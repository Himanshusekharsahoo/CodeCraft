/**
 * Secret Redaction and Sensitive Pattern Protection (Phase 8 MVP).
 *
 * Scans, detects, and redacts credentials, environment files, private keys,
 * and sensitive tokens before repository content reaches Gemini or is recorded in logs.
 */

const SENSITIVE_FILE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /(^|\/)\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /serviceAccountKey.*\.json$/i,
  /firebase-adminsdk.*\.json$/i,
  /\.docker\/config\.json$/i,
  /\.npmrc$/i,
  /\.aws\/(credentials|config)$/i,
];

const SECRET_PATTERNS = [
  // Google / Gemini API Keys: AIzaSy...
  { pattern: /AIzaSy[A-Za-z0-9_-]{33}/g, replacement: "[REDACTED_GEMINI_KEY]" },
  // Bearer Authorization Tokens
  { pattern: /Bearer\s+[A-Za-z0-9\-_.]+/gi, replacement: "Bearer [REDACTED_TOKEN]" },
  // Standard API key / token assignments in code or json
  {
    pattern: /(api[_-]?key|apikey|secret|token|password|auth[_-]?token|access[_-]?token)\s*([:=])\s*(['"][^'"\r\n]{6,}['"]|[^\s,;}{]{8,})/gi,
    replacement: (match, p1, p2, p3) => {
      if (typeof p3 === "string" && p3.includes("REDACTED")) return match;
      return `${p1}${p2}"[REDACTED_SECRET]"`;
    },
  },
  // Private Key blocks (PEM)
  {
    pattern: /-----BEGIN [A-Z0-9_-]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9_-]+ PRIVATE KEY-----/gi,
    replacement: "[REDACTED_PRIVATE_KEY_BLOCK]",
  },
  // Firebase Web Config / App credentials
  {
    pattern: /(apiKey|messagingSenderId|appId|measurementId)\s*:\s*["'][^"']+["']/g,
    replacement: '$1: "[REDACTED_FIREBASE_CONFIG]"',
  },
  // Generic high-entropy hex or base64 token strings (64+ chars)
  {
    pattern: /(["'])[a-f0-9]{64,}(["'])/gi,
    replacement: '$1[REDACTED_TOKEN]$2',
  },
];

/**
 * Checks if a relative or absolute file path points to a prohibited sensitive file.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isSensitivePath(filePath) {
  if (!filePath || typeof filePath !== "string") return true;
  const normalized = filePath.replace(/\\/g, "/").trim();
  return SENSITIVE_FILE_PATTERNS.some((regex) => regex.test(normalized));
}

/**
 * Redacts secrets, tokens, and credentials from arbitrary text or source code.
 *
 * @param {string} text
 * @returns {string} Sanitized string
 */
export function redactSecrets(text) {
  if (!text || typeof text !== "string") return "";

  let result = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  // Also verify environment variables currently in process.env don't appear in plaintext
  const envSecrets = [
    process.env.GEMINI_API_KEY,
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    process.env.FIREBASE_API_KEY,
  ].filter((k) => typeof k === "string" && k.length > 8);

  for (const secret of envSecrets) {
    if (result.includes(secret)) {
      result = result.replaceAll(secret, "[REDACTED_ENV_SECRET]");
    }
  }

  return result;
}
