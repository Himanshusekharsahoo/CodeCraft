"use client";

import React, { useState } from "react";
import { LogOut, AlertTriangle, Loader2 } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/config/firebase";

export default function LogoutAction() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleConfirmLogout = async () => {
    setIsLoggingOut(true);
    try {
      await signOut(auth);
      window.location.href = "/login";
    } catch (err) {
      console.error("Logout failed:", err);
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="pt-2 flex justify-end">
      {showConfirm ? (
        <div className="w-full sm:max-w-md bg-[#0D111A] border border-red-500/30 rounded-xl p-4 shadow-xl flex flex-col gap-3 animate-in fade-in duration-150">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Sign out of CodeCraft?</h4>
              <p className="text-xs text-[#94A3B8] mt-0.5 leading-relaxed">
                You will need to sign in again to access your collaborative developer workspaces.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#18202D]">
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              disabled={isLoggingOut}
              className="px-3 py-1.5 rounded-lg text-xs font-mono text-[#CBD5E1] hover:text-white bg-[#111722] hover:bg-[#151C29] border border-[#202938] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmLogout}
              disabled={isLoggingOut}
              className="px-3.5 py-1.5 rounded-lg text-xs font-mono text-white bg-red-600 hover:bg-red-500 active:bg-red-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isLoggingOut ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Signing out...</span>
                </>
              ) : (
                <>
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Log out</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono text-[#94A3B8] hover:text-red-400 bg-[#0D111A] hover:bg-[#151C29] border border-[#202938] hover:border-red-500/30 transition-all"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Log out</span>
        </button>
      )}
    </div>
  );
}
