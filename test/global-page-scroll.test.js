import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

console.log("===================================================================");
console.log(" CodeCraft Regression Test — Global Document Scroll Architecture   ");
console.log("===================================================================");

const rootDir = process.cwd();

// ---------------------------------------------------------------------------
// Suite 1: Global Stylesheet Document Scroll Invariant
// ---------------------------------------------------------------------------
test("Suite 1: Global Stylesheet Does Not Disable Document Scrolling", () => {
  const globalsCssPath = path.resolve(rootDir, "src/app/globals.css");
  const globalsCss = fs.readFileSync(globalsCssPath, "utf8");

  // 1. Must NOT have unconditional html, body { overflow: hidden }
  assert.doesNotMatch(
    globalsCss,
    /^html,\s*body\s*\{[^}]*overflow:\s*hidden/m,
    "globals.css must NOT set overflow: hidden globally on html, body"
  );

  // 2. Must NOT set body { height: 100vh } or body { height: 100% } globally
  assert.doesNotMatch(
    globalsCss,
    /^body\s*\{[^}]*height:\s*100(?:vh|%)/m,
    "globals.css must NOT lock body height globally"
  );

  // 3. Overflow locking must be strictly scoped to IDE shell
  assert.match(
    globalsCss,
    /html:has\(\.ide-shell\),\s*body:has\(\.ide-shell\)/,
    "globals.css must scope viewport overflow lock to html:has(.ide-shell), body:has(.ide-shell)"
  );
  assert.match(
    globalsCss,
    /body\.ide-shell-active/,
    "globals.css must support scoped body.ide-shell-active class"
  );

  console.log("  ✔ PASS [Suite 1]: globals.css preserves document scrolling for non-workspace pages");
});

// ---------------------------------------------------------------------------
// Suite 2: Non-Workspace Pages (Dashboard, Home, Auth) Scrollable Container Structure
// ---------------------------------------------------------------------------
test("Suite 2: Non-Workspace Pages Retain Natural Document Flow & Sizing", () => {
  const dashboardPath = path.resolve(rootDir, "src/app/dashboard/page.jsx");
  const dashboardCode = fs.readFileSync(dashboardPath, "utf8");
  const homePath = path.resolve(rootDir, "src/components/Home.jsx");
  const homeCode = fs.readFileSync(homePath, "utf8");
  const authShellPath = path.resolve(rootDir, "src/components/auth/AuthShell.jsx");
  const authShellCode = fs.readFileSync(authShellPath, "utf8");

  // 1. Dashboard must use min-h-screen to allow vertical content growth and document scroll
  assert.match(
    dashboardCode,
    /min-h-screen/,
    "Dashboard must apply min-h-screen to allow vertical document scrolling"
  );
  assert.doesNotMatch(
    dashboardCode,
    /w-screen\s+.*overflow-hidden/,
    "Dashboard must NOT combine w-screen with overflow-hidden"
  );

  // 2. Home landing page must use min-h-screen to allow vertical document scroll
  assert.match(
    homeCode,
    /min-h-screen/,
    "Landing page must apply min-h-screen to allow vertical document scrolling"
  );

  // 3. AuthShell must use min-h-screen to allow vertical document scroll
  assert.match(
    authShellCode,
    /min-h-screen/,
    "AuthShell must apply min-h-screen to allow vertical document scrolling"
  );

  console.log("  ✔ PASS [Suite 2]: Dashboard, Home, and Auth pages have scrollable document layout");
});

