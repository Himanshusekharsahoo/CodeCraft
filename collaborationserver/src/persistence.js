import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { config } from "./config.js";
import { logger } from "./logger.js";

let db = null;

// Initialize Firestore if Firebase credentials are present and not in test environment
if (!config.isTest && config.firebase.projectId) {
  try {
    const app = getApps().length > 0 ? getApp() : initializeApp(config.firebase);
    db = getFirestore(app);
    logger.info("FIRESTORE_INIT_SUCCESS", { projectId: config.firebase.projectId });
  } catch (error) {
    logger.warn("FIRESTORE_INIT_WARNING", { message: error.message });
  }
}

/**
 * Map tracking pending debounced saves: key => { timer, content, workspaceId, fileId, createdAt }
 * @type {Map<string, { timer: NodeJS.Timeout, content: string, workspaceId: string, fileId: string, createdAt: number }>}
 */
const pendingSaves = new Map();
const testSnapshots = new Map();

/**
 * Returns the Firestore database instance.
 */
export function getDb() {
  return db;
}

/**
 * Sets a custom database instance (used for testing or mock injections).
 */
export function setDb(customDb) {
  db = customDb;
}

/**
 * Returns the count of documents currently pending debounced persistence.
 */
export function getPendingSavesCount() {
  return pendingSaves.size;
}

/**
 * Reads cold file content snapshot from Firestore.
 *
/**
 * Reads cold file content snapshot from Firestore.
 *
 * @param {string} workspaceId
 * @param {string} fileId
 * @param {string} [token] - Authenticated caller Firebase ID token
 * @returns {Promise<string>}
 */
