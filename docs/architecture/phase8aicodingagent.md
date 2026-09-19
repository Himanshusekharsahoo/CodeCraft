# CodeCraft Phase 8: Autonomous AI Coding Agent Architecture

## 1. Architecture Overview
CodeCraft Phase 8 implements an autonomous, controlled AI Coding Agent that runs directly inside the server execution boundary of CodeCraft. The agent orchestrator coordinates with Google Gemini to inspect workspace layout, locate relevant files, read code, apply conflict-checked patches, verify changes via allowlisted tests or Docker sandbox execution, and present full git diffs with safe rollback capabilities.

```
+-------------------------------------------------------------------------------+
|                               Browser Client                                  |
|  [AgentPanel.jsx] <---> [MonacoDiffViewer.jsx] <---> [Editor (Monaco / Yjs)]  |
+---------------------------------------+---------------------------------------+
                                        | HTTP POST / GET (Bearer Auth)
                                        v
+-------------------------------------------------------------------------------+
|                       CodeCraft API & Server Route                            |
|             /api/workspace/[workspaceId]/agent & .../agent/rollback           |
|                                       |                                       |
|    +----------------------------------v----------------------------------+    |
|    |           Authentication & Workspace Authorization Guard            |    |
|    |      (Token Verification, Role Enforcing: Viewer vs Contributor)    |    |
|    +----------------------------------+----------------------------------+    |
|                                       |                                       |
|    +----------------------------------v----------------------------------+    |
|    |                      Agent Orchestrator Engine                      |    |
|    |     - Concurrency Tracker & User Rate Limiter                       |    |
|    |     - Finite State Machine (IDLE -> PLANNING -> INSPECTING -> ...)  |    |
|    |     - Bounded Self-Repair Loop (Max 3 Iterations)                   |    |
|    +-----+----------------------------+----------------------------+-----+    |
|          |                            |                            |          |
|          v                            v                            v          |
|  +------------------+     +------------------------+     +-----------------+  |
|  |  Gemini Provider |     |     Tool Registry      |     |  Safe Rollback  |  |
|  |  - AIConfig      |     |  - list_files          |     |  - Pre-run      |  |
|  |  - Sanitization  |     |  - read_file           |     |    Snapshots    |  |
|  |  - Normalization |     |  - search_code         |     |  - Conflict     |  |
|  |  - Retry Logic   |     |  - get_git_diff        |     |    Reversal     |  |
|  +-------+----------+     |  - apply_patch         |     +-----------------+  |
|          |                |  - run_code (Docker)   |                          |
|          |                |  - run_tests           |                          |
|          |                +-----------+------------+                          |
|          |                            |                                       |
|          v                            v                                       |
|  Google Gemini API       ExecutionService / GitService / Workspace Filesystem |
+-------------------------------------------------------------------------------+
```

## 2. Agent Lifecycle & State Machine
The agent progresses through a strict, finite state machine:
- `IDLE`: Initial dormant state awaiting user input.
- `PLANNING`: Initial prompt context sent to Gemini along with registered function declarations.
- `INSPECTING`: Model executing `list_files`, `search_code`, or `read_file` to understand workspace context.
- `EDITING`: Model calling `apply_patch` to create or update files on disk.
- `TESTING`: Model calling `run_tests` to execute allowlisted regression/test suites.
- `EXECUTING`: Model calling `run_code` to evaluate execution within the isolated Docker sandbox.
- `ANALYZING`: When a test failure is encountered, the agent transitions to analyze failure logs.
- `FIXING`: Subsequent self-repair patch applied to address test/execution failures.
- `COMPLETED`: Objective accomplished, diff finalized, summary reported.
- `FAILED`: Hard error encountered, rate limit reached, or invalid tool call made.
- `TIMED_OUT`: Total execution duration exceeded `agentTimeoutMs` (90s).
- `CANCELLED`: Execution aborted safely.

## 3. Gemini Configuration
All configuration parameters are centrally encapsulated in `AIConfig` (`src/lib/ai/config.js`). The browser never accesses credentials; `process.env.GEMINI_API_KEY` is strictly accessed server-side.

## 4. Provider Abstraction
The abstract base class `AIProvider` (`src/lib/ai/provider.js`) defines the contract (`sendMessage`, `isConfigured`). Concrete subclasses like `GeminiProvider` (`src/lib/ai/geminiProvider.js`) implement provider-specific protocols (Gemini function calling via `@google/generative-ai`), while supporting deterministic mock test handlers for CI.

