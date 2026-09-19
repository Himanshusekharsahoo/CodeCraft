import { GitService } from "@/lib/git/gitService.js";
import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { jsonSuccess, jsonError } from "@/lib/git/apiResponse.js";

export async function DELETE(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;
    const branchName = decodeURIComponent(params.branchName);

    await authenticateAndAuthorize(request, workspaceId, "MUTATE");

    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "true";

    const result = await GitService.deleteBranch(workspaceId, branchName, { force });

    return jsonSuccess({ result });
  } catch (error) {
    return jsonError(error);
  }
}
