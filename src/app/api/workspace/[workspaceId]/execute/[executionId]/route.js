import { ExecutionService } from "@/lib/execution/executionService.js";
import { authenticateAndAuthorizeExecution } from "@/lib/execution/executionAuth.js";
import { jsonSuccess, jsonError } from "@/lib/execution/apiResponse.js";
import { ExecutionError, ExecutionErrorCodes } from "@/lib/execution/errors.js";

export async function GET(request, context) {
  try {
    const params = await context.params;
    const { workspaceId, executionId } = params || {};

    await authenticateAndAuthorizeExecution(request, workspaceId, "READ");

    const status = ExecutionService.getStatus(executionId);
    if (!status) {
      throw new ExecutionError(
        ExecutionErrorCodes.NOT_FOUND,
        `Execution session '${executionId}' was not found or has expired`,
        404
      );
    }

    // CC-010: Prevent cross-workspace IDOR — execution must belong to the requested workspace
    if (status.workspaceId && status.workspaceId !== workspaceId) {
      throw new ExecutionError(
        ExecutionErrorCodes.NOT_FOUND,
        `Execution session '${executionId}' was not found or has expired`,
        404
      );
    }

    return jsonSuccess({
      executionId,
      ...status,
    });
  } catch (error) {
    return jsonError(error);
  }
}
