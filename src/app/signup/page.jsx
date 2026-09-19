"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck, RefreshCw } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import AuthInput from "@/components/auth/AuthInput";
import PasswordInput from "@/components/auth/PasswordInput";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";
import AuthDivider from "@/components/auth/AuthDivider";
import { AuthError, AuthSuccess } from "@/components/auth/AuthStatus";
import { signUpUser, signInWithGoogle, resendNativeVerificationEmail } from "@/helpers/signUpHelp";
import { normalizeError } from "@/lib/errorUtils";

export default function SignUpPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [successNotice, setSuccessNotice] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState({});

  const validate = () => {
    const errors = {};
    if (!displayName.trim()) {
      errors.displayName = "Display name is required.";
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      errors.email = "Email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = "Please enter a valid email address.";
    }
    if (!password) {
      errors.password = "Password is required.";
    } else if (password.length < 8) {
      errors.password = "Password must be at least 8 characters.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    if (isSubmitting || isGoogleSubmitting) return;

    setError(null);
    if (!validate()) return;

    setIsSubmitting(true);

    try {
      const res = await signUpUser(email.trim(), password, displayName.trim());
      if (!res.success) {
        setError(res.message || "Failed to create account.");
      } else {
        setSuccessNotice({
          email: email.trim(),
          message: res.message || "Account created successfully! Verification email dispatched.",
        });
      }
    } catch (err) {
      const normalized = normalizeError(err, "Failed to create account. Please check your information.");
      setError(normalized.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignUp = async () => {
    if (isSubmitting || isGoogleSubmitting) return;

    setError(null);
    setIsGoogleSubmitting(true);

    try {
      const result = await signInWithGoogle();
      if (result?.success && result?.user) {
        router.push("/dashboard");
      } else {
        const errorMsg = result?.error || "Google registration was cancelled or failed.";
        setError(errorMsg);
      }
    } catch (err) {
      const normalized = normalizeError(err, "Google registration failed. Please try again.");
      setError(normalized.message);
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (isResending) return;
    setIsResending(true);
    setError(null);

    try {
      const res = await resendNativeVerificationEmail();
      if (res.success) {
        setSuccessNotice((prev) => ({
          ...prev,
          message: "Verification email re-sent successfully! Check your inbox.",
        }));
      } else {
        setError(res.message || "Could not resend verification email.");
      }
    } catch (err) {
      const normalized = normalizeError(err, "Could not resend verification email.");
      setError(normalized.message);
    } finally {
      setIsResending(false);
    }
  };

  const handleProceedToDashboard = () => {
    router.push("/dashboard");
  };

  // If successfully created, display a focused verification confirmation state
  if (successNotice) {
    return (
      <AuthShell>
        <div className="bg-[#0D111A] border border-[#202938] rounded-xl p-6 sm:p-8 text-center space-y-5 shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-[#22C55E]">
            <MailCheck className="w-6 h-6" />
          </div>

          <div>
            <h1 className="text-xl font-bold text-white mb-1">Verify your email</h1>
            <p className="text-xs text-[#94A3B8] leading-relaxed">
              We dispatched an activation link to{" "}
              <span className="font-mono text-blue-400">{successNotice.email}</span>.
              Please confirm your email to finalize workspace privileges.
            </p>
          </div>

          <AuthSuccess message={successNotice.message} />

          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={handleProceedToDashboard}
              className="w-full h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <span>Continue to Workspace Hub</span>
            </button>

            <button
              type="button"
              onClick={handleResendVerification}
              disabled={isResending}
              className="w-full h-9 px-4 rounded-lg bg-[#080B12] hover:bg-[#151C29] text-xs font-mono text-[#CBD5E1] border border-[#202938] hover:border-[#2E3B4E] transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isResending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Resending link...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Resend verification email</span>
                </>
              )}
            </button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      {/* Form Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">
          Create your workspace
        </h1>
        <p className="text-sm text-[#94A3B8]">
          Start building and collaborating with CodeCraft.
        </p>
      </div>

      {/* Inline Error Display */}
      {error && <AuthError title="Sign-up failed" message={error} />}

      {/* Sign-up Form */}
      <form onSubmit={handleSignUp} className="space-y-4" noValidate>
        <AuthInput
          id="displayName"
          label="Display name"
          type="text"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value);
            if (fieldErrors.displayName) {
              setFieldErrors((prev) => ({ ...prev, displayName: null }));
            }
          }}
          placeholder="Alex Developer"
          autoComplete="name"
          required
          error={fieldErrors.displayName}
          disabled={isSubmitting || isGoogleSubmitting}
        />

        <AuthInput
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldErrors.email) {
              setFieldErrors((prev) => ({ ...prev, email: null }));
            }
          }}
          placeholder="developer@example.com"
          autoComplete="email"
          required
          error={fieldErrors.email}
          disabled={isSubmitting || isGoogleSubmitting}
        />

        <PasswordInput
          id="password"
          label="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) {
              setFieldErrors((prev) => ({ ...prev, password: null }));
            }
          }}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          required
          error={fieldErrors.password}
          disabled={isSubmitting || isGoogleSubmitting}
          hint="Min. 8 characters"
        />

        {/* Primary Create Account Button */}
        <button
          type="submit"
          disabled={isSubmitting || isGoogleSubmitting}
          className="w-full h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-sm shadow-blue-500/10 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed select-none mt-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Creating account...</span>
            </>
          ) : (
            <span>Create Account</span>
          )}
        </button>
      </form>

      {/* Divider */}
      <AuthDivider text="or" />

      {/* Google Authentication */}
      <GoogleAuthButton
        onClick={handleGoogleSignUp}
        isLoading={isGoogleSubmitting}
        disabled={isSubmitting || isGoogleSubmitting}
        text="Continue with Google"
      />

      {/* Login Navigation Footer */}
      <div className="mt-8 text-center text-xs text-[#94A3B8]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-blue-400 hover:text-blue-300 font-medium hover:underline transition-colors"
        >
          Sign in
        </Link>
      </div>
    </AuthShell>
  );
}
