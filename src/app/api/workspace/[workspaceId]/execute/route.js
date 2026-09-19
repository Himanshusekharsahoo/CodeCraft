import { ExecutionService } from "@/lib/execution/executionService.js";
import { authenticateAndAuthorizeExecution } from "@/lib/execution/executionAuth.js";
import { jsonSuccess, jsonError } from "@/lib/execution/apiResponse.js";
import { ExecutionError, ExecutionErrorCodes } from "@/lib/execution/errors.js";
import { logExecutionEvent, createRequestId } from "@/lib/observability.js";

export async function POST(request, context) {
  const startTime = Date.now();
  const requestId = createRequestId("exec");
  let workspaceId = null;
  let user = null;
  let language = null;

  try {
    const params = await context.params;
    workspaceId = params?.workspaceId;

    user = await authenticateAndAuthorizeExecution(request, workspaceId, "EXECUTE");

    let body;
    try {
      body = await request.json();
    } catch {
      throw new ExecutionError(
        ExecutionErrorCodes.INVALID_REQUEST,
        "Invalid JSON request body",
        400
      );
    }

    const {
      language: reqLang,
      sourceCode,
      source,
      files,
      stdin,
      entrypoint,
      provider,
      executionId: clientExecutionId,
    } = body || {};

    // CC-013: Validate caller-provided executionId for early lifecycle availability & cancellation
    const headerExecId = request.headers.get("x-execution-id");
    const candidateExecId = clientExecutionId || headerExecId || null;
    let validatedExecutionId = undefined;
    if (candidateExecId) {
      if (typeof candidateExecId !== "string" || !/^[a-zA-Z0-9_\-]{8,64}$/.test(candidateExecId)) {
        throw new ExecutionError(
          ExecutionErrorCodes.INVALID_REQUEST,
          "Invalid executionId format. Must be alphanumeric with hyphens or underscores (8-64 chars)",
          400
        );
      }
      validatedExecutionId = candidateExecId;
    }

    language = reqLang;
    const effectiveSource = source ?? sourceCode;

    const result = await ExecutionService.execute({
      language,
      source: effectiveSource,
      files,
      stdin,
      entrypoint,
      workspaceId,
      userId: user.uid,
      provider,
      executionId: validatedExecutionId,
    });

    logExecutionEvent({
      event: "EXECUTION_COMPLETED",
      requestId,
      workspaceId,
      userId: user.uid,
      executionId: result.executionId,
      language,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: Date.now() - startTime,
      outputTruncated: Boolean(result.outputTruncated),
    });

    return jsonSuccess({
      result,
      executionId: result.executionId,
      status: result.status,
      requestId,
    });
  } catch (error) {
    logExecutionEvent({
      event: "EXECUTION_FAILED",
      requestId,
      workspaceId,
      userId: user?.uid,
      language,
      status: "ERROR",
      durationMs: Date.now() - startTime,
      errorCategory: error.code || "INTERNAL_ERROR",
    });
    return jsonError(error);
  }
}
