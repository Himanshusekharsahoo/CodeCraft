import { GitService } from "@/lib/git/gitService.js";
import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { jsonSuccess, jsonError } from "@/lib/git/apiResponse.js";

export async function GET(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;
    const commitHash = params.commitHash;

    await authenticateAndAuthorize(request, workspaceId, "READ");

    const commit = await GitService.getCommitDetails(workspaceId, commitHash);

    return jsonSuccess({ commit });
  } catch (error) {
    return jsonError(error);
  }
}
