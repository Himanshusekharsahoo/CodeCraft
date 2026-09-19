import { GitService } from "@/lib/git/gitService.js";
import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { jsonSuccess, jsonError } from "@/lib/git/apiResponse.js";

export async function POST(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;

    await authenticateAndAuthorize(request, workspaceId, "MUTATE");

    let body = {};
    try {
      body = await request.json();
    } catch {
      // empty body
    }

    const filesToUnstage = body.files || (body.all ? "." : ".");
    const result = await GitService.unstageFiles(workspaceId, filesToUnstage);

    return jsonSuccess({ unstaged: result });
  } catch (error) {
    return jsonError(error);
  }
}
