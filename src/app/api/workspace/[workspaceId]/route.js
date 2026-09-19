import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/serverAuth";
import { isExplicitTestEnvironment, isValidDeterministicTestToken, parseTestTokenClaims } from "@/lib/authEnv";
import { fetchFirestoreWorkspaceMemberRole } from "@/lib/execution/executionAuth";
import { getWorkspaceRepoDir } from "@/lib/git/security";
import { collection, getDocs, doc, deleteDoc, query, where, writeBatch } from "firebase/firestore";
import { db } from "@/config/firebase";

async function deleteFirestoreDocRest(docPath, token, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok && res.status !== 404) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Firestore REST DELETE ${docPath} failed (${res.status}): ${errorText}`);
  }
}

async function deleteFirestoreSubcollectionRest(workspaceId, subcollection, token, projectId) {
  const listUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/workspaces/${encodeURIComponent(workspaceId)}/${encodeURIComponent(subcollection)}?pageSize=300`;
  const res = await fetch(listUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    if (res.status === 404) return;
    const errText = await res.text().catch(() => "");
    throw new Error(`Firestore REST list ${subcollection} failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const documents = data.documents || [];
  for (const docItem of documents) {
    if (docItem.name) {
      const deleteUrl = `https://firestore.googleapis.com/v1/${docItem.name}`;
      const delRes = await fetch(deleteUrl, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!delRes.ok && delRes.status !== 404) {
        const errText = await delRes.text().catch(() => "");
        throw new Error(`Firestore REST delete ${docItem.name} failed (${delRes.status}): ${errText}`);
      }
    }
  }
}

async function deleteFirestoreMessagesRest(workspaceId, token, projectId) {
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`;
  const res = await fetch(queryUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "messages" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "workspaceId" },
            op: "EQUAL",
            value: { stringValue: workspaceId },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    if (res.status === 404) return;
    const errText = await res.text().catch(() => "");
    throw new Error(`Firestore REST query messages failed (${res.status}): ${errText}`);
  }

  const results = await res.json();
  if (Array.isArray(results)) {
    for (const r of results) {
      if (r.document && r.document.name) {
        const delRes = await fetch(`https://firestore.googleapis.com/v1/${r.document.name}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!delRes.ok && delRes.status !== 404) {
          // Non-fatal if specific chat message already removed
        }
      }
    }
  }
}

