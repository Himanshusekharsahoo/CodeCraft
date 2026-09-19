"use client";

import SignUpPage from "@/app/signup/page";

/**
 * Re-export the redesigned SignUpPage under /register to guarantee backward compatibility.
 */
export default function RegisterPage() {
  return <SignUpPage />;
}
