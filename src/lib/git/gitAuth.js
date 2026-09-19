import { GitError, GitErrorCodes } from "./errors.js";
import { isExplicitTestEnvironment, isValidDeterministicTestToken, parseTestTokenClaims } from "../authEnv.js";
import { fetchFirestoreWorkspaceMemberRole } from "../execution/executionAuth.js";

/**
 * Validates the authentication token and verifies workspace authorization.
 *
 * @param {Request} req - Next.js App Router Request object
 * @param {string} workspaceId - Target workspace identifier
 * @param {"READ" | "MUTATE" | "ADMIN"} [requiredLevel="READ"] - Minimum required authorization level
 * @returns {Promise<{ uid: string, displayName: string, email: string, role: "owner" | "contributor" | "viewer" }>}
 */
export async function authenticateAndAuthorize(req, workspaceId, requiredLevel = "READ") {
  if (!workspaceId) {
    throw new GitError(GitErrorCodes.INVALID_PATH, "Missing workspaceId", 400);
  }

  // 1. Extract Bearer token
  const authHeader = req.headers.get("authorization") || "";
  let token = "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }

  if (!token) {
    // Fallback check on query string for diff / event streams if applicable
    const url = new URL(req.url);
    token = url.searchParams.get("token") || "";
  }

  if (!token) {
    throw new GitError(
      GitErrorCodes.UNAUTHORIZED,
      "Missing authentication token. Provide Authorization: Bearer <token>",
      401
    );
  }

  // 2. Fail-Closed Test-Mode / Deterministic Token Support
  // CRITICAL: Must be an explicit test environment. NEVER permitted in production!
  const isTest = isExplicitTestEnvironment();

  if (isTest && isValidDeterministicTestToken(token)) {
    if (token.includes("unauthorized")) {
      throw new GitError(GitErrorCodes.UNAUTHORIZED, "User is unauthorized for this workspace", 401);
    }

    const user = parseTestTokenClaims(token);
    assertRolePermission(user.role, requiredLevel);
    return {
      ...user,
      token,
    };
  }

  // 3. Production Token Verification via Firebase Identity Toolkit
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    throw new GitError(
      GitErrorCodes.GIT_OPERATION_FAILED,
      "Firebase Web API key is not configured on server",
      500
    );
  }

  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });

  if (!res.ok) {
    throw new GitError(GitErrorCodes.UNAUTHORIZED, "Invalid or expired authentication token", 401);
  }

  const data = await res.json();
  const fbUser = data.users?.[0];
  if (!fbUser?.localId) {
    throw new GitError(GitErrorCodes.UNAUTHORIZED, "User account not found", 401);
  }

  const uid = fbUser.localId;
  const email = fbUser.email || `${uid}@codecraft.dev`;
  const displayName = fbUser.displayName || email.split("@")[0];

  // 4. Check Workspace Membership and Role in Firestore via authenticated REST API (CC-005)
  let userRole = null;

  try {
    userRole = await fetchFirestoreWorkspaceMemberRole(workspaceId, uid, token);
  } catch (err) {
    throw new GitError(
      GitErrorCodes.GIT_OPERATION_FAILED,
      `Failed to query workspace authorization: ${err.message}`,
      500
    );
  }

  if (!userRole) {
    throw new GitError(
      GitErrorCodes.PERMISSION_DENIED,
      "You are not a member of this workspace",
      403
    );
  }

  assertRolePermission(userRole, requiredLevel);

  return {
    uid,
    displayName,
    email,
    role: userRole,
    token,
  };
}

/**
 * Enforces role hierarchy rules:
 * - READ: viewer, contributor, owner
 * - MUTATE: contributor, owner (viewers rejected with PERMISSION_DENIED)
 * - ADMIN: owner (viewers and non-owners rejected with PERMISSION_DENIED)
 *
 * @param {"owner" | "contributor" | "viewer"} role
 * @param {"READ" | "MUTATE" | "ADMIN"} level
 */
function assertRolePermission(role, level) {
  if (level === "MUTATE" && role === "viewer") {
    throw new GitError(
      GitErrorCodes.PERMISSION_DENIED,
      "Viewer role is read-only and cannot mutate Git repository state (staging, committing, branching, and merging are prohibited)",
      403
    );
  }

  if (level === "ADMIN" && role !== "owner") {
    throw new GitError(
      GitErrorCodes.PERMISSION_DENIED,
      "Administrative Git actions require Workspace Owner privileges",
      403
    );
  }
}
