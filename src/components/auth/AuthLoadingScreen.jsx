"use client";

import React from "react";
import { Terminal, Code2 } from "lucide-react";

/**
 * Minimal, dark, developer-focused session loading screen.
 * Replaces generic flashy marketing loaders with a restrained IDE aesthetic.
 */
export default function AuthLoadingScreen({
  message = "Initializing session...",
  description = "Setting up secure developer environment",
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-screen w-full bg-[#080B12] text-[#F8FAFC] flex flex-col items-center justify-center p-6 selection:bg-blue-500/20 font-sans"
    >
      {/* Centered Developer Card */}
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        {/* IDE Brand Icon */}
        <div className="w-12 h-12 rounded-xl bg-[#0D111A] border border-[#202938] flex items-center justify-center mb-5 shadow-inner">
          <Code2 className="w-6 h-6 text-blue-400" />
        </div>

        {/* Brand Name */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base font-bold tracking-tight text-white">CodeCraft</span>
          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
            IDE
          </span>
        </div>

        {/* Status Line with Pulsing Indicator */}
        <div className="flex items-center gap-2 text-sm font-medium text-[#CBD5E1] mb-1">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span>{message}</span>
        </div>

        {/* Muted Terminal Description */}
        {description && (
          <p className="text-xs text-[#64748B] font-mono mt-1 max-w-xs leading-relaxed">
            {description}
          </p>
        )}

        {/* Minimal Progress Bar */}
        <div className="w-48 h-0.5 bg-[#18202D] rounded-full overflow-hidden mt-6">
          <div className="h-full bg-blue-500/80 rounded-full w-24 animate-[pulse_1.5s_ease-in-out_infinite]" />
        </div>

        {/* Footer Meta */}
        <div className="mt-8 pt-4 border-t border-[#18202D]/60 flex items-center gap-2 text-[11px] font-mono text-[#64748B]">
          <Terminal className="w-3 h-3 text-[#64748B]" />
          <span>SECURE_SESSION // v1.0</span>
        </div>
      </div>
    </div>
  );
}
