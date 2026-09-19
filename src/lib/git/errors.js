/**
 * Custom Error class for CodeCraft Git operations.
 * Maps internal Git CLI and authorization failures into structured application errors.
 */
export class GitError extends Error {
  /**
   * @param {string} code - Standardized error code
   * @param {string} message - Safe user-facing description
   * @param {number} [status=400] - HTTP status code
   * @param {object} [details={}] - Non-sensitive diagnostic metadata
   */
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.status = status;
    this.statusCode = status;
    this.details = details;
  }
}

export const GitErrorCodes = {
  REPOSITORY_NOT_INITIALIZED: "REPOSITORY_NOT_INITIALIZED",
  REPOSITORY_ALREADY_EXISTS: "REPOSITORY_ALREADY_EXISTS",
  WORKTREE_DIRTY: "WORKTREE_DIRTY",
  BRANCH_NOT_FOUND: "BRANCH_NOT_FOUND",
  BRANCH_ALREADY_EXISTS: "BRANCH_ALREADY_EXISTS",
  INVALID_BRANCH_NAME: "INVALID_BRANCH_NAME",
  MERGE_CONFLICT: "MERGE_CONFLICT",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  INVALID_REVISION: "INVALID_REVISION",
  INVALID_COMMIT_MESSAGE: "INVALID_COMMIT_MESSAGE",
  INVALID_PATH: "INVALID_PATH",
  PATH_TRAVERSAL_DETECTED: "PATH_TRAVERSAL_DETECTED",
  GIT_INTERNALS_PROTECTED: "GIT_INTERNALS_PROTECTED",
  REPOSITORY_ESCAPE_DETECTED: "REPOSITORY_ESCAPE_DETECTED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UNAUTHORIZED: "UNAUTHORIZED",
  GIT_OPERATION_FAILED: "GIT_OPERATION_FAILED",
};
