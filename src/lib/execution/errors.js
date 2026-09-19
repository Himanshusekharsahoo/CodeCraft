/**
 * Standardized Error class for CodeCraft Execution Engine.
 */
export class ExecutionError extends Error {
  /**
   * @param {string} code - Standardized error code
   * @param {string} message - User-facing sanitized description
   * @param {number} [status=400] - HTTP status code
   * @param {object} [details={}] - Non-sensitive diagnostic details
   */
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
    this.status = status;
    this.statusCode = status;
    this.details = details;
  }
}

export const ExecutionErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  WORKSPACE_MISMATCH: "WORKSPACE_MISMATCH",
  INVALID_REQUEST: "INVALID_REQUEST",
  UNSUPPORTED_LANGUAGE: "UNSUPPORTED_LANGUAGE",
  SOURCE_LIMIT_EXCEEDED: "SOURCE_LIMIT_EXCEEDED",
  STDIN_LIMIT_EXCEEDED: "STDIN_LIMIT_EXCEEDED",
  FILE_COUNT_LIMIT_EXCEEDED: "FILE_COUNT_LIMIT_EXCEEDED",
  PATH_TRAVERSAL_DETECTED: "PATH_TRAVERSAL_DETECTED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  CONCURRENCY_LIMIT_EXCEEDED: "CONCURRENCY_LIMIT_EXCEEDED",
  EXECUTION_TIMEOUT: "EXECUTION_TIMEOUT",
  OUTPUT_LIMIT_EXCEEDED: "OUTPUT_LIMIT_EXCEEDED",
  EXECUTION_SANDBOX_UNAVAILABLE: "EXECUTIONSANDBOXUNAVAILABLE",
  EXECUTION_CANCELLED: "EXECUTION_CANCELLED",
  SANDBOX_ERROR: "SANDBOX_ERROR",
  NOT_FOUND: "NOT_FOUND",
};
