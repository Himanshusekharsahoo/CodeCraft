import { NextResponse } from "next/server";
import { AgentError, AgentErrorCodes } from "./agentErrors.js";

/**
 * Standardized JSON success response for AI Agent API.
 *
 * @param {any} data
 * @param {number} [status=200]
 * @returns {NextResponse}
 */
export function jsonSuccess(data, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

/**
 * Standardized JSON error response for AI Agent API.
 *
 * @param {any} error
 * @returns {NextResponse}
 */
export function jsonError(error) {
  if (error instanceof AgentError) {
    const headers = {};
    if ((error.status === 429 || error.code === AgentErrorCodes.AI_RATE_LIMITED) && error.retryAfterSeconds) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details || null,
        retryAfter: error.retryAfterSeconds || null,
      },
      { status: error.status || 400, headers }
    );
  }

  const message = error?.message || "An unexpected error occurred in AI Agent execution";
  const status = error?.status || error?.statusCode || 500;
  const code = error?.code || (status === 401 ? "UNAUTHORIZED" : status === 403 ? "PERMISSION_DENIED" : AgentErrorCodes.MODEL_ERROR);

  return NextResponse.json(
    {
      success: false,
      error: message,
      code,
      details: null,
    },
    { status }
  );
}
