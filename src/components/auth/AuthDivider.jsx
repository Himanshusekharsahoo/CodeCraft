"use client";

import React from "react";

/**
 * Subtle technical divider for separating authentication methods.
 */
export default function AuthDivider({ text = "or" }) {
  return (
    <div className="relative my-5 flex items-center justify-center select-none" aria-hidden="true">
      <div className="w-full border-t border-[#202938]" />
      <span className="absolute bg-[#0D111A] px-2 text-[11px] font-mono text-[#64748B] uppercase tracking-wider">
        {text}
      </span>
    </div>
  );
}
