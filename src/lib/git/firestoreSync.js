import fs from "node:fs";
import path from "node:path";
import { collection, getDocs, doc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "../../config/firebase.js";
import { getWorkspaceRepoDir, resolveSafePath } from "./security.js";
import { GitError, GitErrorCodes } from "./errors.js";

/**
 * Traverses the disk directory recursively, omitting .git and specified excludes.
 *
 * @param {string} dir
 * @param {string} baseDir
 * @returns {Array<{ relativePath: string, fullPath: string }>}
 */
function scanDiskFiles(dir, baseDir = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDiskFiles(full, baseDir));
    } else if (entry.isFile()) {
      const rel = path.relative(baseDir, full).replace(/\\/g, "/");
      results.push({ relativePath: rel, fullPath: full });
    }
  }
  return results;
}

/**
 * Removes empty directories recursively.
 *
 * @param {string} dir
 * @param {string} rootDir
 */
function cleanupEmptyDirs(dir, rootDir) {
  if (!fs.existsSync(dir) || dir === rootDir) return;
  const entries = fs.readdirSync(dir);
  if (entries.length === 0) {
    try {
      fs.rmdirSync(dir);
      cleanupEmptyDirs(path.dirname(dir), rootDir);
    } catch {
      // Ignore if dir cannot be removed
    }
  }
}

/**
 * Requests the collaboration server to flush pending debounced saves to Firestore
 * before reading workspace state for Git or AI operations.
 *
 * @param {string} workspaceId
 * @returns {Promise<boolean>}
 */
export async function requestCollabFlush(workspaceId) {
  try {
    const serverUrl = process.env.NEXT_PUBLIC_COLLAB_HTTP_URL || "http://localhost:1234";
    const internalSecret = process.env.COLLAB_INTERNAL_SECRET || process.env.INTERNAL_SERVICE_KEY || "cc-collab-internal-service-secret";
    const res = await fetch(`${serverUrl}/flush`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-collab-internal-token": internalSecret,
      },
      body: JSON.stringify({ workspaceId }),
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    // If collaboration server is not running or unreachable, fail gracefully
    return false;
  }
}

/**
 * Notifies the collaboration server of an external disk mutation (e.g. Git restore or AI patch)
 * so that active in-memory Yjs documents update live in open Monaco editor sessions.
 *
 * @param {string} workspaceId
 * @param {string} fileId
 * @param {string} content
 * @returns {Promise<boolean>}
 */
