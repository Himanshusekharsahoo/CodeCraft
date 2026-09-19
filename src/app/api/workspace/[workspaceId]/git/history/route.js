import { GitService } from "@/lib/git/gitService.js";
import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { jsonSuccess, jsonError } from "@/lib/git/apiResponse.js";

export async function GET(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;

    await authenticateAndAuthorize(request, workspaceId, "READ");

    const url = new URL(request.url);
    const branch = url.searchParams.get("branch") || undefined;
    const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit"), 10) : 50;
    const skip = url.searchParams.get("skip") ? parseInt(url.searchParams.get("skip"), 10) : 0;
    const filePath = url.searchParams.get("filePath") || url.searchParams.get("file") || undefined;

    const history = await GitService.getHistory(workspaceId, {
      branch,
      limit,
      skip,
      filePath,
    });

    return jsonSuccess({ history });
  } catch (error) {
    return jsonError(error);
  }
}
