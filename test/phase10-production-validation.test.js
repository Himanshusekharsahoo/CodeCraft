process.env.NODE_ENV = process.env.NODE_ENV || "test";
if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "codecraft-test";
}

import assert from "node:assert/strict";
import {
  ErrorTaxonomy,
  createRequestId,
  scrubSensitiveData,
  logAgentEvent,
  logExecutionEvent,
} from "../src/lib/observability.js";
import { parseExecutionDiagnostics } from "../src/lib/diagnostics.js";
import { ExecutionService } from "../src/lib/execution/executionService.js";
import { ExecutionErrorCodes } from "../src/lib/execution/errors.js";
import { GeminiProvider } from "../src/lib/ai/geminiProvider.js";
import { AgentErrorCodes } from "../src/lib/ai/agentErrors.js";
import { formatAgentPhase } from "../src/lib/agentUiHelpers.js";
import { setMockDockerAvailability } from "../src/lib/execution/dockerDetector.js";

async function runTests() {
  console.log("==================================================");
  console.log("  CodeCraft Phase 10 — Production Validation Test Suite");
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
  // Suite 1: Centralized Observability & Diagnostics Taxonomy
  // ==========================================
  console.log("--- Suite 1: Centralized Observability & Diagnostics Taxonomy ---");

  await test("TAXONOMY-01: ErrorTaxonomy contains all 16 standardized codes", () => {
    const requiredCodes = [
      "AUTH_ERROR",
      "FORBIDDEN",
      "VALIDATION_ERROR",
      "AI_PROVIDER_NOT_CONFIGURED",
      "AI_PROVIDER_TIMEOUT",
      "AI_RATE_LIMITED",
      "MODEL_ERROR",
      "INVALID_TOOL_CALL",
      "PATCH_CONFLICT",
      "ROLLBACK_CONFLICT",
      "EXECUTION_TIMEOUT",
      "EXECUTION_FAILED",
      "SANDBOX_UNAVAILABLE",
      "TEST_FAILED",
      "SYNC_CONFLICT",
      "INTERNAL_ERROR",
    ];

    for (const code of requiredCodes) {
      assert.equal(ErrorTaxonomy[code], code, `Missing taxonomy code: ${code}`);
    }
  });

  await test("REQID-01: createRequestId generates unique IDs with designated prefix", () => {
    const id1 = createRequestId("agent");
    const id2 = createRequestId("exec");
    assert.ok(id1.startsWith("agent_"));
    assert.ok(id2.startsWith("exec_"));
    assert.notEqual(id1, id2);
  });

  await test("SCRUB-01: scrubSensitiveData redacts Bearer tokens, passwords, and API keys in strings", () => {
    const sensitiveStr = "Authorization: Bearer mySecretToken123 with api_key=AIzaSySecretKey and password: secretPassWord1";
    const scrubbed = scrubSensitiveData(sensitiveStr);
    assert.ok(!scrubbed.includes("mySecretToken123"), "Bearer token must be redacted");
    assert.ok(!scrubbed.includes("AIzaSySecretKey"), "API key must be redacted");
    assert.ok(!scrubbed.includes("secretPassWord1"), "Password must be redacted");
    assert.ok(scrubbed.includes("[REDACTED]"));
  });

  await test("SCRUB-02: scrubSensitiveData deeply redacts objects and nested arrays", () => {
    const payload = {
      user: { name: "Alice", apiKey: "secret_live_key_999" },
      headers: { authorization: "Bearer xyz", contentType: "application/json" },
      itemsList: [{ token: "tok123" }, { normal: "clean" }],
    };

    const scrubbed = scrubSensitiveData(payload);
    assert.equal(scrubbed.user.apiKey, "[REDACTED]");
    assert.equal(scrubbed.headers.authorization, "[REDACTED]");
    assert.equal(scrubbed.headers.contentType, "application/json");
    assert.equal(scrubbed.itemsList[0].token, "[REDACTED]");
    assert.equal(scrubbed.itemsList[1].normal, "clean");
  });

  await test("LOG-01: logAgentEvent emits structured safe event without crashing", () => {
    const result = logAgentEvent({
      event: "AGENT_RUN_COMPLETED",
      workspaceId: "ws-100",
      userId: "user-123",
      runId: "run-456",
      state: "SUCCESS",
      durationMs: 420.7,
      filesInspected: ["src/index.js", "src/util.js"],
      filesModified: ["src/index.js"],
      toolCalls: 4,
      iterationCount: 1,
      executionResult: "SUCCESS",
      testResult: "SUCCESS",
    });

    assert.equal(result.service, "codecraft-agent");
    assert.equal(result.event, "AGENT_RUN_COMPLETED");
    assert.equal(result.filesInspected, 2);
    assert.equal(result.filesModified, 1);
    assert.equal(result.durationMs, 421);
    assert.ok(result.timestamp);
  });

  await test("LOG-02: logExecutionEvent emits structured safe execution event", () => {
    const result = logExecutionEvent({
      event: "EXECUTION_COMPLETED",
      workspaceId: "ws-100",
      userId: "user-123",
      executionId: "exec-789",
      language: "python",
      status: "SUCCESS",
      exitCode: 0,
      durationMs: 150.2,
      outputTruncated: false,
    });

    assert.equal(result.service, "codecraft-execution");
    assert.equal(result.language, "python");
    assert.equal(result.status, "SUCCESS");
    assert.equal(result.exitCode, 0);
    assert.equal(result.durationMs, 150);
  });

  // ==========================================
  // Suite 2: Monaco Diagnostics & Language Error Traceback Parsing
  // ==========================================
  console.log("\n--- Suite 2: Monaco Diagnostics & Traceback Parsing ---");

  await test("DIAG-01: Parses Python SyntaxError and traceback into Monaco markers", () => {
    const pythonOutput = `Traceback (most recent call last):
  File "main.py", line 14, in <module>
    result = calculate_total(items)
  File "main.py", line 8, in calculate_total
    return sum(item.price for item in items)
ZeroDivisionError: division by zero`;

    const markers = parseExecutionDiagnostics(pythonOutput, "python", "main.py");
    assert.ok(markers.length >= 1, "Should parse at least one marker from Python traceback");
    assert.equal(markers[0].startLineNumber, 14);
    assert.ok(markers[0].message.includes("ZeroDivisionError") || markers[0].message.includes("division by zero"));
    assert.equal(markers[0].severity, 8); // Monaco Error
  });

  await test("DIAG-02: Parses JavaScript/Node runtime and syntax errors", () => {
    const jsOutput = `/workspace/app.js:25
    throw new TypeError("Cannot read properties of undefined");
    ^

TypeError: Cannot read properties of undefined
    at Object.<anonymous> (/workspace/app.js:25:11)`;

    const markers = parseExecutionDiagnostics(jsOutput, "javascript", "app.js");
    assert.ok(markers.length >= 1, "Should parse JavaScript error marker");
    assert.equal(markers[0].startLineNumber, 25);
    assert.ok(markers[0].message.includes("TypeError"));
    assert.equal(markers[0].severity, 8);
  });

  await test("DIAG-03: Parses GCC/Clang C++ error and warning markers", () => {
    const cppOutput = `main.cpp:18:5: error: 'cout' was not declared in this scope; did you mean 'std::cout'?
   18 |     cout << "Hello" << endl;
      |     ^~~~
main.cpp:22:10: warning: unused variable 'unusedVar' [-Wunused-variable]
   22 |     int unusedVar = 42;
      |          ^~~~~~~~~`;

    const markers = parseExecutionDiagnostics(cppOutput, "cpp", "main.cpp");
    assert.equal(markers.length, 2, "Should parse both error and warning");
    assert.equal(markers[0].startLineNumber, 18);
    assert.equal(markers[0].startColumn, 5);
    assert.equal(markers[0].severity, 8); // Error
    assert.ok(markers[0].message.includes("cout"));

    assert.equal(markers[1].startLineNumber, 22);
    assert.equal(markers[1].severity, 4); // Warning
    assert.ok(markers[1].message.includes("unused variable"));
  });

  await test("DIAG-04: Parses Java javac compiler errors", () => {
    const javaOutput = `Main.java:7: error: cannot find symbol
    System.out.prntln("Hello");
              ^
  symbol:   method prntln(String)
  location: variable out of type PrintStream
1 error`;

    const markers = parseExecutionDiagnostics(javaOutput, "java", "Main.java");
    assert.equal(markers.length, 1);
    assert.equal(markers[0].startLineNumber, 7);
    assert.equal(markers[0].severity, 8);
    assert.ok(markers[0].message.includes("cannot find symbol"));
  });

  await test("DIAG-05: Safely returns empty array on null, empty, or mismatched files", () => {
    assert.deepEqual(parseExecutionDiagnostics(null, "python"), []);
    assert.deepEqual(parseExecutionDiagnostics("", "javascript"), []);
    assert.deepEqual(parseExecutionDiagnostics("Some random text without error", "python"), []);

    const pythonOutput = `File "other.py", line 5\nZeroDivisionError`;
    const markers = parseExecutionDiagnostics(pythonOutput, "python", "main.py");
    assert.equal(markers.length, 0, "Should ignore tracebacks for other files");
  });

  // ==========================================
  // Suite 3: Fail-Closed Real-Service Execution Handling
  // ==========================================
  console.log("\n--- Suite 3: Fail-Closed Real-Service Execution Handling ---");

  await test("EXEC-FAILCLOSE-01: ExecutionService fails closed when Docker daemon is offline", async () => {
    // Force mock handler to null to test real path
    ExecutionService.setMockHandler(null);
    setMockDockerAvailability({ available: false, reason: "Docker daemon connection refused" });

    let errorThrown = null;
    try {
      await ExecutionService.execute({
        language: "python",
        source: "print('fail-closed test')",
        workspaceId: "test-ws-sandbox",
        userId: "test-user-sandbox",
      });
    } catch (err) {
      errorThrown = err;
    } finally {
      setMockDockerAvailability(null);
    }

    assert.ok(errorThrown, "ExecutionService must reject execution when Docker daemon is offline");
    assert.equal(
      errorThrown.code,
      ExecutionErrorCodes.EXECUTION_SANDBOX_UNAVAILABLE,
      "Must throw EXECUTION_SANDBOX_UNAVAILABLE"
    );
    assert.equal(errorThrown.status, 503, "Must return HTTP 503 status");
    assert.ok(
      errorThrown.message.includes("offline") || errorThrown.message.includes("unreachable"),
      "Error message must clearly state Docker offline status"
    );
  });

  // ==========================================
  // Suite 4: Fail-Closed Gemini AI Provider Error Normalization
  // ==========================================
  console.log("\n--- Suite 4: Fail-Closed Gemini AI Provider Error Normalization ---");

  await test("AI-NORM-01: Normalizes API key error to AI_PROVIDER_NOT_CONFIGURED (401)", () => {
    const provider = new GeminiProvider();
    const rawGoogleError = new Error("[400 Bad Request] API key not valid. Please pass a valid API key. (reason: API_KEY_INVALID)");

    const normalized = provider.normalizeError(rawGoogleError);
    assert.equal(normalized.code, AgentErrorCodes.AI_PROVIDER_NOT_CONFIGURED);
    assert.equal(normalized.status, 401);
    assert.ok(!normalized.message.includes("APIzaSy"), "Must not leak raw keys in normalized error");
  });

  await test("AI-NORM-02: Normalizes rate limit / quota exhausted to AI_RATE_LIMITED (429)", () => {
    const provider = new GeminiProvider();
    const rawRateError = new Error("[429 Too Many Requests] Resource has been exhausted (e.g. check quota)");

    const normalized = provider.normalizeError(rawRateError);
    assert.equal(normalized.code, AgentErrorCodes.AI_RATE_LIMITED);
    assert.equal(normalized.status, 429);
  });

  await test("AI-NORM-03: Normalizes timeout error to AI_PROVIDER_TIMEOUT (504)", () => {
    const provider = new GeminiProvider();
    const rawTimeoutError = new Error("Request timed out after 30000ms: ETIMEDOUT");

    const normalized = provider.normalizeError(rawTimeoutError);
    assert.equal(normalized.code, AgentErrorCodes.AI_PROVIDER_TIMEOUT);
    assert.equal(normalized.status, 504);
  });

  // ==========================================
  // Suite 5: Agent Panel & Execution Output UX Safeguards
  // ==========================================
  console.log("\n--- Suite 5: Agent Panel UX Formatting & Status Safeguards ---");

  await test("UX-01: formatAgentPhase maps internal states to friendly user labels", () => {
    assert.equal(formatAgentPhase("IDLE"), "Idle");
    assert.equal(formatAgentPhase("ANALYZING"), "Analyzing Workspace...");
    assert.equal(formatAgentPhase("MODIFYING"), "Applying Code Edits...");
    assert.equal(formatAgentPhase("RUNNING_TESTS"), "Running Validation Tests...");
    assert.equal(formatAgentPhase("SUCCESS"), "Task Completed Successfully");
    assert.equal(formatAgentPhase("FAILED"), "Task Failed or Incomplete");
    assert.equal(formatAgentPhase("UNKNOWN_STATE"), "UNKNOWN_STATE");
  });

  console.log("\n==================================================");
  console.log(`  Phase 10 Tests Complete: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
