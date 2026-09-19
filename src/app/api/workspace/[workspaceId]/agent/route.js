import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { AgentOrchestrator } from "@/lib/ai/agentOrchestrator.js";
import { jsonSuccess, jsonError } from "@/lib/ai/apiResponse.js";
import { AgentError, AgentErrorCodes } from "@/lib/ai/agentErrors.js";
import { logAgentEvent, createRequestId } from "@/lib/observability.js";

export async function POST(request, context) {
  const startTime = Date.now();
  const requestId = createRequestId("agent");
  let workspaceId = null;
  let user = null;

  try {
    const params = await context.params;
    workspaceId = params?.workspaceId;

    if (!workspaceId) {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, "Missing workspaceId in agent request", 400);
    }

    user = await authenticateAndAuthorize(request, workspaceId, "READ");

    let body;
    try {
      body = await request.json();
    } catch {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, "Invalid JSON request body", 400);
    }

    const { task, openFiles, activeFile, selectedCode, diagnostics } = body || {};
    if (!task || typeof task !== "string" || !task.trim()) {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, "A non-empty 'task' description is required", 400);
    }

    const result = await AgentOrchestrator.run({
      task,
      workspaceId,
      userId: user.uid,
      userRole: user.role,
      token: user.token,
      openFiles: Array.isArray(openFiles) ? openFiles : [],
      activeFile: activeFile || null,
      selectedCode: typeof selectedCode === "string" ? selectedCode : "",
      diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
    });

    logAgentEvent({
      event: "AGENT_RUN_COMPLETED",
      requestId,
      workspaceId,
      userId: user.uid,
      runId: result.runId,
      state: result.status,
      durationMs: Date.now() - startTime,
      filesInspected: result.filesRead || [],
      filesModified: result.patchesApplied ? [result.patchesApplied.fileId] : [],
      iterationCount: result.iterations ?? 0,
      executionResult: result.executionResult?.status || null,
      testResult: result.testResult?.status || null,
      message: result.summary || "Agent run finished",
    });

    return jsonSuccess({
      result,
      runId: result.runId,
      status: result.status,
      requestId,
    });
  } catch (error) {
    logAgentEvent({
      event: "AGENT_RUN_FAILED",
      requestId,
      workspaceId: workspaceId || "unknown",
      userId: user?.uid,
      state: "FAILED",
      durationMs: Date.now() - startTime,
      errorCategory: error.code || "AGENT_ERROR",
      message: error.message || "Agent execution failed",
    });
    return jsonError(error);
  }
}

export async function GET(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params?.workspaceId;

    if (!workspaceId) {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, "Missing workspaceId", 400);
    }

    await authenticateAndAuthorize(request, workspaceId, "READ");

    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");

    if (runId) {
      const run = AgentOrchestrator.getRun(runId);
      if (!run || run.workspaceId !== workspaceId) {
        throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, `Run '${runId}' not found`, 404);
      }
      return jsonSuccess({ run });
    }

    return jsonSuccess({ message: "Agent service ready", workspaceId });
  } catch (error) {
    return jsonError(error);
  }
}
