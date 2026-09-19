import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { GeminiProvider } from "../src/lib/ai/geminiProvider.js";
import { AgentError, AgentErrorCodes } from "../src/lib/ai/agentErrors.js";

console.log("===================================================================");
console.log(" CodeCraft Issue 3 & 4 — Floating AI Panel & AI Error Architecture ");
console.log("===================================================================");

// ---------------------------------------------------------------------------
// Suite 1: Floating AI Button & Floating Panel Static Verification
// ---------------------------------------------------------------------------
test("Suite 1: Workspace Page Floating AI Button & Panel Architecture", () => {
  const workspacePagePath = path.resolve("src/app/workspace/[workspaceId]/page.jsx");
  const workspaceCode = fs.readFileSync(workspacePagePath, "utf8");

  // 1. Floating AI state exists
  assert.match(
    workspaceCode,
    /const\s*\[isFloatingAIOpen,\s*setIsFloatingAIOpen\]\s*=\s*useState\(false\)/,
    "Workspace page must manage isFloatingAIOpen state initialized to false"
  );

  // 2. Escape key handler exists to close floating AI
  assert.match(
    workspaceCode,
    /e\.key\s*===\s*["']Escape["']/,
    "Workspace page must implement Escape keyboard shortcut to close floating AI panel"
  );

  // 3. Floating AI button exists on right side with accessible label and test ID
  assert.match(
    workspaceCode,
    /data-testid=["']floating-ai-btn["']/,
    "Floating AI button must have data-testid='floating-ai-btn'"
  );
  assert.match(
    workspaceCode,
    /aria-label=["']Open AI Coding Agent["']/,
    "Floating AI button must have accessible aria-label='Open AI Coding Agent'"
  );
  assert.match(
    workspaceCode,
    /fixed\s+bottom-6\s+right-6/,
    "Floating AI button must have fixed right-side positioning (bottom-6 right-6)"
  );

  // 4. Floating AI panel exists with test ID and proper positioning
  assert.match(
    workspaceCode,
    /data-testid=["']floating-ai-panel["']/,
    "Floating AI panel must have data-testid='floating-ai-panel'"
  );
  assert.match(
    workspaceCode,
    /<AgentPanel[^>]*isFloating=\{true\}/,
    "Floating AI panel must reuse existing AgentPanel with isFloating={true}"
  );
  assert.match(
    workspaceCode,
    /onClose=\{[^}]*setIsFloatingAIOpen\(false\)/,
    "Floating AgentPanel must pass onClose callback to toggle state"
  );

  console.log("  ✔ PASS [Suite 1]: Workspace page integrates floating AI trigger button and floating AgentPanel");
});

// ---------------------------------------------------------------------------
// Suite 2: AgentPanel Floating Mode & Close Button Verification
// ---------------------------------------------------------------------------
test("Suite 2: AgentPanel Component Floating Mode & Close Support", () => {
  const agentPanelPath = path.resolve("src/components/AgentPanel.jsx");
  const agentPanelCode = fs.readFileSync(agentPanelPath, "utf8");

  // 1. X icon imported from lucide-react
  assert.match(
    agentPanelCode,
    /import\s*\{[^}]*\bX\b[^}]*\}\s*from\s*["']lucide-react["']/,
    "AgentPanel must import X from lucide-react for the close button"
  );

  // 2. onClose prop supported
  assert.match(
    agentPanelCode,
    /onClose\s*=\s*null/,
    "AgentPanel must accept onClose prop"
  );
  assert.match(
    agentPanelCode,
    /isFloating\s*=\s*false/,
    "AgentPanel must accept isFloating prop"
  );

  // 3. Close button rendered when onClose is provided
  assert.match(
    agentPanelCode,
    /aria-label=["']Close AI Coding Agent["']/,
    "AgentPanel must render accessible close button with aria-label='Close AI Coding Agent'"
  );

  // 4. Existing API calls and diff viewer reused
  assert.match(
    agentPanelCode,
    /runAIAgent\(/,
    "AgentPanel must reuse existing runAIAgent API helper"
  );
  assert.match(
    agentPanelCode,
    /rollbackAIAgent\(/,
    "AgentPanel must reuse existing rollbackAIAgent API helper"
  );
  assert.match(
    agentPanelCode,
    /<MonacoDiffViewer/,
    "AgentPanel must reuse MonacoDiffViewer for viewing diffs"
  );

  console.log("  ✔ PASS [Suite 2]: AgentPanel supports floating mode, clean close trigger, and component reuse");
});

// ---------------------------------------------------------------------------
// Suite 3: Gemini Error Classification & Quota Normalization
// ---------------------------------------------------------------------------
test("Suite 3: GeminiProvider Error Normalization Matrix", () => {
  const provider = new GeminiProvider();

  // 1. HTTP 429 Quota Exceeded
  const quotaErr = new Error("Resource has been exhausted (e.g. check quota)");
  quotaErr.status = 429;
  const normQuota = provider.normalizeError(quotaErr);
  assert.equal(normQuota.code, AgentErrorCodes.AI_RATE_LIMITED);
  assert.equal(normQuota.status, 429);
  assert.ok(normQuota.message.includes("rate limit or quota exceeded"));

  // 2. HTTP 401 Unauthorized / Invalid API Key
  const authErr = new Error("API_KEY_INVALID: API key not valid");
  authErr.status = 401;
  const normAuth = provider.normalizeError(authErr);
  assert.equal(normAuth.code, AgentErrorCodes.AI_PROVIDER_NOT_CONFIGURED);
  assert.equal(normAuth.status, 401);

  // 3. HTTP 403 Forbidden
  const permErr = new Error("Permission denied: caller does not have permission");
  permErr.status = 403;
  const normPerm = provider.normalizeError(permErr);
  assert.equal(normPerm.code, AgentErrorCodes.AI_PROVIDER_NOT_CONFIGURED);
  assert.equal(normPerm.status, 403);

  // 4. HTTP 404 Model Not Found
  const modelErr = new Error("models/gemini-invalid is not supported for generateContent");
  modelErr.status = 404;
  const normModel = provider.normalizeError(modelErr);
  assert.equal(normModel.code, AgentErrorCodes.MODEL_ERROR);
  assert.equal(normModel.status, 404);

  // 5. HTTP 400 Context Limit
  const contextErr = new Error("Maximum context length exceeded");
  contextErr.status = 400;
  const normContext = provider.normalizeError(contextErr);
  assert.equal(normContext.code, AgentErrorCodes.CONTEXT_LIMIT_EXCEEDED);
  assert.equal(normContext.status, 400);

  // 6. HTTP 400 Malformed Request
  const badReqErr = new Error("Invalid argument supplied to Gemini");
  badReqErr.status = 400;
  const normBadReq = provider.normalizeError(badReqErr);
  assert.equal(normBadReq.code, AgentErrorCodes.AGENT_INVALID_REQUEST);
  assert.equal(normBadReq.status, 400);

  // 7. HTTP 408 / 504 Timeout
  const timeout408 = new Error("Request timeout");
  timeout408.status = 408;
  const normTimeout408 = provider.normalizeError(timeout408);
  assert.equal(normTimeout408.code, AgentErrorCodes.AI_PROVIDER_TIMEOUT);
  assert.equal(normTimeout408.status, 408);

  const timeout504 = new Error("Gateway timeout: deadline exceeded");
  timeout504.status = 504;
  const normTimeout504 = provider.normalizeError(timeout504);
  assert.equal(normTimeout504.code, AgentErrorCodes.AI_PROVIDER_TIMEOUT);
  assert.equal(normTimeout504.status, 504);

  // 8. HTTP 503 Service Unavailable
  const svcErr = new Error("Service Unavailable");
  svcErr.status = 503;
  const normSvc = provider.normalizeError(svcErr);
  assert.equal(normSvc.code, AgentErrorCodes.MODEL_ERROR);
  assert.equal(normSvc.status, 503);

  console.log("  ✔ PASS [Suite 3]: All error categories (400, 401, 403, 404, 408, 429, 503, 504) strictly categorized");
});

// ---------------------------------------------------------------------------
// Suite 4: Retry Policy Invariants
// ---------------------------------------------------------------------------
test("Suite 4: Retry Policy Does Not Loop on 429 Quota Exceeded", async () => {
  const provider = new GeminiProvider();
  let callCount = 0;

  try {
    await provider.withRetry(async () => {
      callCount++;
      const err = new Error("Resource exhausted: quota limit 20 reached");
      err.status = 429;
      throw err;
    });
    assert.fail("Should have thrown");
  } catch (err) {
    assert.equal(callCount, 1, "429 errors must fail immediately without rapid retry loops");
    assert.equal(err.code, AgentErrorCodes.AI_RATE_LIMITED);
    assert.equal(err.status, 429);
  }

  console.log("  ✔ PASS [Suite 4]: withRetry terminates immediately on 429 quota exhaustion");
});
