import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { AgentOrchestrator } from "@/lib/ai/agentOrchestrator.js";
import { jsonSuccess, jsonError } from "@/lib/ai/apiResponse.js";
import { AgentError, AgentErrorCodes } from "@/lib/ai/agentErrors.js";

export async function POST(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params?.workspaceId;

    if (!workspaceId) {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, "Missing workspaceId", 400);
    }

    const user = await authenticateAndAuthorize(request, workspaceId, "MUTATE");

    let body;
    try {
      body = await request.json();
    } catch {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, "Invalid JSON request body", 400);
    }

    const { runId } = body || {};
    if (!runId || typeof runId !== "string") {
      throw new AgentError(AgentErrorCodes.AGENT_INVALID_REQUEST, "Missing 'runId' parameter for rollback", 400);
    }

    const result = await AgentOrchestrator.rollback(runId, workspaceId, user.role);

    return jsonSuccess({
      result,
      rolledBack: true,
      message: `Successfully rolled back changes from run '${runId}'`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
