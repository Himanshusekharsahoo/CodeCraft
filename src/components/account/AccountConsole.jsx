"use client";

import React from "react";
import { useAuth } from "@/context/AuthProvider";
import AccountHeader from "./AccountHeader";
import ProfileCard from "./ProfileCard";
import InvitationsCard from "./InvitationsCard";
import SecurityCard from "./SecurityCard";
import LogoutAction from "./LogoutAction";
import { Loader2 } from "lucide-react";

export default function AccountConsole() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-[#080B12] text-[#F8FAFC] flex items-center justify-center font-mono text-xs text-[#64748B]">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          <span>Loading developer profile...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen w-full bg-[#080B12] text-[#F8FAFC] flex flex-col font-sans selection:bg-blue-500/25 selection:text-white pb-16">
      {/* 1. Header Bar */}
      <AccountHeader />

      {/* 2. Main Account Container */}
      <main className="max-w-4xl w-full mx-auto px-4 sm:px-6 pt-8 sm:pt-10 flex-1 space-y-6">
        {/* Page Title & Subtitle */}
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Account
          </h1>
          <p className="text-sm text-[#94A3B8]">
            Manage your CodeCraft identity and workspace access
          </p>
        </div>

        {/* Profile Card */}
        <ProfileCard user={user} />

        {/* Workspace Invitations Card */}
        <InvitationsCard user={user} />

        {/* Security & Password Card */}
        <SecurityCard user={user} />

        {/* Logout Action */}
        <LogoutAction />
      </main>
    </div>
  );
}
