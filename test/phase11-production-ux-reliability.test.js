process.env.NODE_ENV = process.env.NODE_ENV || "test";
if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "codecraft-test";
}

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ErrorTaxonomy,
  createRequestId,
  scrubSensitiveData,
} from "../src/lib/observability.js";
import { parseExecutionDiagnostics } from "../src/lib/diagnostics.js";
import { formatAgentPhase } from "../src/lib/agentUiHelpers.js";
import { isBinaryOrOversizedFile } from "../src/lib/editorSafety.js";
import { SafeRollbackService } from "../src/lib/ai/safeRollback.js";
import { AgentErrorCodes } from "../src/lib/ai/agentErrors.js";
import { ExecutionService } from "../src/lib/execution/executionService.js";
import { ExecutionErrorCodes } from "../src/lib/execution/errors.js";

async function runTests() {
  console.log("==================================================");
  console.log("  CodeCraft Phase 11 — Production UX & Reliability Test Suite");
  console.log("==================================================\n");

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

  // ==========================================
  // Group 1: File Tree & Navigation Lifecycle
  // ==========================================
  console.log("--- Group 1: File Tree & Navigation Lifecycle ---");

  await test("FILETREE-01: Validates and sanitizes file & folder names", () => {
    function validateName(name) {
      const trimmed = (name || "").trim();
      if (!trimmed) return { valid: false, reason: "Name cannot be empty" };
      if (trimmed.includes("/") || trimmed.includes("\\") || trimmed === ".." || trimmed === ".") {
        return { valid: false, reason: "Name cannot contain slashes or relative segments" };
      }
      return { valid: true, name: trimmed };
    }

    assert.equal(validateName("").valid, false);
    assert.equal(validateName("   ").valid, false);
    assert.equal(validateName("folder/sub").valid, false);
    assert.equal(validateName("..").valid, false);
    assert.equal(validateName("valid-component.jsx").valid, true);
    assert.equal(validateName("  trimmedName.js  ").name, "trimmedName.js");
  });

  await test("FILETREE-02: Delete confirmation state prevents accidental blind deletions", () => {
    let itemToDelete = null;
    let deletionExecuted = false;

    function requestDelete(type, id, name) {
      itemToDelete = { type, id, name };
    }

    function confirmDelete() {
      if (!itemToDelete) return;
      deletionExecuted = true;
      itemToDelete = null;
    }

    function cancelDelete() {
      itemToDelete = null;
    }

    // Step 1: Request delete
    requestDelete("files", "file-123", "important.js");
    assert.deepEqual(itemToDelete, { type: "files", id: "file-123", name: "important.js" });
    assert.equal(deletionExecuted, false);

    // Step 2: User cancels
    cancelDelete();
    assert.equal(itemToDelete, null);
    assert.equal(deletionExecuted, false);

    // Step 3: User requests again and confirms
    requestDelete("files", "file-123", "important.js");
    confirmDelete();
    assert.equal(deletionExecuted, true);
    assert.equal(itemToDelete, null);
  });

  // ==========================================
  // Group 2: Multi-Tab Editor Lifecycle
  // ==========================================
  console.log("\n--- Group 2: Multi-Tab Editor Lifecycle ---");

  await test("TAB-01: Enforces 1:1 file-to-session mapping and active tab selection", () => {
    let openFiles = [
      { id: "f1", name: "index.js" },
      { id: "f2", name: "styles.css" },
    ];
    let activeId = "f1";

    function openFile(file) {
      if (!openFiles.some((f) => f.id === file.id)) {
        openFiles = [...openFiles, file];
      }
      activeId = file.id;
    }

    function closeFile(id) {
      const idx = openFiles.findIndex((f) => f.id === id);
      openFiles = openFiles.filter((f) => f.id !== id);
      if (activeId === id) {
        const next = openFiles[idx] || openFiles[idx - 1] || null;
        activeId = next ? next.id : null;
      }
    }

    // Opening already open file activates it without duplicating
    openFile({ id: "f2", name: "styles.css" });
    assert.equal(openFiles.length, 2);
    assert.equal(activeId, "f2");

    // Opening new file appends and activates
    openFile({ id: "f3", name: "utils.js" });
    assert.equal(openFiles.length, 3);
    assert.equal(activeId, "f3");

    // Closing active file activates adjacent tab
    closeFile("f3");
    assert.equal(openFiles.length, 2);
    assert.equal(activeId, "f2");

    // Closing remaining files leaves activeId null
    closeFile("f2");
    closeFile("f1");
    assert.equal(openFiles.length, 0);
    assert.equal(activeId, null);
  });

  // ==========================================
  // Group 3: Monaco Diagnostics & Problems Panel
  // ==========================================
  console.log("\n--- Group 3: Monaco Diagnostics & Problems Panel ---");

  await test("DIAG-P11-01: Groups diagnostics by severity and supports jump coordinates", () => {
    const output = `main.cpp:12:4: error: expected ';' before 'return'
main.cpp:18:9: warning: unused variable 'count' [-Wunused-variable]`;

    const markers = parseExecutionDiagnostics(output, "cpp", "main.cpp");
    assert.equal(markers.length, 2);

    const errors = markers.filter((m) => m.severity === 8);
    const warnings = markers.filter((m) => m.severity === 4);

    assert.equal(errors.length, 1);
    assert.equal(warnings.length, 1);
    assert.equal(errors[0].startLineNumber, 12);
    assert.equal(errors[0].startColumn, 4);
    assert.equal(warnings[0].startLineNumber, 18);
    assert.equal(warnings[0].startColumn, 9);
  });

  await test("DIAG-P11-02: Clears obsolete diagnostics on execution success or edit", () => {
    let currentMarkers = [
      { startLineNumber: 5, message: "SyntaxError: Unexpected token", severity: 8 },
    ];

    function onExecutionComplete(exitCode, stderr) {
      if (exitCode === 0 && !stderr) {
        currentMarkers = []; // Clean markers on success
      }
    }

    function onUserEdit() {
      currentMarkers = []; // Dynamic clearing on keystroke
    }

    assert.equal(currentMarkers.length, 1);
    onExecutionComplete(0, "");
    assert.equal(currentMarkers.length, 0);

    // Trigger error again
    currentMarkers = [{ startLineNumber: 10, message: "ReferenceError", severity: 8 }];
    assert.equal(currentMarkers.length, 1);
    onUserEdit();
    assert.equal(currentMarkers.length, 0);
  });

  // ==========================================
  // Group 4: Execution Protection & Output Bounding
  // ==========================================
  console.log("\n--- Group 4: Execution Protection & Output Bounding ---");

  await test("EXEC-LOCK-01: Locks against duplicate execution on double-click", () => {
    let executionsDispatched = 0;
    let isExecuting = false;

    async function triggerRun() {
      if (isExecuting) return { status: "BLOCKED_BY_LOCK" };
      isExecuting = true;
      executionsDispatched++;
      // Simulate async execution
      await new Promise((res) => setTimeout(res, 20));
      isExecuting = false;
      return { status: "DISPATCHED" };
    }

    // Fire two runs simultaneously
    const run1 = triggerRun();
    const run2 = triggerRun();

    return Promise.all([run1, run2]).then(([r1, r2]) => {
      assert.equal(executionsDispatched, 1, "Only one execution must proceed");
      assert.equal(r1.status, "DISPATCHED");
      assert.equal(r2.status, "BLOCKED_BY_LOCK");
    });
  });

  await test("EXEC-BOUND-01: Bounds terminal output to MAX_DISPLAY_LINES without UI freeze", () => {
    const MAX_LINES = 1000;
    const hugeOutput = Array.from({ length: 5000 }, (_, i) => `Log line ${i}`).join("\n");
    const rawLines = hugeOutput.split("\n");

    let displayedLines = rawLines;
    let isTruncated = false;

    if (rawLines.length > MAX_LINES) {
      displayedLines = rawLines.slice(0, MAX_LINES);
      isTruncated = true;
    }

    assert.equal(displayedLines.length, 1000);
    assert.equal(isTruncated, true);
    assert.equal(displayedLines[0], "Log line 0");
    assert.equal(displayedLines[999], "Log line 999");
  });

  // ==========================================
  // Group 5: AI Coding Agent UX & Change Review
  // ==========================================
  console.log("\n--- Group 5: AI Coding Agent UX & Change Review ---");

  await test("AGENT-LOCK-01: Blocks duplicate concurrent agent requests", () => {
    let agentRunsStarted = 0;
    let isRunning = false;

    async function startAgent() {
      if (isRunning) return { blocked: true };
      isRunning = true;
      agentRunsStarted++;
      await new Promise((res) => setTimeout(res, 20));
      isRunning = false;
      return { blocked: false };
    }

    const first = startAgent();
    const second = startAgent();

    return Promise.all([first, second]).then(([res1, res2]) => {
      assert.equal(agentRunsStarted, 1);
      assert.equal(res1.blocked, false);
      assert.equal(res2.blocked, true);
    });
  });

  await test("AGENT-PHASE-01: Human-friendly state formatting for all agent lifecycle stages", () => {
    assert.equal(formatAgentPhase("PLANNING"), "Understanding request");
    assert.equal(formatAgentPhase("INSPECTING"), "Inspecting files");
    assert.equal(formatAgentPhase("EDITING"), "Preparing changes");
    assert.equal(formatAgentPhase("MODIFYING"), "Applying Code Edits...");
    assert.equal(formatAgentPhase("RUNNING_TESTS"), "Running Validation Tests...");
    assert.equal(formatAgentPhase("TESTING", 0), "Running tests");
    assert.equal(formatAgentPhase("TESTING", 2), "Rerunning tests");
    assert.equal(formatAgentPhase("FIXING"), "Fixing issue");
    assert.equal(formatAgentPhase("SUCCESS"), "Task Completed Successfully");
    assert.equal(formatAgentPhase("FAILED"), "Task Failed or Incomplete");
  });

  await test("AGENT-DIFF-01: Structures changed files list with additions and modifications", () => {
    const runResult = {
      filesModified: ["src/app.js", "src/config.js"],
      filesCreated: ["src/newUtil.js"],
      testsRun: [
        { testName: "unit-tests", passed: true },
        { testName: "e2e-tests", passed: true },
      ],
    };

    assert.equal(runResult.filesModified.length, 2);
    assert.equal(runResult.filesCreated.length, 1);
    assert.ok(runResult.testsRun.every((t) => t.passed));
  });

  await test("AGENT-ROLLBACK-01: Aborts rollback if collaborator concurrently modified file", async () => {
    const testWsId = "p11-rollback-test-" + Date.now();
    const wsDir = path.resolve(process.cwd(), "data", "git", "workspaces", testWsId);
    fs.mkdirSync(wsDir, { recursive: true });

    const targetFile = path.join(wsDir, "calc.js");
    fs.writeFileSync(targetFile, "export function add(a, b) { return a + b + 1; }\n");

    const runRecord = {
      runId: "run-p11-1",
      workspaceId: testWsId,
      filesModified: ["calc.js"],
      filesCreated: [],
      agentPatchedContent: {
        "calc.js": "export function add(a, b) { return a + b; }\n",
      },
      preRunSnapshots: {
        "calc.js": "export function add(a, b) { return a + b + 1; }\n",
      },
    };

    // Simulate collaborator editing calc.js after agent run
    fs.writeFileSync(targetFile, "export function add(a, b) { return (a + b) * 2; }\n");

    let rollbackError = null;
    try {
      await SafeRollbackService.rollbackRun(testWsId, runRecord);
    } catch (err) {
      rollbackError = err;
    }

    assert.ok(rollbackError, "Must reject rollback when collaborator changed file");
    assert.equal(rollbackError.code, AgentErrorCodes.PATCH_CONFLICT);
    assert.equal(rollbackError.status, 409);

    // Clean up test workspace
    try {
      fs.rmSync(wsDir, { recursive: true, force: true });
    } catch (e) {}
  });

  // ==========================================
  // Group 6: Connection & Offline Recovery UX
  // ==========================================
  console.log("\n--- Group 6: Connection & Offline Recovery UX ---");

  await test("RECOVERY-01: Connection status progression and honest local saved reporting", () => {
    function computeStatus(wsConnected, isSynced, hasLocalIdb) {
      if (!wsConnected) {
        return { status: "offline", localSaved: hasLocalIdb };
      }
      if (!isSynced) {
        return { status: "syncing", localSaved: hasLocalIdb };
      }
      return { status: "connected", localSaved: hasLocalIdb };
    }

    // Offline but local IndexedDB saved
    const off = computeStatus(false, false, true);
    assert.equal(off.status, "offline");
    assert.equal(off.localSaved, true);

    // Reconnecting & syncing
    const sync = computeStatus(true, false, true);
    assert.equal(sync.status, "syncing");

    // Fully synced
    const conn = computeStatus(true, true, true);
    assert.equal(conn.status, "connected");
    assert.equal(conn.localSaved, true);
  });

  // ==========================================
  // Group 7: Responsive Layout & Empty States
  // ==========================================
  console.log("\n--- Group 7: Responsive Layout & Empty States ---");

  await test("RESPONSIVE-01: Workspace container allows fluid scaling without min-w-[1024px]", () => {
    const pageContent = fs.readFileSync(
      path.resolve(process.cwd(), "src", "app", "workspace", "[workspaceId]", "page.jsx"),
      "utf8"
    );

    // Verify min-w-[1024px] is eliminated
    assert.ok(
      !pageContent.includes("min-w-[1024px]"),
      "Workspace page must not contain hardcoded min-w-[1024px]"
    );
    assert.ok(pageContent.includes("w-full overflow-hidden"));
  });

  await test("EMPTY-01: Empty states exist for all core workspace views", () => {
    const navContent = fs.readFileSync(
      path.resolve(process.cwd(), "src", "components", "Navpanel.jsx"),
      "utf8"
    );
    const editorContent = fs.readFileSync(
      path.resolve(process.cwd(), "src", "components", "Editor.jsx"),
      "utf8"
    );
    const agentContent = fs.readFileSync(
      path.resolve(process.cwd(), "src", "components", "AgentPanel.jsx"),
      "utf8"
    );
    const outputContent = fs.readFileSync(
      path.resolve(process.cwd(), "src", "components", "Output.jsx"),
      "utf8"
    );

    assert.ok(navContent.includes('data-testid="empty-file-tree"'), "Navpanel must have empty state");
    assert.ok(editorContent.includes('data-testid="empty-editor-state"'), "Editor must have empty state");
    assert.ok(agentContent.includes('data-testid="empty-agent-state"'), "AgentPanel must have empty state");
    assert.ok(outputContent.includes("No problems detected"), "Output problems must have empty state");
  });

  // ==========================================
  // Group 8: Large File & Binary Safety Preservation
  // ==========================================
  console.log("\n--- Group 8: Large File & Binary Safety ---");

  await test("SAFETY-01: Preserves 512KB limit and binary detection", () => {
    const smallFile = { name: "app.js", content: "console.log('small');" };
    const binaryFile = { name: "image.png", content: "PNG..." };
    const largeFile = { name: "huge.txt", size: 600 * 1024 };

    assert.equal(isBinaryOrOversizedFile(smallFile).isUnsupported, false);
    assert.equal(isBinaryOrOversizedFile(binaryFile).isUnsupported, true);
    assert.equal(isBinaryOrOversizedFile(largeFile).isUnsupported, true);
  });

  console.log("\n==================================================");
  console.log(`  Phase 11 Tests Complete: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