## 5. Environment Variables
- `GEMINI_API_KEY`: Server-side API key for Google Generative AI (Placeholder only; never exposed).
- `GEMINI_MODEL`: Configurable Gemini model identifier (Defaults to `gemini-1.5-flash`).
- `AGENT_TEST_MOCK`: Explicit test-only flag enabling deterministic offline mock responses for CI/E2E without external network calls.

## 6. Model Configuration
Configured centrally via `AIConfig.model`:
- Default: `gemini-1.5-flash`
- Fallback / Alternatives: `gemini-1.5-pro`, `gemini-2.0-flash`
- Fully configurable via `GEMINI_MODEL` without code modifications.

## 7. Generation Settings
Deterministic settings optimized for code analysis and generation:
- `temperature`: `0.1` (minimizes hallucinations and ensures reproducible patches)
- `topP`: `0.95`
- `topK`: `40`
- `maxOutputTokens`: `4096`
- `requestTimeoutMs`: `45000` (45s per model generation turn)

## 8. Tool Registry
Seven strictly allowlisted tools are registered in `TOOL_REGISTRY` (`src/lib/ai/tools/registry.js`):
1. `list_files`: Explores directory tree bounded by `maxFilesToScan` (20).
2. `read_file`: Reads specific workspace files bounded by `maxFileSize` (128 KB).
3. `search_code`: Scans code identifiers returning bounded line numbers and snippets.
4. `get_git_diff`: Computes clean git diff of working tree changes.
5. `apply_patch`: Safe patch application with `expectedOldContent` verification.
6. `run_code`: Dispatches code execution to `ExecutionService` (Docker sandbox).
7. `run_tests`: Dispatches to allowlisted project test commands.

## 9. Tool Validation Pipeline
Every tool call proceeds through:
```
Gemini Function Call -> Schema Validation -> Authentication -> Workspace Authorization -> Path Validation -> Security Policy -> Execution
```
Unknown tools, invalid arguments, and path traversal attempts are rejected with controlled `AgentError` exceptions.

## 10. Workspace Context
Initial prompt context includes the user request, workspace ID, user role, and open tab list. Untrusted data is never injected directly into system instructions.

## 11. Repository Inspection
- `list_files`: Bounded to workspace directory, filters out `.git` and sensitive files.
- `search_code`: Ignores `node_modules` and `.git`, truncates snippets to 300 characters, caps total results at 30.
- `read_file`: Reads file content, sanitizes secrets, and wraps content in passive data boundaries.

## 12. Secret Redaction
`src/lib/ai/secretRedaction.js` scans and redacts:
- Google / Gemini API keys (`AIzaSy...`)
- Bearer authorization tokens
- Private key blocks (`-----BEGIN RSA PRIVATE KEY-----`)
- Generic high-entropy secret patterns (`apiKey`, `password`, `token`)
- Firebase configuration blocks
- Plaintext occurrences of environment variables in `process.env`

## 13. Prompt Injection Defense
- Strict policy hierarchy: `SYSTEM POLICY > USER REQUEST > REPOSITORY CONTENT / TOOL RESULTS`.
- Untrusted repository text is wrapped inside `<UNTRUSTED_REPOSITORY_DATA>` demarcation blocks.
- Agent system prompt explicitly prohibits following instructions embedded in source files.

## 14. Safe Patching
- Requires `file`, `patch`, and optional `expectedOldContent`.
- If `expectedOldContent` is supplied but does not match current disk content, `PATCH_CONFLICT` (HTTP 409) is thrown.
- Disallows silent overwrites of collaborator modifications.

## 15. Multi-File Editing
The agent orchestrator supports multi-file workflows in a single run. Multiple `apply_patch` calls are tracked in `runRecord.filesModified` and `runRecord.filesCreated`.

## 16. Yjs & Collaborative Safety
Prior to execution, the agent working tree synchronizes from Firestore (`syncFirestoreToWorkingTree`) and overlays in-memory live Monaco / Yjs edits from open tabs. After patching, disk changes are pushed back to Firestore (`syncWorkingTreeToFirestore`), ensuring all connected peers receive updates.

