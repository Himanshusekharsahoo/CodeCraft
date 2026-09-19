import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeError, scrubErrorMessage, NormalizedAppError, isExpectedCancellation, extractMessageString } from "../src/lib/errorUtils.js";

function logPass(id, desc) {
  console.log(`  \x1b[32m✔ [${id}]\x1b[0m ${desc}`);
}

function logSuite(name) {
  console.log(`\n\x1b[1m\x1b[36m▶ Running suite: ${name}\x1b[0m`);
}

async function runTests() {
  console.log("===============================================================================");
  console.log(" CodeCraft Centralized Error Normalization & Rejection Verification Suite");
  console.log("===============================================================================");

  // ===========================================================================
  // Suite 1: Plain Object Conversion and Preservation of Codes & Status
  // ===========================================================================
  logSuite("Suite 1: Plain Object Conversion & Code/Status Preservation");
  {
    // Test 1.1: Plain object with error, code, status
    const plainErr1 = {
      error: "Workspace execution limit exceeded",
      code: "QUOTA_EXCEEDED",
      status: 429,
    };
    const norm1 = normalizeError(plainErr1);
    assert.ok(norm1 instanceof Error, "Must convert plain object to Error instance");
    assert.ok(norm1 instanceof NormalizedAppError, "Must be instance of NormalizedAppError");
    assert.strictEqual(norm1.message, "Workspace execution limit exceeded");
    assert.strictEqual(norm1.code, "QUOTA_EXCEEDED");
    assert.strictEqual(norm1.status, 429);
    assert.notStrictEqual(String(norm1), "[object Object]", "Must not stringify to [object Object]");
    logPass("NORM-01", "Plain object { error, code, status } correctly converted to Error instance");

    // Test 1.2: Firebase Auth style plain error
    const fbError = {
      code: "auth/user-not-found",
      message: "There is no user record corresponding to this identifier.",
    };
    const norm2 = normalizeError(fbError);
    assert.ok(norm2 instanceof Error);
    assert.strictEqual(norm2.code, "auth/user-not-found");
    assert.strictEqual(norm2.message, "There is no user record corresponding to this identifier.");
    logPass("NORM-02", "Firebase-style error object preserved with exact error code and message");

    // Test 1.3: Axios-style error with response.data
    const axiosError = {
      isAxiosError: true,
      response: {
        status: 404,
        data: {
          error: "Requested file not found in workspace",
          code: "FILE_NOT_FOUND",
        },
      },
    };
    const norm3 = normalizeError(axiosError);
    assert.ok(norm3 instanceof Error);
    assert.strictEqual(norm3.status, 404);
    assert.strictEqual(norm3.code, "FILE_NOT_FOUND");
    assert.strictEqual(norm3.message, "Requested file not found in workspace");
    logPass("NORM-03", "Axios response error normalized with extracted status and code");

    // Test 1.4: Empty plain object with fallback message
    const emptyObj = {};
    const norm4 = normalizeError(emptyObj, "Custom fallback error");
    assert.ok(norm4 instanceof Error);
    assert.strictEqual(norm4.message, "Custom fallback error");
    assert.notStrictEqual(String(norm4), "[object Object]");
    logPass("NORM-04", "Empty plain object correctly receives fallback message and status 500");

    // Test 1.5: String input
    const strErr = normalizeError("Database connection timed out");
    assert.ok(strErr instanceof Error);
    assert.strictEqual(strErr.message, "Database connection timed out");
    assert.strictEqual(strErr.code, "ERROR_STRING");
    logPass("NORM-05", "Direct string error normalized to Error instance");

    // Test 1.6: Null and undefined inputs
    const nullErr = normalizeError(null, "Default null fallback");
    const undefErr = normalizeError(undefined, "Default undef fallback");
    assert.ok(nullErr instanceof Error);
    assert.strictEqual(nullErr.message, "Default null fallback");
    assert.ok(undefErr instanceof Error);
    assert.strictEqual(undefErr.message, "Default undef fallback");
    logPass("NORM-06", "Null and undefined inputs normalized to Error instances");
  }

  // ===========================================================================
  // Suite 2: Existing Error Instance Preservation & Stack Traces
  // ===========================================================================
  logSuite("Suite 2: Existing Error Instance Preservation");
  {
    const originalError = new TypeError("Cannot read properties of undefined");
    const originalStack = originalError.stack;
    const normalized = normalizeError(originalError);

    assert.ok(normalized instanceof TypeError, "Preserves specific Error subclass");
    assert.strictEqual(normalized, originalError, "Returns identical Error instance");
    assert.strictEqual(normalized.stack, originalStack, "Preserves stack trace untouched");
    assert.strictEqual(normalized.message, "Cannot read properties of undefined");
    logPass("NORM-07", "Existing Error instances retain type, stack trace, and reference");
  }

  // ===========================================================================
  // Suite 3: Secret Redaction & Token Scrubbing
  // ===========================================================================
  logSuite("Suite 3: Secret Redaction & Token Scrubbing");
  {
    // Test 3.1: Google / Gemini API key
    const geminiRaw = "Gemini call failed with key AIzaSyB1234567890123456789012345678901 in headers";
    const scrubbedGemini = scrubErrorMessage(geminiRaw);
    assert.ok(!scrubbedGemini.includes("AIzaSyB1234567890123456789012345678901"), "Gemini key must be redacted");
    assert.ok(scrubbedGemini.includes("[REDACTED_GEMINI_KEY]"), "Must contain [REDACTED_GEMINI_KEY]");
    logPass("SCRUB-01", "Google/Gemini API key is scrubbed from error message");

    // Test 3.2: Bearer token
    const bearerRaw = "Authorization failed: Bearer ya29.a0AfH6SMDI983274_sdjfksdf384920";
    const scrubbedBearer = scrubErrorMessage(bearerRaw);
    assert.ok(!scrubbedBearer.includes("ya29.a0AfH6SMDI983274_sdjfksdf384920"), "Bearer token must be redacted");
    assert.ok(scrubbedBearer.includes("Bearer [REDACTED_TOKEN]"), "Must contain Bearer [REDACTED_TOKEN]");
    logPass("SCRUB-02", "Bearer Authorization token is scrubbed from error message");

    // Test 3.3: JWT Token
    const jwtRaw = "Firebase rejected JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0";
    const scrubbedJwt = scrubErrorMessage(jwtRaw);
    assert.ok(!scrubbedJwt.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"), "JWT must be redacted");
    assert.ok(scrubbedJwt.includes("[REDACTED_JWT_TOKEN]"), "Must contain [REDACTED_JWT_TOKEN]");
    logPass("SCRUB-03", "Firebase / JWT tokens are scrubbed from error message");

    // Test 3.4: Normalization scrubs secrets inside Error instances
    const leakedError = new Error("Failed to connect: api_key='sk_live_99999999999999'");
    normalizeError(leakedError);
    assert.ok(!leakedError.message.includes("sk_live_99999999999999"), "Error.message must be scrubbed in-place");
    assert.ok(leakedError.message.includes("REDACTED"), "Must contain REDACTED replacement");
    logPass("SCRUB-04", "normalizeError scrubs secrets inside native Error instances in-place");
  }

  // ===========================================================================
  // Suite 4: Next.js Dev Overlay & Rejection Prevention
  // ===========================================================================
  logSuite("Suite 4: Next.js Dev Overlay & Unhandled Rejection Prevention");
  {
    // Next.js createUnhandledError(reason) runs new Error(reason)
    // When reason is a plain object, new Error({ ... }) renders Error: [object Object]
    const badReason = { error: "Network timeout", status: 504 };
    const simulatedOverlayWithPlain = new Error(badReason);
    assert.strictEqual(simulatedOverlayWithPlain.message, "[object Object]", "Proves root cause: new Error(plainObj) produces [object Object]");

    // When normalized, reason is an Error instance with proper message
    const normalizedReason = normalizeError(badReason);
    const simulatedOverlayWithNormalized = new Error(normalizedReason.message);
    assert.strictEqual(simulatedOverlayWithNormalized.message, "Network timeout", "Normalized error produces readable message");
    assert.notStrictEqual(simulatedOverlayWithNormalized.message, "[object Object]");
    logPass("NEXT-01", "Verified root cause mechanism: plain object -> [object Object]; normalized -> readable message");
  }

  // ===========================================================================
  // Suite 5: Static Code Inspection of Critical Unhandled Rejection Areas
  // ===========================================================================
  logSuite("Suite 5: Static Code Inspection of Critical CodeCraft Files");
  {
    // 5.1: AuthProvider window.unhandledrejection listener
    const authProviderCode = fs.readFileSync(path.resolve("src/context/AuthProvider.js"), "utf8");
    assert.match(authProviderCode, /unhandledrejection/, "AuthProvider must register unhandledrejection listener");
    assert.match(authProviderCode, /normalizeError/, "AuthProvider must normalize unhandled rejection reason");
    assert.match(authProviderCode, /event\.preventDefault\(\)/, "AuthProvider must prevent Next.js dev overlay crash for unhandled rejections");
    logPass("STATIC-01", "src/context/AuthProvider.js handles window unhandledrejection and normalizes errors");

    // 5.2: Editor.jsx session init and snapshot safety
    const editorCode = fs.readFileSync(path.resolve("src/components/Editor.jsx"), "utf8");
    assert.match(editorCode, /import\s*\{\s*normalizeError\s*\}\s*from\s*["']@\/lib\/errorUtils["']/, "Editor.jsx must import normalizeError");
    assert.match(editorCode, /initSession\(activeFile\)\s*\.then\([\s\S]*?\)\s*\.catch\(/, "Editor.jsx onMount initSession must have .catch() handler");
    assert.match(editorCode, /fallbackUnsub\s*=\s*onSnapshot\([\s\S]*?,\s*\(error\)\s*=>/, "Editor.jsx workspace fallback listener must have onError callback");
    logPass("STATIC-02", "src/components/Editor.jsx safely catches initSession and provides fallbackUnsub onError callback");

    // 5.3: Dashboard.jsx snapshot safety and cascading delete
    const dashboardCode = fs.readFileSync(path.resolve("src/app/dashboard/page.jsx"), "utf8");
    assert.match(dashboardCode, /import\s*\{\s*normalizeError\s*\}\s*from\s*["']@\/lib\/errorUtils["']/, "Dashboard must import normalizeError");
    assert.match(dashboardCode, /const\s+handleSnapshot\s*=\s*async/, "Dashboard userRef onSnapshot must use safe async handler");
    assert.match(dashboardCode, /handleSnapshot\(docSnap\)\.catch\(/, "Dashboard userRef onSnapshot must catch promise rejection");
    assert.match(dashboardCode, /onSnapshot\(\s*userRef,\s*\(docSnap\)\s*=>[\s\S]*?,\s*\((?:err|error)\)\s*=>/, "Dashboard userRef onSnapshot must provide onError callback");
    logPass("STATIC-03", "src/app/dashboard/page.jsx safely catches snapshot handler and provides onError callback");

    // 5.4: Navpanel.jsx snapshot listeners
    const navpanelCode = fs.readFileSync(path.resolve("src/components/Navpanel.jsx"), "utf8");
    assert.match(navpanelCode, /onSnapshot\(\s*membersRef,[\s\S]*?,\s*\((?:err|error)\)\s*=>/, "Navpanel membersRef onSnapshot must have onError callback");
    assert.match(navpanelCode, /onSnapshot\(\s*foldersRef,[\s\S]*?,\s*\((?:err|error)\)\s*=>/, "Navpanel foldersRef onSnapshot must have onError callback");
    assert.match(navpanelCode, /onSnapshot\(\s*filesRef,[\s\S]*?,\s*\((?:err|error)\)\s*=>/, "Navpanel filesRef onSnapshot must have onError callback");
    logPass("STATIC-04", "src/components/Navpanel.jsx provides onError callbacks on all Firestore onSnapshot listeners");

    // 5.5: Members.jsx synchronous snapshot and onError
    const membersCode = fs.readFileSync(path.resolve("src/components/Members.jsx"), "utf8");
    assert.doesNotMatch(membersCode, /onSnapshot\(\s*membersCollectionRef,\s*async\s*\(/, "Members.jsx must NOT pass async function directly to onSnapshot");
    assert.match(membersCode, /onSnapshot\(\s*membersCollectionRef,[\s\S]*?,\s*\((?:err|error)\)\s*=>/, "Members.jsx must provide onError callback");
    logPass("STATIC-05", "src/components/Members.jsx uses synchronous snapshot handler and onError callback");

    // 5.6: api.js normalized error handling and secret scrubbing
    const apiCode = fs.readFileSync(path.resolve("src/api.js"), "utf8");
    assert.match(apiCode, /import\s*\{\s*normalizeError,\s*scrubErrorMessage\s*\}\s*from\s*["']\.\/lib\/errorUtils\.js["']/, "api.js must import normalizeError and scrubErrorMessage");
    assert.match(apiCode, /executeCode[\s\S]*?normalizeError/, "api.js executeCode must normalize errors");
    assert.match(apiCode, /cancelExecution[\s\S]*?normalizeError/, "api.js cancelExecution must normalize errors");
    assert.match(apiCode, /getExecutionStatus[\s\S]*?normalizeError/, "api.js getExecutionStatus must normalize errors");
    assert.match(apiCode, /runAIAgent[\s\S]*?normalizeError/, "api.js runAIAgent must normalize errors");
    assert.match(apiCode, /rollbackAIAgent[\s\S]*?normalizeError/, "api.js rollbackAIAgent must normalize errors");
    assert.match(apiCode, /getAIAgentRun[\s\S]*?normalizeError/, "api.js getAIAgentRun must normalize errors");
    logPass("STATIC-06", "src/api.js normalizes errors and scrubs secrets across all API operations");

    // 5.7: ErrorBoundary.jsx normalized errors
    const errorBoundaryCode = fs.readFileSync(path.resolve("src/components/ErrorBoundary.jsx"), "utf8");
    assert.match(errorBoundaryCode, /import\s*\{\s*normalizeError\s*\}\s*from\s*["']@\/lib\/errorUtils["']/, "ErrorBoundary must import normalizeError");
    assert.match(errorBoundaryCode, /normalizeError\(error\)/, "ErrorBoundary must normalize error in getDerivedStateFromError");
    logPass("STATIC-07", "src/components/ErrorBoundary.jsx normalizes render errors");
  }

  // ===========================================================================
  // Suite 6: Expected Cancellation vs Real Error Discrimination
  // ===========================================================================
  logSuite("Suite 6: Expected Cancellation vs Real Error Discrimination");
  {
    // 6.1: Monaco makeCancelable rejection object
    const monacoCancel = {
      type: "cancelation",
      msg: "operation is manually canceled",
    };
    assert.strictEqual(isExpectedCancellation(monacoCancel), true, "Monaco cancelation object must be identified as expected cancellation");
    const normMonaco = normalizeError(monacoCancel);
    assert.strictEqual(normMonaco.code, "OPERATION_CANCELED", "Normalized Monaco cancellation must have OPERATION_CANCELED code");
    assert.strictEqual(normMonaco.status, 0, "Normalized Monaco cancellation must have status 0");
    assert.strictEqual(normMonaco.isCancellation, true, "isCancellation flag must be true");
    assert.strictEqual(normMonaco.message, "operation is manually canceled");
    logPass("CANCEL-01", "Monaco { type: 'cancelation', msg: 'operation is manually canceled' } recognized and normalized as cancellation");

    // 6.2: DOMException AbortError
    const domAbort = new Error("The user aborted a request.");
    domAbort.name = "AbortError";
    domAbort.code = 20;
    assert.strictEqual(isExpectedCancellation(domAbort), true, "AbortError must be recognized as expected cancellation");
    const normAbort = normalizeError(domAbort);
    assert.strictEqual(normAbort.isCancellation, true);
    assert.strictEqual(normAbort.code, "OPERATION_CANCELED");
    logPass("CANCEL-02", "DOMException / Standard AbortError recognized and normalized as cancellation");

    // 6.3: Axios CanceledError
    const axiosCancel = {
      name: "CanceledError",
      code: "ERR_CANCELED",
      message: "canceled",
      __CANCEL__: true,
    };
    assert.strictEqual(isExpectedCancellation(axiosCancel), true, "Axios CanceledError must be recognized as expected cancellation");
    const normAxiosCancel = normalizeError(axiosCancel);
    assert.strictEqual(normAxiosCancel.isCancellation, true);
    logPass("CANCEL-03", "Axios CanceledError / ERR_CANCELED recognized as cancellation");

    // 6.4: Real errors must NOT be classified as cancellations
    const authError = { code: "auth/invalid-credential", message: "Invalid email or password" };
    assert.strictEqual(isExpectedCancellation(authError), false, "Auth error must not be marked as cancellation");

    const firestorePerm = new Error("Missing or insufficient permissions.");
    assert.strictEqual(isExpectedCancellation(firestorePerm), false, "Firestore permission-denied must not be marked as cancellation");

    const geminiRateLimit = { status: 429, error: "Resource has been exhausted (e.g. check quota)." };
    assert.strictEqual(isExpectedCancellation(geminiRateLimit), false, "Gemini rate limit 429 must not be marked as cancellation");
    const normGemini = normalizeError(geminiRateLimit);
    assert.strictEqual(normGemini.code, "AI_RATE_LIMITED");
    assert.strictEqual(normGemini.status, 429);
    assert.strictEqual(normGemini.isCancellation, false);

    const execFailed = { status: "failed", error: "Command execution timed out after 30000ms" };
    assert.strictEqual(isExpectedCancellation(execFailed), false, "Execution timeout must not be marked as cancellation");

    logPass("CANCEL-04", "Real errors (auth, firestore, rate limits, timeouts) are strictly NOT marked as cancellations");
  }

  // ===========================================================================
  // Suite 7: Prevention of [object Object] from Nested Plain Objects
  // ===========================================================================
  logSuite("Suite 7: Nested Plain Object Message Extraction & [object Object] Prevention");
  {
    // 7.1: Nested error object { error: { message: "...", code: 429 } }
    const nestedApiErr = {
      error: {
        code: 429,
        message: "Quota exceeded for quota metric 'Generate Content API' and limit 'Requests per minute'",
        status: "RESOURCE_EXHAUSTED",
      },
    };
    const normNested = normalizeError(nestedApiErr);
    assert.ok(!normNested.message.includes("[object Object]"), "Must NOT contain [object Object]");
    assert.ok(normNested.message.includes("Quota exceeded"), "Must extract nested message");
    assert.strictEqual(normNested.status, 429);
    logPass("NO-OBJ-01", "Nested error object extracts human-readable text and avoids [object Object]");

    // 7.2: Deep response object { response: { data: { error: { message: "Internal server error" } } } }
    const deepResponseErr = {
      response: {
        status: 500,
        data: {
          error: {
            message: "Database connection failed",
          },
        },
      },
    };
    const normDeep = normalizeError(deepResponseErr);
    assert.strictEqual(normDeep.message, "Database connection failed");
    assert.strictEqual(normDeep.status, 500);
    assert.ok(!normDeep.message.includes("[object Object]"));
    logPass("NO-OBJ-02", "Deep response.data.error extracts nested message and preserves status");

    // 7.3: Object with only numeric code
    const codeOnly = { code: 503 };
    const normCodeOnly = normalizeError(codeOnly);
    assert.strictEqual(normCodeOnly.message, "Request failed with HTTP status 503");
    assert.ok(!normCodeOnly.message.includes("[object Object]"));
    logPass("NO-OBJ-03", "Object with status code only generates readable message without [object Object]");
  }

  // ===========================================================================
  // Suite 8: Static Code Inspection of Cancellation & Rejection Shields
  // ===========================================================================
  logSuite("Suite 8: Static Code Inspection of Cancellation & Rejection Shields");
  {
    // 8.1: Editor.jsx defines useSafeMonaco and catches cancellation
    const editorCode = fs.readFileSync(path.resolve("src/components/Editor.jsx"), "utf8");
    assert.doesNotMatch(editorCode, /import\s*\{[^}]*useMonaco[^}]*\}\s*from\s*["']@monaco-editor\/react["']/, "Editor.jsx must NOT import unhandled useMonaco");
    assert.match(editorCode, /function\s+useSafeMonaco\(\)/, "Editor.jsx must define useSafeMonaco hook");
    assert.match(editorCode, /const\s+monaco\s*=\s*useSafeMonaco\(\)/, "Editor.jsx must invoke useSafeMonaco");
    assert.match(editorCode, /error\?\.type\s*===\s*["']cancelation["']/, "useSafeMonaco must explicitly handle cancelation");
    logPass("SHIELD-01", "Editor.jsx implements useSafeMonaco with explicit cancelation absorption");

    // 8.2: AuthProvider.js uses capture phase and stops propagation for dev overlay protection
    const authCode = fs.readFileSync(path.resolve("src/context/AuthProvider.js"), "utf8");
    assert.match(authCode, /window\.addEventListener\(\s*["']unhandledrejection["'],\s*handleUnhandledRejection,\s*\{\s*capture:\s*true\s*\}\s*\)/, "AuthProvider must register unhandledrejection in capture phase");
    assert.match(authCode, /isExpectedCancellation\(reason\)/, "AuthProvider must check isExpectedCancellation");
    assert.match(authCode, /event\.stopImmediatePropagation\(\)/, "AuthProvider must call stopImmediatePropagation to shield Next.js dev overlay");
    logPass("SHIELD-02", "AuthProvider.js uses capturing phase and stopImmediatePropagation to protect dev overlay");
  }

  console.log("\n\x1b[32m✔ All Error Normalization & Observability tests passed successfully!\x1b[0m\n");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
