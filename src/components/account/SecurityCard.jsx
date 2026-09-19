"use client";

import React, { useState } from "react";
import { KeyRound, Shield, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/config/firebase";
import { normalizeError } from "@/lib/errorUtils";

export default function SecurityCard({ user }) {
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState(null);

  if (!user) return null;

  const isGoogle = user.providerData?.some((p) => p.providerId === "google.com");

  const handlePasswordReset = async () => {
    if (!user.email || isResetting) return;
    setIsResetting(true);
    setResetMessage(null);

    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetMessage({
        success: true,
        text: `Password reset instructions sent to ${user.email}. Check your inbox.`,
      });
    } catch (err) {
      const norm = normalizeError(err, "Failed to dispatch password reset email.");
      setResetMessage({
        success: false,
        text: norm.message,
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="bg-[#0D111A] border border-[#202938] rounded-xl p-5 sm:p-6 shadow-xl">
      <div className="mb-4 pb-3 border-b border-[#18202D]">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white font-mono">
          Security
        </h2>
        <p className="text-xs text-[#94A3B8] mt-0.5">
          Manage your credentials, authentication methods, and security settings
        </p>
      </div>

      <div className="p-4 rounded-lg bg-[#111722] border border-[#202938] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#080B12] border border-[#202938] flex items-center justify-center flex-shrink-0 mt-0.5">
            <KeyRound className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white tracking-tight">Password</h4>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              {isGoogle
                ? "Your account uses Google OAuth for authentication."
                : "Manage your CodeCraft account password and login security."}
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div>
          {isGoogle ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-[#94A3B8] bg-[#080B12] border border-[#202938]">
              <Shield className="w-3.5 h-3.5 text-blue-400" />
              <span>Managed by Google</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={isResetting}
              className="px-3.5 py-2 rounded-lg text-xs font-mono text-white bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              {isResetting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Dispatching link...</span>
                </>
              ) : (
                <span>Reset password</span>
              )}
            </button>
          )}
        </div>
      </div>

      {resetMessage && (
        <div
          className={`mt-4 p-3 rounded-lg text-xs font-mono flex items-start gap-2 ${
            resetMessage.success
              ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
              : "bg-red-500/10 border border-red-500/20 text-red-300"
          }`}
        >
          {resetMessage.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          ) : null}
          <span>{resetMessage.text}</span>
        </div>
      )}
    </div>
  );
}
