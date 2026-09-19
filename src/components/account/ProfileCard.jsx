"use client";

import React, { useState } from "react";
import Image from "next/image";
import { CheckCircle2, AlertTriangle, ShieldCheck, Mail, Loader2, Sparkles } from "lucide-react";
import { sendEmailVerification } from "firebase/auth";
import { normalizeError } from "@/lib/errorUtils";

function getInitials(name, email) {
  if (name && typeof name === "string") {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email && typeof email === "string") {
    return email.slice(0, 2).toUpperCase();
  }
  return "DEV";
}

export default function ProfileCard({ user }) {
  const [isSendingVerif, setIsSendingVerif] = useState(false);
  const [verifStatus, setVerifStatus] = useState(null);

  if (!user) return null;

  const displayName = user.displayName || user.email?.split("@")[0] || "Developer";
  const email = user.email || "No email associated";
  const initials = getInitials(user.displayName, user.email);
  const isVerified = Boolean(user.emailVerified);
  const isGoogle = user.providerData?.some((p) => p.providerId === "google.com");

  const handleSendVerification = async () => {
    if (isSendingVerif) return;
    setIsSendingVerif(true);
    setVerifStatus(null);

    try {
      await sendEmailVerification(user);
      setVerifStatus({ success: true, message: "Verification link sent to your email!" });
    } catch (err) {
      const norm = normalizeError(err, "Failed to send verification email. Try again later.");
      setVerifStatus({ success: false, message: norm.message });
    } finally {
      setIsSendingVerif(false);
    }
  };

  return (
    <div className="bg-[#0D111A] border border-[#202938] rounded-xl p-5 sm:p-6 shadow-xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
        {/* Left: Avatar + Details */}
        <div className="flex items-center gap-4">
          {/* Avatar / Fallback */}
          <div className="relative w-14 h-14 rounded-xl bg-[#111722] border border-[#202938] flex items-center justify-center overflow-hidden flex-shrink-0 shadow-inner">
            {user.photoURL && user.photoURL !== "/robotic.png" ? (
              <Image
                src={user.photoURL}
                alt={displayName}
                width={56}
                height={56}
                className="w-full h-full object-cover"
                unoptimized
              />
            ) : (
              <span className="text-base font-bold font-mono text-blue-400">
                {initials}
              </span>
            )}
            {isVerified && (
              <div
                title="Verified Account"
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#080B12] flex items-center justify-center"
              >
                <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
              </div>
            )}
          </div>

          {/* User Info */}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                {displayName}
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#111722] text-[#94A3B8] border border-[#202938]">
                {isGoogle ? "Google OAuth" : "Developer"}
              </span>
            </div>

            <p className="text-xs text-[#CBD5E1] font-mono mt-0.5">{email}</p>

            <div className="flex items-center gap-3 mt-2 text-[11px] font-mono">
              {isVerified ? (
                <span className="inline-flex items-center gap-1 text-[#22C55E]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Account verified</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[#F59E0B]">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Unverified email</span>
                </span>
              )}

              <span className="text-[#64748B]">•</span>
              <span className="text-[#64748B] truncate max-w-[140px] sm:max-w-[200px]">
                UID: {user.uid}
              </span>
            </div>
          </div>
        </div>

        {/* Right Action: Resend Verification if Unverified */}
        {!isVerified && !isGoogle && (
          <div className="w-full sm:w-auto">
            <button
              type="button"
              onClick={handleSendVerification}
              disabled={isSendingVerif}
              className="w-full sm:w-auto px-3.5 py-2 rounded-lg bg-[#111722] hover:bg-[#151C29] text-xs font-mono text-[#CBD5E1] hover:text-white border border-[#202938] hover:border-[#2E3B4E] transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isSendingVerif ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Mail className="w-3.5 h-3.5 text-blue-400" />
                  <span>Send verification email</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {verifStatus && (
        <div
          className={`mt-4 p-2.5 rounded-lg text-xs font-mono ${
            verifStatus.success
              ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
              : "bg-red-500/10 border border-red-500/20 text-red-300"
          }`}
        >
          {verifStatus.message}
        </div>
      )}
    </div>
  );
}
