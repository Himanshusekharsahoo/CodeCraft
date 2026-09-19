/**
 * Standard Error Taxonomy for CodeCraft Phase 8 AI Coding Agent.
 */

export const AgentErrorCodes = {
  AGENT_UNAUTHORIZED: "AGENT_UNAUTHORIZED",
  AGENT_INVALID_REQUEST: "AGENT_INVALID_REQUEST",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  AGENT_LIMIT_EXCEEDED: "AGENT_LIMIT_EXCEEDED",
  TOOL_NOT_ALLOWED: "TOOL_NOT_ALLOWED",
  TOOL_VALIDATION_ERROR: "TOOL_VALIDATION_ERROR",
  WORKSPACE_ACCESS_DENIED: "WORKSPACE_ACCESS_DENIED",
  FILE_ACCESS_DENIED: "FILE_ACCESS_DENIED",
  PATCH_CONFLICT: "PATCH_CONFLICT",
  MODEL_ERROR: "MODEL_ERROR",
  AI_PROVIDER_NOT_CONFIGURED: "AI_PROVIDER_NOT_CONFIGURED",
  AI_PROVIDER_TIMEOUT: "AI_PROVIDER_TIMEOUT",
  AI_RATE_LIMITED: "AI_RATE_LIMITED",
  INVALID_TOOL_CALL: "INVALID_TOOL_CALL",
  EXECUTION_ERROR: "EXECUTION_ERROR",
  TEST_ERROR: "TEST_ERROR",
  GIT_ERROR: "GIT_ERROR",
  CONTEXT_LIMIT_EXCEEDED: "CONTEXT_LIMIT_EXCEEDED",
  SECRET_REDACTION_ERROR: "SECRET_REDACTION_ERROR",
};

export class AgentError extends Error {
  /**
   * @param {string} code - AgentErrorCode
   * @param {string} message - Human-readable safe error message (no secrets, no internal stack)
   * @param {number} [status=400] - HTTP status code
   * @param {object} [details=null] - Optional safe details object
   */
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      status: this.status,
      details: this.details,
    };
  }
}
