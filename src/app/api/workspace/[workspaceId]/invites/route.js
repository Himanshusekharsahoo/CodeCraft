import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/serverAuth";
import { isExplicitTestEnvironment, isValidDeterministicTestToken, parseTestTokenClaims } from "@/lib/authEnv";
import { fetchFirestoreWorkspaceMemberRole } from "@/lib/execution/executionAuth";
import { doc, getDoc, updateDoc, arrayUnion, setDoc } from "firebase/firestore";
import { db } from "@/config/firebase";

// In-memory mock invites tracking for test environments
export const mockUserInvites = new Map();

export async function POST(request, context) {
  try {
    const params = await context.params;
    const workspaceId = params?.workspaceId;

    if (!workspaceId || typeof workspaceId !== "string" || !workspaceId.trim()) {
      return NextResponse.json({ error: "Missing or invalid workspaceId" }, { status: 400 });
    }

    const { auth: callerAuth, response: authResponse } = await requireAuth(request);
    if (authResponse) return authResponse;

    const body = await request.json().catch(() => null);
    const { recipientUserId, recipientEmail } = body || {};

    if (!recipientUserId || typeof recipientUserId !== "string") {
      return NextResponse.json({ error: "Missing required recipientUserId" }, { status: 400 });
    }

    // Prevent self-invitation
    if (recipientUserId === callerAuth.uid) {
      return NextResponse.json({ error: "Cannot invite yourself to your own workspace" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    // 1. Verify caller is workspace OWNER (CC-001, CC-012)
    let callerRole = null;
    if (isExplicitTestEnvironment() && isValidDeterministicTestToken(token)) {
      const claims = parseTestTokenClaims(token);
      callerRole = claims.role || "viewer";
    } else {
      callerRole = await fetchFirestoreWorkspaceMemberRole(workspaceId, callerAuth.uid, token);
    }

    if (callerRole !== "owner") {
      return NextResponse.json(
        { error: "Only workspace owners are permitted to send workspace invitations" },
        { status: 403 }
      );
    }

    // Check if recipient is already an active member of this workspace (CC-012)
    if (!isExplicitTestEnvironment()) {
      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
      if (projectId && token) {
        const baseDocUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
        const headers = { Authorization: `Bearer ${token}` };

        // 1. Check if recipient is in workspace members subcollection
        const memberRes = await fetch(`${baseDocUrl}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(recipientUserId)}`, { headers });
        if (memberRes.ok) {
          return NextResponse.json(
            { error: "User is already a member of this workspace", alreadyMember: true },
            { status: 400 }
          );
        }

        // 2. Check if recipient is the workspace owner
        const wsRes = await fetch(`${baseDocUrl}/workspaces/${encodeURIComponent(workspaceId)}`, { headers });
        if (wsRes.ok) {
          const wsDoc = await wsRes.json();
          const ownerId = wsDoc?.fields?.userId?.stringValue || wsDoc?.fields?.ownerId?.stringValue;
          if (ownerId === recipientUserId) {
            return NextResponse.json(
              { error: "User is already a member of this workspace", alreadyMember: true },
              { status: 400 }
            );
          }
        }
      }
    }

    // 2. In test environment, record invite deterministically
    if (isExplicitTestEnvironment()) {
      const current = mockUserInvites.get(recipientUserId) || [];
      if (!current.includes(workspaceId)) {
        current.push(workspaceId);
        mockUserInvites.set(recipientUserId, current);
      }
      return NextResponse.json({
        success: true,
        workspaceId,
        recipientUserId,
        invited: true,
      }, { status: 200 });
    }

    // 3. In production, safely append workspaceId to recipient's invites array using authenticated REST API
    try {
      const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
      if (projectId && token) {
        const userUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(recipientUserId)}`;
        const getRes = await fetch(userUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });

        if (getRes.status === 404) {
          return NextResponse.json({ error: "Recipient user profile does not exist" }, { status: 404 });
        }

        if (!getRes.ok) {
          const errText = await getRes.text().catch(() => "");
          console.error("Failed fetching recipient user:", getRes.status, errText);
          return NextResponse.json({ error: "Failed to locate recipient user record" }, { status: 500 });
        }

        const userDoc = await getRes.json();
        const rawInvites = userDoc?.fields?.invites?.arrayValue?.values || [];
        const existingInvites = rawInvites.map((v) => v.stringValue).filter(Boolean);

        if (existingInvites.includes(workspaceId)) {
          return NextResponse.json(
            { message: "User is already invited to this workspace", alreadyInvited: true },
            { status: 200 }
          );
        }

        const updatedInvitesValues = [
          ...existingInvites.map((id) => ({ stringValue: id })),
          { stringValue: workspaceId },
        ];

        const patchUrl = `${userUrl}?updateMask.fieldPaths=invites`;
        const patchRes = await fetch(patchUrl, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            fields: {
              invites: {
                arrayValue: {
                  values: updatedInvitesValues,
                },
              },
            },
          }),
        });

        if (!patchRes.ok) {
          const patchErr = await patchRes.text().catch(() => "");
          console.error("Firestore REST PATCH invites failed:", patchRes.status, patchErr);
          return NextResponse.json(
            { error: "Failed to update recipient invitation record" },
            { status: 500 }
          );
        }
      } else {
        // Fallback for non-REST client-side emulation if token or projectId is absent
        const userRef = doc(db, "users", recipientUserId);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const data = userSnap.data();
          const existingInvites = data.invites || [];
          if (existingInvites.includes(workspaceId)) {
            return NextResponse.json(
              { message: "User is already invited to this workspace", alreadyInvited: true },
              { status: 200 }
            );
          }
          await updateDoc(userRef, {
            invites: arrayUnion(workspaceId),
          });
        }
      }

      return NextResponse.json({
        success: true,
        workspaceId,
        recipientUserId,
        invited: true,
      }, { status: 200 });
    } catch (firestoreErr) {
      console.error("Failed to append invite to recipient document:", firestoreErr.message);
      return NextResponse.json(
        { error: "Failed to update recipient invitation record" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Invitation API error:", error.message);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
