import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AIConfig } from "./config.js";
import { AgentError, AgentErrorCodes } from "./agentErrors.js";
import { GeminiProvider } from "./geminiProvider.js";
import { SYSTEM_AGENT_POLICY } from "./promptInjectionDefense.js";
import { TOOL_REGISTRY, ToolExecutor, getRegisteredToolDeclarations } from "./tools/registry.js";
import { GitService } from "../git/gitService.js";
import { getWorkspaceRepoDir, resolveSafePath } from "../git/security.js";
import { syncFirestoreToWorkingTree } from "../git/firestoreSync.js";
import { SafeRollbackService } from "./safeRollback.js";
import { redactSecrets } from "./secretRedaction.js";

export const AgentStates = {
  IDLE: "IDLE",
  PLANNING: "PLANNING",
  INSPECTING: "INSPECTING",
  EDITING: "EDITING",
  TESTING: "TESTING",
  EXECUTING: "EXECUTING",
  ANALYZING: "ANALYZING",
  FIXING: "FIXING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  TIMED_OUT: "TIMED_OUT",
};

// In-memory run store and concurrency tracker
const runCache = new Map(); // runId => runRecord
const userActiveRuns = new Map(); // userId => runId
const userRateLimits = new Map(); // userId => timestamp array

function checkRateLimit(userId) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const timestamps = (userRateLimits.get(userId) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= AIConfig.limits.rateLimitPerUser) {
    const oldest = timestamps[0] || now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    const err = new AgentError(
      AgentErrorCodes.AI_RATE_LIMITED,
      `User exceeded agent rate limit (${AIConfig.limits.rateLimitPerUser} requests per 10 minutes).`,
      429
    );
    err.retryAfterSeconds = retryAfterSeconds;
    throw err;
  }
  timestamps.push(now);
  userRateLimits.set(userId, timestamps);
}

