import { ExecutionError, ExecutionErrorCodes } from "./errors.js";
import { isExplicitTestEnvironment, isValidDeterministicTestToken, parseTestTokenClaims } from "../authEnv.js";

// Test-mode mock workspace memberships registry (strictly isolated to explicit test environments)
const mockWorkspaceMembers = new Map();

/**
 * Registers mock workspace members for test suites.
 * Only functional when isExplicitTestEnvironment() is true.
 *
 * @param {string} workspaceId
 * @param {Record<string, "owner" | "contributor" | "viewer"> | Map<string, "owner" | "contributor" | "viewer"> | null} membersMap
 */
export function setMockWorkspaceMembers(workspaceId, membersMap) {
  if (!isExplicitTestEnvironment()) return;
  if (!workspaceId) return;
  if (!membersMap) {
    mockWorkspaceMembers.delete(workspaceId);
    return;
  }
  const map = membersMap instanceof Map ? membersMap : new Map(Object.entries(membersMap));
  mockWorkspaceMembers.set(workspaceId, map);
}

/**
 * Clears all mock workspace memberships.
 */
export function clearMockWorkspaceMembers() {
  mockWorkspaceMembers.clear();
}

/**
 * Authenticates the request and verifies workspace authorization for execution.
 *
 * @param {Request} req - Next.js Request
 * @param {string} workspaceId - Target workspace
 * @param {"EXECUTE" | "READ"} [requiredPermission="EXECUTE"]
 * @returns {Promise<{ uid: string, displayName: string, email: string, role: "owner" | "contributor" | "viewer" }>}
 */
export async function authenticateAndAuthorizeExecution(req, workspaceId, requiredPermission = "EXECUTE") {
  if (!workspaceId || typeof workspaceId !== "string" || !workspaceId.trim()) {
    throw new ExecutionError(
      ExecutionErrorCodes.INVALID_REQUEST,
      "Missing workspaceId in execution request",
      400
    );
  }

  // 1. Extract Bearer token
  const authHeader = req.headers?.get ? (req.headers.get("authorization") || "") : (req.headers?.authorization || "");
  let token = "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }

  if (!token && req.url) {
    try {
      const url = new URL(req.url, "http://localhost");
      token = url.searchParams?.get("token") || "";
    } catch {}
  }

  if (!token) {
    throw new ExecutionError(
      ExecutionErrorCodes.UNAUTHORIZED,
      "Missing authentication token. Provide Authorization: Bearer <token>",
      401
    );
  }

  // 2. Fail-Closed Test-Mode / Deterministic Token Support
  // CRITICAL: Must be an explicit test environment. NEVER permitted in production!
  // Unsigned JWT ("header.*") claim spoofing is strictly prohibited in production!
  const isTest = isExplicitTestEnvironment();

  if (isTest) {
    if (isValidDeterministicTestToken(token)) {
      if (token.includes("unauthorized")) {
        throw new ExecutionError(
          ExecutionErrorCodes.UNAUTHORIZED,
          "User is unauthorized for this workspace",
          401
        );
      }

      const user = parseTestTokenClaims(token);
      let userRole = null;

      if (mockWorkspaceMembers.has(workspaceId)) {
        userRole = mockWorkspaceMembers.get(workspaceId).get(user.uid) || null;
      } else {
        userRole = user.role;
      }

      if (!userRole) {
        throw new ExecutionError(
          ExecutionErrorCodes.PERMISSION_DENIED,
          "You are not an authorized member of this workspace",
          403
        );
      }

      if (requiredPermission === "EXECUTE") {
        assertExecutionPermission(userRole);
      }

      return {
        ...user,
        role: userRole,
      };
    }

    // Explicit test-mode mock token parsing (Strictly disabled in production)
    if (token.startsWith("header.")) {
      const parts = token.split(".");
      if (parts.length >= 2) {
        let payload = null;
        try {
          payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
        } catch {
          // Invalid base64/JSON, fall through
        }
        if (payload && typeof payload === "object") {
          const uid = payload.user_id || payload.uid || "test-user";
          let userRole = null;

          if (mockWorkspaceMembers.has(workspaceId)) {
            userRole = mockWorkspaceMembers.get(workspaceId).get(uid) || null;
          } else if (payload.workspaceId && payload.workspaceId !== workspaceId) {
            userRole = null;
          } else {
            userRole = payload.role || "contributor";
          }

          if (!userRole) {
            throw new ExecutionError(
              ExecutionErrorCodes.PERMISSION_DENIED,
              "You are not an authorized member of this workspace",
              403
            );
          }

          const user = {
            uid,
            displayName: payload.name || "Test User",
            email: payload.email || `${uid}@example.com`,
            role: userRole,
          };
          if (requiredPermission === "EXECUTE") {
            assertExecutionPermission(user.role);
          }
          return user;
        }
      }
    }
  }

  // 3. Production Token Verification via Firebase Identity Toolkit
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    throw new ExecutionError(
      ExecutionErrorCodes.SANDBOX_ERROR,
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
    throw new ExecutionError(
      ExecutionErrorCodes.UNAUTHORIZED,
      "Invalid or expired authentication token",
      401
    );
  }

  const data = await res.json();
  const fbUser = data.users?.[0];
  if (!fbUser?.localId) {
    throw new ExecutionError(
      ExecutionErrorCodes.UNAUTHORIZED,
      "User account not found",
      401
    );
  }

  const uid = fbUser.localId;
  const email = fbUser.email || `${uid}@codecraft.dev`;
  const displayName = fbUser.displayName || email.split("@")[0];

  // 4. Query Workspace Membership and Role in Firestore
  // Uses direct Firestore REST API authenticated with the caller's Firebase ID token.
  // This satisfies Firestore Security Rules under the verified user context, avoiding
  // the client SDK's server-side unauthenticated limitation.
  let userRole = null;

  try {
    userRole = await fetchFirestoreWorkspaceMemberRole(workspaceId, uid, token);
  } catch (err) {
    if (err instanceof ExecutionError) throw err;
    throw new ExecutionError(
      ExecutionErrorCodes.SANDBOX_ERROR,
      `Failed to verify workspace membership: ${err.message}`,
      500
    );
  }

  if (!userRole) {
    throw new ExecutionError(
      ExecutionErrorCodes.PERMISSION_DENIED,
      "You are not an authorized member of this workspace",
      403
    );
  }

  if (requiredPermission === "EXECUTE") {
    assertExecutionPermission(userRole);
  }

  return {
    uid,
    displayName,
    email,
    role: userRole,
  };
}

