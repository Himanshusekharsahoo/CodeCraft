import { config } from "./config.js";

/**
 * Verifies a Firebase ID token using Google Identity Toolkit REST API
 * or test-mode bypass for unit/integration testing.
 *
 * @param {string} token - The raw Firebase Auth ID token
 * @param {string} [apiKey] - The Firebase Web API Key
 * @returns {Promise<{ uid: string, email: string, displayName: string }>}
 */
export async function verifyToken(token, apiKey = config.firebase.apiKey) {
  if (!token || typeof token !== "string" || token.trim() === "") {
    throw new Error("Missing authentication token");
  }

  // Support deterministic test-mode tokens strictly in test environment (never in production)
  const isExplicitTest = process.env.NODE_ENV !== "production" && (config.isTest || process.env.NODE_ENV === "test");
  if (isExplicitTest) {
    if (token.startsWith("test-token-") && /^test-token-[a-zA-Z0-9_\-\.]+(:[a-zA-Z0-9_\-\.]+)?$/.test(token)) {
      const parts = token.split(":");
      const roleOrUid = parts[0].replace("test-token-", "");
      const uid = parts[1] || roleOrUid;
      return {
        uid,
        email: `${uid}@test.codecraft.dev`,
        displayName: uid.charAt(0).toUpperCase() + uid.slice(1),
      };
    }
  }

  // Support development mock tokens only in non-production dev mode
  if (process.env.NODE_ENV !== "production" && config.isDev && token.startsWith("dev-mock-")) {
    const uid = token.replace("dev-mock-", "");
    return {
      uid,
      email: `${uid}@dev.codecraft.local`,
      displayName: uid.charAt(0).toUpperCase() + uid.slice(1),
    };
  }

  if (!apiKey) {
    throw new Error("Firebase API key is not configured for token verification");
  }

  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      const message = errorBody?.error?.message || res.statusText || "Token verification failed";
      throw new Error(`Authentication failed: ${message}`);
    }

    const data = await res.json();
    const user = data.users?.[0];

    if (!user || !user.localId) {
      throw new Error("No user record found for provided token");
    }

    return {
      uid: user.localId,
      email: user.email || "",
      displayName: user.displayName || (user.email ? user.email.split("@")[0] : "Collaborator"),
    };
  } catch (error) {
    throw new Error(`Token verification error: ${error.message}`);
  }
}