export class AgentOrchestrator {
  /**
   * Dispatches and coordinates a coding agent workflow.
   *
   * @param {object} params
   * @param {string} params.task
   * @param {string} params.workspaceId
   * @param {string} params.userId
   * @param {"owner"|"contributor"|"viewer"} params.userRole
   * @param {Array<object>} [params.openFiles]
   * @param {AIProvider} [params.aiProvider]
   * @param {string} [params.token]
   * @returns {Promise<object>}
   */
  static async run({
    task,
    workspaceId,
    userId,
    userRole,
    openFiles = [],
    activeFile = null,
    selectedCode = "",
    diagnostics = [],
    aiProvider = null,
    token = null,
  }) {
    if (!task || typeof task !== "string" || !task.trim()) {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, "Missing or empty task prompt", 400);
    }
    if (!workspaceId) {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, "Missing workspaceId", 400);
    }
    if (!userId) {
      throw new AgentError(AgentErrorCodes.AGENT_UNAUTHORIZED, "Missing userId authentication", 401);
    }

    // Check concurrency
    if (userActiveRuns.has(userId)) {
      throw new AgentError(
        AgentErrorCodes.AGENT_LIMIT_EXCEEDED,
        "Another agent task is already running for this user. Please wait for it to complete.",
        409
      );
    }

    // Check rate limit
    checkRateLimit(userId);

    const runId = `run_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    userActiveRuns.set(userId, runId);

    const runRecord = {
      runId,
      workspaceId,
      userId,
      userRole,
      task: task.trim(),
      status: AgentStates.PLANNING,
      startedAt: new Date().toISOString(),
      completedAt: null,
      filesRead: [],
      filesModified: [],
      filesCreated: [],
      filesDeleted: [],
      executionIds: [],
      executionCalls: 0,
      totalToolCalls: 0,
      iterations: 0,
      testsRun: [],
      gitDiffSummary: null,
      activityLog: [],
      preRunSnapshots: new Map(),
      summary: "",
      error: null,
    };

    runCache.set(runId, runRecord);

    const logActivity = (action, detail = "") => {
      const entry = {
        time: new Date().toISOString(),
        action,
        detail,
        iteration: runRecord.iterations,
        state: runRecord.status,
      };
      runRecord.activityLog.push(entry);
    };

    logActivity("Agent started", "Analyzing user coding request");

    const provider = aiProvider || new GeminiProvider();

    // Timeout guard
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        runRecord.status = AgentStates.TIMED_OUT;
        logActivity("Agent timed out", `Exceeded timeout of ${AIConfig.limits.agentTimeoutMs / 1000}s`);
        reject(new AgentError(AgentErrorCodes.AGENT_TIMEOUT, "Agent run exceeded server timeout limit", 504));
      }, AIConfig.limits.agentTimeoutMs);
    });

    try {
      const executionPromise = (async () => {
        // Synchronize latest Firestore documents to working tree
        await syncFirestoreToWorkingTree(workspaceId, token).catch((err) => {
          console.warn("[AgentOrchestrator] Firestore sync notice:", err.message);
        });

        // Overlay current in-memory / Yjs / Monaco editor content from open tabs
        if (Array.isArray(openFiles) && openFiles.length > 0) {
          const repoDir = getWorkspaceRepoDir(workspaceId);
          for (const openFile of openFiles) {
            const relPath = openFile.path || openFile.name;
            if (relPath && typeof openFile.content === "string") {
              try {
                const { fullPath } = resolveSafePath(repoDir, relPath);
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                fs.writeFileSync(fullPath, openFile.content.replace(/\r\n/g, "\n"), "utf8");
              } catch (err) {
                console.warn("[AgentOrchestrator] Failed applying live tab content:", err.message);
              }
            }
          }
        }

        // Initialize Git repo if needed
        if (!GitService.isRepositoryInitialized(workspaceId)) {
          await GitService.initializeRepository(workspaceId, {
            initialCommitMessage: "Initial workspace commit prior to AI agent run",
          }).catch((err) => {
            console.warn("[AgentOrchestrator] Git init notice:", err.message);
          });
        }

        const registeredTools = getRegisteredToolDeclarations();
        const history = [];

        // Build initial context message
        let initialPrompt = `User Request: ${task.trim()}\n\nAuthorized Workspace ID: ${workspaceId}\nUser Role: ${userRole}`;
        if (activeFile) {
          const activeName = activeFile.path || activeFile.name || (typeof activeFile === "string" ? activeFile : null);
          if (activeName) {
            initialPrompt += `\nActive File: ${activeName}`;
          }
        }
        if (selectedCode && typeof selectedCode === "string" && selectedCode.trim()) {
          initialPrompt += `\nUser Selected Editor Code:\n\`\`\`\n${selectedCode.trim().slice(0, 4000)}\n\`\`\``;
        }
        if (Array.isArray(diagnostics) && diagnostics.length > 0) {
          const diagList = diagnostics.slice(0, 10).map((d) =>
            `[${d.severity || "INFO"}] line ${d.startLineNumber ?? "?"}: ${d.message}`
          ).join("\n");
          initialPrompt += `\nActive Editor Problems / Diagnostics:\n${diagList}`;
        }
        if (Array.isArray(openFiles) && openFiles.length > 0) {
          const tabNames = openFiles.map((f) => f.name || f.path).filter(Boolean).join(", ");
          initialPrompt += `\nCurrently Open Tabs: ${tabNames}`;
        }

        runRecord.status = AgentStates.PLANNING;
        logActivity("Planning approach", "Consulting Gemini with available tools");

        let currentMessage = initialPrompt;
        let isComplete = false;

        while (!isComplete) {
          if (runRecord.totalToolCalls >= AIConfig.limits.maxToolCalls) {
            throw new AgentError(
              AgentErrorCodes.AGENT_LIMIT_EXCEEDED,
              `Exceeded maximum allowed tool calls (${AIConfig.limits.maxToolCalls})`,
              400
            );
          }

          const response = await provider.sendMessage({
            systemInstruction: SYSTEM_AGENT_POLICY,
            tools: registeredTools,
            history,
            message: currentMessage,
          });

          // Append to conversation history
          if (Array.isArray(currentMessage)) {
            history.push({
              role: "user",
              parts: currentMessage,
            });
          } else if (currentMessage?.functionResponse) {
            history.push({
              role: "user",
              parts: [{ functionResponse: currentMessage.functionResponse }],
            });
          } else {
            history.push({
              role: "user",
              parts: [{ text: typeof currentMessage === "string" ? currentMessage : JSON.stringify(currentMessage) }],
            });
          }

          const toolCalls = response.toolCalls || [];

          if (toolCalls.length > 0) {
            // Process tool calls
            const toolResults = [];

            for (const toolCall of toolCalls) {
              runRecord.totalToolCalls++;
              const toolName = toolCall.name;
              const toolArgs = toolCall.args || {};

              // Update agent state according to tool type
              if (["list_files", "search_code", "get_git_diff"].includes(toolName)) {
                runRecord.status = AgentStates.INSPECTING;
                logActivity(
                  toolName === "search_code"
                    ? `Searching repository for "${toolArgs.query || ""}"`
                    : `Inspecting repository (${toolName})`
                );
              } else if (toolName === "read_file") {
                runRecord.status = AgentStates.INSPECTING;
                logActivity(`Reading ${toolArgs.path || "file"}`);
              } else if (toolName === "apply_patch") {
                runRecord.status = runRecord.iterations > 0 ? AgentStates.FIXING : AgentStates.EDITING;
                logActivity(`Applying patch to ${toolArgs.file || "file"}`);
              } else if (toolName === "run_code") {
                runRecord.status = AgentStates.EXECUTING;
                logActivity(`Executing code in sandbox (${toolArgs.language || ""})`);
              } else if (toolName === "run_tests") {
                runRecord.status = AgentStates.TESTING;
                logActivity(`Running test suite: ${toolArgs.testName || ""}`);
              }

              let executionResult;
              try {
                executionResult = await ToolExecutor.executeTool({
                  name: toolName,
                  args: toolArgs,
                  workspaceId,
                  userId,
                  userRole,
                  runRecord,
                });
              } catch (toolErr) {
                executionResult = {
                  error: toolErr.message || String(toolErr),
                  code: toolErr.code || "TOOL_ERROR",
                };
                logActivity(`Tool error (${toolName})`, toolErr.message);
              }

              // Check if tests ran and failed -> enter self-repair loop
              if (toolName === "run_tests") {
                if (!executionResult.passed) {
                  runRecord.iterations++;
                  if (runRecord.iterations > AIConfig.limits.maxIterations) {
                    throw new AgentError(
                      AgentErrorCodes.AGENT_LIMIT_EXCEEDED,
                      `Self-repair limit reached: tests still failing after ${AIConfig.limits.maxIterations} iterations.`,
                      400
                    );
                  }
                  runRecord.status = AgentStates.ANALYZING;
                  logActivity(
                    `Test failed (Iteration ${runRecord.iterations}/${AIConfig.limits.maxIterations})`,
                    "Analyzing failure and planning fix"
                  );
                } else {
                  logActivity("Tests passed successfully");
                }
              }

              toolResults.push({
                functionResponse: {
                  name: toolName,
                  response: executionResult,
                },
              });
            }

            // Append assistant call and pass tool results as next message
            history.push({
              role: "model",
              parts: response.candidateParts || toolCalls.map((tc) => ({ functionCall: tc })),
            });

            currentMessage = toolResults;
          } else {
            // Model finished calling tools and returned final textual summary
            runRecord.summary = redactSecrets(response.text || "").trim();
            isComplete = true;
          }
        }

        // Final Git Diff computation
        try {
          if (GitService.isRepositoryInitialized(workspaceId)) {
            const diffData = await GitService.getDiff(workspaceId);
            runRecord.gitDiffSummary = {
              diff: diffData.diff || "",
              hasChanges: Boolean(diffData.diff && diffData.diff.trim().length > 0),
            };
          }
        } catch (err) {
          console.warn("[AgentOrchestrator] Git diff computation notice:", err.message);
        }

        runRecord.status = AgentStates.COMPLETED;
        runRecord.completedAt = new Date().toISOString();
        logActivity("Completed", "Agent successfully finished requested task");

        return {
          runId,
          status: runRecord.status,
          summary: runRecord.summary || "Task finished successfully.",
          filesModified: runRecord.filesModified,
          filesCreated: runRecord.filesCreated,
          filesRead: runRecord.filesRead,
          testsRun: runRecord.testsRun,
          iterations: runRecord.iterations,
          totalToolCalls: runRecord.totalToolCalls,
          gitDiffSummary: runRecord.gitDiffSummary,
          activityLog: runRecord.activityLog,
        };
      })();

      return await Promise.race([executionPromise, timeoutPromise]);
    } catch (error) {
      runRecord.status =
        runRecord.status === AgentStates.TIMED_OUT
          ? AgentStates.TIMED_OUT
          : AgentStates.FAILED;
      runRecord.error = error.message;
      runRecord.completedAt = new Date().toISOString();
      logActivity("Agent failed", error.message);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      userActiveRuns.delete(userId);
    }
  }

  /**
   * Retrieves a run record by runId.
   */
  static getRun(runId) {
    return runCache.get(runId) || null;
  }

  /**
   * Performs safe rollback of an agent run.
   */
  static async rollback(runId, workspaceId, userRole) {
    if (userRole === "viewer") {
      throw new AgentError(
        AgentErrorCodes.WORKSPACE_ACCESS_DENIED,
        "Viewer role is not authorized to rollback changes",
        403
      );
    }

    const runRecord = this.getRun(runId);
    if (!runRecord) {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, `Agent run '${runId}' not found`, 404);
    }

    if (runRecord.workspaceId !== workspaceId) {
      throw new AgentError(
        AgentErrorCodes.WORKSPACE_ACCESS_DENIED,
        "Run record belongs to a different workspace",
        403
      );
    }

    const result = await SafeRollbackService.rollbackRun(workspaceId, runRecord);
    runRecord.rolledBack = true;
    runRecord.activityLog.push({
      time: new Date().toISOString(),
      action: "Rollback executed",
      detail: `Restored ${result.restoredFiles.length} files, removed ${result.removedFiles.length} files`,
    });

    return result;
  }
}
