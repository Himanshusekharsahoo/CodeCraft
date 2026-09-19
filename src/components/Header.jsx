"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import InviteNotification from "./InviteNotification";
import { auth } from "@/config/firebase";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/config/firebase"; // Firestore instance
import { LayoutDashboard, Menu } from "lucide-react";

const Header = ({ workspaceId, onToggleMobileNav, isMobileNavOpen }) => {
  const pathname = usePathname();
  const router = useRouter();
  const [userName, setUserName] = useState(() => {
    const user = auth.currentUser;
    return user?.displayName || user?.email || "";
  });

  // Fetch User Info if not immediately available from Auth cache
  useEffect(() => {
    const user = auth.currentUser;
    if (user && !userName) {
      setUserName(user.displayName || user.email || "");
    }
  }, [userName]);

  const goToDashboard = () => {
    router.push("/dashboard");
  };

  if (pathname.startsWith("/workspace/") || workspaceId) {
    return (
      <header className="h-10 px-2.5 sm:px-4 bg-[#070B14] border-b border-white/[0.08] flex items-center justify-between z-30 select-none w-full min-w-0 overflow-hidden flex-shrink-0">
        {/* Left: Hamburger (Mobile only) + Brand + IDE Tag */}
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-shrink-0">
          {onToggleMobileNav && (
            <button
              onClick={onToggleMobileNav}
              className="md:hidden p-1.5 -ml-1 text-slate-400 hover:text-white hover:bg-white/[0.06] rounded transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500"
              title={isMobileNavOpen ? "Close Navigation" : "Open Navigation"}
              aria-label="Toggle Navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}

          <Link href="/dashboard" className="flex items-center gap-1.5 sm:gap-2 group transition-transform hover:scale-[1.02] flex-shrink-0">
            <span className="text-sm sm:text-base font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 tracking-tight">
              CodeCraft
            </span>
            <span className="text-[9px] sm:text-[10px] px-1.5 py-0.2 rounded-full font-mono font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
              IDE
            </span>
          </Link>
        </div>

        {/* Center: Invite notification if pending */}
        <div className="flex items-center gap-2 min-w-0 overflow-hidden mx-2">
          <InviteNotification />
        </div>

        {/* Right: Dashboard button & Avatar */}
        <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
          <Button
            size="sm"
            onClick={goToDashboard}
            className="h-7 px-2 sm:px-2.5 text-xs bg-slate-900 hover:bg-slate-800 text-gray-300 hover:text-white border border-gray-800 rounded-md transition-colors flex items-center gap-1.5 font-medium"
            title="Return to Workspace Dashboard"
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
            <span className="hidden sm:inline">Dashboard</span>
          </Button>

          <Link href="/profile" title="Profile Settings" className="flex-shrink-0">
            <Avatar className="w-6 h-6 cursor-pointer border border-gray-700 transition-all hover:border-blue-400">
              <AvatarImage src={auth.currentUser?.photoURL || "/robotic.png"} alt="Profile" />
              <AvatarFallback className="text-[10px]">U</AvatarFallback>
            </Avatar>
          </Link>
        </div>
      </header>
    );
  }

  return (
    <header className="flex items-center justify-between px-8 py-3 bg-[#0a0f1e] bg-opacity-80 backdrop-blur-lg border-b border-gray-700 shadow-xl z-20">
      {/* Title with Neon Glow Effect */}
      <Link href="/dashboard" className="flex items-center gap-3 group transition-transform hover:scale-[1.02]">
        <span className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 drop-shadow-lg animate-pulse">
          CodeCraft
        </span>
        <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
          IDE
        </span>
      </Link>

      <InviteNotification />

      <div className="flex items-center gap-6">
        {/* Welcome Message */}
        <p className="text-white text-sm font-medium opacity-90 animate-fadeIn">
          Welcome back, <span className="font-bold text-blue-400">{userName}</span> 👋
        </p>

        {/* Profile Avatar */}
        <Link href="/profile">
          <Avatar className="w-10 h-10 cursor-pointer border-2 border-gray-500 transition-all duration-300 hover:border-blue-400 hover:scale-105">
            <AvatarImage src={auth.currentUser?.photoURL || "/robotic.png"} alt="Profile" />
            <AvatarFallback>U</AvatarFallback>
          </Avatar>
        </Link>
      </div>
    </header>
  );
};

export default Header;
