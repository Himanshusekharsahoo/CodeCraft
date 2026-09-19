import { GitService } from "@/lib/git/gitService.js";
import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { jsonSuccess, jsonError } from "@/lib/git/apiResponse.js";
import { GitError, GitErrorCodes } from "@/lib/git/errors.js";

export async function GET(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;

    await authenticateAndAuthorize(request, workspaceId, "READ");

    const branches = await GitService.listBranches(workspaceId);
    return jsonSuccess({ branches });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;

    await authenticateAndAuthorize(request, workspaceId, "MUTATE");

    let body = {};
    try {
      body = await request.json();
    } catch {
      throw new GitError(GitErrorCodes.INVALID_ARGUMENT, "Missing request body", 400);
    }

    if (!body?.branchName) {
      throw new GitError(GitErrorCodes.INVALID_BRANCH_NAME, "Missing branchName in request body", 400);
    }

    const branch = await GitService.createBranch(workspaceId, body.branchName, body.startPoint);

    return jsonSuccess({ branch });
  } catch (error) {
    return jsonError(error);
  }
}
