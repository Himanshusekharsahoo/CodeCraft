"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import AuthInput from "@/components/auth/AuthInput";
import PasswordInput from "@/components/auth/PasswordInput";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";
import AuthDivider from "@/components/auth/AuthDivider";
import { AuthError } from "@/components/auth/AuthStatus";
import { loginWithEmailAndPassword, loginWithGoogle } from "@/helpers/loginHelp";
import { normalizeError } from "@/lib/errorUtils";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (isSubmitting || isGoogleSubmitting) return;

    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setIsSubmitting(true);

    try {
      const user = await loginWithEmailAndPassword(trimmedEmail, password);
      if (user) {
        router.push("/dashboard");
      } else {
        setError("Unable to sign in. Check your credentials and try again.");
      }
    } catch (err) {
      const normalized = normalizeError(err, "Unable to sign in. Check your credentials and try again.");
      setError(normalized.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (isSubmitting || isGoogleSubmitting) return;

    setError(null);
    setIsGoogleSubmitting(true);

    try {
      const result = await loginWithGoogle();
      if (result?.success && result?.user) {
        router.push("/dashboard");
      } else {
        const errorMsg = result?.error || "Google sign-in could not be completed. Please try again.";
        setError(errorMsg);
      }
    } catch (err) {
      const normalized = normalizeError(err, "Google sign-in could not be completed. Please try again.");
      setError(normalized.message);
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <AuthShell>
      {/* Form Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">
          Welcome back
        </h1>
        <p className="text-sm text-[#94A3B8]">
          Sign in to continue to CodeCraft developer workspace.
        </p>
      </div>

      {/* Inline Error Display */}
      {error && <AuthError title="Unable to sign in" message={error} />}

      {/* Email / Password Form */}
      <form onSubmit={handleLogin} className="space-y-4" noValidate>
        <AuthInput
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="developer@example.com"
          autoComplete="email"
          required
          disabled={isSubmitting || isGoogleSubmitting}
        />

        <PasswordInput
          id="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
          autoComplete="current-password"
          required
          disabled={isSubmitting || isGoogleSubmitting}
          rightLabelAction={
            <Link
              href="/forgot-password"
              className="text-xs font-mono text-blue-400 hover:text-blue-300 hover:underline transition-colors"
              tabIndex={0}
            >
              Forgot password?
            </Link>
          }
        />

        {/* Primary Continue Button */}
        <button
          type="submit"
          disabled={isSubmitting || isGoogleSubmitting}
          className="w-full h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-sm shadow-blue-500/10 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed select-none mt-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Signing in...</span>
            </>
          ) : (
            <span>Continue</span>
          )}
        </button>
      </form>

      {/* Divider */}
      <AuthDivider text="or" />

      {/* Google Authentication */}
      <GoogleAuthButton
        onClick={handleGoogleLogin}
        isLoading={isGoogleSubmitting}
        disabled={isSubmitting || isGoogleSubmitting}
        text="Continue with Google"
      />

      {/* Signup Navigation Footer */}
      <div className="mt-8 text-center text-xs text-[#94A3B8]">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="text-blue-400 hover:text-blue-300 font-medium hover:underline transition-colors"
        >
          Create one
        </Link>
      </div>
    </AuthShell>
  );
}
