"use client";

import React from "react";
import { Loader2 } from "lucide-react";

/**
 * Clean, neutral developer-styled Google OAuth button.
 * Avoids aggressive branded colors (not red) and matches CodeCraft's dark palette.
 */
export default function GoogleAuthButton({
  onClick,
  isLoading = false,
  disabled = false,
  text = "Continue with Google",
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className="w-full h-10 px-4 rounded-lg bg-[#080B12] hover:bg-[#151C29] active:bg-[#18202D] text-white text-sm font-medium border border-[#202938] hover:border-[#2E3B4E] focus:outline-none focus:ring-1 focus:ring-blue-500/40 transition-all flex items-center justify-center gap-2.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed select-none"
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-[#94A3B8]" />
      ) : (
        <svg
          className="w-4 h-4 flex-shrink-0"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="#EA4335"
            d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.3 8.9 5 12 5z"
          />
          <path
            fill="#4285F4"
            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
          />
          <path
            fill="#FBBC05"
            d="M5.3 14.7c-.2-.7-.4-1.5-.4-2.7s.1-2 .4-2.7L1.6 6.4C.6 8.3 0 10.1 0 12s.6 3.7 1.6 5.6l3.7-2.9z"
          />
          <path
            fill="#34A853"
            d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.3-6.7-5.3L1.6 16c1.9 3.8 5.8 7 10.4 7z"
          />
        </svg>
      )}
      <span>{isLoading ? "Signing in..." : text}</span>
    </button>
  );
}
