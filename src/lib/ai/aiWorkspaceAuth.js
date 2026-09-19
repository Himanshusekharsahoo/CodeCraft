import { isExplicitTestEnvironment, isValidDeterministicTestToken, parseTestTokenClaims } from "../authEnv.js";
import { fetchFirestoreWorkspaceMemberRole } from "../execution/executionAuth.js";

/**
 * Verifies that the authenticated caller has membership access to the given workspace (CC-011).
 *
 * @param {Request} request
 * @param {{ uid: string }} authUser
 * @param {string} workspaceId
 * @param {"viewer" | "contributor" | "owner"} [requiredLevel="viewer"]
 * @returns {Promise<{ authorized: boolean, role?: string, error?: string, status?: number }>}
 */
export async function verifyAIWorkspaceAccess(request, authUser, workspaceId, requiredLevel = "viewer") {
  if (!workspaceId || typeof workspaceId !== "string" || !workspaceId.trim()) {
    return {
      authorized: false,
      error: "Missing required workspaceId parameter",
      status: 400,
    };
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  // Test mode isolation
  if (isExplicitTestEnvironment()) {
    if (token && isValidDeterministicTestToken(token)) {
      if (token.includes("unauthorized")) {
        return {
          authorized: false,
          error: "Unauthorized for this workspace",
          status: 403,
        };
      }
      const testClaims = parseTestTokenClaims(token);
      const role = testClaims.role || "contributor";
      if (requiredLevel === "contributor" && role === "viewer") {
        return {
          authorized: false,
          error: "Read-only viewer role cannot perform this modification",
          status: 403,
        };
      }
      return { authorized: true, role };
    }
  }

  // Production or Firestore membership check
  try {
    const role = await fetchFirestoreWorkspaceMemberRole(workspaceId, authUser.uid, token);
    if (!role) {
      return {
        authorized: false,
        error: "You are not an authorized member of this workspace",
        status: 403,
      };
    }

    if (requiredLevel === "contributor" && role === "viewer") {
      return {
        authorized: false,
        error: "Read-only viewer role cannot perform this modification",
        status: 403,
      };
    }

    if (requiredLevel === "owner" && role !== "owner") {
      return {
        authorized: false,
        error: "Only workspace owners can perform this action",
        status: 403,
      };
    }

    return { authorized: true, role };
  } catch (err) {
    return {
      authorized: false,
      error: `Workspace authorization failed: ${err.message}`,
      status: 500,
    };
  }
}
