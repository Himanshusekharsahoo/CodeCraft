/**
 * Workspace Domain Logic & Helper Utilities for CodeCraft Phase 12.5.
 * Provides validation, role-based authorization checks, and workspace filtering.
 */

export const WORKSPACE_ROLES = {
  OWNER: "owner",
  CONTRIBUTOR: "contributor",
  VIEWER: "viewer",
};

/**
 * Validates and sanitizes a proposed workspace name.
 *
 * @param {string} rawName
 * @returns {{ valid: boolean, error: string | null, sanitizedName: string }}
 */
export function validateWorkspaceName(rawName) {
  if (typeof rawName !== "string") {
    return { valid: false, error: "Workspace name must be a string", sanitizedName: "" };
  }

  const trimmed = rawName.trim();

  if (!trimmed || trimmed.length === 0) {
    return { valid: false, error: "Workspace name cannot be empty", sanitizedName: "" };
  }

  if (trimmed.length > 64) {
    return { valid: false, error: "Workspace name cannot exceed 64 characters", sanitizedName: "" };
  }

  // Reject path traversal and directory separators
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    return { valid: false, error: "Workspace name cannot contain path traversal or slashes", sanitizedName: "" };
  }

  // Reject control characters or null bytes
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { valid: false, error: "Workspace name cannot contain control characters", sanitizedName: "" };
  }

  return { valid: true, error: null, sanitizedName: trimmed };
}

/**
 * Validates and sanitizes workspace description.
 *
 * @param {string} [desc=""]
 * @returns {string}
 */
export function sanitizeWorkspaceDescription(desc = "") {
  if (typeof desc !== "string") return "";
  return desc.trim().slice(0, 256);
}

/**
 * Formats a raw role string into a human-friendly label.
 *
 * @param {string} role
 * @returns {string}
 */
export function formatWorkspaceRole(role) {
  switch ((role || "").toLowerCase()) {
    case "owner":
      return "Owner";
    case "contributor":
      return "Contributor";
    case "viewer":
      return "Viewer";
    default:
      return "Member";
  }
}

/**
 * Returns role badge styling classes for consistent UI presentation.
 *
 * @param {string} role
 * @returns {{ label: string, bgClass: string, textClass: string, borderClass: string }}
 */
export function getRoleBadgeStyle(role) {
  switch ((role || "").toLowerCase()) {
    case "owner":
      return {
        label: "Owner",
        bgClass: "bg-purple-950/60",
        textClass: "text-purple-300",
        borderClass: "border-purple-700/50",
      };
    case "contributor":
      return {
        label: "Contributor",
        bgClass: "bg-emerald-950/60",
        textClass: "text-emerald-300",
        borderClass: "border-emerald-700/50",
      };
    case "viewer":
      return {
        label: "Viewer",
        bgClass: "bg-amber-950/60",
        textClass: "text-amber-300",
        borderClass: "border-amber-700/50",
      };
    default:
      return {
        label: "Member",
        bgClass: "bg-slate-800",
        textClass: "text-gray-300",
        borderClass: "border-gray-700",
      };
  }
}

/**
 * Checks if a given role has authority to manage workspace members.
 *
 * @param {string} role
 * @returns {boolean}
 */
export function canManageMembers(role) {
  return (role || "").toLowerCase() === WORKSPACE_ROLES.OWNER;
}

/**
 * Checks if a given role has authority to rename or delete the workspace.
 *
 * @param {string} role
 * @returns {boolean}
 */
export function canDeleteWorkspace(role) {
  return (role || "").toLowerCase() === WORKSPACE_ROLES.OWNER;
}

/**
 * Checks if a member can leave the workspace.
 * Owners cannot leave if they are the sole owner, as it would orphan the workspace.
 *
 * @param {string} role
 * @param {boolean} [isSoleOwner=true]
 * @returns {{ canLeave: boolean, reason: string | null }}
 */
export function canLeaveWorkspace(role, isSoleOwner = true) {
  const normRole = (role || "").toLowerCase();
  if (normRole === WORKSPACE_ROLES.OWNER && isSoleOwner) {
    return {
      canLeave: false,
      reason: "Workspace owners cannot leave without transferring ownership or deleting the workspace.",
    };
  }
  return { canLeave: true, reason: null };
}

