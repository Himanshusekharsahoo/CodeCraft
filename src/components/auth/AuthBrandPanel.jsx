"use client";

import React from "react";
import { Code2, Check, Terminal } from "lucide-react";

/**
 * Reusable developer brand & terminal panel for the split-screen auth shell.
 * Features a restrained, technical terminal view and system capability checklist.
 */
export default function AuthBrandPanel() {
  return (
    <aside
      aria-label="CodeCraft Developer Overview"
      className="hidden lg:flex lg:w-[45%] flex-col justify-between p-8 xl:p-12 bg-[#080B12] border-r border-[#202938] select-none text-[#F8FAFC]"
    >
      {/* 1. Header Section */}
      <div>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-[#0D111A] border border-[#202938] flex items-center justify-center shadow-inner">
            <Code2 className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-white">CodeCraft</span>
              <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30">
                IDE
              </span>
            </div>
            <p className="text-[11px] font-mono text-[#64748B] tracking-wider uppercase">
              AI-Assisted Collaborative IDE
            </p>
          </div>
        </div>

        {/* Action Commands */}
        <div className="font-mono text-xs text-[#64748B] space-y-1 mb-8 pl-1">
          <div className="text-blue-400/90">&gt; build</div>
          <div className="text-[#94A3B8]">&gt; collaborate</div>
          <div className="text-[#64748B]">&gt; create</div>
        </div>

        {/* 2. Technical Terminal Window */}
        <div className="bg-[#0D111A] border border-[#202938] rounded-xl overflow-hidden mb-8 shadow-2xl">
          {/* Terminal Title Bar */}
          <div className="px-4 py-2.5 bg-[#111722] border-b border-[#202938] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444]/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E]/60" />
            </div>
            <span className="text-[11px] font-mono text-[#64748B]">session://terminal.codecraft</span>
            <div className="w-10" />
          </div>

          {/* Terminal Output */}
          <div className="p-4 font-mono text-xs leading-relaxed space-y-2 text-[#CBD5E1]">
            <div className="flex items-center gap-2 text-blue-400">
              <span className="text-[#64748B]">$</span>
              <span>codecraft auth --mode=secure</span>
            </div>
            <div className="text-[#64748B] text-[11px]">Connecting to developer cluster...</div>

            <div className="space-y-1 pt-1 text-[11px]">
              <div className="flex items-center gap-2 text-[#22C55E]">
                <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                <span>Authentication service</span>
              </div>
              <div className="flex items-center gap-2 text-[#22C55E]">
                <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                <span>Workspace sync service</span>
              </div>
              <div className="flex items-center gap-2 text-[#22C55E]">
                <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                <span>Realtime collaboration engine</span>
              </div>
              <div className="flex items-center gap-2 text-[#22C55E]">
                <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                <span>AI Coding Agent (Gemini)</span>
              </div>
            </div>

            <div className="pt-2 text-blue-400 flex items-center gap-1">
              <span>ready</span>
              <span className="inline-block w-1.5 h-3 bg-blue-400 animate-[pulse_1s_infinite]" />
            </div>
          </div>
        </div>

        {/* 3. Product Capabilities Checklist */}
        <div className="space-y-2.5 pl-1">
          <p className="text-[11px] font-mono uppercase tracking-wider text-[#64748B] mb-2 font-medium">
            Core Architecture
          </p>
          <div className="flex items-center gap-2.5 text-xs text-[#CBD5E1]">
            <div className="w-4 h-4 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Check className="w-3 h-3 text-blue-400" />
            </div>
            <span>Real-time multi-user CRDT collaboration</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-[#CBD5E1]">
            <div className="w-4 h-4 rounded bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Check className="w-3 h-3 text-purple-400" />
            </div>
            <span>AI coding agent &amp; intelligent diagnostics</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-[#CBD5E1]">
            <div className="w-4 h-4 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Check className="w-3 h-3 text-emerald-400" />
            </div>
            <span>Isolated, secure sandbox code execution</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-[#CBD5E1]">
            <div className="w-4 h-4 rounded bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Check className="w-3 h-3 text-amber-400" />
            </div>
            <span>Git-powered branch &amp; commit version control</span>
          </div>
        </div>
      </div>

      {/* 4. Footer System Status */}
      <div className="pt-6 border-t border-[#18202D] flex items-center justify-between text-xs font-mono text-[#64748B]">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-[#64748B]" />
          <span>CODECRAFT v1.0</span>
        </div>
        <div className="flex items-center gap-1.5 text-[#22C55E]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
          <span className="text-[11px]">All systems operational</span>
        </div>
      </div>
    </aside>
  );
}
