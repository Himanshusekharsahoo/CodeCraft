"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { auth, db } from "@/config/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  collectionGroup,
  addDoc,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  arrayRemove,
  arrayUnion,
  onSnapshot,
} from "firebase/firestore";
import {
  Plus,
  PlusCircle,
  Trash2,
  Settings,
  Users,
  LogOut,
  Globe,
  Lock,
  Search,
  Code2,
  Check,
  X,
  Clock,
  AlertTriangle,
  Loader2,
  ArrowRight,
  MoreVertical,
  Archive,
  Inbox,
  UserPlus,
  Shield,
  Layers,
  Sparkles,
  CheckCircle2,
  FolderGit2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import Header from "@/components/Header";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import {
  validateWorkspaceName,
  sanitizeWorkspaceDescription,
  getRoleBadgeStyle,
  canManageMembers,
  canDeleteWorkspace,
  canLeaveWorkspace,
  filterWorkspaces,
  resolveUserWorkspaceMembership,
  recordRecentWorkspace,
  getRecentStorageKey,
  WORKSPACE_ROLES,
} from "@/lib/workspaceHelpers";
import { normalizeError } from "@/lib/errorUtils";
import AuthLoadingScreen from "@/components/auth/AuthLoadingScreen";
import { useAuth } from "@/context/AuthProvider";

const toastOptions = {
  position: "top-right",
  autoClose: 3500,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
  theme: "dark",
};

export default function Dashboard() {
  const router = useRouter();
  const { user: authUser, loading: authContextLoading } = useAuth();
  const currentUser = authUser || null;
  const authLoading = authContextLoading;

  // Core workspace state
  const [workspaces, setWorkspaces] = useState([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all"); // 'all' | 'owned' | 'shared' | 'recent' | 'invitations'

  // Invitations state
  const [pendingInvites, setPendingInvites] = useState([]); // [{ workspaceId, workspaceName, ... }]
  const [loadingInvites, setLoadingInvites] = useState(false);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [newWsDesc, setNewWsDesc] = useState("");
  const [newWsIsPublic, setNewWsIsPublic] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Settings & Members Modal
  const [settingsWs, setSettingsWs] = useState(null);
  const [settingsTab, setSettingsTab] = useState("general"); // 'general' | 'members' | 'danger'
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editIsPublic, setEditIsPublic] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [membersList, setMembersList] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [inviteEmailInput, setInviteEmailInput] = useState("");
  const [inviteRoleInput, setInviteRoleInput] = useState("contributor");
  const [isInviting, setIsInviting] = useState(false);

  // Safe Delete Modal
  const [deleteTargetWs, setDeleteTargetWs] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  // Leave Workspace Modal
  const [leaveTargetWs, setLeaveTargetWs] = useState(null);
  const [isLeaving, setIsLeaving] = useState(false);

  // Action Menu Dropdown active workspace ID
  const [activeMenuWsId, setActiveMenuWsId] = useState(null);

  // 2. Workspaces Fetching (Strict Data Isolation & Multi-Vector Targeted Queries)
  const fetchWorkspaces = useCallback(async () => {
    if (!currentUser) return;
    try {
      setLoadingWorkspaces(true);

      // Read recent workspaces from localStorage to attach lastOpenedAt
      let recentsMap = {};
      try {
        const rawRecents = localStorage.getItem(getRecentStorageKey(currentUser.uid));
        if (rawRecents) {
          const parsed = JSON.parse(rawRecents);
          parsed.forEach((item) => {
            if (item.id) recentsMap[item.id] = item.openedAt;
          });
        }
      } catch (err) {
        console.warn("Could not read recent workspaces:", err);
      }

      // Collect candidate workspace documents strictly associated with currentUser
      const candidateDocsMap = new Map();

      // Vectors 1 to 6: Discover candidate workspaces concurrently in parallel (P0 Critical Path Optimization)
      const vectorPromises = [
        // Vector 1: Workspaces explicitly owned by currentUser (userId == currentUser.uid)
        (async () => {
          try {
            const ownedQuery = query(
              collection(db, "workspaces"),
              where("userId", "==", currentUser.uid)
            );
            const ownedSnap = await getDocs(ownedQuery);
            ownedSnap.docs.forEach((docSnap) => {
              candidateDocsMap.set(docSnap.id, docSnap);
            });
          } catch (err) {
            console.warn("Could not execute owned workspaces query (userId):", err);
          }
        })(),

        // Vector 2: Workspaces where ownerId == currentUser.uid (backward compatibility)
        (async () => {
          try {
            const ownerIdQuery = query(
              collection(db, "workspaces"),
              where("ownerId", "==", currentUser.uid)
            );
            const ownerIdSnap = await getDocs(ownerIdQuery);
            ownerIdSnap.docs.forEach((docSnap) => {
              if (!candidateDocsMap.has(docSnap.id)) {
                candidateDocsMap.set(docSnap.id, docSnap);
              }
            });
          } catch (err) {
            console.warn("Could not execute ownerId workspaces query:", err);
          }
        })(),

        // Vector 3: Workspaces where memberUids array contains currentUser.uid
        (async () => {
          try {
            const memberUidsQuery = query(
              collection(db, "workspaces"),
              where("memberUids", "array-contains", currentUser.uid)
            );
            const memberUidsSnap = await getDocs(memberUidsQuery);
            memberUidsSnap.docs.forEach((docSnap) => {
              if (!candidateDocsMap.has(docSnap.id)) {
                candidateDocsMap.set(docSnap.id, docSnap);
              }
            });
          } catch (err) {
            // Suppress warning if memberUids field index is not yet built in Firestore
          }
        })(),

        // Vector 4: Explicit joined workspaces recorded on user document
        (async () => {
          try {
            const userDocSnap = await getDoc(doc(db, "users", currentUser.uid));
            if (userDocSnap.exists()) {
              const userData = userDocSnap.data();
              const joinedWsIds = [
                ...(Array.isArray(userData.joinedWorkspaces) ? userData.joinedWorkspaces : []),
                ...(userData.workspaces && typeof userData.workspaces === "object" ? Object.keys(userData.workspaces) : []),
              ];

              await Promise.all(
                joinedWsIds.map(async (wsId) => {
                  if (wsId && !candidateDocsMap.has(wsId)) {
                    try {
                      const wsSnap = await getDoc(doc(db, "workspaces", wsId));
                      if (wsSnap.exists()) {
                        candidateDocsMap.set(wsSnap.id, wsSnap);
                      }
                    } catch (e) {
                      // Workspace may no longer exist
                    }
                  }
                })
              );
            }
          } catch (err) {
            console.warn("Could not fetch user document joinedWorkspaces:", err);
          }
        })(),

        // Vector 5: Recents list from localStorage
        (async () => {
          const recentIds = Object.keys(recentsMap);
          if (recentIds.length > 0) {
            await Promise.all(
              recentIds.map(async (wsId) => {
                if (wsId && !candidateDocsMap.has(wsId)) {
                  try {
                    const wsSnap = await getDoc(doc(db, "workspaces", wsId));
                    if (wsSnap.exists()) {
                      candidateDocsMap.set(wsSnap.id, wsSnap);
                    }
                  } catch (e) {}
                }
              })
            );
          }
        })(),

        // Vector 6: Collection group fallback for memberships
        (async () => {
          try {
            const memberGroupQuery = query(
              collectionGroup(db, "members"),
              where("userId", "==", currentUser.uid)
            );
            const groupSnap = await getDocs(memberGroupQuery);
            await Promise.all(
              groupSnap.docs.map(async (memberSnap) => {
                const parentWsRef = memberSnap.ref?.parent?.parent;
                if (parentWsRef && !candidateDocsMap.has(parentWsRef.id)) {
                  try {
                    const wsSnap = await getDoc(parentWsRef);
                    if (wsSnap.exists()) {
                      candidateDocsMap.set(wsSnap.id, wsSnap);
                    }
                  } catch (e) {}
                }
              })
            );
          } catch (groupErr) {
            // Graceful fallback if collectionGroup query is unindexed or disallowed
          }
        })(),
      ];

      await Promise.allSettled(vectorPromises);

      // STRICT MEMBERSHIP & ROLE RESOLUTION
      const candidateList = Array.from(candidateDocsMap.values());
      const workspaceData = await Promise.all(
        candidateList.map(async (workspaceDoc) => {
          const data = workspaceDoc.data();
          const isDocOwner = data.userId === currentUser.uid || data.ownerId === currentUser.uid;

          let role = isDocOwner ? WORKSPACE_ROLES.OWNER : null;
          let userMemberDoc = null;

          // P0 Optimization: Skip querying members subcollection for owned workspaces.
          // For non-owned candidate workspaces, fetch the specific member document directly
          // instead of a full collection scan (O(1) read vs O(M) reads).
          if (!isDocOwner) {
            try {
              const memberSnap = await getDoc(
                doc(db, `workspaces/${workspaceDoc.id}/members/${currentUser.uid}`)
              );
              if (memberSnap.exists()) {
                userMemberDoc = memberSnap.data();
                role = userMemberDoc.role || WORKSPACE_ROLES.CONTRIBUTOR;
              }
            } catch (err) {
              // Throws permission-denied if user is not authorized member of workspace
            }
          }

          // HARD DATA ISOLATION INVARIANT:
          // A workspace must ONLY appear on this user's dashboard if they are the verified
          // owner or an authentic member. Being marked 'isPublic' DOES NOT grant dashboard residency.
          const membership = resolveUserWorkspaceMembership(data, currentUser.uid, userMemberDoc);
          if (!membership.isMember) {
            return null;
          }

          const memberCount = Array.isArray(data.memberUids) ? data.memberUids.length : 1;

          return {
            ...data,
            id: workspaceDoc.id,
            role: membership.role || role || WORKSPACE_ROLES.CONTRIBUTOR,
            memberCount: Math.max(memberCount, 1),
            memberAvatars: [],
            lastOpenedAt: recentsMap[workspaceDoc.id] || null,
          };
        })
      );

      // Deduplicate workspaces by document ID to guarantee unique card entries
      const seen = new Set();
      const uniqueWorkspaces = workspaceData.filter(Boolean).filter((ws) => {
        if (!ws.id || seen.has(ws.id)) return false;
        seen.add(ws.id);
        return true;
      });

      setWorkspaces(uniqueWorkspaces);
    } catch (error) {
      console.error("Error fetching workspaces:", error);
      toast.error("Failed to load workspaces", toastOptions);
    } finally {
      setLoadingWorkspaces(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      fetchWorkspaces();
    }
  }, [currentUser, fetchWorkspaces]);

  // 3. Realtime User Invites Listener
  useEffect(() => {
    if (!currentUser) return;
    setLoadingInvites(true);
    const userRef = doc(db, "users", currentUser.uid);

    const handleSnapshot = async (docSnap) => {
      try {
        if (docSnap.exists()) {
          const inviteIds = docSnap.data().invites || [];
          if (!Array.isArray(inviteIds) || inviteIds.length === 0) {
            setPendingInvites([]);
            setLoadingInvites(false);
            return;
          }

          // Hydrate invite IDs with workspace names
          const hydrated = await Promise.all(
            inviteIds.map(async (wsId) => {
              try {
                const wsSnap = await getDoc(doc(db, "workspaces", wsId));
                if (wsSnap.exists()) {
                  return {
                    workspaceId: wsId,
                    name: wsSnap.data().name || `Workspace (${wsId.slice(0, 6)})`,
                    description: wsSnap.data().description || "Collaborative workspace",
                    ownerEmail: wsSnap.data().ownerEmail || "Workspace Owner",
                    isPublic: Boolean(wsSnap.data().isPublic),
                  };
                }
              } catch (e) {
                // Workspace may have been deleted
              }
              return {
                workspaceId: wsId,
                name: `Workspace (${wsId.slice(0, 8)})`,
                description: "Collaborative project invitation",
                ownerEmail: "Teammate",
                isPublic: false,
              };
            })
          );
          setPendingInvites(hydrated.filter(Boolean));
        } else {
          setPendingInvites([]);
        }
      } catch (err) {
        const norm = normalizeError(err, "Error hydrating invites");
        console.warn("[Dashboard Invites]", norm.message);
      } finally {
        setLoadingInvites(false);
      }
    };

    const unsubscribe = onSnapshot(
      userRef,
      (docSnap) => {
        handleSnapshot(docSnap).catch((err) => {
          const norm = normalizeError(err, "Unhandled invite processing error");
          console.warn("[Dashboard Invites]", norm.message);
          setLoadingInvites(false);
        });
      },
      (err) => {
        const norm = normalizeError(err, "Failed to listen for user invites");
        console.warn("[Dashboard User Invites Listener]", norm.message);
        setLoadingInvites(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // Close card action menu when clicking outside
  useEffect(() => {
    const handleWindowClick = () => setActiveMenuWsId(null);
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  // 4. Create Workspace Handler
  const handleCreateWorkspace = async (e) => {
    if (e) e.preventDefault();
    setCreateError(null);

    const validation = validateWorkspaceName(newWsName);
    if (!validation.valid) {
      setCreateError(validation.error);
      return;
    }

    try {
      setIsCreating(true);
      const sanitizedDesc = sanitizeWorkspaceDescription(newWsDesc);

      // Create root workspace document with explicit ownerId, userId, and memberUids
      const workspaceRef = await addDoc(collection(db, "workspaces"), {
        name: validation.sanitizedName,
        description: sanitizedDesc,
        isPublic: newWsIsPublic,
        userId: currentUser.uid,
        ownerId: currentUser.uid,
        ownerEmail: currentUser.email || "",
        memberUids: [currentUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Create owner member document in subcollection
      const membersRef = collection(db, `workspaces/${workspaceRef.id}/members`);
      await setDoc(doc(membersRef, currentUser.uid), {
        userId: currentUser.uid,
        role: WORKSPACE_ROLES.OWNER,
        displayName: currentUser.displayName || currentUser.email?.split("@")[0] || "Owner",
        photoURL: currentUser.photoURL || "/robotic.png",
        joinedAt: serverTimestamp(),
      });

      // Initialize workspace cursors map
      await setDoc(doc(db, `workspaces/${workspaceRef.id}`), { cursors: {} }, { merge: true });

      // Register workspace reference on user profile
      try {
        await updateDoc(doc(db, "users", currentUser.uid), {
          joinedWorkspaces: arrayUnion(workspaceRef.id),
        });
      } catch (userDocErr) {
        console.warn("Could not register workspace on user doc:", userDocErr);
      }

      // Record in recent list
      recordRecentWorkspace(currentUser.uid, {
        id: workspaceRef.id,
        name: validation.sanitizedName,
      });

      toast.success(`Workspace "${validation.sanitizedName}" created!`, toastOptions);

      // Reset form and close dialog
      setNewWsName("");
      setNewWsDesc("");
      setNewWsIsPublic(false);
      setIsCreateOpen(false);

      // Refresh workspaces list
      await fetchWorkspaces();
    } catch (error) {
      console.error("Error creating workspace:", error);
      setCreateError("Failed to create workspace. Please try again.");
      toast.error("Failed to create workspace.", toastOptions);
    } finally {
      setIsCreating(false);
    }
  };

  // 5. Open Workspace (Strict navigation only, zero workspace document creation)
  const handleOpenWorkspace = useCallback((ws) => {
    if (!ws) {
      console.warn("handleOpenWorkspace called with no workspace");
      return;
    }
    const targetId = ws.id || ws.workspaceId;
    if (!targetId || typeof targetId !== "string") {
      console.error("Cannot open workspace: missing or invalid workspace ID", ws);
      toast.error("Unable to open workspace: invalid workspace ID", toastOptions);
      return;
    }

    // Client-side recents record: updates localStorage only, zero Firestore workspace writes
    if (currentUser?.uid) {
      try {
        recordRecentWorkspace(currentUser.uid, {
          id: targetId,
          name: ws.name || "Workspace",
        });
      } catch (e) {
        console.warn("Could not record recent workspace:", e);
      }
    }

    // Strict client-side navigation to existing workspace route
    router.push(`/workspace/${targetId}`);
  }, [currentUser, router]);

  // 6. Settings Modal Open & Load Members
  const handleOpenSettings = async (ws, initialTab = "general") => {
    setSettingsWs(ws);
    setSettingsTab(initialTab);
    setEditName(ws.name || "");
    setEditDesc(ws.description || "");
    setEditIsPublic(Boolean(ws.isPublic));
    setInviteEmailInput("");
    setActiveMenuWsId(null);

    // Fetch members for this workspace
    try {
      setLoadingMembers(true);
      const membersSnap = await getDocs(collection(db, `workspaces/${ws.id}/members`));
      const members = membersSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      setMembersList(members);
    } catch (err) {
      console.error("Error loading members:", err);
      toast.error("Failed to load workspace members", toastOptions);
    } finally {
      setLoadingMembers(false);
    }
  };

  // 7. Save Workspace Settings
  const handleSaveSettings = async () => {
    if (!settingsWs || isSavingSettings) return;

    const validation = validateWorkspaceName(editName);
    if (!validation.valid) {
      toast.error(validation.error, toastOptions);
      return;
    }

    try {
      setIsSavingSettings(true);
      const sanitizedDesc = sanitizeWorkspaceDescription(editDesc);

      await updateDoc(doc(db, "workspaces", settingsWs.id), {
        name: validation.sanitizedName,
        description: sanitizedDesc,
        isPublic: editIsPublic,
        updatedAt: serverTimestamp(),
      });

      toast.success("Workspace settings updated!", toastOptions);

      // Update in state
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === settingsWs.id
            ? {
                ...w,
                name: validation.sanitizedName,
                description: sanitizedDesc,
                isPublic: editIsPublic,
              }
            : w
        )
      );

      setSettingsWs((prev) =>
        prev
          ? {
              ...prev,
              name: validation.sanitizedName,
              description: sanitizedDesc,
              isPublic: editIsPublic,
            }
          : null
      );
    } catch (err) {
      console.error("Error updating settings:", err);
      toast.error("Failed to update workspace settings", toastOptions);
    } finally {
      setIsSavingSettings(false);
    }
  };

  // 8. Member Role Change
  const handleUpdateMemberRole = async (memberId, newRole) => {
    if (!settingsWs) return;

    // Disallow demoting sole owner
    if (memberId === currentUser.uid && newRole !== WORKSPACE_ROLES.OWNER) {
      const owners = membersList.filter((m) => m.role === WORKSPACE_ROLES.OWNER);
      if (owners.length <= 1) {
        toast.error("You cannot demote yourself as the sole owner.", toastOptions);
        return;
      }
    }

    try {
      await updateDoc(doc(db, `workspaces/${settingsWs.id}/members`, memberId), {
        role: newRole,
      });

      setMembersList((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
      );
      toast.success("Member role updated", toastOptions);
    } catch (err) {
      console.error("Error updating member role:", err);
      toast.error("Failed to update member role", toastOptions);
    }
  };

  // 9. Remove Member
  const handleRemoveMember = async (memberId) => {
    if (!settingsWs) return;

    if (memberId === currentUser.uid) {
      toast.error("To leave the workspace, use the Leave Workspace option.", toastOptions);
      return;
    }

    try {
      await deleteDoc(doc(db, `workspaces/${settingsWs.id}/members`, memberId));

      try {
        await updateDoc(doc(db, "workspaces", settingsWs.id), {
          memberUids: arrayRemove(memberId),
        });
      } catch (e) {}

      try {
        await updateDoc(doc(db, "users", memberId), {
          joinedWorkspaces: arrayRemove(settingsWs.id),
        });
      } catch (e) {}

      setMembersList((prev) => prev.filter((m) => m.id !== memberId));
      toast.success("Member removed from workspace", toastOptions);

      // Decrement count in main list
      setWorkspaces((prev) =>
        prev.map((w) =>
          w.id === settingsWs.id ? { ...w, memberCount: Math.max(1, (w.memberCount || 1) - 1) } : w
        )
      );
    } catch (err) {
      console.error("Error removing member:", err);
      toast.error("Failed to remove member", toastOptions);
    }
  };

  // 10. Invite Member via Settings Form
  const handleInviteMember = async (e) => {
    if (e) e.preventDefault();
    if (!settingsWs || !inviteEmailInput.trim() || isInviting) return;

    const term = inviteEmailInput.trim().toLowerCase();
    if (term === (currentUser.email || "").toLowerCase()) {
      toast.info("You are already the owner of this workspace.", toastOptions);
      return;
    }

    try {
      setIsInviting(true);
      const q = query(
        collection(db, "users"),
        where("email", "==", term)
      );
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        toast.error(`User with email "${term}" not found.`, toastOptions);
        return;
      }

      const targetDoc = querySnapshot.docs[0];
      const targetUserId = targetDoc.id;

      // Check if already a member
      if (membersList.some((m) => m.id === targetUserId)) {
        toast.info("User is already a member of this workspace.", toastOptions);
        return;
      }

      // Add workspaceId to target user's invites array
      await updateDoc(doc(db, "users", targetUserId), {
        invites: arrayUnion(settingsWs.id),
      });

      toast.success(`Invitation sent to ${term}!`, toastOptions);
      setInviteEmailInput("");
    } catch (err) {
      console.error("Error sending invitation:", err);
      toast.error("Failed to send invitation.", toastOptions);
    } finally {
      setIsInviting(false);
    }
  };

  // 11. Archive / Unarchive Workspace
  const handleToggleArchive = async (ws) => {
    try {
      const nextState = !ws.archived;
      await updateDoc(doc(db, "workspaces", ws.id), {
        archived: nextState,
        updatedAt: serverTimestamp(),
      });

      setWorkspaces((prev) =>
        prev.map((w) => (w.id === ws.id ? { ...w, archived: nextState } : w))
      );

      toast.success(
        nextState ? `Workspace "${ws.name}" archived.` : `Workspace "${ws.name}" unarchived.`,
        toastOptions
      );
      if (settingsWs?.id === ws.id) {
        setSettingsWs(null);
      }
    } catch (err) {
      console.error("Error archiving workspace:", err);
      toast.error("Failed to update workspace archive status", toastOptions);
    }
  };

  // 12. Safe Cascading Delete
  const handlePerformCascadingDelete = async (e) => {
    if (e) e.preventDefault();
    if (!deleteTargetWs || isDeleting) return;

    // Strict validation: must match workspace name exactly
    if (deleteConfirmText.trim() !== deleteTargetWs?.name?.trim()) {
      return;
    }

    try {
      setIsDeleting(true);
      const wsId = deleteTargetWs.id;

      // CC-015: Server-coordinated reliable cascading deletion
      const token = await currentUser?.getIdToken?.();
      const res = await fetch(`/api/workspace/${wsId}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(resData.error || "Cascading deletion failed on server");
      }

      // Clean local storage recents
      try {
        const key = getRecentStorageKey(currentUser.uid);
        const existing = JSON.parse(localStorage.getItem(key) || "[]");
        const updated = existing.filter((item) => item.id !== wsId);
        localStorage.setItem(key, JSON.stringify(updated));
      } catch (err) {}

      // Clean up joinedWorkspaces from user doc
      try {
        await updateDoc(doc(db, "users", currentUser.uid), {
          joinedWorkspaces: arrayRemove(wsId),
        });
      } catch (err) {}

      // Update state
      setWorkspaces((prev) => prev.filter((w) => w.id !== wsId));
      if (settingsWs?.id === wsId) setSettingsWs(null);

      toast.success(`Workspace "${deleteTargetWs.name}" permanently deleted.`, toastOptions);
      setDeleteTargetWs(null);
      setDeleteConfirmText("");
    } catch (err) {
      const norm = normalizeError(err, "Failed to delete workspace. Please try again.");
      console.error("Error during cascading delete:", norm);
      toast.error(norm.message || "Failed to delete workspace. Please try again.", toastOptions);
    } finally {
      setIsDeleting(false);
    }
  };

  // 13. Leave Workspace
  const handleLeaveWorkspace = async () => {
    if (!leaveTargetWs || isLeaving || !currentUser) return;

    const check = canLeaveWorkspace(leaveTargetWs.role, true);
    if (!check.canLeave) {
      toast.error(check.reason, toastOptions);
      setLeaveTargetWs(null);
      return;
    }

    try {
      setIsLeaving(true);
      await deleteDoc(doc(db, `workspaces/${leaveTargetWs.id}/members`, currentUser.uid));

      try {
        await updateDoc(doc(db, "workspaces", leaveTargetWs.id), {
          memberUids: arrayRemove(currentUser.uid),
        });
      } catch (e) {}

      try {
        await updateDoc(doc(db, "users", currentUser.uid), {
          joinedWorkspaces: arrayRemove(leaveTargetWs.id),
        });
      } catch (e) {}

      setWorkspaces((prev) => prev.filter((w) => w.id !== leaveTargetWs.id));
      toast.info(`You have left "${leaveTargetWs.name}".`, toastOptions);
      setLeaveTargetWs(null);
    } catch (err) {
      console.error("Error leaving workspace:", err);
      toast.error("Failed to leave workspace", toastOptions);
    } finally {
      setIsLeaving(false);
    }
  };

  // 14. Accept Invite
  const handleAcceptInvite = async (inv) => {
    if (!currentUser) return;
    try {
      const wsId = inv.workspaceId;

      // 1. Create membership
      const memberRef = doc(db, `workspaces/${wsId}/members`, currentUser.uid);
      await setDoc(memberRef, {
        userId: currentUser.uid,
        role: WORKSPACE_ROLES.CONTRIBUTOR,
        displayName: currentUser.displayName || currentUser.email?.split("@")[0] || "Contributor",
        photoURL: currentUser.photoURL || "/robotic.png",
        joinedAt: serverTimestamp(),
      });

      // 2. Add to workspace memberUids
      try {
        await updateDoc(doc(db, "workspaces", wsId), {
          memberUids: arrayUnion(currentUser.uid),
        });
      } catch (e) {}

      // 3. Remove invite and add to user joinedWorkspaces
      await updateDoc(doc(db, "users", currentUser.uid), {
        invites: arrayRemove(wsId),
        joinedWorkspaces: arrayUnion(wsId),
      });

      // 4. Update local invite state
      setPendingInvites((prev) => prev.filter((item) => item.workspaceId !== wsId));

      toast.success(`Joined workspace "${inv.name}"!`, toastOptions);

      // 5. Refresh workspaces and navigate
      await fetchWorkspaces();
      router.push(`/workspace/${wsId}`);
    } catch (err) {
      console.error("Error accepting invite:", err);
      toast.error("Failed to accept invitation", toastOptions);
    }
  };

  // 15. Decline Invite
  const handleDeclineInvite = async (inv) => {
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, "users", currentUser.uid), {
        invites: arrayRemove(inv.workspaceId),
      });
      setPendingInvites((prev) => prev.filter((item) => item.workspaceId !== inv.workspaceId));
      toast.info(`Invitation to "${inv.name}" declined.`, toastOptions);
    } catch (err) {
      console.error("Error declining invite:", err);
      toast.error("Failed to decline invitation", toastOptions);
    }
  };

  // Filtered workspaces list
  const filteredWorkspaces = useMemo(() => {
    return filterWorkspaces(workspaces, searchQuery, activeTab, currentUser?.uid);
  }, [workspaces, searchQuery, activeTab, currentUser]);

  // Counts for tabs
  const tabCounts = useMemo(() => {
    const owned = workspaces.filter(
      (w) => w.userId === currentUser?.uid || w.ownerId === currentUser?.uid || (w.role || "").toLowerCase() === "owner"
    ).length;
    const shared = workspaces.filter(
      (w) => (w.userId !== currentUser?.uid && w.ownerId !== currentUser?.uid) && (w.role || "").toLowerCase() !== "owner"
    ).length;
    const recent = workspaces.filter((w) => w.lastOpenedAt).length;
    return {
      all: workspaces.filter((w) => !w.archived).length,
      owned,
      shared,
      recent,
      invitations: pendingInvites.length,
    };
  }, [workspaces, pendingInvites, currentUser]);

  if (authLoading || !currentUser) {
    return (
      <AuthLoadingScreen
        message="Loading workspace hub..."
        description="Synchronizing your developer environments"
      />
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#070b14] text-gray-100 flex flex-col font-sans selection:bg-blue-500/30 selection:text-white">
      <ToastContainer />
      <Header />

      {/* Hero / Quick Action Bar */}
      <div className="border-b border-gray-800/80 bg-gradient-to-b from-[#0a0f1e] to-[#070b14]/90 px-6 lg:px-12 py-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-blue-400 mb-2">
              <Sparkles className="w-4 h-4 text-blue-400" />
              <span>COLLABORATIVE CLOUD IDE</span>
            </div>
            <h1 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight flex items-center gap-3">
              Workspace Hub
            </h1>
            <p className="text-sm text-gray-400 mt-1 max-w-xl">
              Create, manage, and collaborate across AI-assisted coding workspaces in real time.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => setIsCreateOpen(true)}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium rounded-lg shadow-lg shadow-blue-600/20 transition-all transform hover:scale-[1.02] flex items-center gap-2 border border-blue-400/20"
            >
              <PlusCircle className="w-5 h-5" />
              <span>New Workspace</span>
            </Button>
          </div>
        </div>

        {/* Filter Navigation & Search Bar */}
        <div className="max-w-7xl mx-auto mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          {/* Navigation Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-900/90 rounded-lg border border-gray-800 overflow-x-auto">
            <button
              data-testid="tab-all"
              onClick={() => setActiveTab("all")}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === "all"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-200 hover:bg-slate-800/60"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>All Workspaces</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 text-gray-300 font-mono">
                {tabCounts.all}
              </span>
            </button>

            <button
              data-testid="tab-owned"
              onClick={() => setActiveTab("owned")}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === "owned"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-200 hover:bg-slate-800/60"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>My Workspaces</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 text-gray-300 font-mono">
                {tabCounts.owned}
              </span>
            </button>

            <button
              data-testid="tab-shared"
              onClick={() => setActiveTab("shared")}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === "shared"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-200 hover:bg-slate-800/60"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Shared with Me</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 text-gray-300 font-mono">
                {tabCounts.shared}
              </span>
            </button>

            <button
              data-testid="tab-recent"
              onClick={() => setActiveTab("recent")}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === "recent"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-200 hover:bg-slate-800/60"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Recent</span>
              {tabCounts.recent > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/30 text-gray-300 font-mono">
                  {tabCounts.recent}
                </span>
              )}
            </button>

            <button
              data-testid="tab-invitations"
              onClick={() => setActiveTab("invitations")}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeTab === "invitations"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-gray-200 hover:bg-slate-800/60"
              }`}
            >
              <Inbox className="w-3.5 h-3.5" />
              <span>Invitations</span>
              {tabCounts.invitations > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-black font-bold font-mono animate-pulse">
                  {tabCounts.invitations}
                </span>
              )}
            </button>
          </div>

          {/* Search Input */}
          {activeTab !== "invitations" && (
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search workspaces..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 py-1.5 bg-slate-900 border-gray-800 text-sm text-gray-200 placeholder-gray-500 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-6 lg:p-12">
        {activeTab === "invitations" ? (
          /* INVITATIONS VIEW */
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Inbox className="w-5 h-5 text-amber-400" />
                <span>Pending Workspace Invitations</span>
              </h2>
              <span className="text-xs text-gray-400">
                Accepting an invite grants Contributor access.
              </span>
            </div>

            {loadingInvites ? (
              <div className="py-16 text-center text-gray-400 flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                <p className="text-sm">Loading invitations...</p>
              </div>
            ) : pendingInvites.length === 0 ? (
              <div
                data-testid="empty-invitations"
                className="py-16 text-center border border-dashed border-gray-800 rounded-xl bg-slate-900/40 p-8"
              >
                <Inbox className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-gray-300">No Pending Invitations</h3>
                <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">
                  When teammates invite you to collaborate on their workspaces, your invitations will appear here.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pendingInvites.map((inv) => (
                  <Card
                    key={inv.workspaceId}
                    className="border border-amber-500/30 bg-slate-900/80 backdrop-blur rounded-xl p-5 shadow-lg relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-yellow-400" />
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          Pending Invite
                        </span>
                        <h3 className="text-lg font-bold text-white mt-2 flex items-center gap-2">
                          <Code2 className="w-4 h-4 text-blue-400" />
                          {inv.name}
                        </h3>
                        <p className="text-xs text-gray-400 mt-1">
                          {inv.description}
                        </p>
                        <p className="text-xs text-gray-500 mt-2 font-mono">
                          Invited by: {inv.ownerEmail}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-gray-800">
                      <Button
                        onClick={() => handleDeclineInvite(inv)}
                        variant="ghost"
                        size="sm"
                        className="text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                      >
                        Decline
                      </Button>
                      <Button
                        onClick={() => handleAcceptInvite(inv)}
                        size="sm"
                        className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium shadow-md flex items-center gap-1.5"
                      >
                        <Check className="w-4 h-4" />
                        <span>Accept & Join</span>
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* WORKSPACES GRID VIEW */
          <div>
            {loadingWorkspaces ? (
              <div className="py-20 text-center text-gray-400 flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <p className="text-sm">Loading your workspaces...</p>
              </div>
            ) : filteredWorkspaces.length === 0 ? (
              <div
                data-testid="empty-workspaces"
                className="py-16 text-center border border-dashed border-gray-800 rounded-xl bg-slate-900/40 p-8"
              >
                <FolderGit2 className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-gray-300">
                  {searchQuery ? "No matching workspaces found" : "No workspaces yet"}
                </h3>
                <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">
                  {searchQuery
                    ? `No workspaces match "${searchQuery}". Try a different keyword.`
                    : "Create your first collaborative workspace to start coding with live sync and AI pair programming."}
                </p>
                {!searchQuery && (
                  <Button
                    onClick={() => setIsCreateOpen(true)}
                    className="mt-5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create First Workspace</span>
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredWorkspaces.map((ws) => {
                  const roleStyle = getRoleBadgeStyle(ws.role);
                  const isOwner = ws.role === WORKSPACE_ROLES.OWNER;

                  return (
                    <Card
                      key={ws.id}
                      data-testid="workspace-card"
                      className="group border border-gray-800/90 bg-slate-900/70 hover:bg-slate-900/95 backdrop-blur-md rounded-xl p-5 transition-all duration-200 hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-500/10 flex flex-col justify-between relative"
                    >
                      <div>
                        {/* Header: Badges and Action Menu */}
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${roleStyle.bgClass} ${roleStyle.textClass} ${roleStyle.borderClass}`}
                            >
                              {roleStyle.label}
                            </span>
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-gray-400 border border-gray-700 flex items-center gap-1">
                              {ws.isPublic ? (
                                <>
                                  <Globe className="w-3 h-3 text-emerald-400" />
                                  <span>Public</span>
                                </>
                              ) : (
                                <>
                                  <Lock className="w-3 h-3 text-amber-400" />
                                  <span>Private</span>
                                </>
                              )}
                            </span>
                            {ws.archived && (
                              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-red-950/60 text-red-400 border border-red-800/40 flex items-center gap-1">
                                <Archive className="w-3 h-3" />
                                <span>Archived</span>
                              </span>
                            )}
                          </div>

                          {/* Three dots dropdown */}
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuWsId((prev) => (prev === ws.id ? null : ws.id));
                              }}
                              className="p-1 rounded-md text-gray-400 hover:text-white hover:bg-slate-800 transition-colors"
                              aria-label="Workspace Actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {activeMenuWsId === ws.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 top-7 w-48 bg-slate-800 border border-gray-700 rounded-lg shadow-2xl py-1 z-30 text-xs"
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleOpenWorkspace(ws);
                                  }}
                                  className="w-full text-left px-3 py-2 text-gray-200 hover:bg-slate-700/80 flex items-center gap-2"
                                >
                                  <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
                                  <span>Open IDE</span>
                                </button>

                                {isOwner && (
                                  <>
                                    <button
                                      onClick={() => handleOpenSettings(ws, "general")}
                                      className="w-full text-left px-3 py-2 text-gray-200 hover:bg-slate-700/80 flex items-center gap-2"
                                    >
                                      <Settings className="w-3.5 h-3.5 text-gray-400" />
                                      <span>Settings & Members</span>
                                    </button>

                                    <button
                                      onClick={() => handleToggleArchive(ws)}
                                      className="w-full text-left px-3 py-2 text-gray-200 hover:bg-slate-700/80 flex items-center gap-2"
                                    >
                                      <Archive className="w-3.5 h-3.5 text-amber-400" />
                                      <span>{ws.archived ? "Unarchive" : "Archive"}</span>
                                    </button>

                                    <div className="my-1 border-t border-gray-700" />

                                    <button
                                      onClick={() => {
                                        setActiveMenuWsId(null);
                                        setDeleteTargetWs(ws);
                                        setDeleteConfirmText("");
                                      }}
                                      className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                                      <span>Delete Workspace</span>
                                    </button>
                                  </>
                                )}

                                {!isOwner && (
                                  <button
                                    onClick={() => {
                                      setActiveMenuWsId(null);
                                      setLeaveTargetWs(ws);
                                    }}
                                    className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                                  >
                                    <LogOut className="w-3.5 h-3.5 text-red-400" />
                                    <span>Leave Workspace</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Title & Description */}
                        <div
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleOpenWorkspace(ws);
                          }}
                          className="cursor-pointer group/title"
                        >
                          <h2 className="text-xl font-bold text-white group-hover/title:text-blue-400 transition-colors flex items-center gap-2">
                            <Code2 className="w-5 h-5 text-blue-500" />
                            <span className="truncate">{ws.name}</span>
                          </h2>
                          <p className="text-xs text-gray-400 mt-1.5 line-clamp-2 min-h-[32px]">
                            {ws.description || "Collaborative web development workspace."}
                          </p>
                        </div>

                        {/* Meta info: Members and Last Opened */}
                        <div className="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between text-xs text-gray-400">
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-gray-500" />
                            <span>
                              {ws.memberCount} {ws.memberCount === 1 ? "member" : "members"}
                            </span>
                          </div>

                          {ws.lastOpenedAt ? (
                            <div className="flex items-center gap-1 text-[11px] text-gray-500">
                              <Clock className="w-3 h-3" />
                              <span>Recent</span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray-600 font-mono">
                              ID: {ws.id.slice(0, 6)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Open Action Button */}
                      <div className="mt-4 pt-2">
                        <Button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleOpenWorkspace(ws);
                          }}
                          className="w-full py-2 bg-slate-800 hover:bg-blue-600 text-gray-200 hover:text-white text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2 border border-gray-700/60 hover:border-blue-500"
                        >
                          <span>Open Workspace</span>
                          <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* CREATE WORKSPACE MODAL */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) {
            setNewWsName("");
            setNewWsDesc("");
            setCreateError(null);
          }
        }}
      >
        <DialogContent className="bg-[#0f172a] text-gray-100 border border-gray-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
              <PlusCircle className="w-5 h-5 text-blue-500" />
              Create New Workspace
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-400">
              Set up a shared coding environment with real-time sync, Monaco editor, and AI assistance.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateWorkspace} className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Workspace Name <span className="text-red-400">*</span>
              </label>
              <Input
                placeholder="e.g. frontend-app or my-project"
                value={newWsName}
                onChange={(e) => {
                  setNewWsName(e.target.value);
                  if (createError) setCreateError(null);
                }}
                maxLength={64}
                required
                className="bg-slate-900 border-gray-700 text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <div className="flex justify-between items-center text-[10px] text-gray-500 mt-1">
                <span>Must not contain slashes or path traversal</span>
                <span>{newWsName.length}/64</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">
                Description (Optional)
              </label>
              <textarea
                placeholder="Brief summary of this workspace's purpose"
                value={newWsDesc}
                onChange={(e) => setNewWsDesc(e.target.value)}
                maxLength={256}
                rows={3}
                className="w-full bg-slate-900 border border-gray-700 rounded-md p-2 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
              <div className="text-right text-[10px] text-gray-500">
                {newWsDesc.length}/256
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                Visibility
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setNewWsIsPublic(true)}
                  className={`p-3 rounded-lg border text-left transition-all flex flex-col gap-1 ${
                    newWsIsPublic
                      ? "border-blue-500 bg-blue-500/10 text-white"
                      : "border-gray-800 bg-slate-900 text-gray-400 hover:border-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-medium text-xs">
                    <Globe className="w-4 h-4 text-emerald-400" />
                    <span>Public</span>
                  </div>
                  <span className="text-[11px] text-gray-400">
                    Anyone can view this workspace.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setNewWsIsPublic(false)}
                  className={`p-3 rounded-lg border text-left transition-all flex flex-col gap-1 ${
                    !newWsIsPublic
                      ? "border-blue-500 bg-blue-500/10 text-white"
                      : "border-gray-800 bg-slate-900 text-gray-400 hover:border-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-medium text-xs">
                    <Lock className="w-4 h-4 text-amber-400" />
                    <span>Private</span>
                  </div>
                  <span className="text-[11px] text-gray-400">
                    Only invited members can access.
                  </span>
                </button>
              </div>
            </div>

            {createError && (
              <div className="p-2.5 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <DialogFooter className="pt-3 border-t border-gray-800">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsCreateOpen(false)}
                disabled={isCreating}
                className="text-gray-400 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || !newWsName.trim()}
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    <span>Creating...</span>
                  </>
                ) : (
                  <span>Create Workspace</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* WORKSPACE SETTINGS & MEMBERS MODAL */}
      <Dialog
        open={Boolean(settingsWs)}
        onOpenChange={(open) => {
          if (!open) setSettingsWs(null);
        }}
      >
        <DialogContent className="bg-[#0f172a] text-gray-100 border border-gray-700 sm:max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
              <Settings className="w-5 h-5 text-blue-500" />
              <span>Workspace Settings: {settingsWs?.name}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-400">
              Configure workspace metadata, invite collaborators, and manage access roles.
            </DialogDescription>

            {/* Sub-tabs */}
            <div className="flex items-center gap-2 pt-2 border-b border-gray-800">
              <button
                onClick={() => setSettingsTab("general")}
                className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors ${
                  settingsTab === "general"
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                General Info
              </button>
              <button
                onClick={() => setSettingsTab("members")}
                className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  settingsTab === "members"
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                <span>Members</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-gray-300 font-mono">
                  {membersList.length}
                </span>
              </button>
              <button
                onClick={() => setSettingsTab("danger")}
                className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors text-red-400 ${
                  settingsTab === "danger"
                    ? "border-red-500 text-red-400"
                    : "border-transparent opacity-70 hover:opacity-100"
                }`}
              >
                Danger Zone
              </button>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-3 space-y-4">
            {settingsTab === "general" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Workspace Name
                  </label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={64}
                    className="bg-slate-900 border-gray-700 text-white text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1">
                    Description
                  </label>
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    maxLength={256}
                    rows={3}
                    className="w-full bg-slate-900 border border-gray-700 rounded-md p-2 text-xs text-white outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                    Visibility
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setEditIsPublic(true)}
                      className={`p-2.5 rounded-lg border text-left transition-all flex items-center gap-2 ${
                        editIsPublic
                          ? "border-blue-500 bg-blue-500/10 text-white"
                          : "border-gray-800 bg-slate-900 text-gray-400"
                      }`}
                    >
                      <Globe className="w-4 h-4 text-emerald-400" />
                      <div className="text-xs">
                        <div className="font-semibold">Public</div>
                        <div className="text-[10px] text-gray-400">Accessible by all</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditIsPublic(false)}
                      className={`p-2.5 rounded-lg border text-left transition-all flex items-center gap-2 ${
                        !editIsPublic
                          ? "border-blue-500 bg-blue-500/10 text-white"
                          : "border-gray-800 bg-slate-900 text-gray-400"
                      }`}
                    >
                      <Lock className="w-4 h-4 text-amber-400" />
                      <div className="text-xs">
                        <div className="font-semibold">Private</div>
                        <div className="text-[10px] text-gray-400">Members only</div>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <Button
                    onClick={handleSaveSettings}
                    disabled={isSavingSettings || !editName.trim()}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
                  >
                    {isSavingSettings ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Changes</span>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {settingsTab === "members" && (
              <div className="space-y-5">
                {/* Invite form */}
                <div className="p-3 bg-slate-900/90 rounded-lg border border-gray-800">
                  <h4 className="text-xs font-bold text-gray-200 mb-2 flex items-center gap-1.5">
                    <UserPlus className="w-4 h-4 text-blue-400" />
                    <span>Invite Teammate</span>
                  </h4>
                  <form onSubmit={handleInviteMember} className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="user@example.com"
                      value={inviteEmailInput}
                      onChange={(e) => setInviteEmailInput(e.target.value)}
                      required
                      className="bg-slate-950 border-gray-700 text-white text-xs flex-1"
                    />
                    <Button
                      type="submit"
                      disabled={isInviting || !inviteEmailInput.trim()}
                      className="bg-blue-600 hover:bg-blue-500 text-white text-xs whitespace-nowrap"
                    >
                      {isInviting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <span>Send Invite</span>
                      )}
                    </Button>
                  </form>
                </div>

                {/* Members list */}
                <div>
                  <h4 className="text-xs font-bold text-gray-300 mb-2">
                    Current Members ({membersList.length})
                  </h4>
                  {loadingMembers ? (
                    <div className="py-6 text-center text-gray-400 text-xs">
                      <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1 text-blue-400" />
                      Loading members...
                    </div>
                  ) : membersList.length === 0 ? (
                    <p className="text-xs text-gray-500">No members found.</p>
                  ) : (
                    <div className="space-y-2">
                      {membersList.map((m) => {
                        const isSelf = m.id === currentUser?.uid;
                        return (
                          <div
                            key={m.id}
                            className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-gray-800"
                          >
                            <div className="flex items-center gap-2.5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={m.photoURL || "/robotic.png"}
                                alt=""
                                className="w-7 h-7 rounded-full border border-gray-700"
                              />
                              <div>
                                <div className="text-xs font-medium text-white flex items-center gap-1.5">
                                  <span>{m.displayName || "Member"}</span>
                                  {isSelf && (
                                    <span className="text-[10px] text-blue-400 font-mono">(You)</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-gray-500 font-mono">
                                  ID: {m.id.slice(0, 8)}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {/* Role Selector */}
                              <select
                                value={m.role || "contributor"}
                                onChange={(e) => handleUpdateMemberRole(m.id, e.target.value)}
                                disabled={isSelf}
                                className="bg-slate-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-blue-500"
                              >
                                <option value={WORKSPACE_ROLES.OWNER}>Owner</option>
                                <option value={WORKSPACE_ROLES.CONTRIBUTOR}>Contributor</option>
                                <option value={WORKSPACE_ROLES.VIEWER}>Viewer</option>
                              </select>

                              {/* Remove button */}
                              {!isSelf && (
                                <button
                                  onClick={() => handleRemoveMember(m.id)}
                                  className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                  title="Remove Member"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {settingsTab === "danger" && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-red-950/20 border border-red-800/40">
                  <h4 className="text-xs font-bold text-red-400 flex items-center gap-1.5 mb-1">
                    <Archive className="w-4 h-4" />
                    <span>Archive Workspace</span>
                  </h4>
                  <p className="text-xs text-gray-400 mb-3">
                    Archived workspaces are hidden from the primary list but retain all history and files.
                  </p>
                  <Button
                    onClick={() => handleToggleArchive(settingsWs)}
                    variant="outline"
                    size="sm"
                    className="border-red-800/60 text-red-300 hover:bg-red-950/40 text-xs"
                  >
                    {settingsWs?.archived ? "Unarchive Workspace" : "Archive Workspace"}
                  </Button>
                </div>

                <div className="p-4 rounded-lg bg-red-950/40 border border-red-700/60">
                  <h4 className="text-xs font-bold text-red-400 flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Delete Workspace Permanently</span>
                  </h4>
                  <p className="text-xs text-gray-300 mb-3">
                    Permanently deletes this workspace and all associated files, folders, commit history, and chat messages. This action cannot be undone.
                  </p>
                  <Button
                    onClick={() => {
                      setDeleteTargetWs(settingsWs);
                      setDeleteConfirmText("");
                    }}
                    className="bg-red-600 hover:bg-red-500 text-white text-xs font-medium"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    <span>Delete Workspace...</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* SAFE DELETE CONFIRMATION MODAL */}
      <Dialog
        open={Boolean(deleteTargetWs)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTargetWs(null);
            setDeleteConfirmText("");
          }
        }}
      >
        <DialogContent className="bg-[#0f172a] text-gray-100 border border-red-800/60 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              <span>Confirm Workspace Deletion</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-300">
              You are about to permanently delete{" "}
              <strong className="text-white font-mono">{deleteTargetWs?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handlePerformCascadingDelete} className="space-y-4 py-1">
            <div className="space-y-3 text-xs text-gray-300">
              <div className="p-3 bg-red-950/40 border border-red-900 rounded-md space-y-1 text-red-200">
                <p className="font-semibold">Cascading deletion will destroy:</p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-gray-300">
                  <li>All workspace files and directories</li>
                  <li>All Git commit logs and state records</li>
                  <li>All collaborator permissions and memberships</li>
                  <li>All chat messages associated with this workspace</li>
                </ul>
              </div>

              <div>
                <label className="block mb-1 text-gray-400 text-xs">
                  Type the workspace name <strong className="text-white font-mono">{deleteTargetWs?.name}</strong> to confirm:
                </label>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={deleteTargetWs?.name}
                  className="bg-slate-900 border-gray-700 text-white text-xs font-mono"
                  autoFocus
                />
              </div>
            </div>

            <DialogFooter className="pt-2 border-t border-gray-800">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDeleteTargetWs(null);
                  setDeleteConfirmText("");
                }}
                disabled={isDeleting}
                className="text-gray-400 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isDeleting || deleteConfirmText.trim() !== deleteTargetWs?.name?.trim()}
                className="bg-red-600 hover:bg-red-500 text-white text-xs font-medium"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Permanently Delete</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* LEAVE WORKSPACE CONFIRMATION MODAL */}
      <Dialog
        open={Boolean(leaveTargetWs)}
        onOpenChange={(open) => {
          if (!open) setLeaveTargetWs(null);
        }}
      >
        <DialogContent className="bg-[#0f172a] text-gray-100 border border-gray-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <LogOut className="w-5 h-5 text-red-400" />
              <span>Leave Workspace</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-400">
              Are you sure you want to leave{" "}
              <strong className="text-white">{leaveTargetWs?.name}</strong>?
            </DialogDescription>
          </DialogHeader>

          <p className="text-xs text-gray-300 py-2">
            You will lose access to edit this workspace and will require a new invitation from an owner to rejoin.
          </p>

          <DialogFooter className="pt-2 border-t border-gray-800">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLeaveTargetWs(null)}
              disabled={isLeaving}
              className="text-gray-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleLeaveWorkspace}
              disabled={isLeaving}
              className="bg-red-600 hover:bg-red-500 text-white text-xs font-medium"
            >
              {isLeaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  <span>Leaving...</span>
                </>
              ) : (
                <span>Leave Workspace</span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
