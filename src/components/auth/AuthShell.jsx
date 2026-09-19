"use client";

import React from "react";
import Link from "next/link";
import { Code2 } from "lucide-react";
import AuthBrandPanel from "./AuthBrandPanel";

/**
 * Reusable split-screen authentication shell for CodeCraft IDE.
 *
 * Desktop:
 * - Left side ~45%: Technical brand & terminal status panel
 * - Right side ~55%: Centered, restrained developer authentication form
 *
 * Mobile / Tablet:
 * - Left panel collapses into a compact developer identity header
 * - Form remains centered with max-w-[420px] and zero horizontal overflow
 */
export default function AuthShell({ children }) {
  return (
    <div className="min-h-screen w-full bg-[#080B12] text-[#F8FAFC] flex flex-col lg:flex-row selection:bg-blue-500/25 selection:text-white font-sans antialiased overflow-x-hidden">
      {/* 1. Left Side: Developer Brand & Architecture Panel (Desktop) */}
      <AuthBrandPanel />

      {/* 2. Right Side: Centered Authentication Form */}
      <main
        role="main"
        className="flex-1 flex flex-col justify-center items-center px-4 sm:px-8 py-8 sm:py-12 bg-[#0D111A]/40"
      >
        <div className="w-full max-w-[420px] flex flex-col">
          {/* Mobile / Tablet Compact Brand Header */}
          <div className="lg:hidden flex items-center justify-between pb-6 mb-6 border-b border-[#202938]">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-[#0D111A] border border-[#202938] flex items-center justify-center group-hover:border-blue-500/50 transition-colors">
                <Code2 className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold tracking-tight text-white">CodeCraft</span>
                <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                  IDE
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#22C55E]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
              <span>Ready</span>
            </div>
          </div>

          {/* Form Content */}
          <div className="w-full">{children}</div>

          {/* Minimal Mobile Footer */}
          <div className="lg:hidden mt-8 pt-6 border-t border-[#18202D] text-center text-[11px] font-mono text-[#64748B]">
            <span>CodeCraft Developer Cloud · v1.0</span>
          </div>
        </div>
      </main>
    </div>
  );
}
