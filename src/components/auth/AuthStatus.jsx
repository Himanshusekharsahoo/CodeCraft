"use client";

import React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * Polished inline error / success feedback component for developer forms.
 * Replaces intrusive toasts or browser alerts with inline contextual status.
 */
export function AuthError({ title, message }) {
  if (!message && !title) return null;

  return (
    <div
      role="alert"
      className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-3 text-xs flex items-start gap-2.5 font-mono mb-4 animate-in fade-in duration-200"
    >
      <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        {title && <p className="font-semibold text-red-200">{title}</p>}
        <p className="text-red-300/90 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

export function AuthSuccess({ title, message }) {
  if (!message && !title) return null;

  return (
    <div
      role="status"
      className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-lg p-3 text-xs flex items-start gap-2.5 font-mono mb-4 animate-in fade-in duration-200"
    >
      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        {title && <p className="font-semibold text-emerald-200">{title}</p>}
        <p className="text-emerald-300/90 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}