export async function loadSnapshot(workspaceId, fileId, token = null) {
  const key = `${workspaceId}:${fileId}`;
  if (config.isTest) {
    if (testSnapshots.has(key)) {
      return testSnapshots.get(key);
    }
    return "// CodeCraft Collaborative Session\n";
  }

  // Authenticated Firestore REST loading for production (CC-004)
  const projectId = config.firebase.projectId;
  if (token && projectId && !token.startsWith("dev-mock-")) {
    try {
      const fileUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(fileId)}`;
      const res = await fetch(fileUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const docData = await res.json();
        return docData?.fields?.content?.stringValue || "";
      }
    } catch (error) {
      logger.error("LOAD_SNAPSHOT_REST_ERROR", { workspaceId, fileId, error: error.message });
    }
  }

  if (!db) {
    if (testSnapshots.has(key)) {
      return testSnapshots.get(key);
    }
    return "// CodeCraft Collaborative Session\n";
  }

  try {
    const fileRef = doc(db, `workspaces/${workspaceId}/files/${fileId}`);
    const fileSnap = await getDoc(fileRef);

    if (fileSnap.exists()) {
      const data = fileSnap.data();
      return typeof data.content === "string" ? data.content : "";
    }
    return "";
  } catch (error) {
    logger.error("LOAD_SNAPSHOT_ERROR", { workspaceId, fileId, error: error.message });
    return "";
  }
}

/**
 * Debounces writing a snapshot to Firestore.
 * Enforces 3.5s quiet period with a 10s maximum quiet ceiling.
 *
 * @param {string} workspaceId
 * @param {string} fileId
 * @param {string} content
 * @param {string} [token] - Authenticated caller Firebase ID token
 */
export function scheduleSave(workspaceId, fileId, content, token = null) {
  const key = `${workspaceId}:${fileId}`;
  const now = Date.now();

  const existing = pendingSaves.get(key);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const createdAt = existing ? existing.createdAt : now;
  // If editing has been continuous without quiet period past maxQuietPeriodMs, schedule immediate save
  const isMaxQuietExceeded = now - createdAt >= config.persistence.maxQuietPeriodMs;
  const delay = isMaxQuietExceeded ? 0 : config.persistence.debounceMs;
  const effectiveToken = token || existing?.token || null;

  const timer = setTimeout(async () => {
    await flushSave(workspaceId, fileId, content, effectiveToken);
  }, delay);

  pendingSaves.set(key, { timer, content, workspaceId, fileId, token: effectiveToken, createdAt });
}

/**
 * Immediately flushes a specific pending save to Firestore.
 *
 * @param {string} workspaceId
 * @param {string} fileId
 * @param {string} [overrideContent]
 * @param {string} [token] - Authenticated caller Firebase ID token
 */
export async function flushSave(workspaceId, fileId, overrideContent, token = null) {
  const key = `${workspaceId}:${fileId}`;
  const pending = pendingSaves.get(key);

  if (pending) {
    clearTimeout(pending.timer);
    pendingSaves.delete(key);
  }

  const contentToSave = overrideContent !== undefined ? overrideContent : pending?.content;
  if (contentToSave === undefined) return;

  const effectiveToken = token || pending?.token || null;

  // In test environment, persist in memory snapshot map
  if (config.isTest) {
    testSnapshots.set(key, contentToSave);
    return;
  }

  // Authenticated Firestore REST persistence for production (CC-004)
  const projectId = config.firebase.projectId;
  if (effectiveToken && projectId && !effectiveToken.startsWith("dev-mock-")) {
    try {
      const updateUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(fileId)}?updateMask.fieldPaths=content&updateMask.fieldPaths=updatedAt`;
      const res = await fetch(updateUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${effectiveToken}`,
        },
        body: JSON.stringify({
          fields: {
            content: { stringValue: contentToSave },
            updatedAt: { timestampValue: new Date().toISOString() },
          },
        }),
      });

      if (res.ok) {
        logger.debug("SNAPSHOT_SAVED_AUTH", { workspaceId, fileId, bytes: contentToSave.length });
        return;
      } else if (res.status === 404) {
        logger.warn("PERSISTENCE_SKIPPED_DELETED_TARGET", {
          workspaceId,
          fileId,
          reason: "Document was deleted in Firestore; snapshot safely aborted.",
        });
        return;
      } else {
        const errorBody = await res.json().catch(() => ({}));
        logger.error("FLUSH_SAVE_REST_ERROR", {
          workspaceId,
          fileId,
          status: res.status,
          error: errorBody?.error?.message || res.statusText,
        });
        return;
      }
    } catch (error) {
      logger.error("FLUSH_SAVE_REST_EXCEPTION", { workspaceId, fileId, error: error.message });
      return;
    }
  }

  if (!db) {
    testSnapshots.set(key, contentToSave);
    return;
  }

  try {
    const fileRef = doc(db, `workspaces/${workspaceId}/files/${fileId}`);

    // Note: updateDoc fails if the document does not exist, guaranteeing we never resurrect deleted files!
    await updateDoc(fileRef, {
      content: contentToSave,
      updatedAt: serverTimestamp(),
    });

    logger.debug("SNAPSHOT_SAVED", { workspaceId, fileId, bytes: contentToSave.length });
  } catch (error) {
    // Check if failure is due to document/workspace deletion
    const isNotFound =
      error.code === "not-found" ||
      error.message?.includes("NOT_FOUND") ||
      error.message?.includes("No document to update");

    if (isNotFound) {
      logger.warn("PERSISTENCE_SKIPPED_DELETED_TARGET", {
        workspaceId,
        fileId,
        reason: "Document was deleted in Firestore; snapshot safely aborted.",
      });
    } else {
      logger.error("FLUSH_SAVE_ERROR", {
        workspaceId,
        fileId,
        error: error.message,
      });
    }
  }
}

/**
 * Immediately flushes all scheduled saves.
 */
export async function flushAll() {
  const promises = [];
  for (const [key, pending] of pendingSaves.entries()) {
    clearTimeout(pending.timer);
    pendingSaves.delete(key);
    promises.push(flushSave(pending.workspaceId, pending.fileId, pending.content, pending.token));
  }
  await Promise.all(promises);
}

/**
 * Cancels and clears pending debounced saves for a deleted workspace to prevent resurrection (CC-015).
 *
 * @param {string} workspaceId
 * @returns {number} Count of cancelled pending saves
 */
export function cancelPendingSavesForWorkspace(workspaceId) {
  let count = 0;
  for (const [key, pending] of pendingSaves.entries()) {
    if (pending.workspaceId === workspaceId) {
      clearTimeout(pending.timer);
      pendingSaves.delete(key);
      count++;
    }
  }
  return count;
}
