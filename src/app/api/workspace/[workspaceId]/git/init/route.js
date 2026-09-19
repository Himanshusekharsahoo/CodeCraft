import { GitService } from "@/lib/git/gitService.js";
import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { syncFirestoreToWorkingTree } from "@/lib/git/firestoreSync.js";
import { jsonSuccess, jsonError } from "@/lib/git/apiResponse.js";

export async function POST(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;

    const user = await authenticateAndAuthorize(request, workspaceId, "MUTATE");

    let body = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional
    }

    // Attempt to sync any existing files into working tree before initial commit
    await syncFirestoreToWorkingTree(workspaceId, user?.token);

    const result = await GitService.initializeRepository(workspaceId, {
      defaultBranch: body.defaultBranch || "main",
      initialCommitMessage: body.initialCommitMessage,
      initialFiles: body.initialFiles,
    });

    return jsonSuccess({ result });
  } catch (error) {
    return jsonError(error);
  }
}
