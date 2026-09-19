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

    const filePath = body.file || body.filePath;
    if (!filePath) {
      throw new GitError(GitErrorCodes.INVALID_PATH, "Missing file path in request body", 400);
    }

    const result = await GitService.resolveConflict(workspaceId, filePath, body.content);

    // Update Firestore with the resolved file content
    await syncWorkingTreeToFirestore(workspaceId, user?.token);

    return jsonSuccess({ result });
  } catch (error) {
    return jsonError(error);
  }
}
