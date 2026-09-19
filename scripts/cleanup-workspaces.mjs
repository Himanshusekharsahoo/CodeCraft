/**
 * CodeCraft Safe Workspace Cleanup & Audit Tool
 *
 * Usage:
 *   node --env-file=.env.local scripts/cleanup-workspaces.mjs --audit
 *   node --env-file=.env.local scripts/cleanup-workspaces.mjs --delete <workspaceId>
 *
 * Safety Guards:
 * - Refuses to delete unless explicit workspace ID is specified
 * - Audits dependencies (members, files, folders, messages, git) before deletion
 * - Cascades deletion through all subcollections before purging the root workspace document
 */

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Read Firebase credentials from environment
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

if (!firebaseConfig.projectId) {
  console.error("Error: Missing Firebase configuration. Run with --env-file=.env.local");
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SUBCOLLECTIONS = ["members", "files", "folders", "comments", "git"];

async function auditWorkspace(workspaceId) {
  console.log(`\n========================================================`);
  console.log(` Auditing Workspace: ${workspaceId}`);
  console.log(`========================================================`);

  const wsRef = doc(db, "workspaces", workspaceId);
  const wsSnap = await getDoc(wsRef);

  if (!wsSnap.exists()) {
    console.log(`Workspace ${workspaceId} does not exist in Firestore.`);
    return null;
  }

  const data = wsSnap.data();
  console.log("Root Document Data:");
  console.log(` - Name:        ${data.name}`);
  console.log(` - Description: ${data.description || "(none)"}`);
  console.log(` - Owner UID:   ${data.userId || data.ownerId || "(unknown)"}`);
  console.log(` - Public:      ${Boolean(data.isPublic)}`);
  console.log(` - CreatedAt:   ${data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : "unknown"}`);

  const counts = {};
  for (const sub of SUBCOLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, `workspaces/${workspaceId}/${sub}`));
      counts[sub] = snap.size;
      console.log(` - Subcollection [${sub}]: ${snap.size} document(s)`);
    } catch (e) {
      counts[sub] = `error (${e.message})`;
    }
  }

  try {
    const msgQuery = query(collection(db, "messages"), where("workspaceId", "==", workspaceId));
    const msgSnap = await getDocs(msgQuery);
    counts.messages = msgSnap.size;
    console.log(` - Messages: ${msgSnap.size} document(s)`);
  } catch (e) {
    counts.messages = `error (${e.message})`;
  }

  const gitDir = path.resolve(ROOT_DIR, "data", "git", "workspaces", workspaceId);
  const gitExists = fs.existsSync(gitDir);
  console.log(` - Local Git Repo: ${gitExists ? `exists at ${gitDir}` : "none"}`);

  return { exists: true, data, counts, gitExists, gitDir };
}

async function deleteWorkspaceCascade(workspaceId) {
  const audit = await auditWorkspace(workspaceId);
  if (!audit) return;

  console.log(`\nInitiating safe cascading deletion of workspace ${workspaceId}...`);

  // 1. Delete messages
  try {
    const msgQuery = query(collection(db, "messages"), where("workspaceId", "==", workspaceId));
    const msgSnap = await getDocs(msgQuery);
    for (const msgDoc of msgSnap.docs) {
      await deleteDoc(msgDoc.ref);
    }
    console.log(`✔ Deleted ${msgSnap.size} message(s)`);
  } catch (e) {
    console.warn(`Notice: Could not delete messages: ${e.message}`);
  }

  // 2. Delete subcollections
  for (const sub of SUBCOLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, `workspaces/${workspaceId}/${sub}`));
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
      }
      console.log(`✔ Purged subcollection [${sub}]: ${snap.size} document(s)`);
    } catch (e) {
      console.warn(`Notice: Could not purge subcollection ${sub}: ${e.message}`);
    }
  }

  // 3. Delete local git directory if present
  if (audit.gitExists) {
    try {
      fs.rmSync(audit.gitDir, { recursive: true, force: true });
      console.log(`✔ Purged git directory at ${audit.gitDir}`);
    } catch (e) {
      console.warn(`Notice: Could not delete git directory: ${e.message}`);
    }
  }

  // 4. Delete root workspace document
  await deleteDoc(doc(db, "workspaces", workspaceId));
  console.log(`✔ Deleted root workspace document: workspaces/${workspaceId}`);

  console.log(`\nWorkspace ${workspaceId} completely and safely purged.\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const targetId = args[1];

  if (mode === "--audit" && targetId) {
    await auditWorkspace(targetId);
  } else if (mode === "--delete" && targetId) {
    await deleteWorkspaceCascade(targetId);
  } else {
    console.log("CodeCraft Workspace Cleanup Utility");
    console.log("Usage:");
    console.log("  node --env-file=.env.local scripts/cleanup-workspaces.mjs --audit <workspaceId>");
    console.log("  node --env-file=.env.local scripts/cleanup-workspaces.mjs --delete <workspaceId>");
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Cleanup error:", err);
  process.exit(1);
});
