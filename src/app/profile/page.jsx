"use client";

import AccountConsole from "@/components/account/AccountConsole";

/**
 * Re-export AccountConsole under /profile for seamless backward compatibility.
 */
export default function ProfilePage() {
  return <AccountConsole />;
}
