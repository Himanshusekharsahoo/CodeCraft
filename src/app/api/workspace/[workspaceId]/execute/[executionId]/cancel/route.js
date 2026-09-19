import { ExecutionService } from "@/lib/execution/executionService.js";
import { authenticateAndAuthorizeExecution } from "@/lib/execution/executionAuth.js";
import { jsonSuccess, jsonError } from "@/lib/execution/apiResponse.js";

export async function POST(request, context) {
  try {
    const params = await context.params;
    const { workspaceId, executionId } = params || {};

    const user = await authenticateAndAuthorizeExecution(request, workspaceId, "EXECUTE");

    const cancelled = ExecutionService.cancel(executionId, user.uid, workspaceId);
    if (!cancelled) {
      return jsonSuccess({
        cancelled: false,
        message: "Execution is not currently running or has already finished",
      });
    }

    return jsonSuccess({
      cancelled: true,
      executionId,
      status: "CANCELLED",
    });
  } catch (error) {
    return jsonError(error);
  }
}