## 17. Git Integration
The agent integrates directly with the Phase 6 `GitService`:
- Ensures repository is initialized idempotently.
- Computes working tree diffs via `GitService.getDiff`.
- Never performs auto-commits: commits remain strictly user-initiated.

## 18. Docker Integration
The agent interacts with Docker exclusively through `ExecutionService.execute`. Direct access to the Docker socket, host filesystem, or raw shell is strictly prohibited. If Docker is offline, the fail-closed defense returns HTTP 503 `EXECUTIONSANDBOXUNAVAILABLE`.

## 19. Test Execution Allowlist
`run_tests` enforces a strict server-side allowlist:
- `test:execution`: Sandbox & execution security test suite
- `test:git`: Git version control test suite
- `test:security`: Security, auth & AI context test suite
- `test:collab`: Yjs collaboration test suite
Arbitrary commands (e.g. `rm -rf`, `curl`, `powershell`) are strictly rejected.

## 20. Self-Repair Engine
If a test run fails, the orchestrator:
1. Increments `iterations` counter.
2. Transitions state to `ANALYZING`.
3. Passes failure output back to the model.
4. Transitions state to `FIXING` upon patch generation.
5. Server hard-caps self-repair at 3 iterations (`AIConfig.limits.maxIterations`).

## 21. Timeout & Cancellation
- Overall agent run timeout: 90,000 ms (90 seconds).
- Individual tool / Gemini request timeout: 45,000 ms.
- Timed-out runs transition to `TIMED_OUT` and abort execution promises cleanly.

## 22. Rate Limiting & Concurrency
- `maxConcurrentRunsPerUser`: 1 (returns HTTP 409 if another run is active).
- `rateLimitPerUser`: 10 runs per 10-minute sliding window (returns HTTP 429).

## 23. Context Limits
- `maxFileSize`: 128 KB
- `maxTotalContextChars`: 40,000 characters
- `maxSearchResults`: 30
- `maxPatchBytes`: 128 KB

## 24. Safe Rollback
`SafeRollbackService` (`src/lib/ai/safeRollback.js`) maintains pre-run snapshots of touched files:
- Modified files are restored to their pre-run content.
- Newly created files are unlinked.
- Unrelated collaborator files and preexisting uncommitted changes are preserved.
- Never performs destructive `git reset --hard`.

## 25. Authentication & Authorization
- Uses `authenticateAndAuthorize` from Phase 6.
- `viewer` role is restricted to read-only tools (`list_files`, `read_file`, `search_code`, `get_git_diff`).
- `viewer` calling `apply_patch`, `run_code`, `run_tests`, or `rollback` receives HTTP 403 `WORKSPACE_ACCESS_DENIED`.

## 26. Agent UI
`AgentPanel.jsx`:
- Task prompt textarea and "Run Agent" button.
- Status badge reflecting live orchestrator states.
- Real-time activity log (tool actions and events).
- Changed files list with "View Diff" and "Rollback" buttons.
- Test execution results display.
- Final summary banner.

## 27. Error Handling
Unified error taxonomy via `AgentError` and `AgentErrorCodes`:
- `AGENT_UNAUTHORIZED` (401)
- `WORKSPACE_ACCESS_DENIED` (403)
- `FILE_ACCESS_DENIED` (403)
- `PATCH_CONFLICT` (409)
- `AGENT_LIMIT_EXCEEDED` (400)
- `AI_PROVIDER_NOT_CONFIGURED` (401/503)
- `AI_RATE_LIMITED` (429)
- `AI_PROVIDER_TIMEOUT` (504)
- Internal stack traces and secrets are never returned in JSON API responses.

## 28. Security Summary
- Defense-in-depth isolation: server-only API keys, path traversal validation, role-based tool authorization, passive prompt wrapping, sandbox code execution.

## 29. Testing Architecture
- Unit & Security Tests: `test/agent-security.test.js` (25 automated test cases)
- End-to-End Playwright: `e2e/agent.spec.js` (8 browser and API integration tests)
- Regression: Verified across Phase 5, 6, and 7 test suites.

## 30. Known Limitations
- Offline CI requires deterministic mock handler due to external Google API network/quota dependencies.
- Monolithic single-patch operations cannot exceed 128 KB.

## 31. Future Work
- Streaming token responses to the UI via Server-Sent Events (SSE).
- Interactive diff hunk acceptance (accept/reject individual changes).
