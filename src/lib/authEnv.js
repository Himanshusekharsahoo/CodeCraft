/**
 * Centralized Authentication Environment and Test Token Security Guard (Phase 9 Hardening).
 *
 * Enforces strict fail-closed boundary:
 * Test authentication tokens MUST NEVER be accepted in production.
 */

/**
 * Returns true ONLY when running under an explicit, non-production test environment.
 * In production (NODE_ENV === "production"), this unconditionally returns false.
 *
 * @returns {boolean}
 */
export function isExplicitTestEnvironment() {
  // Production invariant: test authentication MUST NEVER be enabled in production
  // regardless of any other environment variables or flags (CC-020).
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return (
    process.env.NODE_ENV === "test" ||
    process.env.COLLAB_TEST === "true" ||
    process.env.CODECRAFT_TEST === "true" ||
    process.env.PLAYWRIGHT_TEST === "true" ||
    process.env.NEXT_PUBLIC_APP_ENV === "test" ||
    (typeof process.env.npm_lifecycle_event === "string" && process.env.npm_lifecycle_event.startsWith("test"))
  );
}

/**
 * Validates whether a token matches the strict deterministic test token specification.
 * Format: test-token-<role>:<uid> or test-token-<role-or-uid>
 * Example: test-token-owner:alice, test-token-contributor:bob, test-token-viewer:charlie
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isValidDeterministicTestToken(token) {
  if (!token || typeof token !== "string") return false;
  const trimmed = token.trim();
  if (!trimmed.startsWith("test-token-")) return false;

  // Reject malformed or suspicious tokens
  if (trimmed.length > 128 || /[\s\r\n\0]/.test(trimmed)) return false;

  // Must match allowed role/uid pattern
  return /^test-token-[a-zA-Z0-9_\-\.]+(:[a-zA-Z0-9_\-\.]+)?$/.test(trimmed);
}

/**
 * Parses claims from a verified deterministic test token in test mode.
 *
 * @param {string} token
 * @returns {{ uid: string, displayName: string, email: string, role: "owner" | "contributor" | "viewer" }}
 */
export function parseTestTokenClaims(token) {
  const trimmed = token.trim();
  let role = "contributor";
  const lower = trimmed.toLowerCase();
  if (lower.includes("viewer")) role = "viewer";
  else if (lower.includes("owner")) role = "owner";
  else if (lower.includes("contributor")) role = "contributor";

  const parts = trimmed.split(":");
  const uid = parts[1] || parts[0].replace("test-token-", "") || "test-user";

  return {
    uid,
    displayName: uid.charAt(0).toUpperCase() + uid.slice(1),
    email: `${uid}@codecraft.test`,
    role,
  };
}