/**
 * Queries workspace membership directly via Google Cloud Firestore REST API using the user's
 * authenticated ID token. This ensures Firestore Security Rules (firestore.rules) are evaluated
 * under the caller's authentic identity (request.auth.uid), resolving the limitation where server-side
 * client SDK instances have no signed-in user.
 *
 * @param {string} workspaceId - Target workspace
 * @param {string} uid - Authenticated user UID
 * @param {string} token - Firebase Auth ID token
 * @returns {Promise<"owner" | "contributor" | "viewer" | null>}
 */
export async function fetchFirestoreWorkspaceMemberRole(workspaceId, uid, token) {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new ExecutionError(
      ExecutionErrorCodes.SANDBOX_ERROR,
      "Firebase project ID is not configured on server",
      500
    );
  }

  const baseDocUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  const memberUrl = `${baseDocUrl}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(uid)}`;

  const headers = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // 1. Query membership document in subcollection: workspaces/{workspaceId}/members/{uid}
  const memberRes = await fetch(memberUrl, {
    method: "GET",
    headers,
  });

  if (memberRes.ok) {
    const memberDoc = await memberRes.json();
    const role = memberDoc?.fields?.role?.stringValue;
    if (role && (role === "owner" || role === "contributor" || role === "viewer")) {
      return role;
    }
    return "contributor";
  }

  // 2. If member doc is not found (404) or permission check requires workspace root inspection (403),
  // inspect the workspace document: workspaces/{workspaceId}
  // This verifies whether the user is the workspace owner (userId/ownerId match) or if workspace is public.
  if (memberRes.status === 404 || memberRes.status === 403) {
    const wsUrl = `${baseDocUrl}/workspaces/${encodeURIComponent(workspaceId)}`;
    const wsRes = await fetch(wsUrl, {
      method: "GET",
      headers,
    });

    if (wsRes.ok) {
      const wsDoc = await wsRes.json();
      const ownerId = wsDoc?.fields?.userId?.stringValue || wsDoc?.fields?.ownerId?.stringValue;
      if (ownerId === uid) {
        return "owner";
      }
      if (wsDoc?.fields?.isPublic?.booleanValue === true) {
        return "viewer";
      }
    } else if (wsRes.status >= 500) {
      throw new ExecutionError(
        ExecutionErrorCodes.SANDBOX_ERROR,
        `Firestore service returned error status ${wsRes.status}`,
        500
      );
    }
  } else if (memberRes.status >= 500) {
    throw new ExecutionError(
      ExecutionErrorCodes.SANDBOX_ERROR,
      `Firestore service returned error status ${memberRes.status}`,
      500
    );
  }

  // 3. User is not an authorized member
  return null;
}

/**
 * Enforces execution role permissions.
 * Viewers are read-only and cannot trigger code execution in the workspace.
 *
 * @param {"owner" | "contributor" | "viewer"} role
 */
export function assertExecutionPermission(role) {
  if (role === "viewer") {
    throw new ExecutionError(
      ExecutionErrorCodes.PERMISSION_DENIED,
      "Viewer role has read-only access and is not permitted to execute code in this workspace",
      403
    );
  }
  if (role !== "owner" && role !== "contributor") {
    throw new ExecutionError(
      ExecutionErrorCodes.PERMISSION_DENIED,
      `Role '${role}' is not permitted to execute code in this workspace`,
      403
    );
  }
}
