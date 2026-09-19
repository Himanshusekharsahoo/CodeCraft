"use client";

import React, { useState, useEffect, useCallback } from "react";
import { db } from "@/config/firebase";
import { doc, getDoc, setDoc, updateDoc, arrayRemove } from "firebase/firestore";
import { Inbox, Check, X, Loader2, FolderGit2 } from "lucide-react";
import { normalizeError } from "@/lib/errorUtils";

export default function InvitationsCard({ user }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const fetchInvites = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setActionError(null);

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        setInvites([]);
        setLoading(false);
        return;
      }

      const rawInvites = userSnap.data().invites || [];
      if (!Array.isArray(rawInvites) || rawInvites.length === 0) {
        setInvites([]);
        setLoading(false);
        return;
      }

      // Hydrate workspace IDs with metadata
      const hydrated = await Promise.all(
        rawInvites.map(async (wsId) => {
          try {
            const wsSnap = await getDoc(doc(db, "workspaces", wsId));
            if (wsSnap.exists()) {
              const data = wsSnap.data();
              return {
                workspaceId: wsId,
                name: data.name || `Workspace (${wsId.slice(0, 8)})`,
                description: data.description || "Collaborative developer workspace",
                ownerEmail: data.ownerEmail || "Workspace Owner",
              };
            }
          } catch (e) {
            // Workspace might be deleted or private
          }
          return {
            workspaceId: wsId,
            name: `Workspace (${wsId.slice(0, 8)})`,
            description: "Workspace invitation",
            ownerEmail: "Teammate",
          };
        })
      );

      setInvites(hydrated.filter(Boolean));
    } catch (err) {
      const norm = normalizeError(err, "Failed to load workspace invitations");
      setActionError(norm.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const handleAccept = async (wsId) => {
    if (!user?.uid || processingId) return;
    setProcessingId(wsId);
    setActionError(null);

    try {
      // 1. Join workspace as contributor
      const membersRef = doc(db, `workspaces/${wsId}/members`, user.uid);
      await setDoc(membersRef, {
        userId: user.uid,
        role: "contributor",
        displayName: user.displayName || user.email?.split("@")[0] || "Contributor",
        photoURL: user.photoURL || "/robotic.png",
      });

      // 2. Remove invite from user doc
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        invites: arrayRemove(wsId),
      });

      setInvites((prev) => prev.filter((item) => item.workspaceId !== wsId));
    } catch (err) {
      const norm = normalizeError(err, "Failed to accept workspace invitation");
      setActionError(norm.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDecline = async (wsId) => {
    if (!user?.uid || processingId) return;
    setProcessingId(wsId);
    setActionError(null);

    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        invites: arrayRemove(wsId),
      });

      setInvites((prev) => prev.filter((item) => item.workspaceId !== wsId));
    } catch (err) {
      const norm = normalizeError(err, "Failed to decline workspace invitation");
      setActionError(norm.message);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="bg-[#0D111A] border border-[#202938] rounded-xl p-5 sm:p-6 shadow-xl">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#18202D]">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white font-mono">
            Workspace Invitations
          </h2>
          <p className="text-xs text-[#94A3B8] mt-0.5">
            Pending collaboration access requests to developer workspaces
          </p>
        </div>
        {invites.length > 0 && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
            {invites.length} pending
          </span>
        )}
      </div>

      {actionError && (
        <div className="mb-4 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-mono text-red-300">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="py-8 flex items-center justify-center gap-2 text-xs font-mono text-[#64748B]">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          <span>Syncing invitations...</span>
        </div>
      ) : invites.length === 0 ? (
        <div className="py-8 text-center space-y-1.5">
          <div className="w-10 h-10 rounded-lg bg-[#111722] border border-[#202938] flex items-center justify-center mx-auto text-[#64748B] mb-2">
            <Inbox className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium text-[#CBD5E1]">No pending invitations</p>
          <p className="text-xs text-[#64748B] font-mono">You&apos;re all caught up.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {invites.map((ws) => (
            <div
              key={ws.workspaceId}
              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-lg bg-[#111722] border border-[#202938] hover:border-[#2E3B4E] transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#080B12] border border-[#202938] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <FolderGit2 className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white tracking-tight">{ws.name}</h4>
                  <p className="text-xs text-[#94A3B8]">{ws.description}</p>
                  <p className="text-[11px] font-mono text-[#64748B] mt-0.5">
                    Invited by: {ws.ownerEmail}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end pt-2 sm:pt-0">
                <button
                  type="button"
                  onClick={() => handleDecline(ws.workspaceId)}
                  disabled={processingId === ws.workspaceId}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono text-[#CBD5E1] hover:text-white bg-[#080B12] hover:bg-[#151C29] border border-[#202938] hover:border-[#2E3B4E] transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5 text-gray-400" />
                  <span>Decline</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAccept(ws.workspaceId)}
                  disabled={processingId === ws.workspaceId}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono text-white bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition-colors flex items-center gap-1 shadow-sm disabled:opacity-50"
                >
                  {processingId === ws.workspaceId ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>Accept</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