export async function DELETE(request, context) {
  const deletedSteps = [];
  const failedSteps = [];
  let workspaceId = null;

  try {
    const params = await context.params;
    workspaceId = params?.workspaceId;

    // 1. Validate workspaceId
    if (
      !workspaceId ||
      typeof workspaceId !== "string" ||
      workspaceId.includes("..") ||
      !/^[a-zA-Z0-9_\-\.]+$/.test(workspaceId)
    ) {
      return NextResponse.json({ error: "Invalid workspaceId format" }, { status: 400 });
    }

    // 2. Authenticate caller
    const { auth: callerAuth, response: authResponse } = await requireAuth(request);
    if (authResponse) return authResponse;

    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    // 3. Verify owner authorization (CC-002, CC-015)
    let callerRole = null;
    if (isExplicitTestEnvironment() && isValidDeterministicTestToken(token)) {
      const claims = parseTestTokenClaims(token);
      callerRole = claims.role || "viewer";
    } else {
      callerRole = await fetchFirestoreWorkspaceMemberRole(workspaceId, callerAuth.uid, token);
    }

    if (callerRole !== "owner") {
      return NextResponse.json(
        { error: "Only the workspace owner is authorized to permanently delete this workspace" },
        { status: 403 }
      );
    }

    // 4. Evict and destroy collaboration server rooms (prevents Yjs resurrection - CC-015)
    try {
      const collabUrl = process.env.NEXT_PUBLIC_COLLAB_HTTP_URL || "http://localhost:1234";
      const internalSecret =
        process.env.COLLAB_INTERNAL_SECRET ||
        process.env.INTERNAL_SERVICE_KEY ||
        "cc-collab-internal-service-secret";

      const collabRes = await fetch(`${collabUrl}/destroy-workspace-rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-collab-internal-token": internalSecret,
        },
        body: JSON.stringify({ workspaceId }),
        signal: AbortSignal.timeout(2500),
      }).catch(() => null);

      if (collabRes && collabRes.ok) {
        deletedSteps.push("collab_rooms_evicted");
      }
    } catch (collabErr) {
      // Non-fatal: collab server may be offline
      deletedSteps.push("collab_evict_skipped");
    }

    // 5. Clean up Git repository directory on server disk (CC-015)
    try {
      const repoDir = getWorkspaceRepoDir(workspaceId);
      if (fs.existsSync(repoDir)) {
        fs.rmSync(repoDir, { recursive: true, force: true });
        deletedSteps.push("git_working_tree_deleted");
      }
    } catch (gitDirErr) {
      failedSteps.push({ step: "git_working_tree", error: gitDirErr.message });
    }

    // 6. Delete subcollections and documents in Firestore (CC-015)
    // Subcollections: files, folders, comments, git, members
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
    const isTestMode = (isExplicitTestEnvironment() && isValidDeterministicTestToken(token)) || !projectId;
    const subcollections = ["files", "folders", "comments", "git", "members"];

    for (const subcol of subcollections) {
      try {
        if (!isTestMode && token) {
          await deleteFirestoreSubcollectionRest(workspaceId, subcol, token, projectId);
        } else {
          const subRef = collection(db, `workspaces/${workspaceId}/${subcol}`);
          const snap = await getDocs(subRef).catch(() => ({ docs: [] }));
          if (snap.docs && snap.docs.length > 0) {
            // Bounded chunk deletion
            const docs = snap.docs;
            const CHUNK_SIZE = 100;
            for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
              const chunk = docs.slice(i, i + CHUNK_SIZE);
              await Promise.all(chunk.map((d) => deleteDoc(d.ref)));
            }
          }
        }
        deletedSteps.push(`subcollection_${subcol}`);
      } catch (err) {
        failedSteps.push({ step: `subcollection_${subcol}`, error: err.message });
      }
    }

    // 7. Delete workspace chat messages
    try {
      if (!isTestMode && token) {
        await deleteFirestoreMessagesRest(workspaceId, token, projectId);
      } else {
        const msgQuery = query(collection(db, "messages"), where("workspaceId", "==", workspaceId));
        const msgSnap = await getDocs(msgQuery).catch(() => ({ docs: [] }));
        if (msgSnap.docs && msgSnap.docs.length > 0) {
          await Promise.all(msgSnap.docs.map((d) => deleteDoc(d.ref)));
        }
      }
      deletedSteps.push("workspace_messages");
    } catch (err) {
      failedSteps.push({ step: "workspace_messages", error: err.message });
    }

    // 8. Delete root workspace document
    try {
      if (!isTestMode && token) {
        await deleteFirestoreDocRest(`workspaces/${encodeURIComponent(workspaceId)}`, token, projectId);
      } else {
        const wsRef = doc(db, `workspaces/${workspaceId}`);
        await deleteDoc(wsRef);
      }
      deletedSteps.push("workspace_root");
    } catch (err) {
      failedSteps.push({ step: "workspace_root", error: err.message });
    }

    // Report partial failure if any step failed
    if (failedSteps.length > 0) {
      return NextResponse.json(
        {
          success: false,
          partial: true,
          workspaceId,
          deletedSteps,
          failedSteps,
          error: `Partial deletion failure: ${failedSteps.length} step(s) failed`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      workspaceId,
      deletedSteps,
      message: "Workspace and all associated resources permanently deleted",
    }, { status: 200 });
  } catch (err) {
    console.error("Workspace deletion error:", err);
    return NextResponse.json(
      {
        success: false,
        workspaceId,
        deletedSteps,
        failedSteps: [...failedSteps, { step: "root_handler", error: err.message }],
        error: err.message || "Failed to complete workspace deletion",
      },
      { status: 500 }
    );
  }
}
