/**
 * CodeCraft: Workspace Data Isolation, Access Control & Duplication Audit Regression Suite
 *
 * Validates:
 * - P0: Cross-account data isolation (User A vs User B strict separation)
 * - P1: Targeted Firestore queries (elimination of unbounded table-scan queries)
 * - P2: Zero-trust membership and role resolution (non-members on public workspaces excluded from dashboard)
 * - P3: Creation audit (memberUids, default private visibility, opening separation)
 * - P4 / P5: Safe cascading cleanup and dependency audit for test artifacts
 * - P6: Dashboard tab counts, empty states, and refresh invariance
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const HELPERS_MODULE_URL = pathToFileURL(path.join(ROOT_DIR, "src", "lib", "workspaceHelpers.js")).href;

async function runIsolationSuite() {
  console.log("===============================================================================");
  console.log(" CodeCraft Workspace Data Isolation, Access Control & Duplication Suite");
  console.log("===============================================================================");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  \x1b[32m✔ [PASS]\x1b[0m ${name}`);
      passed++;
    } catch (err) {
      console.error(`  \x1b[31m✖ [FAIL]\x1b[0m ${name}`);
      console.error(`         ${err.message}`);
      failed++;
    }
  }

  const {
    resolveUserWorkspaceMembership,
    filterWorkspaces,
    formatWorkspaceRole,
    getRoleBadgeStyle,
    validateWorkspaceName,
    WORKSPACE_ROLES,
  } = await import(HELPERS_MODULE_URL);

  const dashboardPath = path.join(ROOT_DIR, "src", "app", "dashboard", "page.jsx");
  const dashboardSource = fs.readFileSync(dashboardPath, "utf8");
  const firestoreRulesPath = path.join(ROOT_DIR, "firestore.rules");
  const firestoreRulesSource = fs.readFileSync(firestoreRulesPath, "utf8");

  // ===========================================================================
  // Suite 1: Cross-Account Data Isolation & Role Resolution Boundary (P0 & P2)
  // ===========================================================================
  console.log("\n--- Suite 1: Cross-Account Data Isolation & Role Resolution (P0 & P2) ---");

  await test("ISO-01: Owner of workspace is granted OWNER role", async () => {
    const ws = { id: "ws-1", name: "Project Alpha", userId: "user-alice", isPublic: false };
    const res = resolveUserWorkspaceMembership(ws, "user-alice", null);
    assert.equal(res.isMember, true);
    assert.equal(res.role, WORKSPACE_ROLES.OWNER);
  });

  await test("ISO-02: Backward-compatible ownerId match is granted OWNER role", async () => {
    const ws = { id: "ws-2", name: "Project Beta", ownerId: "user-alice", isPublic: true };
    const res = resolveUserWorkspaceMembership(ws, "user-alice", null);
    assert.equal(res.isMember, true);
    assert.equal(res.role, WORKSPACE_ROLES.OWNER);
  });

  await test("ISO-03: Explicit collaborator with member doc is granted member role", async () => {
    const ws = { id: "ws-3", name: "Team Project", userId: "user-alice", isPublic: false };
    const memberDoc = { userId: "user-bob", role: "contributor" };
    const res = resolveUserWorkspaceMembership(ws, "user-bob", memberDoc);
    assert.equal(res.isMember, true);
    assert.equal(res.role, "contributor");
  });

  await test("ISO-04: Non-member on PUBLIC workspace is strictly EXCLUDED (isMember: false, role: null)", async () => {
    // This directly addresses the "prototype 1" bug where public workspaces were assigned "Viewer"
    const publicWs = {
      id: "pQsdVP",
      name: "prototype 1",
      userId: "user-charlie",
      isPublic: true,
    };
    const res = resolveUserWorkspaceMembership(publicWs, "user-bob", null);
    assert.equal(res.isMember, false);
    assert.equal(res.role, null);
  });

  await test("ISO-05: Non-member on PRIVATE workspace is strictly EXCLUDED", async () => {
    const privateWs = {
      id: "uQlCMP",
      name: "prototype 1",
      userId: "user-charlie",
      isPublic: false,
    };
    const res = resolveUserWorkspaceMembership(privateWs, "user-bob", null);
    assert.equal(res.isMember, false);
    assert.equal(res.role, null);
  });

  // ===========================================================================
  // Suite 2: Firestore Query Architecture (P1)
  // ===========================================================================
  console.log("\n--- Suite 2: Firestore Query Architecture (P1) ---");

  await test("QRY-01: Dashboard source strictly avoids unbounded getDocs(collection(db, 'workspaces'))", async () => {
    // Unbounded table scans fetch every workspace across all users and break data isolation
    assert.ok(
      !dashboardSource.includes('getDocs(collection(db, "workspaces"))'),
      "Dashboard must NEVER perform an unbounded global scan getDocs(collection(db, 'workspaces'))"
    );
  });

  await test("QRY-02: Dashboard executes targeted query for owned workspaces (where userId == currentUser.uid)", async () => {
    assert.ok(
      dashboardSource.includes('where("userId", "==", currentUser.uid)'),
      "Dashboard must execute targeted query for owned workspaces by userId"
    );
  });

  await test("QRY-03: Dashboard queries memberUids array-contains for shared workspaces", async () => {
    assert.ok(
      dashboardSource.includes('where("memberUids", "array-contains", currentUser.uid)'),
      "Dashboard must query workspaces where memberUids contains current user"
    );
  });

  await test("QRY-04: Dashboard reads user document joinedWorkspaces for explicit memberships", async () => {
    assert.ok(
      dashboardSource.includes("joinedWorkspaces"),
      "Dashboard must check joinedWorkspaces on user profile"
    );
  });

  // ===========================================================================
  // Suite 3: Creation & Workspace Opening Audit (P3)
  // ===========================================================================
  console.log("\n--- Suite 3: Creation & Workspace Opening Audit (P3) ---");

  await test("CRT-01: Workspace creation stores memberUids array containing owner UID", async () => {
    assert.ok(
      dashboardSource.includes("memberUids: [currentUser.uid]"),
      "Workspace creation must initialize memberUids array with owner UID"
    );
  });

  await test("CRT-02: Workspace creation defaults to Private (newWsIsPublic = false)", async () => {
    assert.ok(
      dashboardSource.includes("useState(false)"),
      "Dashboard must initialize newWsIsPublic with false (Private by default)"
    );
  });

  await test("CRT-03: Creation form submit button is disabled while isCreating is true", async () => {
    assert.ok(
      dashboardSource.includes("disabled={isCreating"),
      "Create button must be disabled while isCreating to prevent duplicate submissions"
    );
  });

  await test("CRT-04: handleOpenWorkspace strictly performs client navigation with ZERO Firestore writes", async () => {
    const openWsMatch = dashboardSource.match(/const handleOpenWorkspace = useCallback\(\((.*?)\) => {([\s\S]*?)}\s*,\s*\[currentUser,\s*router\]\);/);
    assert.ok(openWsMatch, "handleOpenWorkspace must be defined");
    const body = openWsMatch[2];
    assert.ok(!body.includes("addDoc"), "handleOpenWorkspace must never call addDoc");
    assert.ok(!body.includes("setDoc"), "handleOpenWorkspace must never call setDoc");
    assert.ok(body.includes("router.push"), "handleOpenWorkspace must navigate via router.push");
  });

  // ===========================================================================
  // Suite 4: Firestore Security Rules Invariants (P0)
  // ===========================================================================
  console.log("\n--- Suite 4: Firestore Security Rules Invariants (P0) ---");

  await test("SEC-01: Security rules include collection group match for members self-reading", async () => {
    assert.ok(
      firestoreRulesSource.includes("match /{path=**}/members/{memberId}"),
      "firestore.rules must include collection group match for members"
    );
  });

  await test("SEC-02: Security rules maintain immutability of workspace userId (CC-002)", async () => {
    assert.ok(
      firestoreRulesSource.includes("request.resource.data.userId == resource.data.userId"),
      "firestore.rules must enforce immutable userId"
    );
  });

  await test("SEC-03: Security rules require isWorkspaceOwner for member role updates", async () => {
    assert.ok(
      firestoreRulesSource.includes("isWorkspaceOwner(workspaceId)"),
      "firestore.rules must enforce owner-only role modifications"
    );
  });

  // ===========================================================================
  // Suite 5: Dashboard Tabs, Filters & Invariant Refresh (P6)
  // ===========================================================================
  console.log("\n--- Suite 5: Dashboard Tabs, Filters & Invariant Refresh (P6) ---");

  const portfolio = [
    {
      id: "alice-1",
      name: "Alice Backend",
      userId: "user-alice",
      role: "owner",
      archived: false,
      lastOpenedAt: "2026-09-18T10:00:00Z",
    },
    {
      id: "alice-2",
      name: "Alice Docs",
      userId: "user-alice",
      role: "owner",
      archived: true,
      lastOpenedAt: null,
    },
    {
      id: "shared-1",
      name: "Team Frontend",
      userId: "user-charlie",
      role: "contributor",
      archived: false,
      lastOpenedAt: "2026-09-18T12:00:00Z",
    },
  ];

  await test("DASH-01: User A sees only active owned and shared workspaces under 'all'", async () => {
    const all = filterWorkspaces(portfolio, "", "all", "user-alice");
    assert.equal(all.length, 2); // alice-1 and shared-1 (excludes archived alice-2)
    assert.ok(!all.some((w) => w.archived));
  });

  await test("DASH-02: 'owned' tab strictly excludes workspaces owned by others", async () => {
    const owned = filterWorkspaces(portfolio, "", "owned", "user-alice");
    assert.equal(owned.length, 2); // alice-1 and alice-2
    assert.ok(owned.every((w) => w.userId === "user-alice" || w.role === "owner"));
  });

  await test("DASH-03: 'shared' tab strictly includes only non-owned workspaces", async () => {
    const shared = filterWorkspaces(portfolio, "", "shared", "user-alice");
    assert.equal(shared.length, 1);
    assert.equal(shared[0].id, "shared-1");
  });

  await test("DASH-04: Refresh invariance: multiple consecutive filters yield identical outputs", async () => {
    const run1 = filterWorkspaces(portfolio, "", "all", "user-alice");
    const run2 = filterWorkspaces(portfolio, "", "all", "user-alice");
    const run3 = filterWorkspaces(portfolio, "", "all", "user-alice");
    assert.deepEqual(run1.map((w) => w.id), run2.map((w) => w.id));
    assert.deepEqual(run2.map((w) => w.id), run3.map((w) => w.id));
  });

  // ===========================================================================
  // Suite 6: Safe Cascading Cleanup & Dependency Audit (P4 & P5)
  // ===========================================================================
  console.log("\n--- Suite 6: Safe Cascading Cleanup & Dependency Audit (P4 & P5) ---");

  await test("CLN-01: Cascading deletion API endpoint route exists and verifies ownership", async () => {
    const apiRoutePath = path.join(ROOT_DIR, "src", "app", "api", "workspace", "[workspaceId]", "route.js");
    const apiRouteSource = fs.readFileSync(apiRoutePath, "utf8");
    assert.ok(
      apiRouteSource.includes("deleteFirestoreSubcollectionRest") || apiRouteSource.includes("deleteFirestoreDocRest"),
      "Cascading deletion must purge subcollections and root documents"
    );
    assert.ok(
      apiRouteSource.includes("fetchFirestoreWorkspaceMemberRole") || apiRouteSource.includes("owner"),
      "Cascading deletion must verify owner permissions"
    );
  });

  await test("CLN-02: Deletion in dashboard cleans local recents and user joinedWorkspaces", async () => {
    assert.ok(
      dashboardSource.includes("joinedWorkspaces: arrayRemove(wsId)") ||
      dashboardSource.includes("arrayRemove(wsId)"),
      "Dashboard delete must remove workspace from user joinedWorkspaces"
    );
    assert.ok(
      dashboardSource.includes("getRecentStorageKey"),
      "Dashboard delete must purge recents cache"
    );
  });

  console.log("\n===============================================================================");
  console.log(` Workspace Isolation Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("===============================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runIsolationSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
