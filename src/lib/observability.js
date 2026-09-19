/**
 * CodeCraft Centralized Observability & Diagnostics Module (Phase 10 Hardening).
 *
 * Provides normalized error taxonomy, correlation request IDs,
 * and structured JSON event logging with strict secret scrubbing.
 */

import crypto from "node:crypto";
import { redactSecrets } from "./ai/secretRedaction.js";

/**
 * Standard Normalized Error Taxonomy across all CodeCraft subsystems.
 */
export const ErrorTaxonomy = {
  AUTH_ERROR: "AUTH_ERROR",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AI_PROVIDER_NOT_CONFIGURED: "AI_PROVIDER_NOT_CONFIGURED",
  AI_PROVIDER_TIMEOUT: "AI_PROVIDER_TIMEOUT",
  AI_RATE_LIMITED: "AI_RATE_LIMITED",
  MODEL_ERROR: "MODEL_ERROR",
  INVALID_TOOL_CALL: "INVALID_TOOL_CALL",
  PATCH_CONFLICT: "PATCH_CONFLICT",
  ROLLBACK_CONFLICT: "ROLLBACK_CONFLICT",
  EXECUTION_TIMEOUT: "EXECUTION_TIMEOUT",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  SANDBOX_UNAVAILABLE: "SANDBOX_UNAVAILABLE",
  TEST_FAILED: "TEST_FAILED",
  SYNC_CONFLICT: "SYNC_CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

/**
 * Generates a unique correlation request identifier.
 *
 * @param {string} [prefix="req"]
 * @returns {string}
 */
export function createRequestId(prefix = "req") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Deeply scrubs secrets, bearer tokens, API keys, and credentials from log objects.
 *
 * @param {any} data
 * @returns {any}
 */
export function scrubSensitiveData(data) {
  if (data === null || data === undefined) return data;
  if (typeof data === "string") {
    // Scrub sensitive headers or values
    let scrubbed = redactSecrets(data);
    if (/Bearer\s+[A-Za-z0-9_\-\.]+/i.test(scrubbed)) {
      scrubbed = scrubbed.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer [REDACTED]");
    }
    if (/(api[_-]?key|password|secret|token)[:=]\s*["']?[^"'}\s]+/i.test(scrubbed)) {
      scrubbed = scrubbed.replace(/(api[_-]?key|password|secret|token)([:=]\s*["']?)[^"'}\s]+/gi, "$1$2[REDACTED]");
    }
    return scrubbed;
  }
  if (Array.isArray(data)) {
    return data.map((item) => scrubSensitiveData(item));
  }
  if (typeof data === "object") {
    const scrubbedObj = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("key") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("password") ||
        lowerKey.includes("authorization") ||
        lowerKey.includes("cookie")
      ) {
        scrubbedObj[key] = "[REDACTED]";
      } else {
        scrubbedObj[key] = scrubSensitiveData(value);
      }
    }
    return scrubbedObj;
  }
  return data;
}

/**
 * Emits a structured log event for AI operations with safe metadata.
 *
 * @param {object} params
 * @param {string} params.event
 * @param {string} [params.requestId]
 * @param {string} params.workspaceId
 * @param {string} [params.userId]
 * @param {string} [params.runId]
 * @param {string} [params.model]
 * @param {string} [params.state]
 * @param {number} [params.durationMs]
 * @param {string[]} [params.filesInspected]
 * @param {string[]} [params.filesModified]
 * @param {number} [params.toolCalls]
 * @param {number} [params.iterationCount]
 * @param {string} [params.executionResult]
 * @param {string} [params.testResult]
 * @param {string} [params.errorCategory]
 * @param {string} [params.message]
 */
export function logAgentEvent(params) {
  const safePayload = scrubSensitiveData({
    timestamp: new Date().toISOString(),
    service: "codecraft-agent",
    event: params.event,
    requestId: params.requestId || null,
    workspaceId: params.workspaceId,
    userId: params.userId || "anonymous",
    runId: params.runId || null,
    model: params.model || null,
    state: params.state || null,
    durationMs: typeof params.durationMs === "number" ? Math.round(params.durationMs) : null,
    filesInspected: Array.isArray(params.filesInspected) ? params.filesInspected.length : 0,
    filesModified: Array.isArray(params.filesModified) ? params.filesModified.length : 0,
    toolCalls: params.toolCalls ?? 0,
    iterationCount: params.iterationCount ?? 0,
    executionResult: params.executionResult || null,
    testResult: params.testResult || null,
    errorCategory: params.errorCategory || null,
    message: params.message || null,
  });

  const level = params.errorCategory ? "ERROR" : "INFO";
  const jsonStr = JSON.stringify(safePayload);
  if (level === "ERROR") {
    console.error(`[AGENT_OBSERVABILITY] ${jsonStr}`);
  } else {
    console.log(`[AGENT_OBSERVABILITY] ${jsonStr}`);
  }
  return safePayload;
}

/**
 * Emits a structured log event for execution operations with safe metadata.
 *
 * @param {object} params
 */
export function logExecutionEvent(params) {
  const safePayload = scrubSensitiveData({
    timestamp: new Date().toISOString(),
    service: "codecraft-execution",
    event: params.event,
    requestId: params.requestId || null,
    workspaceId: params.workspaceId,
    userId: params.userId || "anonymous",
    executionId: params.executionId || null,
    language: params.language || null,
    status: params.status || null,
    exitCode: params.exitCode ?? null,
    durationMs: typeof params.durationMs === "number" ? Math.round(params.durationMs) : null,
    outputTruncated: params.outputTruncated ?? false,
    errorCategory: params.errorCategory || null,
  });

  const level = params.status === "SUCCESS" ? "INFO" : "WARN";
  const jsonStr = JSON.stringify(safePayload);
  if (level === "WARN") {
    console.warn(`[EXEC_OBSERVABILITY] ${jsonStr}`);
  } else {
    console.log(`[EXEC_OBSERVABILITY] ${jsonStr}`);
  }
  return safePayload;
}
