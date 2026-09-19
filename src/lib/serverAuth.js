import { NextResponse } from "next/server";
import { isExplicitTestEnvironment, isValidDeterministicTestToken, parseTestTokenClaims } from "./authEnv.js";

/**
 * Verifies a Firebase ID token sent in the Authorization header.
 * Uses the official Google Identity Toolkit REST API so it works across
 * all Node/Edge runtimes without requiring heavy Admin SDK credentials.
 *
 * @param {Request} request
 * @returns {Promise<{ authenticated: boolean, uid?: string, email?: string, error?: string, role?: string }>}
 */
export async function verifyAuthToken(request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return { authenticated: false, error: "Missing or malformed Authorization header" };
    }

    const idToken = authHeader.substring(7).trim();
    if (!idToken) {
      return { authenticated: false, error: "Empty authentication token" };
    }

    // Fail-closed test environment verification (NEVER permitted in production)
    if (isExplicitTestEnvironment() && isValidDeterministicTestToken(idToken)) {
      if (idToken.includes("unauthorized")) {
        return { authenticated: false, error: "Unauthorized test user" };
      }
      const testClaims = parseTestTokenClaims(idToken);
      return {
        authenticated: true,
        uid: testClaims.uid,
        email: testClaims.email,
        displayName: testClaims.displayName,
        role: testClaims.role,
      };
    }

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) {
      return {
        authenticated: false,
        configError: true,
        error: "Server authentication configuration unavailable",
      };
    }

    const verifyUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;

    const res = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return {
        authenticated: false,
        error: errorData.error?.message || "Invalid or expired Firebase ID token"
      };
    }

    const data = await res.json();
    if (!data.users || data.users.length === 0) {
      return { authenticated: false, error: "No user found for provided token" };
    }

    const user = data.users[0];
    return {
      authenticated: true,
      uid: user.localId,
      email: user.email,
      displayName: user.displayName,
      user,
    };
  } catch (err) {
    return { authenticated: false, error: err.message || "Authentication verification error" };
  }
}

/**
 * Guard helper that returns a 401 response if the request is not authenticated,
 * or 500 if server authentication configuration is missing.
 */
export async function requireAuth(request) {
  const authResult = await verifyAuthToken(request);
  if (!authResult.authenticated) {
    const status = authResult.configError ? 500 : 401;
    const errorMessage = authResult.configError
      ? "Authentication service configuration error"
      : `Unauthorized: ${authResult.error || "Authentication required"}`;

    return {
      auth: null,
      response: NextResponse.json(
        { error: errorMessage },
        { status }
      ),
    };
  }
  return { auth: authResult, response: null };
}
