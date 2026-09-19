"use client";
import { useState, useEffect, useRef } from "react";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "@/config/firebase";
import { UserPlus, X, Loader2, Check } from "lucide-react";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useAuth } from "@/context/AuthProvider";

export default function SearchBar({ workspaceId }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [invitingId, setInvitingId] = useState(null);
  const [invitedIds, setInvitedIds] = useState(new Set());
  const [isOpen, setIsOpen] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState(new Set());
  const { user } = useAuth();
  const auth = getAuth();
  const containerRef = useRef(null);

  useEffect(() => {
    if (workspaceId && isOpen) {
      fetchWorkspaceMembers();
    }
  }, [workspaceId, isOpen]);

  useEffect(() => {
    const trimmed = searchTerm.trim();
    if (trimmed.length > 0) {
      const timer = setTimeout(() => {
        fetchUsers(trimmed);
      }, 250);
      return () => clearTimeout(timer);
    } else {
      setUsers([]);
    }
  }, [searchTerm]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const fetchWorkspaceMembers = async () => {
    try {
      const membersSet = new Set();
      // Include workspace owner
      const wsRef = doc(db, "workspaces", workspaceId);
      const wsSnap = await getDoc(wsRef);
      if (wsSnap.exists()) {
        const ownerId = wsSnap.data()?.userId || wsSnap.data()?.ownerId;
        if (ownerId) membersSet.add(ownerId);
      }

      // Include members subcollection
      const membersQuery = collection(db, `workspaces/${workspaceId}/members`);
      const membersSnapshot = await getDocs(membersQuery);
      membersSnapshot.docs.forEach((d) => {
        membersSet.add(d.id);
        const uId = d.data()?.userId;
        if (uId) membersSet.add(uId);
      });

      setWorkspaceMembers(membersSet);
    } catch (error) {
      console.warn("Notice fetching workspace members for invite search:", error.message);
    }
  };

  const fetchUsers = async (term) => {
    setLoading(true);
    try {
      const lower = term.toLowerCase();
      const currentEmail = user?.email || auth.currentUser?.email || "";
      const currentUid = user?.uid || auth.currentUser?.uid || "";

      const queries = [
        query(
          collection(db, "users"),
          where("email", ">=", lower),
          where("email", "<=", lower + "\uf8ff")
        ),
      ];

      // If user typed mixed/upper case, also query exact term
      if (term !== lower) {
        queries.push(
          query(
            collection(db, "users"),
            where("email", ">=", term),
            where("email", "<=", term + "\uf8ff")
          )
        );
      }

      const snapshots = await Promise.all(queries.map((q) => getDocs(q).catch(() => ({ docs: [] }))));
      const userMap = new Map();

      snapshots.forEach((snap) => {
        snap.docs.forEach((d) => {
          if (!userMap.has(d.id)) {
            userMap.set(d.id, { id: d.id, ...d.data() });
          }
        });
      });

      let matchedUsers = Array.from(userMap.values());

      // Filter out current user and existing workspace members
      matchedUsers = matchedUsers.filter(
        (u) =>
          u.id !== currentUid &&
          (!currentEmail || u.email?.toLowerCase() !== currentEmail.toLowerCase()) &&
          !workspaceMembers.has(u.id)
      );

      setUsers(matchedUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      toast.error("Failed to search users");
    } finally {
      setLoading(false);
    }
  };

  const inviteUser = async (userId, userEmail) => {
    if (invitingId) return;
    setInvitingId(userId);
    try {
      const token = await (user?.getIdToken() || auth.currentUser?.getIdToken());
      const response = await fetch(`/api/workspace/${workspaceId}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          recipientUserId: userId,
          recipientEmail: userEmail,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to send invitation");
      }

      setInvitedIds((prev) => new Set([...prev, userId]));
      if (data.alreadyInvited) {
        toast.info(`${userEmail} is already invited.`);
      } else {
        toast.success(`Invitation sent to ${userEmail}!`);
      }
    } catch (error) {
      console.error("Error sending invitation:", error);
      toast.error(error.message || "Failed to send invitation");
    } finally {
      setInvitingId(null);
    }
  };

  return (
    <div className="relative flex items-center" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="h-7 px-2.5 text-xs bg-slate-900 hover:bg-slate-800 text-gray-300 hover:text-white border border-gray-800 rounded-md transition-colors flex items-center gap-1.5 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
        title="Invite Member to Workspace"
        aria-label="Invite Members"
      >
        <UserPlus className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
        <span>Invite</span>
      </button>

      {isOpen && (
        <div className="absolute top-9 right-0 bg-[#0A0F1E] border border-white/[0.1] p-3 rounded-xl shadow-2xl w-80 sm:w-96 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
              Invite Collaborator
            </span>
            <button
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-white/[0.06] transition-colors"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2 flex items-center bg-gray-950 border border-white/[0.08] rounded-lg px-2.5 py-1.5 focus-within:border-indigo-500 transition-colors">
            <input
              type="text"
              placeholder="Search user by email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent text-white text-xs outline-none placeholder-slate-500"
              autoFocus
            />
          </div>

          {loading && (
            <div className="text-slate-400 text-xs text-center py-4 flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              <span>Searching users...</span>
            </div>
          )}

          {!loading && searchTerm.trim().length > 0 && users.length === 0 && (
            <div className="text-slate-500 text-xs text-center py-4">
              No matching registered users found.
            </div>
          )}

          <div className="mt-2 max-h-56 overflow-y-auto space-y-1 scrollbar-none">
            {users.map((u) => {
              const isInvited = invitedIds.has(u.id);
              const isInvitingThis = invitingId === u.id;
              return (
                <div
                  key={u.id}
                  className="flex justify-between items-center p-2 hover:bg-white/[0.04] rounded-lg transition-colors border border-transparent hover:border-white/[0.04]"
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="text-slate-200 text-xs font-medium truncate">
                      {u.displayName || u.email?.split("@")[0] || "Developer"}
                    </span>
                    <span className="text-slate-400 text-[11px] font-mono truncate">
                      {u.email}
                    </span>
                  </div>
                  <button
                    disabled={isInvited || isInvitingThis}
                    className={`px-3 py-1 text-xs rounded-md font-medium transition-colors flex items-center gap-1.5 flex-shrink-0 ${
                      isInvited
                        ? "bg-emerald-900/60 text-emerald-300 border border-emerald-800/80 cursor-default"
                        : "bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                    }`}
                    onClick={() => inviteUser(u.id, u.email)}
                  >
                    {isInvitingThis ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : isInvited ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Invited</span>
                      </>
                    ) : (
                      <span>Invite</span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ToastContainer position="top-right" autoClose={3000} theme="dark" hideProgressBar={false} />
    </div>
  );
}