// ---------------------------------------------------------------------------
// Suite 3: Workspace Lifecycle & Scoped Viewport Locking
// ---------------------------------------------------------------------------
test("Suite 3: Workspace Scoped Viewport Locking & Cleanup", () => {
  const workspacePath = path.resolve(rootDir, "src/app/workspace/[workspaceId]/page.jsx");
  const workspaceCode = fs.readFileSync(workspacePath, "utf8");

  // 1. Workspace page applies ide-shell class to root container
  assert.match(
    workspaceCode,
    /className="[^"]*\bide-shell\b[^"]*"/,
    "Workspace must apply ide-shell to its root container"
  );

  // 2. Workspace dynamically mounts and cleans up ide-shell-active class on body
  assert.match(
    workspaceCode,
    /document\.body\.classList\.add\(["']ide-shell-active["']\)/,
    "Workspace page must add ide-shell-active on mount"
  );
  assert.match(
    workspaceCode,
    /document\.body\.classList\.remove\(["']ide-shell-active["']\)/,
    "Workspace page must remove ide-shell-active on unmount"
  );

  console.log("  ✔ PASS [Suite 3]: Workspace scopes viewport locking and cleans up on navigation");
});

// ---------------------------------------------------------------------------
// Suite 4: Floating AI Panel Does Not Impose Global Scroll Locks
// ---------------------------------------------------------------------------
test("Suite 4: Floating AI Panel Does Not Lock Document Scroll", () => {
  const workspacePath = path.resolve(rootDir, "src/app/workspace/[workspaceId]/page.jsx");
  const workspaceCode = fs.readFileSync(workspacePath, "utf8");
  const agentPanelPath = path.resolve(rootDir, "src/components/AgentPanel.jsx");
  const agentPanelCode = fs.readFileSync(agentPanelPath, "utf8");

  // 1. Floating panel trigger button is fixed
  assert.match(
    workspaceCode,
    /id=["']floating-ai-trigger["'][\s\S]*?className="[^"]*\bfixed\b/,
    "Floating AI trigger button must be fixed to viewport"
  );

  // 2. Floating panel container is fixed with independent internal bounds
  assert.match(
    workspaceCode,
    /id=["']floating-ai-panel["'][\s\S]*?className="[^"]*\bfixed\b/,
    "Floating AI panel must be fixed to viewport"
  );

  // 3. Pointerdown listener does NOT call preventDefault (which would break scrolling / interaction)
  const pointerDownMatch = workspaceCode.match(/const handlePointerDown = \(e\) => \{([\s\S]*?)\};/);
  assert.ok(pointerDownMatch, "Workspace must define handlePointerDown");
  assert.doesNotMatch(
    pointerDownMatch[1],
    /e\.preventDefault\(\)/,
    "Outside-click pointerdown handler must NOT call e.preventDefault()"
  );

  // 4. AgentPanel must NOT manipulate document.body.style.overflow
  assert.doesNotMatch(
    agentPanelCode,
    /document\.body\.style\.overflow/,
    "AgentPanel must not directly manipulate document.body.style.overflow"
  );

  // 5. AgentPanel content must have internal scrolling (overflow-y-auto)
  assert.match(
    agentPanelCode,
    /overflow-y-auto/,
    "AgentPanel must contain internal scrollable regions"
  );

  console.log("  ✔ PASS [Suite 4]: Floating AI Panel does not lock document scrolling");
});

// ---------------------------------------------------------------------------
// Suite 5: Monaco Editor Internal Scrolling Invariants
// ---------------------------------------------------------------------------
test("Suite 5: Monaco Editor Retains Internal Scrolling", () => {
  const editorPath = path.resolve(rootDir, "src/components/Editor.jsx");
  const editorCode = fs.readFileSync(editorPath, "utf8");

  // 1. Monaco Editor options include automaticLayout: true
  assert.match(
    editorCode,
    /automaticLayout:\s*true/,
    "Monaco editor options must enable automaticLayout: true for internal scrolling"
  );

  // 2. Editor surface has min-h-0 min-w-0 for flexbox scroll containment
  assert.match(
    editorCode,
    /className="flex-1 min-h-0 min-w-0 flex flex-col bg-\[#070B14\] overflow-hidden"/,
    "Editor surface must maintain flex-1 min-h-0 min-w-0 overflow-hidden"
  );

  console.log("  ✔ PASS [Suite 5]: Monaco Editor internal scrolling is fully preserved");
});
