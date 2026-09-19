"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Code2 } from "lucide-react";

/**
 * Technical top navigation bar for the Account Console.
 * Directly visually links to the IDE and Dashboard.
 */
export default function AccountHeader() {
  return (
    <header className="w-full border-b border-[#202938] bg-[#080B12]/80 backdrop-blur-md sticky top-0 z-30 select-none">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Left: CodeCraft Brand */}
        <Link href="/dashboard" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-[#0D111A] border border-[#202938] flex items-center justify-center group-hover:border-blue-500/50 transition-colors">
            <Code2 className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold tracking-tight text-white group-hover:text-blue-200 transition-colors">
              CodeCraft
            </span>
            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
              IDE
            </span>
          </div>
        </Link>

        {/* Right: Dashboard Return Action */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#CBD5E1] hover:text-white bg-[#0D111A] hover:bg-[#151C29] border border-[#202938] hover:border-[#2E3B4E] transition-all"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Dashboard</span>
        </Link>
      </div>
    </header>
  );
}
