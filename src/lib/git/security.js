import path from "node:path";
import { GitError, GitErrorCodes } from "./errors.js";

const BASE_GIT_DIR = path.resolve(process.cwd(), "data", "git", "workspaces");

/**
 * Validates and sanitizes workspaceId to ensure strict isolation.
 *
 * @param {string} workspaceId
 * @returns {string}
 */
export function sanitizeWorkspaceId(workspaceId) {
  if (
    !workspaceId ||
    typeof workspaceId !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(workspaceId) ||
    workspaceId.length > 128
  ) {
    throw new GitError(
      GitErrorCodes.INVALID_PATH,
      "Invalid workspace identifier format",
      400
    );
  }
  return workspaceId;
}

export const validateWorkspaceId = sanitizeWorkspaceId;

/**
 * Computes the absolute filesystem path for a workspace Git repository.
 *
 * @param {string} workspaceId
 * @returns {string}
 */
export function getWorkspaceRepoDir(workspaceId) {
  const sanitized = sanitizeWorkspaceId(workspaceId);
  const repoDir = path.resolve(BASE_GIT_DIR, sanitized);

  // Guarantee repo directory cannot escape BASE_GIT_DIR
  if (!repoDir.startsWith(BASE_GIT_DIR + path.sep)) {
    throw new GitError(
      GitErrorCodes.REPOSITORY_ESCAPE_DETECTED,
      "Workspace repository escapes root storage boundary",
      403
    );
  }
  return repoDir;
}

/**
 * Resolves and validates a relative file path inside a repository working tree.
 * Defends against path traversal (../), absolute paths, repository escape,
 * and direct manipulation of .git internals.
 *
 * @param {string} repoDir - The repository root path
 * @param {string} rawPath - The untrusted relative file path
 * @returns {{ relativePath: string, fullPath: string }}
 */
export function resolveSafePath(repoDir, rawPath) {
  if (!rawPath || typeof rawPath !== "string") {
    throw new GitError(
      GitErrorCodes.INVALID_PATH,
      "File path must be a non-empty string",
      400
    );
  }

  // Reject drive letters on Windows (e.g. C:, D:) or leading slashes
  if (path.isAbsolute(rawPath) || /^[a-zA-Z]:/.test(rawPath) || rawPath.startsWith("/") || rawPath.startsWith("\\")) {
    throw new GitError(
      GitErrorCodes.PATH_TRAVERSAL_DETECTED,
      "Absolute paths and drive prefixes are prohibited",
      400
    );
  }

  const normalized = path.normalize(rawPath).replace(/\\/g, "/");

  // Check for traversal segments
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    throw new GitError(
      GitErrorCodes.PATH_TRAVERSAL_DETECTED,
      "Path traversal sequence detected",
      400
    );
  }

  // Prevent direct access to .git metadata or objects
  const segments = normalized.split("/");
  if (segments.some((s) => s.toLowerCase() === ".git")) {
    throw new GitError(
      GitErrorCodes.GIT_INTERNALS_PROTECTED,
      "Direct access to .git internals is prohibited",
      403
    );
  }

  const fullPath = path.resolve(repoDir, normalized);

  // Strict boundary check: resolved path must reside strictly within repoDir
  if (!fullPath.startsWith(repoDir + path.sep) && fullPath !== repoDir) {
    throw new GitError(
      GitErrorCodes.REPOSITORY_ESCAPE_DETECTED,
      "Resolved path escapes repository root",
      403
    );
  }

  return { relativePath: normalized, fullPath };
}

/**
 * Validates a Git branch name according to git-check-ref-format standards.
 *
 * @param {string} branchName
 * @returns {string}
 */
export function validateBranchName(branchName) {
  if (
    !branchName ||
    typeof branchName !== "string" ||
    branchName.length > 100 ||
    !/^[a-zA-Z0-9_\-\.\/]+$/.test(branchName)
  ) {
    throw new GitError(
      GitErrorCodes.INVALID_BRANCH_NAME,
      "Branch name contains invalid characters or exceeds 100 characters",
      400
    );
  }

  if (
    branchName.startsWith("-") ||
    branchName.startsWith(".") ||
    branchName.endsWith(".") ||
    branchName.endsWith(".lock") ||
    branchName.startsWith("/") ||
    branchName.endsWith("/") ||
    branchName.includes("..") ||
    branchName.includes("//") ||
    branchName.includes("@{")
  ) {
    throw new GitError(
      GitErrorCodes.INVALID_BRANCH_NAME,
      "Branch name violates Git ref format rules",
      400
    );
  }

  return branchName;
}

/**
 * Validates a Git commit hash or revision string.
 *
 * @param {string} commitHash
 * @returns {string}
 */
export function validateCommitHash(commitHash) {
  if (
    !commitHash ||
    typeof commitHash !== "string" ||
    !/^[a-fA-F0-9]{4,40}$/.test(commitHash)
  ) {
    throw new GitError(
      GitErrorCodes.INVALID_REVISION,
      "Invalid commit hash or revision format",
      400
    );
  }
  return commitHash.toLowerCase();
}

/**
 * Validates and trims a commit message.
 *
 * @param {string} message
 * @returns {string}
 */
export function validateCommitMessage(message) {
  if (!message || typeof message !== "string") {
    throw new GitError(
      GitErrorCodes.INVALID_COMMIT_MESSAGE,
      "Commit message is required",
      400
    );
  }

  const trimmed = message.trim();
  if (trimmed.length === 0) {
    throw new GitError(
      GitErrorCodes.INVALID_COMMIT_MESSAGE,
      "Commit message cannot be empty or whitespace-only",
      400
    );
  }

  if (trimmed.length > 2000) {
    throw new GitError(
      GitErrorCodes.INVALID_COMMIT_MESSAGE,
      "Commit message exceeds maximum allowed length of 2,000 characters",
      400
    );
  }

  return trimmed;
}

/**
 * Sanitizes author metadata to avoid Git CLI parameter injection.
 *
 * @param {string} name
 * @param {string} email
 * @returns {{ name: string, email: string }}
 */
export function sanitizeAuthor(name, email) {
  const safeName = (name || "CodeCraft Collaborator")
    .replace(/[\r\n<>"]/g, "")
    .trim() || "CodeCraft Collaborator";
  const safeEmail = (email || "git@codecraft.local")
    .replace(/[\r\n<>\s"]/g, "")
    .trim() || "git@codecraft.local";

  return { name: safeName, email: safeEmail };
}
