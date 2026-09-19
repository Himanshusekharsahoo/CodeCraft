"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, Mail } from "lucide-react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/config/firebase";
import AuthShell from "@/components/auth/AuthShell";
import AuthInput from "@/components/auth/AuthInput";
import { AuthError } from "@/components/auth/AuthStatus";
import { normalizeError } from "@/lib/errorUtils";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);

    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setIsSuccess(true);
    } catch (err) {
      // Security: Avoid account enumeration.
      // If error is auth/user-not-found or auth/invalid-email, still show the generic success message.
      if (err?.code === "auth/user-not-found" || err?.code === "auth/invalid-credential") {
        setIsSuccess(true);
      } else if (err?.code === "auth/too-many-requests") {
        setError("Too many password reset requests. Please wait a few moments before trying again.");
      } else {
        const norm = normalizeError(err, "Something went wrong while processing your request. Please try again.");
        setError(norm.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Section 13: Success State
  if (isSuccess) {
    return (
      <AuthShell>
        <div className="bg-[#0D111A] border border-[#202938] rounded-xl p-6 sm:p-8 text-center space-y-5 shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-[#22C55E]">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white mb-2">Check your inbox</h1>
            <p className="text-xs text-[#94A3B8] leading-relaxed max-w-sm mx-auto">
              If an account exists for <span className="font-mono text-blue-400">{email.trim()}</span>,
              we&apos;ve sent a password reset link to your email address.
            </p>
          </div>

          <div className="pt-2">
            <Link
              href="/login"
              className="w-full h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <span>Back to Login</span>
            </Link>
          </div>

          <p className="text-[11px] font-mono text-[#64748B]">
            Did not receive an email? Check your spam folder or verify the address.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      {/* Back to login navigation */}
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 text-xs font-mono text-[#94A3B8] hover:text-white transition-colors mb-6 group"
      >
        <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
        <span>Back to login</span>
      </Link>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">
          Reset your password
        </h1>
        <p className="text-sm text-[#94A3B8]">
          Enter the email associated with your CodeCraft account.
        </p>
      </div>

      {/* Inline Error */}
      {error && <AuthError title="Reset request failed" message={error} />}

      {/* Form */}
      <form onSubmit={handleResetPassword} className="space-y-4" noValidate>
        <AuthInput
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          disabled={isSubmitting}
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-sm shadow-blue-500/10 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed select-none mt-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Sending reset link...</span>
            </>
          ) : (
            <span>Send reset link</span>
          )}
        </button>
      </form>

      {/* Footer Navigation */}
      <div className="mt-8 text-center text-xs text-[#94A3B8]">
        Remember your password?{" "}
        <Link
          href="/login"
          className="text-blue-400 hover:text-blue-300 font-medium hover:underline transition-colors"
        >
          Back to login
        </Link>
      </div>
    </AuthShell>
  );
}
