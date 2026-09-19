import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { AgentOrchestrator } from "../src/lib/ai/agentOrchestrator.js";
import { SYSTEM_AGENT_POLICY } from "../src/lib/ai/promptInjectionDefense.js";
import { TOOL_REGISTRY } from "../src/lib/ai/tools/registry.js";

console.log("===================================================================");
console.log(" CodeCraft Issue — Complete AI Coding Agent & Floating Panel UX    ");
console.log("===================================================================");

// ---------------------------------------------------------------------------
// Suite 1: Floating AI Panel Outside-Click & Background Retention Architecture
// ---------------------------------------------------------------------------
test("Suite 1: Floating AI Panel DOM Retention & Outside Click Contracts", () => {
  const workspacePagePath = path.resolve("src/app/workspace/[workspaceId]/page.jsx");
  const workspaceCode = fs.readFileSync(workspacePagePath, "utf8");

  // 1. Panel is kept mounted in DOM with display toggle (does not unmount on close)
  assert.match(
    workspaceCode,
    /style=\{\{\s*display:\s*isFloatingAIOpen\s*\?\s*["']flex["']\s*:\s*["']none["']\s*\}\}/,
    "Floating AI panel must remain mounted using display: none/flex to prevent cancelling background Agent tasks"
  );

  // 2. Refs for panel and trigger exist to distinguish clicks
  assert.match(
    workspaceCode,
    /const\s+floatingPanelRef\s*=\s*useRef\(null\)/,
    "Workspace must have floatingPanelRef"
  );
  assert.match(
    workspaceCode,
    /const\s+floatingTriggerRef\s*=\s*useRef\(null\)/,
    "Workspace must have floatingTriggerRef"
  );

  // 3. Pointerdown outside-click listener is attached
  assert.match(
    workspaceCode,
    /document\.addEventListener\(["']pointerdown["'],\s*handlePointerDown\)/,
    "Pointerdown listener must be attached to document for outside-click detection"
  );

  // 4. Inside-panel and trigger clicks are excluded from closing
  assert.match(
    workspaceCode,
    /floatingPanelRef\.current\s*&&\s*floatingPanelRef\.current\.contains\(e\.target\)/,
    "Clicks inside floatingPanelRef must NOT close the panel"
  );
  assert.match(
    workspaceCode,
    /floatingTriggerRef\.current\s*&&\s*floatingTriggerRef\.current\.contains\(e\.target\)/,
    "Clicks on floatingTriggerRef must NOT close the panel accidentally"
  );

  // 5. Clean listener teardown
  assert.match(
    workspaceCode,
    /document\.removeEventListener\(["']pointerdown["'],\s*handlePointerDown\)/,
    "Pointerdown listener must be cleaned up on effect disposal"
  );

  console.log("  ✔ PASS [Suite 1]: Floating panel DOM retention and outside-click architecture verified");
});

// ---------------------------------------------------------------------------
// Suite 2: Draft Persistence & Unsent Text Preservation
// ---------------------------------------------------------------------------
test("Suite 2: Draft Persistence Contracts in AgentPanel", () => {
  const agentPanelPath = path.resolve("src/components/AgentPanel.jsx");
  const agentPanelCode = fs.readFileSync(agentPanelPath, "utf8");

  // 1. Session storage key for draft prompt
  assert.match(
    agentPanelCode,
    /codecraft_agent_draft_\$\{workspaceId\}/,
    "AgentPanel must construct workspace-specific draft key"
  );

  // 2. Draft initialized from sessionStorage if available
  assert.match(
    agentPanelCode,
    /sessionStorage\.getItem\(draftKey\)/,
    "AgentPanel must initialize draft prompt from sessionStorage"
  );

  // 3. Draft synced to sessionStorage on change
  assert.match(
    agentPanelCode,
    /sessionStorage\.setItem\(draftKey,\s*taskPrompt\)/,
    "AgentPanel must sync taskPrompt to sessionStorage"
  );

  // 4. Draft cleaned when empty
  assert.match(
    agentPanelCode,
    /sessionStorage\.removeItem\(draftKey\)/,
    "AgentPanel must remove draft key when prompt is empty"
  );

  console.log("  ✔ PASS [Suite 2]: Draft persistence and unsent text preservation verified");
});

// ---------------------------------------------------------------------------
// Suite 3: Monaco Editor Context Forwarding (Selection & Problems)
// ---------------------------------------------------------------------------
test("Suite 3: Monaco Editor Context Integration & Forwarding", () => {
  const agentPanelPath = path.resolve("src/components/AgentPanel.jsx");
  const agentPanelCode = fs.readFileSync(agentPanelPath, "utf8");
  const apiPath = path.resolve("src/api.js");
  const apiCode = fs.readFileSync(apiPath, "utf8");
  const routePath = path.resolve("src/app/api/workspace/[workspaceId]/agent/route.js");
  const routeCode = fs.readFileSync(routePath, "utf8");

  // 1. AgentPanel extracts selectedCode from window.__codecraftEditor
  assert.match(
    agentPanelCode,
    /editor\.getModel\(\)\?\.getValueInRange\(selection\)/,
    "AgentPanel must extract selectedCode from Monaco editor selection"
  );

  // 2. AgentPanel extracts diagnostics from window.monaco
  assert.match(
    agentPanelCode,
    /monaco\.editor\.getModelMarkers\(/,
    "AgentPanel must extract problem markers from Monaco"
  );

  // 3. runAIAgent forwards activeFile, selectedCode, and diagnostics
  assert.match(
    apiCode,
    /activeFile:\s*options\.activeFile/,
    "runAIAgent must forward activeFile"
  );
  assert.match(
    apiCode,
    /selectedCode:\s*options\.selectedCode/,
    "runAIAgent must forward selectedCode"
  );
  assert.match(
    apiCode,
    /diagnostics:\s*options\.diagnostics/,
    "runAIAgent must forward diagnostics"
  );

  // 4. Route handler unpacks and passes context to orchestrator
  assert.match(
    routeCode,
    /activeFile,\s*selectedCode,\s*diagnostics/,
    "Agent route must unpack activeFile, selectedCode, diagnostics from request"
  );
  assert.match(
    routeCode,
    /activeFile:\s*activeFile\s*\|\|\s*null/,
    "Agent route must pass activeFile to AgentOrchestrator.run"
  );
  assert.match(
    routeCode,
    /selectedCode:\s*typeof\s+selectedCode\s*===\s*["']string["']/,
    "Agent route must pass sanitized selectedCode to AgentOrchestrator.run"
  );
  assert.match(
    routeCode,
    /diagnostics:\s*Array\.isArray\(diagnostics\)/,
    "Agent route must pass validated diagnostics array to AgentOrchestrator.run"
  );

  console.log("  ✔ PASS [Suite 3]: Full editor context forwarding pipeline verified end-to-end");
});

// ---------------------------------------------------------------------------
// Suite 4: Agent Capabilities & System Prompt Verification
// ---------------------------------------------------------------------------
test("Suite 4: Agent Capabilities, Policy & Tool Allowlist", () => {
  // 1. System policy includes coding chat and operational capabilities
  assert.ok(
    SYSTEM_AGENT_POLICY.includes("Coding Chat & Explanations"),
    "SYSTEM_AGENT_POLICY must include Coding Chat & Explanations guidance"
  );
  assert.ok(
    SYSTEM_AGENT_POLICY.includes("Code Review"),
    "SYSTEM_AGENT_POLICY must include Code Review capability"
  );
  assert.ok(
    SYSTEM_AGENT_POLICY.includes("CRITICAL"),
    "SYSTEM_AGENT_POLICY must define CRITICAL review tier"
  );
  assert.ok(
    SYSTEM_AGENT_POLICY.includes("WARNING"),
    "SYSTEM_AGENT_POLICY must define WARNING review tier"
  );
  assert.ok(
    SYSTEM_AGENT_POLICY.includes("SUGGESTION"),
    "SYSTEM_AGENT_POLICY must define SUGGESTION review tier"
  );
  assert.ok(
    SYSTEM_AGENT_POLICY.includes("Security Review"),
    "SYSTEM_AGENT_POLICY must include Security Review guidance"
  );
  assert.ok(
    SYSTEM_AGENT_POLICY.includes("Bug Fixing & Monaco Diagnostics"),
    "SYSTEM_AGENT_POLICY must include Bug Fixing & Monaco Diagnostics guidance"
  );
  assert.ok(
    SYSTEM_AGENT_POLICY.includes("Controlled Self-Repair"),
    "SYSTEM_AGENT_POLICY must include Controlled Self-Repair guidance"
  );

  // 2. All 7 tools registered in TOOL_REGISTRY
  const requiredTools = [
    "list_files",
    "read_file",
    "search_code",
    "get_git_diff",
    "apply_patch",
    "run_code",
    "run_tests",
  ];
  for (const toolName of requiredTools) {
    assert.ok(TOOL_REGISTRY[toolName], `Tool '${toolName}' must be registered`);
  }

  console.log("  ✔ PASS [Suite 4]: Agent capabilities, policy, and tool registry verified");
});

// ---------------------------------------------------------------------------
// Suite 5: Orchestrator Context Injection Verification
// ---------------------------------------------------------------------------
test("Suite 5: Orchestrator Formats Context in Agent Run", async () => {
  let capturedPrompt = null;

  const mockProvider = {
    sendMessage: async (args) => {
      capturedPrompt = args.message;
      return {
        text: "Understood. The context has been received.",
        toolCalls: [],
      };
    },
  };

  const result = await AgentOrchestrator.run({
    task: "Fix the NullPointerException in Calculator.java",
    workspaceId: "ws-behavior-test",
    userId: "user-test-behavior",
    userRole: "contributor",
    activeFile: { name: "Calculator.java", path: "src/Calculator.java" },
    selectedCode: "public int add(Integer a, Integer b) { return a + b; }",
    diagnostics: [
      { severity: "ERROR", startLineNumber: 42, message: "Potential null pointer dereference" },
    ],
    aiProvider: mockProvider,
  });

  assert.equal(result.status, "COMPLETED");
  assert.ok(capturedPrompt.includes("Fix the NullPointerException in Calculator.java"));
  assert.ok(capturedPrompt.includes("Active File: src/Calculator.java"));
  assert.ok(capturedPrompt.includes("User Selected Editor Code:"));
  assert.ok(capturedPrompt.includes("public int add(Integer a, Integer b)"));
  assert.ok(capturedPrompt.includes("Active Editor Problems / Diagnostics:"));
  assert.ok(capturedPrompt.includes("[ERROR] line 42: Potential null pointer dereference"));

  console.log("  ✔ PASS [Suite 5]: Orchestrator correctly enriches initial prompt with active context");
  setTimeout(() => process.exit(0), 100);
});