/**
 * Filters and searches workspaces list based on active tab and query.
 *
 * @param {Array<object>} workspaces
 * @param {string} [searchQuery=""]
 * @param {string} [activeTab="all"] - 'all' | 'owned' | 'shared' | 'recent'
 * @param {string} [currentUserId=""]
 * @returns {Array<object>}
 */
export function filterWorkspaces(workspaces = [], searchQuery = "", activeTab = "all", currentUserId = "") {
  if (!Array.isArray(workspaces)) return [];

  // Deduplicate by workspace ID to ensure uniqueness across all views
  const seenIds = new Set();
  const deduped = workspaces.filter((ws) => {
    if (!ws || !ws.id) return false;
    if (seenIds.has(ws.id)) return false;
    seenIds.add(ws.id);
    return true;
  });

  let filtered = [...deduped];

  // 1. Tab filtering
  switch (activeTab) {
    case "owned":
      filtered = filtered.filter(
        (ws) => ws.userId === currentUserId || ws.ownerId === currentUserId || (ws.role || "").toLowerCase() === "owner"
      );
      break;
    case "shared":
      filtered = filtered.filter(
        (ws) => (ws.userId !== currentUserId && ws.ownerId !== currentUserId) && (ws.role || "").toLowerCase() !== "owner"
      );
      break;
    case "recent":
      filtered = filtered
        .filter((ws) => ws.lastOpenedAt)
        .sort((a, b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt));
      break;
    case "all":
    default:
      // Show all non-archived by default
      filtered = filtered.filter((ws) => !ws.archived);
      break;
  }

  // 2. Search query filtering
  const queryTrimmed = (searchQuery || "").trim().toLowerCase();
  if (queryTrimmed.length > 0) {
    filtered = filtered.filter((ws) => {
      const name = (ws.name || "").toLowerCase();
      const desc = (ws.description || "").toLowerCase();
      const role = (ws.role || "").toLowerCase();
      return name.includes(queryTrimmed) || desc.includes(queryTrimmed) || role.includes(queryTrimmed);
    });
  }

  return filtered;
}

/**
 * Resolves a user's membership and role in a given workspace document.
 * Enforces strict data isolation: non-members never receive viewer role for dashboard inclusion.
 *
 * @param {object} workspace - Workspace document data
 * @param {string} userId - Current user's UID
 * @param {object | null} [memberRecord=null] - User's subcollection member document if present
 * @returns {{ isMember: boolean, role: string | null }}
 */
export function resolveUserWorkspaceMembership(workspace, userId, memberRecord = null) {
  if (!workspace || !userId) {
    return { isMember: false, role: null };
  }

  const isOwner = workspace.userId === userId || workspace.ownerId === userId;
  if (isOwner) {
    return { isMember: true, role: WORKSPACE_ROLES.OWNER };
  }

  if (memberRecord && memberRecord.role) {
    return { isMember: true, role: memberRecord.role };
  }

  // Strict Data Isolation Invariant:
  // Public visibility alone DOES NOT grant membership or dashboard residency to non-members.
  return { isMember: false, role: null };
}

/**
 * Key for localStorage recent workspaces cache per user.
 *
 * @param {string} userId
 * @returns {string}
 */
export function getRecentStorageKey(userId) {
  return `codecraft_recent_ws_${userId || "anon"}`;
}

/**
 * Records a workspace open event into client local cache (capped at 5).
 *
 * @param {string} userId
 * @param {{ id: string, name: string }} workspace
 */
export function recordRecentWorkspace(userId, workspace) {
  if (typeof window === "undefined" || !workspace?.id) return;
  try {
    const key = getRecentStorageKey(userId);
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    const filtered = existing.filter((item) => item.id !== workspace.id);
    const updated = [
      {
        id: workspace.id,
        name: workspace.name,
        openedAt: new Date().toISOString(),
      },
      ...filtered,
    ].slice(0, 5);
    localStorage.setItem(key, JSON.stringify(updated));
  } catch (err) {
    console.warn("Could not save recent workspace to localStorage:", err);
  }
}
