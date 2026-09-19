import { GitService } from "@/lib/git/gitService.js";
import { authenticateAndAuthorize } from "@/lib/git/gitAuth.js";
import { syncFirestoreToWorkingTree } from "@/lib/git/firestoreSync.js";
import { jsonSuccess, jsonError } from "@/lib/git/apiResponse.js";

async function handleDiff(request, workspaceId, paramsObj, token = null) {
  const shouldSync = paramsObj.sync !== false && paramsObj.sync !== "false";
  if (shouldSync) {
    await syncFirestoreToWorkingTree(workspaceId, token);
  }

  const diff = await GitService.getDiff(workspaceId, {
    filePath: paramsObj.filePath || paramsObj.file,
    staged: paramsObj.staged === true || paramsObj.staged === "true",
    commitHash: paramsObj.commitHash || paramsObj.commit,
    compareHash: paramsObj.compareHash || paramsObj.compare,
  });

  return jsonSuccess({ diff });
}

export async function GET(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;

    const user = await authenticateAndAuthorize(request, workspaceId, "READ");

    const url = new URL(request.url);
    const paramsObj = {
      filePath: url.searchParams.get("filePath") || url.searchParams.get("file"),
      staged: url.searchParams.get("staged"),
      commitHash: url.searchParams.get("commitHash") || url.searchParams.get("commit"),
      compareHash: url.searchParams.get("compareHash") || url.searchParams.get("compare"),
      sync: url.searchParams.get("sync"),
    };

    return await handleDiff(request, workspaceId, paramsObj, user?.token);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params.workspaceId;

    const user = await authenticateAndAuthorize(request, workspaceId, "READ");

    let body = {};
    try {
      body = await request.json();
    } catch {
      // Body optional
    }

    return await handleDiff(request, workspaceId, body, user?.token);
  } catch (error) {
    return jsonError(error);
  }
}
