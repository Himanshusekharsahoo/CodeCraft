import { GitService } from "@/lib/git/gitService.js";
import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { syncWorkingTreeToFirestore } from "@/lib/git/firestoreSync.js";
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

    if (body.abort) {
      const abortResult = await GitService.abortMerge(workspaceId);
      await syncWorkingTreeToFirestore(workspaceId, user?.token);
      return jsonSuccess({ result: abortResult });
    }

    if (!body.sourceBranch) {
      throw new GitError(GitErrorCodes.INVALID_BRANCH_NAME, "Missing sourceBranch in request body", 400);
    }

    const mergeResult = await GitService.mergeBranch(workspaceId, body.sourceBranch, {
      noFf: Boolean(body.noFf),
      author: {
        name: user.displayName || "CodeCraft User",
        email: user.email || "user@codecraft.local",
      },
    });

    // Update Firestore with the merged state
    await syncWorkingTreeToFirestore(workspaceId, user?.token);

    return jsonSuccess({ result: mergeResult });
  } catch (error) {
    return jsonError(error);
  }
}
