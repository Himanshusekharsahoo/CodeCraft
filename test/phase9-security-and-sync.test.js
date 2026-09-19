process.env.NODE_ENV = process.env.NODE_ENV || "test";
if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "codecraft-test";
}

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { isExplicitTestEnvironment, isValidDeterministicTestToken, parseTestTokenClaims } from "../src/lib/authEnv.js";
import { authenticateAndAuthorize } from "../src/lib/git/gitAuth.js";
import { authenticateAndAuthorizeExecution } from "../src/lib/execution/executionAuth.js";
import { GitError, GitErrorCodes } from "../src/lib/git/errors.js";
import { ExecutionError, ExecutionErrorCodes } from "../src/lib/execution/errors.js";
import { ToolExecutor } from "../src/lib/ai/tools/registry.js";
import { AgentError, AgentErrorCodes } from "../src/lib/ai/agentErrors.js";
import { SafeRollbackService } from "../src/lib/ai/safeRollback.js";
import { ExecutionService } from "../src/lib/execution/executionService.js";
import { getWorkspaceRepoDir } from "../src/lib/git/security.js";
import { isBinaryOrOversizedFile } from "../src/lib/editorSafety.js";
import { requestCollabFlush, notifyCollabMutation } from "../src/lib/git/firestoreSync.js";
import { Room, notifyExternalMutation, rooms } from "../collaborationserver/src/rooms.js";
import { setMockDockerAvailability } from "../src/lib/execution/dockerDetector.js";

const TEST_WS = "test_p9_ws_" + Date.now();
const testRepoDir = getWorkspaceRepoDir(TEST_WS);

