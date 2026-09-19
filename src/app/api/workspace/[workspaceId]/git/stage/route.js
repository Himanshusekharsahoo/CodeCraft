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
      // empty body
    }

    // Always sync Firestore to disk before staging to capture recent editor changes
    await syncFirestoreToWorkingTree(workspaceId, user?.token);

    const filesToStage = body.files || (body.all ? "." : ".");
    const result = await GitService.stageFiles(workspaceId, filesToStage);

    return jsonSuccess({ staged: result });
  } catch (error) {
    return jsonError(error);
  }
}
