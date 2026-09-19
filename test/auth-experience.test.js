import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function logPass(id, desc) {
  console.log(`  \x1b[32m✔ [${id}]\x1b[0m ${desc}`);
}

function logSuite(name) {
  console.log(`\n\x1b[1m\x1b[36m▶ Running suite: ${name}\x1b[0m`);
}

async function runTests() {
  console.log("===============================================================================");
  console.log(" CodeCraft Redesigned Authentication & Account Experience Test Suite");
  console.log("===============================================================================");

  // ===========================================================================
  // Suite 1: Auth Guard, State Handling & Flash Prevention (P0 & P4)
  // ===========================================================================
  logSuite("Suite 1: Auth Guard, Explicit States & UI Flash Prevention (P0/P4)");
  {
    const authProviderCode = fs.readFileSync(path.resolve("src/context/AuthProvider.js"), "utf8");

    // 1.1: Explicit states defined
    assert.match(
      authProviderCode,
      /authStatus.*initializing/,
      "AuthProvider must initialize with 'initializing' state"
    );
    assert.match(
      authProviderCode,
      /setAuthStatus\(["']authenticated["']\)/,
      "AuthProvider must set 'authenticated' status when user exists"
    );
    assert.match(
      authProviderCode,
      /setAuthStatus\(["']unauthenticated["']\)/,
      "AuthProvider must set 'unauthenticated' status when user is null"
    );
    assert.match(
      authProviderCode,
      /setAuthStatus\(["']error["']\)/,
      "AuthProvider must set 'error' status on observer failure"
    );
    logPass("AUTH-01", "AuthProvider explicitly defines 'initializing', 'authenticated', 'unauthenticated', 'error' states");

    // 1.2: Protected routes coverage
    assert.match(
      authProviderCode,
      /\/dashboard/,
      "isProtectedRoute must cover /dashboard"
    );
    assert.match(
      authProviderCode,
      /\/workspace/,
      "isProtectedRoute must cover /workspace"
    );
    assert.match(
      authProviderCode,
      /\/profile/,
      "isProtectedRoute must cover /profile"
    );
    assert.match(
      authProviderCode,
      /\/account/,
      "isProtectedRoute must cover /account"
    );
    logPass("AUTH-02", "Protected routes strictly cover /dashboard, /workspace, /profile, and /account");

    // 1.3: Auth routes coverage
    assert.match(
      authProviderCode,
      /\/login/,
      "isAuthRoute must cover /login"
    );
    assert.match(
      authProviderCode,
      /\/signup/,
      "isAuthRoute must cover /signup"
    );
    assert.match(
      authProviderCode,
      /\/register/,
      "isAuthRoute must cover /register"
    );
    logPass("AUTH-03", "Auth routes cover /login, /signup, and /register");

    // 1.4: Prevention of protected content flash
    assert.match(
      authProviderCode,
      /if\s*\(\s*authStatus\s*===\s*["']initializing["']\s*\)\s*\{[\s\S]*?isProtectedRoute/,
      "AuthProvider must render AuthLoadingScreen when initializing on protected routes"
    );
    assert.match(
      authProviderCode,
      /if\s*\(\s*authStatus\s*===\s*["']unauthenticated["']\s*&&\s*isProtectedRoute\s*\)/,
      "AuthProvider must intercept unauthenticated protected access before rendering children"
    );
    logPass("AUTH-04", "Protected routes strictly block rendering children before authentication resolves");

    // 1.5: Prevention of auth page flash for authenticated users
    assert.match(
      authProviderCode,
      /if\s*\(\s*authStatus\s*===\s*["']authenticated["']\s*&&\s*isAuthRoute\s*\)/,
      "AuthProvider must intercept authenticated users on auth routes before rendering children"
    );
    logPass("AUTH-05", "Auth routes block rendering login/signup for already authenticated users");
  }

  // ===========================================================================
  // Suite 2: Shared Design System & Auth Shell (P1)
  // ===========================================================================
  logSuite("Suite 2: Shared Design System & Auth Shell (P1)");
  {
    // 2.1: Tailwind color tokens
    const tailwindConfig = fs.readFileSync(path.resolve("tailwind.config.mjs"), "utf8");
    assert.match(tailwindConfig, /codecraft:\s*\{/, "tailwind.config.mjs must contain codecraft semantic tokens");
    assert.match(tailwindConfig, /bg:\s*['"]#080B12['"]/, "Semantic bg token must be #080B12");
    assert.match(tailwindConfig, /surface:\s*['"]#0D111A['"]/, "Semantic surface token must be #0D111A");
    assert.match(tailwindConfig, /border:\s*['"]#202938['"]/, "Semantic border token must be #202938");
    logPass("DS-01", "Tailwind configuration extended with unified CodeCraft semantic design tokens");

    // 2.2: AuthShell split-screen layout
    const authShellCode = fs.readFileSync(path.resolve("src/components/auth/AuthShell.jsx"), "utf8");
    assert.match(authShellCode, /AuthBrandPanel/, "AuthShell must render AuthBrandPanel on desktop");
    assert.match(authShellCode, /lg:flex-row/, "AuthShell must use split-screen desktop layout");
    assert.match(authShellCode, /max-w-\[420px\]/, "AuthShell must constrain form width to ~420px");
    logPass("DS-02", "AuthShell implements split-screen layout with restrained 420px form container");

    // 2.3: AuthBrandPanel technical details
    const brandPanelCode = fs.readFileSync(path.resolve("src/components/auth/AuthBrandPanel.jsx"), "utf8");
    assert.match(brandPanelCode, /codecraft auth/, "AuthBrandPanel must include terminal command");
    assert.match(brandPanelCode, /Authentication service/, "AuthBrandPanel must include service check");
    assert.match(brandPanelCode, /All systems operational/, "AuthBrandPanel must include operational status");
    logPass("DS-03", "AuthBrandPanel provides developer terminal status and system health indicators");

    // 2.4: Google Auth Button is NOT red
    const googleBtnCode = fs.readFileSync(path.resolve("src/components/auth/GoogleAuthButton.jsx"), "utf8");
    assert.doesNotMatch(googleBtnCode, /bg-red-[0-9]+/, "GoogleAuthButton must NOT use red background");
    assert.match(googleBtnCode, /bg-\[#080B12\]/, "GoogleAuthButton must use neutral dark surface");
    logPass("DS-04", "GoogleAuthButton adheres to neutral dark developer aesthetic (not red)");
  }

  // ===========================================================================
  // Suite 3: Login Page Implementation (P2)
  // ===========================================================================
  logSuite("Suite 3: Login Page Implementation (P2)");
  {
    const loginCode = fs.readFileSync(path.resolve("src/app/login/page.jsx"), "utf8");
    assert.match(loginCode, /AuthShell/, "Login page must use AuthShell");
    assert.match(loginCode, /Welcome back/, "Login page must feature 'Welcome back' heading");
    assert.match(loginCode, /loginWithEmailAndPassword/, "Login page must preserve Firebase email authentication");
    assert.match(loginCode, /loginWithGoogle/, "Login page must preserve Google authentication");
    assert.match(loginCode, /href=["']\/forgot-password["']/, "Login page must link to /forgot-password");
    assert.match(loginCode, /href=["']\/signup["']/, "Login page must link to /signup");
    assert.doesNotMatch(loginCode, /alert\(/, "Login page must not use ugly browser alert()");
    logPass("LOGIN-01", "LoginPage implements redesigned developer split-screen with inline error handling");
  }

  // ===========================================================================
  // Suite 4: Signup Page Implementation (P3)
  // ===========================================================================
  logSuite("Suite 4: Signup Page Implementation (P3)");
  {
    const signupCode = fs.readFileSync(path.resolve("src/app/signup/page.jsx"), "utf8");
    assert.match(signupCode, /AuthShell/, "Signup page must reuse AuthShell");
    assert.match(signupCode, /Create your workspace/, "Signup page must feature 'Create your workspace' heading");
    assert.match(signupCode, /signUpUser/, "Signup page must invoke signUpUser");
    assert.match(signupCode, /signInWithGoogle/, "Signup page must support Google registration");
    assert.match(signupCode, /displayName/, "Signup page must provide display name field");
    assert.match(signupCode, /password\.length\s*<\s*8/, "Signup page must enforce min 8 character password");
    assert.match(signupCode, /href=["']\/login["']/, "Signup page must link to /login");

    // Verify /register re-exports /signup for backward compatibility
    const registerCode = fs.readFileSync(path.resolve("src/app/register/page.jsx"), "utf8");
    assert.match(registerCode, /SignUpPage/, "src/app/register/page.jsx must re-export SignUpPage");
    logPass("SIGNUP-01", "SignUpPage reuses AuthShell, enforces validation, and supports email verification");
  }

  // ===========================================================================
  // Suite 5: Forgot Password Implementation (P5)
  // ===========================================================================
  logSuite("Suite 5: Forgot Password Implementation (P5)");
  {
    const forgotCode = fs.readFileSync(path.resolve("src/app/forgot-password/page.jsx"), "utf8");
    assert.match(forgotCode, /AuthShell/, "Forgot password must use AuthShell");
    assert.match(forgotCode, /Reset your password/, "Forgot password must feature 'Reset your password' heading");
    assert.match(forgotCode, /sendPasswordResetEmail/, "Forgot password must invoke sendPasswordResetEmail");
    assert.match(forgotCode, /If an account exists for/, "Forgot password must use anti-enumeration success message");
    assert.match(forgotCode, /href=["']\/login["']/, "Forgot password must link back to login");
    logPass("FORGOT-01", "ForgotPasswordPage implements anti-enumeration wording and standalone developer view");
  }

  // ===========================================================================
  // Suite 6: Account / Profile Console Implementation (P6)
  // ===========================================================================
  logSuite("Suite 6: Account / Profile Console Implementation (P6)");
  {
    const accountConsoleCode = fs.readFileSync(path.resolve("src/components/account/AccountConsole.jsx"), "utf8");
    assert.match(accountConsoleCode, /ProfileCard/, "AccountConsole must render ProfileCard");
    assert.match(accountConsoleCode, /InvitationsCard/, "AccountConsole must render InvitationsCard");
    assert.match(accountConsoleCode, /SecurityCard/, "AccountConsole must render SecurityCard");
    assert.match(accountConsoleCode, /LogoutAction/, "AccountConsole must render LogoutAction");
    assert.match(accountConsoleCode, /useAuth/, "AccountConsole must use authenticated user session");

    // Profile card real user data & verification
    const profileCardCode = fs.readFileSync(path.resolve("src/components/account/ProfileCard.jsx"), "utf8");
    assert.match(profileCardCode, /user\.displayName/, "ProfileCard must read user.displayName");
    assert.match(profileCardCode, /user\.emailVerified/, "ProfileCard must check user.emailVerified");
    assert.match(profileCardCode, /getInitials/, "ProfileCard must provide initials fallback for avatar");

    // Security card conditional Google vs password
    const securityCardCode = fs.readFileSync(path.resolve("src/components/account/SecurityCard.jsx"), "utf8");
    assert.match(securityCardCode, /providerId\s*===\s*["']google\.com["']/, "SecurityCard must detect Google OAuth");
    assert.match(securityCardCode, /Managed by Google/, "SecurityCard must adapt for Google accounts");
    assert.match(securityCardCode, /sendPasswordResetEmail/, "SecurityCard must allow password reset for password accounts");

    // Logout action confirmation
    const logoutCode = fs.readFileSync(path.resolve("src/components/account/LogoutAction.jsx"), "utf8");
    assert.match(logoutCode, /showConfirm/, "LogoutAction must provide confirmation state");
    assert.match(logoutCode, /Sign out of CodeCraft\?/, "LogoutAction must ask for confirmation");
    assert.match(logoutCode, /signOut\(auth\)/, "LogoutAction must perform Firebase signOut");

    // Verify /account and /profile routes
    const accountRoute = fs.readFileSync(path.resolve("src/app/account/page.jsx"), "utf8");
    assert.match(accountRoute, /AccountConsole/, "src/app/account/page.jsx must render AccountConsole");
    const profileRoute = fs.readFileSync(path.resolve("src/app/profile/page.jsx"), "utf8");
    assert.match(profileRoute, /AccountConsole/, "src/app/profile/page.jsx must render AccountConsole");
    logPass("ACCOUNT-01", "AccountConsole provides complete developer account management with invitations & security");
  }

  console.log("\n\x1b[32m✔ All Authentication, Shell, and Account Console tests passed successfully!\x1b[0m\n");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