function cleanWorkspace() {
  if (fs.existsSync(testRepoDir)) {
    try {
      fs.rmSync(testRepoDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup locks on windows
    }
  }
}

async function runTests() {
  console.log("==================================================");
  console.log("  CodeCraft Phase 9 — Production Security & Sync Test Suite");
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
  // Suite 1: Authentication Boundary & Production Hardening (AUTH01 & AUTH02)
  // ==========================================
  console.log("--- Suite 1: Centralized Auth Boundary & Production Hardening ---");

  await test("isExplicitTestEnvironment() returns false unconditionally when NODE_ENV === 'production'", () => {
    const origNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      assert.equal(isExplicitTestEnvironment(), false);
    } finally {
      process.env.NODE_ENV = origNodeEnv;
    }
  });

  await test("GitAuth strictly rejects test-token-* when NODE_ENV === 'production'", async () => {
    const origNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const fakeReq = {
        headers: new Headers({ authorization: "Bearer test-token-owner:attacker" }),
        url: "http://localhost:3000/api/workspace/test-ws/git/commit",
      };

      await assert.rejects(
        async () => {
          await authenticateAndAuthorize(fakeReq, "test-ws", "MUTATE");
        },
        (err) => err instanceof GitError && err.statusCode === 401
      );
    } finally {
      process.env.NODE_ENV = origNodeEnv;
    }
  });

  await test("ExecutionAuth strictly rejects unsigned mock JWTs (header.*) when NODE_ENV === 'production'", async () => {
    const origNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const spoofedPayload = Buffer.from(JSON.stringify({ user_id: "attacker", role: "owner" })).toString("base64");
      const fakeToken = `header.${spoofedPayload}.fakesig`;
      const fakeReq = {
        headers: { get: (k) => (k.toLowerCase() === "authorization" ? `Bearer ${fakeToken}` : null) },
        url: "http://localhost:3000/api/workspace/test-ws/execute",
      };

      await assert.rejects(
        async () => {
          await authenticateAndAuthorizeExecution(fakeReq, "test-ws", "EXECUTE");
        },
        (err) => err instanceof ExecutionError && (err.status === 401 || err.status === 500)
      );
    } finally {
      process.env.NODE_ENV = origNodeEnv;
    }
  });

  await test("Deterministic test tokens strictly validate format and parse claims in test mode", () => {
    assert.equal(isValidDeterministicTestToken("test-token-contributor:alice"), true);
    assert.equal(isValidDeterministicTestToken("test-token-owner:bob"), true);
    assert.equal(isValidDeterministicTestToken("test-token-viewer:charlie"), true);
    assert.equal(isValidDeterministicTestToken("not-a-test-token"), false);
    assert.equal(isValidDeterministicTestToken("test-token-spaces are invalid"), false);

    const parsed = parseTestTokenClaims("test-token-viewer:charlie");
    assert.equal(parsed.uid, "charlie");
    assert.equal(parsed.role, "viewer");
  });

  // ==========================================
  // Suite 2: Firestore Authorization Rules Hardening (FIRESTORE01)
  // ==========================================
  console.log("\n--- Suite 2: Firestore Rules Membership & Escalation Hardening ---");

  await test("firestore.rules enforces that member records can ONLY be created or updated by workspace owners", () => {
    const rulesPath = path.resolve(process.cwd(), "firestore.rules");
    assert.ok(fs.existsSync(rulesPath), "firestore.rules must exist");
    const rulesContent = fs.readFileSync(rulesPath, "utf8");

    // Member create/update MUST be guarded by isWorkspaceOwner
    assert.ok(
      rulesContent.includes("isWorkspaceOwner(workspaceId)"),
      "Member management must require isWorkspaceOwner(workspaceId)"
    );

    // Member create/update MUST validate allowed roles
    assert.ok(
      rulesContent.includes('request.resource.data.role in ["owner", "contributor", "viewer"]'),
      "Member roles must be strictly validated against whitelist ['owner', 'contributor', 'viewer']"
    );

    // Outsiders must not be allowed to self-create member records as owner
    assert.ok(
      !rulesContent.includes("allow create, update: if isSignedIn() && memberId == request.auth.uid;"),
      "Self-promotion rule (memberId == request.auth.uid without owner check) must be completely removed"
    );
  });

  // ==========================================
  // Suite 3: Sandboxed Workspace Test Runner & Zero Host Exec (EXEC01)
  // ==========================================
  console.log("\n--- Suite 3: Sandboxed Workspace Test Runner & Zero Host Exec ---");

  await test("src/lib/ai/tools/registry.js contains ZERO imports of child_process or exec", () => {
    const registryPath = path.resolve(process.cwd(), "src/lib/ai/tools/registry.js");
    const content = fs.readFileSync(registryPath, "utf8");

    assert.ok(!content.includes('from "node:child_process"'), "registry.js must not import node:child_process");
    assert.ok(!content.includes("from 'node:child_process'"), "registry.js must not import node:child_process");
    assert.ok(!content.includes('require("child_process")'), "registry.js must not require child_process");
    assert.ok(!content.includes('require("node:child_process")'), "registry.js must not require node:child_process");
    assert.ok(!content.includes("execAsync"), "registry.js must not call execAsync");
  });

  await test("handleRunTests fails closed with HTTP 503 when Docker sandbox is offline (No Host Fallback)", async () => {
    // Ensure mock runner is cleared so real sandbox path is exercised
    ToolExecutor.setMockTestRunner(null);
    setMockDockerAvailability({ available: false, reason: "Docker daemon connection refused" });

    try {
      // Docker is offline on this host: run_tests MUST fail closed with HTTP 503
      await assert.rejects(
        async () => {
          await ToolExecutor.executeTool({
            name: "run_tests",
            args: { testName: "test:execution" },
            workspaceId: TEST_WS,
            userId: "alice",
            userRole: "contributor",
          });
        },
        (err) => {
          assert.ok(err instanceof AgentError);
          assert.equal(err.status, 503);
          assert.match(err.message, /sandbox offline|Host execution/i);
          return true;
        }
      );
    } finally {
      setMockDockerAvailability(null);
    }
  });

  await test("handleRunTests rejects unallowlisted test targets", async () => {
    await assert.rejects(
      async () => {
        await ToolExecutor.executeTool({
          name: "run_tests",
          args: { testName: "malicious_script.sh" },
          workspaceId: TEST_WS,
          userId: "alice",
          userRole: "contributor",
        });
      },
      (err) => err instanceof AgentError && err.code === AgentErrorCodes.TOOL_VALIDATION_ERROR
    );
  });

  // ==========================================
  // Suite 4: apply_patch Collision & Stale Overwrite Defense (PATCH01)
  // ==========================================
  console.log("\n--- Suite 4: apply_patch Hardening (Collision & Blind Overwrite Defense) ---");

  await test("apply_patch REJECTS modifying existing file without expectedOldContent (Blind Overwrite Defense)", async () => {
    cleanWorkspace();
    fs.mkdirSync(testRepoDir, { recursive: true });
    fs.writeFileSync(path.join(testRepoDir, "app.js"), "const x = 10;\n", "utf8");

    await assert.rejects(
      async () => {
        await ToolExecutor.executeTool({
          name: "apply_patch",
          args: {
            file: "app.js",
            patch: "const x = 20;\n",
            // expectedOldContent omitted intentionally!
          },
          workspaceId: TEST_WS,
          userId: "alice",
          userRole: "contributor",
        });
      },
      (err) => {
        assert.ok(err instanceof AgentError);
        assert.equal(err.code, AgentErrorCodes.PATCH_CONFLICT);
        assert.equal(err.status, 409);
        assert.match(err.message, /Missing 'expectedOldContent' parameter for existing file/);
        return true;
      }
    );
  });

  await test("apply_patch REJECTS ambiguous replacement when expectedOldContent matches multiple times", async () => {
    cleanWorkspace();
    fs.mkdirSync(testRepoDir, { recursive: true });
    fs.writeFileSync(path.join(testRepoDir, "duplicate.js"), "foo();\nbar();\nfoo();\n", "utf8");

    await assert.rejects(
      async () => {
        await ToolExecutor.executeTool({
          name: "apply_patch",
          args: {
            file: "duplicate.js",
            expectedOldContent: "foo();",
            patch: "fooPatched();",
          },
          workspaceId: TEST_WS,
          userId: "alice",
          userRole: "contributor",
        });
      },
      (err) => {
        assert.ok(err instanceof AgentError);
        assert.equal(err.code, AgentErrorCodes.PATCH_CONFLICT);
        assert.equal(err.status, 409);
        assert.match(err.message, /Multiple occurrences \(2\) of expectedOldContent found/);
        return true;
      }
    );
  });

  await test("apply_patch succeeds when expectedOldContent matches uniquely and records agentPatchedContent", async () => {
    cleanWorkspace();
    fs.mkdirSync(testRepoDir, { recursive: true });
    fs.writeFileSync(path.join(testRepoDir, "unique.js"), "function hello() { return 'world'; }\n", "utf8");

    const runRecord = {
      filesModified: [],
      filesCreated: [],
      preRunSnapshots: new Map(),
    };

    const res = await ToolExecutor.executeTool({
      name: "apply_patch",
      args: {
        file: "unique.js",
        expectedOldContent: "return 'world';",
        patch: "return 'codecraft';",
      },
      workspaceId: TEST_WS,
      userId: "alice",
      userRole: "contributor",
      runRecord,
    });

    assert.equal(res.status, "applied");
    assert.ok(runRecord.agentPatchedContent instanceof Map);
    assert.ok(runRecord.agentPatchedContent.has("unique.js"));
    const contentOnDisk = fs.readFileSync(path.join(testRepoDir, "unique.js"), "utf8");
    assert.ok(contentOnDisk.includes("return 'codecraft';"));
  });

  // ==========================================
  // Suite 5: safeRollback.js Collaborator Concurrency Protection (ROLLBACK01)
  // ==========================================
  console.log("\n--- Suite 5: Safe Rollback Collaborator Concurrency Protection ---");

  await test("SafeRollback ABORTS with ROLLBACK_CONFLICT (409) if a collaborator modified the file post-run", async () => {
    cleanWorkspace();
    fs.mkdirSync(testRepoDir, { recursive: true });
    const original = "initial content\n";
    const agentPatched = "initial content\nagent was here\n";
    const collaboratorEdited = "initial content\nagent was here\nhuman collaborator edit!\n";

    fs.writeFileSync(path.join(testRepoDir, "collab.js"), collaboratorEdited, "utf8");

    const runRecord = {
      preRunSnapshots: new Map([["collab.js", original]]),
      agentPatchedContent: new Map([["collab.js", agentPatched]]),
    };

    await assert.rejects(
      async () => {
        await SafeRollbackService.rollbackRun(TEST_WS, runRecord);
      },
      (err) => {
        assert.ok(err instanceof AgentError);
        assert.equal(err.code, AgentErrorCodes.PATCH_CONFLICT);
        assert.equal(err.status, 409);
        assert.match(err.message, /ROLLBACK_CONFLICT/);
        return true;
      }
    );

    // Verify human collaborator edit was NOT destroyed
    const currentOnDisk = fs.readFileSync(path.join(testRepoDir, "collab.js"), "utf8");
    assert.equal(currentOnDisk, collaboratorEdited);
  });

  await test("SafeRollback reverts cleanly when no concurrent collaborator conflict exists", async () => {
    cleanWorkspace();
    fs.mkdirSync(testRepoDir, { recursive: true });
    const original = "initial clean content\n";
    const agentPatched = "agent patched content\n";

    fs.writeFileSync(path.join(testRepoDir, "clean.js"), agentPatched, "utf8");

    const runRecord = {
      preRunSnapshots: new Map([["clean.js", original]]),
      agentPatchedContent: new Map([["clean.js", agentPatched]]),
    };

    const res = await SafeRollbackService.rollbackRun(TEST_WS, runRecord);
    assert.equal(res.rolledBack, true);
    assert.ok(res.restoredFiles.includes("clean.js"));

    const currentOnDisk = fs.readFileSync(path.join(testRepoDir, "clean.js"), "utf8");
    assert.equal(currentOnDisk, original);
  });

  // ==========================================
  // Suite 6: Cross-Layer Synchronization Bridge (SYNC01)
  // ==========================================
  console.log("\n--- Suite 6: Cross-Layer Synchronization Bridge ---");

  await test("Room.prototype.applyExternalMutation updates in-memory text with external-mutation origin", () => {
    const roomName = `workspace:test-sync-ws:file:test-sync-file`;
    const room = new Room(roomName, "test-sync-ws", "test-sync-file");
    rooms.set(roomName, room);

    try {
      const updated = room.applyExternalMutation("const updated = true;");
      assert.equal(updated, true);
      assert.equal(room.doc.getText("monaco").toString(), "const updated = true;");

      // Calling notifyExternalMutation finds room and applies update
      const updated2 = notifyExternalMutation("test-sync-ws", "test-sync-file", "const updated2 = true;");
      assert.equal(updated2, true);
      assert.equal(room.doc.getText("monaco").toString(), "const updated2 = true;");

      // Idempotent: identical content returns false (no unnecessary transaction)
      const identical = notifyExternalMutation("test-sync-ws", "test-sync-file", "const updated2 = true;");
      assert.equal(identical, false);
    } finally {
      room.destroy();
      rooms.delete(roomName);
    }
  });

  await test("requestCollabFlush and notifyCollabMutation handle offline collaboration server gracefully", async () => {
    // When collaboration server is not running on custom port, helper returns false without throwing
    const flushRes = await requestCollabFlush("nonexistent-ws");
    assert.equal(typeof flushRes, "boolean");

    const notifyRes = await notifyCollabMutation("nonexistent-ws", "file1", "code");
    assert.equal(typeof notifyRes, "boolean");
  });

  // ==========================================
  // Suite 7: Monaco Editor Safety & Lifecycle (EDITOR01 & EDITOR02)
  // ==========================================
  console.log("\n--- Suite 7: Monaco Safety & Lifecycle ---");

  await test("isBinaryOrOversizedFile detects binary extensions (.png, .pdf, .wasm, .zip, .exe)", () => {
    assert.equal(isBinaryOrOversizedFile({ name: "logo.png" }).isUnsupported, true);
    assert.equal(isBinaryOrOversizedFile({ name: "document.pdf" }).isUnsupported, true);
    assert.equal(isBinaryOrOversizedFile({ name: "binary.wasm" }).isUnsupported, true);
    assert.equal(isBinaryOrOversizedFile({ name: "archive.zip" }).isUnsupported, true);
    assert.equal(isBinaryOrOversizedFile({ name: "app.exe" }).isUnsupported, true);
  });

  await test("isBinaryOrOversizedFile flags files exceeding 512 KB size limit", () => {
    assert.equal(isBinaryOrOversizedFile({ name: "huge.js", size: 600 * 1024 }).isUnsupported, true);
    assert.equal(isBinaryOrOversizedFile({ name: "normal.js", size: 10 * 1024 }).isUnsupported, false);
  });

  await test("isBinaryOrOversizedFile flags files containing null bytes (binary content)", () => {
    assert.equal(isBinaryOrOversizedFile({ name: "test.dat", content: "hello\0world" }).isUnsupported, true);
    assert.equal(isBinaryOrOversizedFile({ name: "test.js", content: "console.log('clean');" }).isUnsupported, false);
  });

  // Cleanup
  cleanWorkspace();

  console.log("\n==================================================");
  console.log(`  Phase 9 Tests Finished: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests();
