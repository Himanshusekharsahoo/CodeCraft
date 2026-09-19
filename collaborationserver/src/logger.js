/**
 * Safe structured logging utility for CodeCraft Collaboration Server.
 * Enforces strict redaction of credentials, tokens, and sensitive personal information.
 */

const SENSITIVE_KEYS = new Set([
  "token",
  "idtoken",
  "authorization",
  "apikey",
  "api_key",
  "secret",
  "password",
  "credential",
  "credentials",
]);

/**
 * Recursively redacts sensitive keys from an object.
 */
function sanitize(obj, depth = 0) {
  if (depth > 3 || obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitize(item, depth + 1));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 500) {
      result[key] = `${value.slice(0, 100)}...[TRUNCATED ${value.length} bytes]`;
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitize(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function formatLog(level, event, meta = {}) {
  const timestamp = new Date().toISOString();
  const safeMeta = sanitize(meta);
  const metaStr = Object.keys(safeMeta).length > 0 ? ` ${JSON.stringify(safeMeta)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] [${event}]${metaStr}`;
}

export const logger = {
  info(event, meta) {
    console.log(formatLog("info", event, meta));
  },
  warn(event, meta) {
    console.warn(formatLog("warn", event, meta));
  },
  error(event, meta) {
    console.error(formatLog("error", event, meta));
  },
  debug(event, meta) {
    if (process.env.DEBUG === "true" || process.env.NODE_ENV !== "production") {
      console.debug(formatLog("debug", event, meta));
    }
  },
};