export async function notifyCollabMutation(workspaceId, fileId, content) {
  try {
    const serverUrl = process.env.NEXT_PUBLIC_COLLAB_HTTP_URL || "http://localhost:1234";
    const internalSecret = process.env.COLLAB_INTERNAL_SECRET || process.env.INTERNAL_SERVICE_KEY || "cc-collab-internal-service-secret";
    const res = await fetch(`${serverUrl}/notify-mutation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-collab-internal-token": internalSecret,
      },
      body: JSON.stringify({ workspaceId, fileId, content }),
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Queries Firestore documents via authenticated REST API (CC-005).
 */
async function fetchFirestoreCollection(workspaceId, subcollection, token) {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  if (!projectId || !token || token.startsWith("dev-mock-") || token.startsWith("test-token-")) {
    return null;
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/workspaces/${encodeURIComponent(workspaceId)}/${encodeURIComponent(subcollection)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      if (res.status === 404) return [];
      return null;
    }

    const data = await res.json();
    const documents = data.documents || [];
    return documents.map((d) => {
      const id = d.name ? d.name.split("/").pop() : "";
      const fields = d.fields || {};
      const obj = { id };
      for (const [key, val] of Object.entries(fields)) {
        if (val.stringValue !== undefined) obj[key] = val.stringValue;
        else if (val.booleanValue !== undefined) obj[key] = val.booleanValue;
        else if (val.integerValue !== undefined) obj[key] = parseInt(val.integerValue, 10);
        else if (val.doubleValue !== undefined) obj[key] = parseFloat(val.doubleValue);
        else if (val.timestampValue !== undefined) obj[key] = val.timestampValue;
        else if (val.nullValue !== undefined) obj[key] = null;
      }
      return obj;
    });
  } catch (err) {
    console.warn(`[firestoreSync] REST collection error for ${subcollection}:`, err.message);
    return null;
  }
}

/**
 * Synchronizes workspace documents from Cloud Firestore into the local Git working tree.
 *
 * @param {string} workspaceId
 * @param {string} [token] - Authenticated caller Firebase ID token
 * @returns {Promise<{ syncedCount: number, syncedFiles: string[], removedFiles: string[] }>}
 */
export async function syncFirestoreToWorkingTree(workspaceId, token = null) {
  if (!token && process.env.NODE_ENV === "production") {
    throw new GitError(
      GitErrorCodes.AUTHENTICATION_REQUIRED,
      "Authenticated user token required for Firestore sync in production",
      401
    );
  }

  // 1. Flush any pending collaboration server changes to Firestore first
  await requestCollabFlush(workspaceId);

  const repoDir = getWorkspaceRepoDir(workspaceId);
  fs.mkdirSync(repoDir, { recursive: true });

  const syncedFiles = [];
  const removedFiles = [];

  let folders = [];
  let files = [];

  try {
    let restFolders = null;
    let restFiles = null;
    if (token) {
      restFolders = await fetchFirestoreCollection(workspaceId, "folders", token);
      restFiles = await fetchFirestoreCollection(workspaceId, "files", token);
    }

    if (restFolders !== null && restFiles !== null) {
      folders = restFolders;
      files = restFiles;
    } else {
      const foldersRef = collection(db, `workspaces/${workspaceId}/folders`);
      const foldersSnap = await getDocs(foldersRef);
      folders = foldersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const filesRef = collection(db, `workspaces/${workspaceId}/files`);
      const filesSnap = await getDocs(filesRef);
      files = filesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {
    // If running in isolated test mode or Firestore is unavailable, log warning and return
    console.warn(`[firestoreSync] Warning reading Firestore for workspace ${workspaceId}:`, err.message);
    return { syncedCount: 0, syncedFiles: [], removedFiles: [] };
  }

  // Build folder path lookup
  const folderMap = new Map(folders.map((f) => [f.id, f]));
  const getFolderPath = (folderId) => {
    const parts = [];
    let currentId = folderId;
    const visited = new Set();
    while (currentId && folderMap.has(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      const f = folderMap.get(currentId);
      if (f?.name) parts.unshift(f.name);
      currentId = f?.parentFolderId;
    }
    return parts.join("/");
  };

  const expectedRelPaths = new Set();

  // Write all current Firestore files to working tree
  for (const file of files) {
    if (!file.name) continue;
    const folderPath = file.folderId ? getFolderPath(file.folderId) : "";
    const rawRelPath = folderPath ? `${folderPath}/${file.name}` : file.name;

    try {
      const { safeRelativePath, fullPath } = resolveSafePath(repoDir, rawRelPath);
      expectedRelPaths.add(safeRelativePath);

      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      const content = typeof file.content === "string" ? file.content : "";
      fs.writeFileSync(fullPath, content.replace(/\r\n/g, "\n"), "utf8");
      syncedFiles.push(safeRelativePath);
    } catch (err) {
      console.warn(`[firestoreSync] Failed writing file ${rawRelPath}:`, err.message);
    }
  }

  // Remove files from working tree that no longer exist in Firestore (except .git and .gitignore)
  const diskFiles = scanDiskFiles(repoDir);
  for (const diskFile of diskFiles) {
    if (diskFile.relativePath === ".gitignore") continue;
    if (!expectedRelPaths.has(diskFile.relativePath)) {
      try {
        fs.unlinkSync(diskFile.fullPath);
        removedFiles.push(diskFile.relativePath);
        cleanupEmptyDirs(path.dirname(diskFile.fullPath), repoDir);
      } catch (err) {
        console.warn(`[firestoreSync] Failed removing deleted file ${diskFile.relativePath}:`, err.message);
      }
    }
  }

  return {
    syncedCount: syncedFiles.length,
    syncedFiles,
    removedFiles,
  };
}

/**
 * Synchronizes the working tree files (e.g. after a branch switch or file restore) back into Cloud Firestore.
 *
 * @param {string} workspaceId
 * @param {string} [token] - Authenticated caller Firebase ID token
 * @returns {Promise<{ updatedFiles: string[], deletedFiles: string[] }>}
 */
export async function syncWorkingTreeToFirestore(workspaceId, token = null) {
  if (!token && process.env.NODE_ENV === "production") {
    throw new GitError(
      GitErrorCodes.AUTHENTICATION_REQUIRED,
      "Authenticated user token required for Firestore sync in production",
      401
    );
  }

  const repoDir = getWorkspaceRepoDir(workspaceId);
  const updatedFiles = [];
  const deletedFiles = [];

  if (!fs.existsSync(repoDir)) {
    return { updatedFiles, deletedFiles };
  }

  let existingFolders = [];
  let existingFiles = [];

  try {
    let restFolders = null;
    let restFiles = null;
    if (token) {
      restFolders = await fetchFirestoreCollection(workspaceId, "folders", token);
      restFiles = await fetchFirestoreCollection(workspaceId, "files", token);
    }

    if (restFolders !== null && restFiles !== null) {
      existingFolders = restFolders;
      existingFiles = restFiles;
    } else {
      const foldersRef = collection(db, `workspaces/${workspaceId}/folders`);
      const foldersSnap = await getDocs(foldersRef);
      existingFolders = foldersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const filesRef = collection(db, `workspaces/${workspaceId}/files`);
      const filesSnap = await getDocs(filesRef);
      existingFiles = filesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch (err) {
    console.warn(`[firestoreSync] Warning querying Firestore for reverse sync:`, err.message);
    return { updatedFiles, deletedFiles };
  }

  // Build existing path map
  const folderMap = new Map(existingFolders.map((f) => [f.id, f]));
  const getFolderPath = (folderId) => {
    const parts = [];
    let currentId = folderId;
    const visited = new Set();
    while (currentId && folderMap.has(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      const f = folderMap.get(currentId);
      if (f?.name) parts.unshift(f.name);
      currentId = f?.parentFolderId;
    }
    return parts.join("/");
  };

  const existingFileByPath = new Map();
  for (const f of existingFiles) {
    const folderPath = f.folderId ? getFolderPath(f.folderId) : "";
    const rel = folderPath ? `${folderPath}/${f.name}` : f.name;
    existingFileByPath.set(rel, f);
  }

  // Scan disk files
  const diskFiles = scanDiskFiles(repoDir).filter((f) => f.relativePath !== ".gitignore");
  const diskPaths = new Set(diskFiles.map((f) => f.relativePath));

  // Helper to ensure nested folder hierarchy exists in Firestore
  const ensureFolderHierarchy = async (folderPathParts) => {
    let parentFolderId = null;
    let accumulatedPath = "";

    for (const folderName of folderPathParts) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${folderName}` : folderName;
      let match = existingFolders.find(
        (f) => f.name === folderName && (f.parentFolderId || null) === (parentFolderId || null)
      );

      if (!match) {
        const newFolderRef = doc(collection(db, `workspaces/${workspaceId}/folders`));
        const newFolderData = {
          name: folderName,
          parentFolderId: parentFolderId || null,
          createdAt: new Date().toISOString(),
        };
        await setDoc(newFolderRef, newFolderData);
        match = { id: newFolderRef.id, ...newFolderData };
        existingFolders.push(match);
        folderMap.set(match.id, match);
      }

      parentFolderId = match.id;
    }
    return parentFolderId;
  };

  // Upsert files from working tree into Firestore
  for (const diskFile of diskFiles) {
    const content = fs.readFileSync(diskFile.fullPath, "utf8");
    const segments = diskFile.relativePath.split("/");
    const fileName = segments.pop();
    const folderSegments = segments;

    const folderId = folderSegments.length > 0 ? await ensureFolderHierarchy(folderSegments) : null;
    const existing = existingFileByPath.get(diskFile.relativePath);

    if (existing) {
      const fileRef = doc(db, `workspaces/${workspaceId}/files/${existing.id}`);
      await setDoc(fileRef, { ...existing, content }, { merge: true });
      await notifyCollabMutation(workspaceId, existing.id, content);
    } else {
      const newFileRef = doc(collection(db, `workspaces/${workspaceId}/files`));
      await setDoc(newFileRef, {
        name: fileName,
        folderId: folderId || null,
        workspaceId,
        content,
        createdAt: new Date().toISOString(),
      });
    }
    updatedFiles.push(diskFile.relativePath);
  }

  // Delete files from Firestore that are no longer on disk
  for (const [relPath, existingFile] of existingFileByPath.entries()) {
    if (!diskPaths.has(relPath)) {
      try {
        const fileRef = doc(db, `workspaces/${workspaceId}/files/${existingFile.id}`);
        await deleteDoc(fileRef);
        deletedFiles.push(relPath);
      } catch (err) {
        console.warn(`[firestoreSync] Error deleting Firestore file ${relPath}:`, err.message);
      }
    }
  }

  return { updatedFiles, deletedFiles };
}
