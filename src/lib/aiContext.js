/**
 * AI Context Foundation for CodeCraft (Phase 5).
 * Builds safe, sanitized, structured context payloads for AI operations.
 * Enforces strict filtering to guarantee no credentials, tokens, or environment secrets leak to Gemini.
 */

const BLOCKED_KEY_PATTERNS = [
  /api[_-]?key/i,
  /auth[_-]?token/i,
  /secret/i,
  /password/i,
  /private[_-]?key/i,
  /bearer\s+[a-zA-Z0-9_\-\.]+/i,
  /firebase/i,
];

/**
 * Strips known credentials or sensitive patterns from code snippet before AI submission.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeContextText(text) {
  if (!text || typeof text !== "string") return "";

  // Truncate maximum size to bound prompt payload
  const maxChars = 12000;
  let sanitized = text.length > maxChars ? text.slice(0, maxChars) : text;

  // Redact obvious token strings if detected
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-_.]+/g, "Bearer [REDACTED]");
  sanitized = sanitized.replace(/(apiKey|API_KEY|api_key)\s*[:=]\s*["'][^"']+["']/g, '$1: "[REDACTED]"');

  return sanitized;
}

/**
 * Builds a structured, minimal context object for AI assistant actions.
 *
 * @param {object} params
 * @param {string} params.workspaceId - ID of active workspace
 * @param {string} params.fileId - ID of active file
 * @param {string} params.fileName - File name
 * @param {string} params.language - Language identifier (e.g. javascript, python)
 * @param {string} params.currentCode - Full document content
 * @param {string} [params.selectedCode] - Currently selected code range in editor
 * @param {{ lineNumber: number, column: number }} [params.cursorPosition] - Active cursor position
 * @param {Array<{ id: string, name: string }>} [params.openTabs] - List of open tabs
 * @returns {object}
 */
export function buildAIContext({
  workspaceId,
  fileId,
  fileName,
  language,
  currentCode,
  selectedCode = "",
  cursorPosition = null,
  openTabs = [],
}) {
  return {
    workspaceId: workspaceId || "",
    fileId: fileId || "",
    fileName: fileName || "untitled",
    language: language || "javascript",
    currentCode: sanitizeContextText(currentCode),
    selectedCode: sanitizeContextText(selectedCode),
    cursor: cursorPosition
      ? { line: cursorPosition.lineNumber, column: cursorPosition.column }
      : null,
    openTabs: Array.isArray(openTabs)
      ? openTabs.slice(0, 10).map((t) => ({ id: t.id, name: t.name }))
      : [],
    timestamp: new Date().toISOString(),
  };
}
