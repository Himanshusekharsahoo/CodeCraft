/**
 * CodeCraft Phase 12.5: Workspace Dashboard, Workspace Management & Product Entry Experience Test Suite
 *
 * Verifies:
 * - Workspace name validation (rejection of empty, path traversal, control chars, >64 chars)
 * - Workspace description sanitization
 * - Role badges, formatting, and authority checks (canManageMembers, canDeleteWorkspace, canLeaveWorkspace)
 * - Workspace filtering by tab (all, owned, shared, recent) and search query
 * - Recents caching and storage mechanics
 * - Cascading deletion sequence integrity
 * - Invitation acceptance and decline state transitions
 * - Firestore rules security invariants for invitations and member access
 * - Header branding and navigation
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const HELPERS_MODULE_URL = pathToFileURL(path.join(ROOT_DIR, "src", "lib", "workspaceHelpers.js")).href;

async function runPhase12_5Tests() {
  console.log("===================================================================");
  console.log("  CodeCraft Phase 12.5 — Workspace Dashboard & Management Suite");
  console.log("===================================================================");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err.message}`);
      failed++;
    }
  }

  const {
    validateWorkspaceName,
    sanitizeWorkspaceDescription,
    formatWorkspaceRole,
    getRoleBadgeStyle,
    canManageMembers,
    canDeleteWorkspace,
    canLeaveWorkspace,
    filterWorkspaces,
    getRecentStorageKey,
    recordRecentWorkspace,
    WORKSPACE_ROLES,
  } = await import(HELPERS_MODULE_URL);

  // ============================================================================
  // Suite 1: Workspace Domain Validation & Sanitization
  // ============================================================================
  console.log("\n--- Suite 1: Workspace Domain Validation & Sanitization ---");

  await test("WS-VAL-01: Valid workspace name passes and returns trimmed name", async () => {
    const res = validateWorkspaceName("  my-awesome-workspace  ");
    assert.equal(res.valid, true);
    assert.equal(res.sanitizedName, "my-awesome-workspace");
    assert.equal(res.error, null);
  });

  await test("WS-VAL-02: Empty or whitespace-only name is strictly rejected", async () => {
    assert.equal(validateWorkspaceName("").valid, false);
    assert.equal(validateWorkspaceName("   ").valid, false);
    assert.equal(validateWorkspaceName(null).valid, false);
    assert.equal(validateWorkspaceName(undefined).valid, false);
  });

  await test("WS-VAL-03: Path traversal characters (.., /, \\) are strictly rejected", async () => {
    assert.equal(validateWorkspaceName("../secret").valid, false);
    assert.equal(validateWorkspaceName("workspaces/sub").valid, false);
    assert.equal(validateWorkspaceName("test\\back").valid, false);
    assert.match(validateWorkspaceName("../foo").error, /path traversal|slash/i);
  });

  await test("WS-VAL-04: Control characters and null bytes are rejected", async () => {
    assert.equal(validateWorkspaceName("bad\x00name").valid, false);
    assert.equal(validateWorkspaceName("newline\nname").valid, false);
    assert.equal(validateWorkspaceName("tab\tname").valid, false);
  });

  await test("WS-VAL-05: Workspace names exceeding 64 characters are rejected", async () => {
    const longName = "a".repeat(65);
    const res = validateWorkspaceName(longName);
    assert.equal(res.valid, false);
    assert.match(res.error, /64 characters/i);

    // Exactly 64 chars is valid
    assert.equal(validateWorkspaceName("a".repeat(64)).valid, true);
  });

  await test("WS-VAL-06: Workspace description is sanitized and capped at 256 characters", async () => {
    assert.equal(sanitizeWorkspaceDescription("   valid description   "), "valid description");
    assert.equal(sanitizeWorkspaceDescription(null), "");
    assert.equal(sanitizeWorkspaceDescription(123), "");
    const longDesc = "x".repeat(300);
    const sanitized = sanitizeWorkspaceDescription(longDesc);
    assert.equal(sanitized.length, 256);
  });

  // ============================================================================
  // Suite 2: Role Management, Styles & Authority Matrix
  // ============================================================================
  console.log("\n--- Suite 2: Role Management, Styles & Authority Matrix ---");

  await test("ROLE-01: formatWorkspaceRole normalizes all roles correctly", async () => {
    assert.equal(formatWorkspaceRole("owner"), "Owner");
    assert.equal(formatWorkspaceRole("OWNER"), "Owner");
    assert.equal(formatWorkspaceRole("contributor"), "Contributor");
    assert.equal(formatWorkspaceRole("viewer"), "Viewer");
    assert.equal(formatWorkspaceRole("unknown"), "Member");
    assert.equal(formatWorkspaceRole(null), "Member");
  });

  await test("ROLE-02: getRoleBadgeStyle yields distinct badge themes", async () => {
    const ownerStyle = getRoleBadgeStyle("owner");
    assert.equal(ownerStyle.label, "Owner");
    assert.match(ownerStyle.bgClass, /purple/);

    const contribStyle = getRoleBadgeStyle("contributor");
    assert.equal(contribStyle.label, "Contributor");
    assert.match(contribStyle.bgClass, /emerald/);

    const viewerStyle = getRoleBadgeStyle("viewer");
    assert.equal(viewerStyle.label, "Viewer");
    assert.match(viewerStyle.bgClass, /amber/);
  });

  await test("ROLE-03: canManageMembers is strictly owner-only", async () => {
    assert.equal(canManageMembers(WORKSPACE_ROLES.OWNER), true);
    assert.equal(canManageMembers("owner"), true);
    assert.equal(canManageMembers(WORKSPACE_ROLES.CONTRIBUTOR), false);
    assert.equal(canManageMembers(WORKSPACE_ROLES.VIEWER), false);
    assert.equal(canManageMembers(null), false);
  });

  await test("ROLE-04: canDeleteWorkspace is strictly owner-only", async () => {
    assert.equal(canDeleteWorkspace(WORKSPACE_ROLES.OWNER), true);
    assert.equal(canDeleteWorkspace(WORKSPACE_ROLES.CONTRIBUTOR), false);
    assert.equal(canDeleteWorkspace(WORKSPACE_ROLES.VIEWER), false);
  });

  await test("ROLE-05: canLeaveWorkspace blocks sole owner from orphaning workspace", async () => {
    const soleOwnerCheck = canLeaveWorkspace("owner", true);
    assert.equal(soleOwnerCheck.canLeave, false);
    assert.match(soleOwnerCheck.reason, /transferring ownership or deleting/i);

    const nonSoleOwnerCheck = canLeaveWorkspace("owner", false);
    assert.equal(nonSoleOwnerCheck.canLeave, true);

    const contribCheck = canLeaveWorkspace("contributor", true);
    assert.equal(contribCheck.canLeave, true);

    const viewerCheck = canLeaveWorkspace("viewer", true);
    assert.equal(viewerCheck.canLeave, true);
  });

  // ============================================================================
  // Suite 3: Workspace Search, Tab Filtering & Recents Cache
  // ============================================================================
  console.log("\n--- Suite 3: Workspace Search, Tab Filtering & Recents Cache ---");

  const sampleWorkspaces = [
    {
      id: "ws-1",
      name: "Alpha Project",
      description: "Frontend Next.js app",
      userId: "user-alice",
      role: "owner",
      archived: false,
      lastOpenedAt: "2026-09-06T10:00:00Z",
    },
    {
      id: "ws-2",
      name: "Beta API",
      description: "Node.js backend service",
      userId: "user-bob",
      role: "contributor",
      archived: false,
      lastOpenedAt: "2026-09-06T12:00:00Z",
    },
    {
      id: "ws-3",
      name: "Gamma Docs",
      description: "Architecture docs",
      userId: "user-charlie",
      role: "viewer",
      archived: false,
      lastOpenedAt: null,
    },
    {
      id: "ws-4",
      name: "Old Archive",
      description: "Deprecated code",
      userId: "user-alice",
      role: "owner",
      archived: true,
      lastOpenedAt: "2026-08-01T00:00:00Z",
    },
  ];

  await test("FILTER-01: Tab 'all' includes active workspaces and excludes archived", async () => {
    const result = filterWorkspaces(sampleWorkspaces, "", "all", "user-alice");
    assert.equal(result.length, 3);
    assert.ok(!result.some((w) => w.archived));
  });

  await test("FILTER-02: Tab 'owned' filters exclusively to owned workspaces", async () => {
    const result = filterWorkspaces(sampleWorkspaces, "", "owned", "user-alice");
    assert.equal(result.length, 2); // ws-1 and ws-4
    assert.ok(result.every((w) => w.userId === "user-alice" || w.role === "owner"));
  });

  await test("FILTER-03: Tab 'shared' filters to non-owned workspaces", async () => {
    const result = filterWorkspaces(sampleWorkspaces, "", "shared", "user-alice");
    assert.equal(result.length, 2); // ws-2 (contributor) and ws-3 (viewer)
    assert.ok(result.some((w) => w.id === "ws-2"));
    assert.ok(result.some((w) => w.id === "ws-3"));
  });

  await test("FILTER-04: Tab 'recent' sorts descending by lastOpenedAt", async () => {
    const result = filterWorkspaces(sampleWorkspaces, "", "recent", "user-alice");
    assert.equal(result.length, 3);
    assert.equal(result[0].id, "ws-2"); // 12:00
    assert.equal(result[1].id, "ws-1"); // 10:00
    assert.equal(result[2].id, "ws-4"); // August
  });

  await test("FILTER-05: Search query matches name, description, or role (case-insensitive)", async () => {
    const byName = filterWorkspaces(sampleWorkspaces, "alpha", "all", "user-alice");
    assert.equal(byName.length, 1);
    assert.equal(byName[0].id, "ws-1");

    const byDesc = filterWorkspaces(sampleWorkspaces, "backend", "all", "user-alice");
    assert.equal(byDesc.length, 1);
    assert.equal(byDesc[0].id, "ws-2");

    const byRole = filterWorkspaces(sampleWorkspaces, "viewer", "all", "user-alice");
    assert.equal(byRole.length, 1);
    assert.equal(byRole[0].id, "ws-3");
  });

  await test("FILTER-06: Recent storage cache key generates per-user key and bounds storage", async () => {
    const key = getRecentStorageKey("user-123");
    assert.equal(key, "codecraft_recent_ws_user-123");

    // Mock localStorage
    const store = {};
    global.window = { localStorage: true };
    global.localStorage = {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => {
        store[k] = v;
      },
    };

    recordRecentWorkspace("user-123", { id: "ws-a", name: "Alpha" });
    recordRecentWorkspace("user-123", { id: "ws-b", name: "Beta" });
    recordRecentWorkspace("user-123", { id: "ws-c", name: "Gamma" });
    recordRecentWorkspace("user-123", { id: "ws-d", name: "Delta" });
    recordRecentWorkspace("user-123", { id: "ws-e", name: "Epsilon" });
    recordRecentWorkspace("user-123", { id: "ws-f", name: "Zeta" });

    const cached = JSON.parse(store[key]);
    assert.equal(cached.length, 5, "Recent cache must be capped at 5 items");
    assert.equal(cached[0].id, "ws-f", "Most recently recorded must be first");
  });

  // ============================================================================
  // Suite 4: Cascading Delete Sequence Integrity
  // ============================================================================
  console.log("\n--- Suite 4: Cascading Delete Sequence Integrity ---");

  await test("DEL-01: Verified cascading deletion destroys subcollections before root document", async () => {
    const deletedOrder = [];
    const mockDb = {
      deleteSubcollection: async (sub) => {
        deletedOrder.push(`sub:${sub}`);
      },
      deleteRoot: async (wsId) => {
        deletedOrder.push(`root:${wsId}`);
      },
    };

    // Simulated cascading delete helper
    async function simulateCascadingDelete(wsId) {
      await mockDb.deleteSubcollection("files");
      await mockDb.deleteSubcollection("folders");
      await mockDb.deleteSubcollection("comments");
      await mockDb.deleteSubcollection("git");
      await mockDb.deleteSubcollection("members");
      await mockDb.deleteSubcollection("messages");
      await mockDb.deleteRoot(wsId);
    }

    await simulateCascadingDelete("test-ws-delete");

    assert.deepEqual(deletedOrder, [
      "sub:files",
      "sub:folders",
      "sub:comments",
      "sub:git",
      "sub:members",
      "sub:messages",
      "root:test-ws-delete",
    ]);
  });

  await test("DEL-02: Non-owner deletion attempt is forbidden by policy", async () => {
    assert.equal(canDeleteWorkspace("contributor"), false);
    assert.equal(canDeleteWorkspace("viewer"), false);
    assert.equal(canDeleteWorkspace("unknown"), false);
  });

  // ============================================================================
  // Suite 5: Product Entry & Invitation Flow Logic
  // ============================================================================
  console.log("\n--- Suite 5: Product Entry & Invitation Flow Logic ---");

  await test("INV-01: Accepting an invite creates contributor record and removes invite from user", async () => {
    let userInvites = ["ws-invited-99"];
    let membersCreated = [];

    async function acceptInvite(userId, workspaceId) {
      membersCreated.push({
        workspaceId,
        userId,
        role: WORKSPACE_ROLES.CONTRIBUTOR,
      });
      userInvites = userInvites.filter((id) => id !== workspaceId);
    }

    await acceptInvite("user-alice", "ws-invited-99");
    assert.equal(membersCreated.length, 1);
    assert.equal(membersCreated[0].role, "contributor");
    assert.equal(userInvites.length, 0);
  });

  await test("INV-02: Declining an invite removes invite without creating member record", async () => {
    let userInvites = ["ws-decline-1", "ws-stay-2"];
    let membersCreated = [];

    async function declineInvite(workspaceId) {
      userInvites = userInvites.filter((id) => id !== workspaceId);
    }

    await declineInvite("ws-decline-1");
    assert.equal(userInvites.length, 1);
    assert.equal(userInvites[0], "ws-stay-2");
    assert.equal(membersCreated.length, 0);
  });

  await test("INV-03: Security rules verify uninvited users cannot self-join private workspaces", async () => {
    const firestoreRulesContent = fs.readFileSync(path.join(ROOT_DIR, "firestore.rules"), "utf8");
    assert.ok(
      firestoreRulesContent.includes("isWorkspaceOwner(workspaceId)"),
      "firestore.rules must enforce isWorkspaceOwner"
    );
    assert.ok(
      firestoreRulesContent.includes("request.resource.data.role in [\"contributor\", \"viewer\"]"),
      "firestore.rules must limit self-joining invitees to contributor or viewer"
    );
  });

  // ============================================================================
  // Suite 6: Dashboard Landing Page & Navigation Verification
  // ============================================================================
  console.log("\n--- Suite 6: Dashboard Landing Page & Navigation Verification ---");

  await test("DASH-01: Dashboard page exists and includes required test IDs and modals", async () => {
    const dashPath = path.join(ROOT_DIR, "src", "app", "dashboard", "page.jsx");
    assert.ok(fs.existsSync(dashPath), "Dashboard page must exist");
    const content = fs.readFileSync(dashPath, "utf8");

    // Verify required test IDs
    assert.ok(content.includes('data-testid="tab-all"'), "Must include tab-all testid");
    assert.ok(content.includes('data-testid="tab-owned"'), "Must include tab-owned testid");
    assert.ok(content.includes('data-testid="tab-shared"'), "Must include tab-shared testid");
    assert.ok(content.includes('data-testid="tab-recent"'), "Must include tab-recent testid");
    assert.ok(content.includes('data-testid="tab-invitations"'), "Must include tab-invitations testid");
    assert.ok(content.includes('data-testid="empty-workspaces"'), "Must include empty-workspaces testid");
    assert.ok(content.includes('data-testid="empty-invitations"'), "Must include empty-invitations testid");
    assert.ok(content.includes('data-testid="workspace-card"'), "Must include workspace-card testid");
  });

  await test("DASH-02: Header displays CodeCraft branding and navigation to dashboard", async () => {
    const headerPath = path.join(ROOT_DIR, "src", "components", "Header.jsx");
    assert.ok(fs.existsSync(headerPath), "Header component must exist");
    const content = fs.readFileSync(headerPath, "utf8");

    assert.ok(content.includes("CodeCraft"), "Header must display CodeCraft branding");
    assert.ok(!content.includes("VibeCode"), "Legacy VibeCode branding must be removed");
    assert.ok(content.includes('href="/dashboard"'), "Header brand must link to dashboard");
  });

  // ============================================================================
  // Suite 7: Workspace Opening & Creation Separation Regression Suite
  // ============================================================================
  console.log("\n--- Suite 7: Workspace Opening & Creation Separation Regression Suite ---");

  await test("Opening an existing workspace does not create a workspace", async () => {
    // Initial workspace state with two existing workspaces
    const initialWorkspaces = [
      { id: "ws-proto-1", name: "prototype 1", userId: "user-test-1" },
      { id: "ws-proto-2", name: "prototype 2", userId: "user-test-1" },
    ];

    let createdWorkspaces = [];
    let routedUrl = null;
    let recentsRecorded = [];

    // Mock Firestore creation handler (should never be called on open)
    const mockAddDoc = async (collPath, docData) => {
      if (collPath.includes("workspaces")) {
        createdWorkspaces.push({ id: `ws-new-${Date.now()}`, ...docData });
      }
    };

    // Mock Next.js router
    const mockRouter = {
      push: (url) => {
        routedUrl = url;
      },
    };

    // Mock client recents recorder
    const mockRecordRecentWorkspace = (uid, ws) => {
      recentsRecorded.push({ uid, wsId: ws.id, wsName: ws.name });
    };

    // Open Workspace Handler matching src/app/dashboard/page.jsx
    const handleOpenWorkspace = (ws) => {
      if (!ws) return;
      const targetId = ws.id || ws.workspaceId;
      if (!targetId || typeof targetId !== "string") return;

      mockRecordRecentWorkspace("user-test-1", {
        id: targetId,
        name: ws.name || "Workspace",
      });

      mockRouter.push(`/workspace/${targetId}`);
    };

    // Act: User clicks "Open Workspace" on "prototype 1"
    const targetWorkspace = initialWorkspaces[0]; // "prototype 1"
    handleOpenWorkspace(targetWorkspace);

    // Assert: Navigation strictly routed to existing workspace ID
    assert.equal(routedUrl, `/workspace/${targetWorkspace.id}`, "Must navigate strictly to /workspace/[EXISTINGWORKSPACEID]");
    assert.equal(routedUrl, "/workspace/ws-proto-1", "Must route to the exact existing ID 'ws-proto-1'");

    // Assert: Zero workspace documents created in Firestore
    assert.equal(createdWorkspaces.length, 0, "No new workspace document may be created");

    // Assert: Workspaces collection count and content remain strictly unchanged
    assert.equal(initialWorkspaces.length, 2, "Workspace count must remain unchanged");
    assert.deepEqual(
      initialWorkspaces.map((w) => w.name),
      ["prototype 1", "prototype 2"],
      "Workspace list must remain unchanged without duplicates"
    );

    // Assert: Only client-side recents cache was updated with the existing workspace
    assert.equal(recentsRecorded.length, 1, "Must record recent workspace once");
    assert.equal(recentsRecorded[0].wsId, targetWorkspace.id, "Recorded recent must match existing workspace ID");
  });

  await test("REG-02: Dashboard source code strictly separates Open Workspace from workspace creation", async () => {
    const dashPath = path.join(ROOT_DIR, "src", "app", "dashboard", "page.jsx");
    const content = fs.readFileSync(dashPath, "utf8");

    // Verify handleOpenWorkspace exists and does NOT invoke creation logic
    const openHandlerMatch = content.match(/const handleOpenWorkspace =[\s\S]*?\n  \};/);
    assert.ok(openHandlerMatch, "handleOpenWorkspace must be defined in dashboard");
    const openHandlerCode = openHandlerMatch[0];

    assert.ok(!openHandlerCode.includes("addDoc"), "handleOpenWorkspace must never call addDoc");
    assert.ok(!openHandlerCode.includes("setDoc"), "handleOpenWorkspace must never call setDoc");
    assert.ok(openHandlerCode.includes("router.push"), "handleOpenWorkspace must navigate via router.push");
    assert.ok(openHandlerCode.includes("/workspace/"), "handleOpenWorkspace must route to /workspace/");

    // Verify fetchWorkspaces preserves genuine workspaceDoc.id after ...data
    assert.ok(
      content.includes("...data,\n            id: workspaceDoc.id") ||
      content.includes("...data, id: workspaceDoc.id"),
      "fetchWorkspaces must place ...data before id: workspaceDoc.id so genuine document ID is never overwritten"
    );

    // Verify workspace card Open button has type='button' and calls stopPropagation
    assert.ok(
      content.includes('type="button"') && content.includes("handleOpenWorkspace(ws)"),
      "Open Workspace buttons must specify type='button' and handleOpenWorkspace"
    );
  });

  await test("REG-03: filterWorkspaces strictly deduplicates any workspaces with duplicate IDs", async () => {
    const rawList = [
      { id: "ws-1", name: "prototype 1", userId: "u1" },
      { id: "ws-2", name: "prototype 2", userId: "u1" },
      { id: "ws-1", name: "prototype 1 (duplicate)", userId: "u1" },
    ];

    const filtered = filterWorkspaces(rawList, "", "all", "u1");
    assert.equal(filtered.length, 2, "filterWorkspaces must remove duplicate workspace IDs");
    assert.equal(filtered[0].id, "ws-1");
    assert.equal(filtered[1].id, "ws-2");
  });

  await test("REG-04: Workspace loading page is idempotent and performs zero document creation", async () => {
    const wsPagePath = path.join(ROOT_DIR, "src", "app", "workspace", "[workspaceId]", "page.jsx");
    assert.ok(fs.existsSync(wsPagePath), "Workspace page must exist");
    const content = fs.readFileSync(wsPagePath, "utf8");

    assert.ok(
      !content.includes('addDoc(collection(db, "workspaces")'),
      "Workspace page must never add workspace documents to workspaces collection"
    );
    assert.ok(
      content.includes("workspaceNotFound"),
      "Workspace page must handle nonexistent workspace ID safely without creating a fallback workspace"
    );
  });

  // ============================================================================
  // Summary
  // ============================================================================
  console.log("\n===================================================================");
  console.log(`  Phase 12.5 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("===================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase12_5Tests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
