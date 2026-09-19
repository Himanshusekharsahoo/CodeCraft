/**
 * CodeCraft Centralized Error Normalization & Observability Utility.
 *
 * Ensures all errors, rejections, API failures, and plain objects are normalized
 * into standard, meaningful Error instances while strictly redacting sensitive
 * tokens, credentials, and API keys.
 */

import { redactSecrets } from "./ai/secretRedaction.js";

export class NormalizedAppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = options.name || "NormalizedAppError";
    this.code = options.code || "APP_ERROR";
    this.status = typeof options.status === "number" ? options.status : (options.statusCode ?? 500);
    this.details = options.details || null;
    this.originalError = options.originalError || null;
    this.isCancellation = Boolean(options.isCancellation);
    if (options.stack) {
      this.stack = options.stack;
    }
  }
}

/**
 * Deeply scrubs sensitive tokens, Gemini API keys, Firebase tokens, and passwords.
 *
 * @param {string} text - Raw string possibly containing secrets
 * @returns {string} Sanitized string
 */
export function scrubErrorMessage(text) {
  if (!text || typeof text !== "string") return "";

  // Apply base redaction from secretRedaction
  let scrubbed = redactSecrets(text);

  // Redact Gemini / Google API keys
  scrubbed = scrubbed.replace(/AIza[0-9A-Za-z_-]{30,45}/g, "[REDACTED_GEMINI_KEY]");

  // Redact Bearer tokens
  scrubbed = scrubbed.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer [REDACTED_TOKEN]");

  // Redact Firebase ID tokens / JWT pattern (header.payload.signature)
  scrubbed = scrubbed.replace(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, "[REDACTED_JWT_TOKEN]");

  // Redact generic key/token/password key-value pairs
  scrubbed = scrubbed.replace(
    /([a-zA-Z0-9_-]*(?:api[_-]?key|secret|token|password|auth|credential)[a-zA-Z0-9_-]*\s*[:=]\s*["']?)[^"'}\s,]+/gi,
    "$1[REDACTED_SECRET]"
  );

  return scrubbed;
}

/**
 * Recursively and safely extracts a string message from an error value or object,
 * preventing any coercion into "[object Object]".
 *
 * @param {any} val
 * @returns {string | null}
 */
export function extractMessageString(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "[object Object]" || !trimmed) return null;
    return trimmed;
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (typeof val === "object") {
    // Check common message properties
    const candidates = [
      val.message,
      val.msg,
      val.errorMessage,
      val.description,
      val.details?.message,
      val.details,
      val.error,
      val.response?.data?.error,
      val.response?.data?.message,
      val.response?.data,
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed && trimmed !== "[object Object]") return trimmed;
      } else if (typeof candidate === "object" && candidate !== val) {
        const nested = extractMessageString(candidate);
        if (nested) return nested;
      }
    }
  }
  return null;
}

/**
 * Detects whether an error or rejection reason is an expected, intentional cancellation
 * (such as Monaco Editor unmount, DOM AbortController, Axios cancel, or user abort).
 *
 * @param {any} err - The error or rejection reason
 * @returns {boolean} True if this is an intentional cancellation that should not be treated as a crash
 */
