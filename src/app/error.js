"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error("Application error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex h-screen bg-gray-950 items-center justify-center text-white p-4">
      <div className="bg-gray-900 border border-gray-800 p-8 rounded-xl max-w-md w-full text-center shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-red-900/30 border border-red-500/50 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-400" />
        </div>
        <h2 className="text-xl font-bold text-red-400 mb-2">Something went wrong</h2>
        <p className="text-gray-400 text-sm mb-6">
          An unexpected error occurred while loading this page.
        </p>
        <button
          onClick={() => reset()}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
        >
          <RefreshCw className="w-4 h-4" /> Try Again
        </button>
      </div>
    </div>
  );
}
