import { GitService } from "@/lib/git/gitService.js";
import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { jsonSuccess, jsonError } from "@/lib/git/apiResponse.js";
import { GitError, GitErrorCodes } from "@/lib/git/errors.js";

export async function POST(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;

    const user = await authenticateAndAuthorize(request, workspaceId, "MUTATE");

    let body = {};
    try {
      body = await request.json();
    } catch {
      throw new GitError(GitErrorCodes.INVALID_ARGUMENT, "Missing request body", 400);
    }

    if (!body?.message || typeof body.message !== "string" || !body.message.trim()) {
      throw new GitError(GitErrorCodes.INVALID_ARGUMENT, "Commit message cannot be empty", 400);
    }

    const author = {
      name: body.author?.name || user.displayName || "CodeCraft User",
      email: body.author?.email || user.email || "user@codecraft.local",
    };

    const commitResult = await GitService.createCommit(workspaceId, {
      message: body.message,
      author,
    });

    return jsonSuccess({ commit: commitResult });
  } catch (error) {
    return jsonError(error);
  }
}
