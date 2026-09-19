import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRepoDir, resolveSafePath } from "../git/security.js";
import { syncWorkingTreeToFirestore } from "../git/firestoreSync.js";
import { AgentError, AgentErrorCodes } from "./agentErrors.js";

/**
 * Safe Rollback Engine for Phase 8 AI Coding Agent.
 *
 * Reverts ONLY the specific files modified or created during an agent run,
 * without executing a destructive `git reset --hard` that could wipe collaborator edits.
 */
export class SafeRollbackService {
  /**
   * Reverts changes made during an agent run using recorded pre-run snapshots.
   *
   * @param {string} workspaceId
   * @param {object} runRecord
   * @param {Map<string, string|null> | object} runRecord.preRunSnapshots - file relative path => original content (or null if newly created)
   * @returns {Promise<{ rolledBack: boolean, restoredFiles: string[], removedFiles: string[] }>}
   */
  static async rollbackRun(workspaceId, runRecord) {
    if (!workspaceId) {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, "Missing workspaceId for rollback", 400);
    }

    const repoDir = getWorkspaceRepoDir(workspaceId);
    if (!fs.existsSync(repoDir)) {
      throw new AgentError(AgentErrorCodes.GIT_ERROR, "Workspace repository does not exist", 404);
    }

    const snapshots = runRecord?.preRunSnapshots instanceof Map
      ? runRecord.preRunSnapshots
      : new Map(Object.entries(runRecord?.preRunSnapshots || {}));

    if (snapshots.size === 0) {
      return {
        rolledBack: true,
        restoredFiles: [],
        removedFiles: [],
        message: "No file changes were recorded for this agent run.",
      };
    }

    const restoredFiles = [];
    const removedFiles = [];

    const patchedSnapshots = runRecord?.agentPatchedContent instanceof Map
      ? runRecord.agentPatchedContent
      : new Map(Object.entries(runRecord?.agentPatchedContent || {}));

    for (const [relPath, originalContent] of snapshots.entries()) {
      try {
        const { fullPath } = resolveSafePath(repoDir, relPath);

        // Collaborator concurrency guard:
        // If agent patched content was tracked and file was modified post-run by a collaborator,
        // abort rollback to prevent destroying the human collaborator's work.
        if (patchedSnapshots.has(relPath) && fs.existsSync(fullPath)) {
          const expectedAgentContent = patchedSnapshots.get(relPath);
          if (typeof expectedAgentContent === "string") {
            const currentDiskContent = fs.readFileSync(fullPath, "utf8");
            const normDisk = currentDiskContent.replace(/\r\n/g, "\n");
            const normAgent = expectedAgentContent.replace(/\r\n/g, "\n");

            if (normDisk !== normAgent) {
              throw new AgentError(
                AgentErrorCodes.PATCH_CONFLICT,
                `ROLLBACK_CONFLICT: File '${relPath}' was modified by a collaborator after the agent modified it. Rollback aborted to prevent overwriting collaborator work.`,
                409
              );
            }
          }
        }

        if (originalContent === null) {
          // File was newly created by agent -> delete it
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            removedFiles.push(relPath);
          }
        } else {
          // File was modified -> restore original content
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, originalContent, "utf8");
          restoredFiles.push(relPath);
        }
      } catch (err) {
        if (err instanceof AgentError) throw err;
        throw new AgentError(
          AgentErrorCodes.GIT_ERROR,
          `Failed during safe rollback of ${relPath}: ${err.message}`,
          500
        );
      }
    }

    // Sync disk changes back to Firestore
    await syncWorkingTreeToFirestore(workspaceId).catch((err) => {
      console.warn("[SafeRollback] Firestore reverse sync warning:", err.message);
    });

    return {
      rolledBack: true,
      restoredFiles,
      removedFiles,
      totalAffected: restoredFiles.length + removedFiles.length,
    };
  }
}