export function isExpectedCancellation(err) {
  if (!err) return false;

  // 1. Monaco Editor makeCancelable cancellation
  // e.g. { type: 'cancelation', msg: 'operation is manually canceled' }
  if (
    err.type === "cancelation" &&
    (err.msg === "operation is manually canceled" ||
      (typeof err.msg === "string" && err.msg.toLowerCase().includes("manually canceled")))
  ) {
    return true;
  }

  // 2. DOMException / Standard AbortError
  if (
    err.name === "AbortError" ||
    (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") ||
    err.code === 20 || // DOMException.ABORT_ERR
    err.code === "ABORT_ERR"
  ) {
    return true;
  }

  // 3. Axios / HTTP Client cancellation
  if (
    err.__CANCEL__ === true ||
    err.name === "CanceledError" ||
    err.code === "ERR_CANCELED"
  ) {
    return true;
  }

  // 4. CodeCraft application-level cancellation flags
  if (
    err.isCancellation === true ||
    err.code === "OPERATION_CANCELED" ||
    err.code === "EXECUTION_CANCELLED" ||
    err.status === "cancelled" ||
    err.status === "canceled"
  ) {
    return true;
  }

  // 5. Message checks for standard aborts & manual cancels
  const msg = extractMessageString(err);
  if (typeof msg === "string") {
    const lower = msg.toLowerCase();
    if (
      lower.includes("operation is manually canceled") ||
      lower.includes("the user aborted a request") ||
      lower.includes("operation was aborted") ||
      lower.includes("signal is aborted without reason") ||
      lower.includes("the operation was aborted") ||
      lower.includes("bodystreambuffer was aborted")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Normalizes any error, plain object, rejection reason, or status into a proper Error instance.
 *
 * - Expected cancellations are marked with isCancellation: true and code OPERATION_CANCELED.
 * - Error instances retain their instance type, stack trace, code, and status with messages sanitized.
 * - Plain objects (e.g. { error, code, status } or { message, details }) are converted into Error instances.
 * - HTTP status codes and Firebase error codes (e.g. auth/*, permission-denied) are preserved.
 * - Gemini AI error statuses/categories (e.g. AI_RATE_LIMITED, 429) are preserved.
 * - Sensitive secrets, Bearer tokens, and API keys are strictly redacted.
 * - Never returns "[object Object]" under any condition.
 *
 * @param {any} err - The error or rejection reason
 * @param {string} [fallbackMessage="An unexpected error occurred"]
 * @returns {NormalizedAppError | Error} Normalized, safe Error instance
 */
export function normalizeError(err, fallbackMessage = "An unexpected error occurred") {
  if (err === null || err === undefined) {
    return new NormalizedAppError(fallbackMessage, { code: "UNKNOWN_ERROR", status: 500 });
  }

  // 0. Expected cancellations: cleanly normalize without treating as fatal
  if (isExpectedCancellation(err)) {
    const cancelMsg = extractMessageString(err) || "Operation was canceled";
    return new NormalizedAppError(scrubErrorMessage(cancelMsg), {
      code: "OPERATION_CANCELED",
      status: 0,
      isCancellation: true,
      originalError: err,
    });
  }

  // 1. If it's already an instance of Error
  if (err instanceof Error) {
    const rawMessage = extractMessageString(err.message) || fallbackMessage;
    err.message = scrubErrorMessage(rawMessage);

    // Ensure status and code properties are preserved/extracted if present on Axios or custom Error
    const status = err.status || err.statusCode || err.response?.status || null;
    const code = err.code || err.response?.data?.code || (status === 429 ? "AI_RATE_LIMITED" : null);

    if (status && !err.status) err.status = status;
    if (code && !err.code) err.code = code;

    return err;
  }

  // 2. If it's a string
  if (typeof err === "string") {
    const clean = extractMessageString(err);
    return new NormalizedAppError(scrubErrorMessage(clean || fallbackMessage), {
      code: "ERROR_STRING",
      status: 500,
    });
  }

  // 3. If it's a plain object or non-Error structure
  if (typeof err === "object") {
    // Extract status code
    const status =
      err.status ||
      err.statusCode ||
      err.response?.status ||
      (typeof err.code === "number" ? err.code : null) ||
      (typeof err.error === "object" ? err.error?.code || err.error?.status : null) ||
      null;

    // Extract error code (Firebase, custom, or status-derived)
    const code =
      err.code ||
      err.errorCode ||
      err.error_code ||
      err.response?.data?.code ||
      err.response?.data?.errorCode ||
      (typeof err.error === "object" ? err.error?.code || err.error?.status : null) ||
      err.statusText ||
      (status === 429 ? "AI_RATE_LIMITED" : status === 403 ? "PERMISSION_DENIED" : status === 404 ? "NOT_FOUND" : "APP_ERROR");

    // Extract human-readable error message safely
    let cleanMessage = extractMessageString(err);
    if (cleanMessage) {
      cleanMessage = scrubErrorMessage(cleanMessage);
    }

    if (!cleanMessage) {
      if (err.code && typeof err.code === "string") {
        cleanMessage = `Operation failed with code ${err.code}`;
      } else if (status) {
        cleanMessage = `Request failed with HTTP status ${status}`;
      } else {
        cleanMessage = fallbackMessage;
      }
    }

    return new NormalizedAppError(cleanMessage, {
      code: String(code),
      status: typeof status === "number" ? status : 500,
      details: err.details || null,
      originalError: err,
    });
  }

  // Primitive number, boolean, symbol, function
  return new NormalizedAppError(scrubErrorMessage(String(err)));
}
