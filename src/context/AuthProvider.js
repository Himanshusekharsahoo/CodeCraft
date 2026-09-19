"use client";

import { useState, useEffect, createContext, useContext, useMemo } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter, usePathname } from "next/navigation";
import { auth } from "@/config/firebase";
import AuthLoadingScreen from "@/components/auth/AuthLoadingScreen";
import { normalizeError, isExpectedCancellation } from "@/lib/errorUtils";

/**
 * Explicit Authentication Context States:
 * - 'initializing'   : Firebase is resolving stored credentials / session
 * - 'authenticated'  : User session is active and verified
 * - 'unauthenticated': No active session found
 * - 'error'          : Auth state observer threw an unexpected error
 */
const AuthContext = createContext({
  user: null,
  loading: true,
  authStatus: "initializing",
  authError: null,
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("initializing");
  const [authError, setAuthError] = useState(null);
  const router = useRouter();
  const pathname = usePathname();

  // Stabilize listener lifecycle: attach onAuthStateChanged once on mount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        if (firebaseUser) {
          setUser(firebaseUser);
          setAuthStatus("authenticated");
        } else {
          setUser(null);
          setAuthStatus("unauthenticated");
        }
        setAuthError(null);
      },
      (err) => {
        console.error("[AuthProvider] Auth state observation failure:", err);
        setAuthError(normalizeError(err, "Failed to resolve authentication state"));
        setAuthStatus("error");
      }
    );

    return () => unsubscribe();
  }, []);

  // Global unhandled promise rejection normalizer to protect against [object Object] and unhandled cancellations
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleUnhandledRejection = (event) => {
      const reason = event.reason;

      // 1. Intercept expected cancellations (Monaco unmount, AbortController, Axios cancels)
      if (isExpectedCancellation(reason)) {
        event.preventDefault();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        return;
      }

      // 2. Real error: normalize into structured Error instance
      const normalized = normalizeError(reason, "Unhandled Promise rejection");

      // Prevent Next.js dev overlay from coercing plain objects into "[object Object]"
      if (!(reason instanceof Error)) {
        event.preventDefault();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      }

      console.error("[CodeCraft Unhandled Rejection]", normalized);
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection, { capture: true });
    return () => window.removeEventListener("unhandledrejection", handleUnhandledRejection, { capture: true });
  }, []);

  const isProtectedRoute = useMemo(() => {
    if (!pathname) return false;
    return (
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/workspace") ||
      pathname.startsWith("/profile") ||
      pathname.startsWith("/account")
    );
  }, [pathname]);

  const isAuthRoute = useMemo(() => {
    if (!pathname) return false;
    return (
      pathname === "/login" ||
      pathname === "/register" ||
      pathname === "/signup"
    );
  }, [pathname]);

  // Handle route protection transitions
  useEffect(() => {
    if (authStatus === "initializing") return;

    if (authStatus === "authenticated" && isAuthRoute) {
      router.replace("/dashboard");
    } else if (authStatus === "unauthenticated" && isProtectedRoute) {
      router.replace("/login");
    }
  }, [authStatus, isAuthRoute, isProtectedRoute, router]);

  const contextValue = useMemo(
    () => ({
      user,
      loading: authStatus === "initializing",
      authStatus,
      authError,
    }),
    [user, authStatus, authError]
  );

  // While initializing, never render protected content (prevent flash of protected UI)
  if (authStatus === "initializing") {
    return (
      <AuthLoadingScreen
        message={isProtectedRoute ? "Initializing workspace..." : "Preparing CodeCraft..."}
        description={isProtectedRoute ? "Verifying security credentials" : "Setting up your secure developer session"}
      />
    );
  }

  // Strictly block unauthenticated access to protected routes: never render protected children
  if (authStatus === "unauthenticated" && isProtectedRoute) {
    return (
      <AuthLoadingScreen
        message="Authenticating session..."
        description="Redirecting to sign-in"
      />
    );
  }

  // Strictly block authenticated access to auth routes: prevent flash of login/register
  if (authStatus === "authenticated" && isAuthRoute) {
    return (
      <AuthLoadingScreen
        message="Authenticated"
        description="Redirecting to workspace dashboard"
      />
    );
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
