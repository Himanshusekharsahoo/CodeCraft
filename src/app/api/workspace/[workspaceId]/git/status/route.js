import { GitService } from "@/lib/git/gitService.js";
import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { syncFirestoreToWorkingTree } from "@/lib/git/firestoreSync.js";
import { jsonSuccess, jsonError } from "@/lib/git/apiResponse.js";

export async function GET(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;

    const user = await authenticateAndAuthorize(request, workspaceId, "READ");

    const url = new URL(request.url);
    const shouldSync = url.searchParams.get("sync") !== "false";

    if (GitService.isRepositoryInitialized(workspaceId)) {
      if (shouldSync) {
        await syncFirestoreToWorkingTree(workspaceId, user?.token);
      }
      const status = await GitService.getStatus(workspaceId);
      return jsonSuccess({ status });
    }

    return jsonSuccess({
      status: {
        initialized: false,
        branch: null,
        commit: null,
        isClean: true,
        staged: [],
        unstaged: [],
        untracked: [],
        conflicts: [],
        ahead: 0,
        behind: 0,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
