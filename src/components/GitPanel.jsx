"use client";

import React, { useState, useEffect, useCallback } from "react";
import { auth } from "@/config/firebase";
import {
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  RotateCcw,
  Plus,
  Minus,
  Check,
  AlertTriangle,
  History,
  Eye,
  RefreshCw,
  FolderGit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileCode,
} from "lucide-react";
import MonacoDiffViewer from "./MonacoDiffViewer";

export default function GitPanel({ workspaceId, userRole = "contributor", onOpenFile }) {
  const [status, setStatus] = useState(null);
  const [branches, setBranches] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const [activeTab, setActiveTab] = useState("changes"); // "changes" | "history"
  const [commitMessage, setCommitMessage] = useState("");
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [selectedMergeBranch, setSelectedMergeBranch] = useState("");

  const [diffModal, setDiffModal] = useState({
    isOpen: false,
    filePath: "",
    original: "",
    modified: "",
    title: "",
  });

  const isViewer = userRole === "viewer";

  const getAuthHeader = useCallback(async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (token) return { Authorization: `Bearer ${token}` };
    } catch {
      // Fallback
    }
    // Test mode token fallback
    return { Authorization: `Bearer test-token-${userRole}:current-user` };
  }, [userRole]);

  const apiFetch = useCallback(
    async (endpoint, options = {}) => {
      const authHeader = await getAuthHeader();
      const headers = {
        "Content-Type": "application/json",
        ...authHeader,
        ...(options.headers || {}),
      };

      const res = await fetch(`/api/workspace/${workspaceId}/git/${endpoint}`, {
        ...options,
        headers,
      });

      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Git operation failed");
      }
      return data;
    },
    [workspaceId, getAuthHeader]
  );

  const fetchStatus = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("status");
      setStatus(data.status);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, apiFetch]);

  const fetchBranches = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const data = await apiFetch("branches");
      setBranches(data.branches?.branches || []);
    } catch {
      // ignore
    }
  }, [workspaceId, apiFetch]);

  const fetchHistory = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const data = await apiFetch("history");
      setHistory(data.history?.commits || []);
    } catch {
      // ignore
    }
  }, [workspaceId, apiFetch]);

  useEffect(() => {
    fetchStatus();
    fetchBranches();
  }, [fetchStatus, fetchBranches]);

  useEffect(() => {
    if (activeTab === "history") {
      fetchHistory();
    }
  }, [activeTab, fetchHistory]);

  const showFeedback = (msg, isErr = false) => {
    if (isErr) {
      setError(msg);
      setTimeout(() => setError(null), 5000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 4000);
    }
  };

  const handleInitRepo = async () => {
    setActionLoading(true);
    try {
      await apiFetch("init", { method: "POST", body: JSON.stringify({}) });
      showFeedback("Git repository initialized successfully");
      await fetchStatus();
      await fetchBranches();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStageFile = async (filePath) => {
    setActionLoading(true);
    try {
      await apiFetch("stage", {
        method: "POST",
        body: JSON.stringify({ files: [filePath] }),
      });
      await fetchStatus();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStageAll = async () => {
    setActionLoading(true);
    try {
      await apiFetch("stage", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });
      await fetchStatus();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnstageFile = async (filePath) => {
    setActionLoading(true);
    try {
      await apiFetch("unstage", {
        method: "POST",
        body: JSON.stringify({ files: [filePath] }),
      });
      await fetchStatus();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnstageAll = async () => {
    setActionLoading(true);
    try {
      await apiFetch("unstage", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });
      await fetchStatus();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      showFeedback("Please enter a commit message", true);
      return;
    }
    setActionLoading(true);
    try {
      await apiFetch("commit", {
        method: "POST",
        body: JSON.stringify({ message: commitMessage.trim() }),
      });
      setCommitMessage("");
      showFeedback("Changes committed successfully");
      await fetchStatus();
      if (activeTab === "history") await fetchHistory();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestoreFile = async (filePath) => {
    if (!confirm(`Are you sure you want to discard changes in '${filePath}'?`)) return;
    setActionLoading(true);
    try {
      await apiFetch("restore", {
        method: "POST",
        body: JSON.stringify({ file: filePath }),
      });
      showFeedback(`Discarded changes in ${filePath}`);
      await fetchStatus();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    setActionLoading(true);
    try {
      await apiFetch("branches", {
        method: "POST",
        body: JSON.stringify({ branchName: newBranchName.trim() }),
      });
      setNewBranchName("");
      setShowCreateBranch(false);
      showFeedback(`Branch '${newBranchName.trim()}' created`);
      await fetchBranches();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSwitchBranch = async (branchName) => {
    if (branchName === status?.branch) return;
    setActionLoading(true);
    try {
      await apiFetch("branches/checkout", {
        method: "POST",
        body: JSON.stringify({ branchName }),
      });
      showFeedback(`Switched to branch '${branchName}'`);
      await fetchStatus();
      await fetchBranches();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMergeBranch = async () => {
    if (!selectedMergeBranch) return;
    setActionLoading(true);
    try {
      const data = await apiFetch("merge", {
        method: "POST",
        body: JSON.stringify({ sourceBranch: selectedMergeBranch }),
      });
      setShowMergeModal(false);
      if (data.result?.clean === false || data.result?.status === "conflict") {
        showFeedback("Merge conflict detected. Please resolve conflicts.", true);
      } else {
        showFeedback(`Branch '${selectedMergeBranch}' merged cleanly`);
      }
      await fetchStatus();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAbortMerge = async () => {
    setActionLoading(true);
    try {
      await apiFetch("merge", {
        method: "POST",
        body: JSON.stringify({ abort: true }),
      });
      showFeedback("Merge aborted successfully");
      await fetchStatus();
    } catch (err) {
      showFeedback(err.message, true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenDiff = async (filePath, staged = false) => {
    setActionLoading(true);
    try {
      const data = await apiFetch(`diff?file=${encodeURIComponent(filePath)}&staged=${staged}`);
      const diffData = data.diff || {};
      setDiffModal({
        isOpen: true,
        filePath,
        original: diffData.original || "",
        modified: diffData.modified || "",
        title: staged ? "Staged Changes" : "Working Tree Changes",
      });
    } catch (err) {
      showFeedback(`Failed to load diff: ${err.message}`, true);
    } finally {
      setActionLoading(false);
    }
  };

  // 1. Loading State
  if (!status) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gray-900 text-gray-400 p-4" data-testid="git-panel-loading">
        <RefreshCw className="w-5 h-5 animate-spin text-indigo-400 mb-2" />
        <span className="text-xs font-mono">Loading Git Status...</span>
      </div>
    );
  }

  // 2. Uninitialized State
  if (!status.initialized) {
    return (
      <div className="flex flex-col h-full bg-gray-900 text-gray-200 p-4 select-none" data-testid="git-panel-uninitialized">
        <div className="flex items-center gap-2 mb-6 border-b border-gray-800 pb-3">
          <FolderGit2 className="w-5 h-5 text-indigo-400" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">
            Source Control
          </h2>
        </div>

        <div className="flex flex-col items-center justify-center flex-1 text-center p-4">
          <div className="p-3 bg-indigo-500/10 rounded-full text-indigo-400 mb-3">
            <GitBranch className="w-8 h-8" />
          </div>
          <h3 className="text-sm font-medium text-gray-200 mb-1">No Git Repository Found</h3>
          <p className="text-xs text-gray-400 mb-4 max-w-xs">
            Initialize a Git repository to start version controlling files and collaborating across branches.
          </p>
          {!isViewer ? (
            <button
              onClick={handleInitRepo}
              disabled={actionLoading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded-md shadow transition-colors flex items-center gap-2"
              data-testid="git-init-btn"
            >
              {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FolderGit2 className="w-4 h-4" />}
              Initialize Repository
            </button>
          ) : (
            <div className="text-xs text-amber-400 bg-amber-400/10 px-3 py-1.5 rounded">
              Viewer role is read-only.
            </div>
          )}
        </div>
      </div>
    );
  }

  const stagedList = status?.staged || [];
  const unstagedList = status?.unstaged || [];
  const untrackedList = status?.untracked || [];
  const conflictsList = status?.conflicts || [];
  const allChanges = [...unstagedList.map((u) => ({ ...u, type: "unstaged" })), ...untrackedList.map((p) => ({ path: p, status: "U", type: "untracked" }))];

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-200 text-xs select-none" data-testid="git-panel">
      {/* Panel Top Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800 bg-gray-950/40">
        <div className="flex items-center gap-2">
          <FolderGit2 className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-gray-200 uppercase tracking-wider text-[11px]">
            Source Control
          </span>
          {isViewer && (
            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30">
              Read-Only
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => fetchStatus()}
            disabled={loading || actionLoading}
            className="p-1 hover:bg-gray-800 text-gray-400 hover:text-gray-200 rounded transition-colors"
            title="Refresh Status"
            data-testid="git-refresh-btn"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Branch & Actions Bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-800/80">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <GitBranch className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
          <select
            value={status?.branch || "main"}
            onChange={(e) => handleSwitchBranch(e.target.value)}
            disabled={isViewer || actionLoading}
            className="bg-gray-800 text-gray-200 border border-gray-700 text-xs rounded px-2 py-0.5 outline-none focus:border-indigo-500 max-w-[120px] truncate"
            data-testid="branch-select"
          >
            {branches.map((b) => (
              <option key={b.name || b} value={b.name || b}>
                {b.name || b}
              </option>
            ))}
          </select>
        </div>

        {!isViewer && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowCreateBranch(!showCreateBranch)}
              className="px-1.5 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded flex items-center gap-1"
              title="Create New Branch"
              data-testid="new-branch-btn"
            >
              <Plus className="w-3 h-3" /> New
            </button>
            <button
              onClick={() => setShowMergeModal(true)}
              className="px-1.5 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded flex items-center gap-1"
              title="Merge Branch"
              data-testid="merge-branch-btn"
            >
              <GitMerge className="w-3 h-3" /> Merge
            </button>
          </div>
        )}
      </div>

      {/* New Branch Input Dropdown */}
      {showCreateBranch && (
        <div className="p-2 bg-gray-950/80 border-b border-gray-800 flex items-center gap-1.5 animate-fadeIn">
          <input
            type="text"
            placeholder="new-branch-name"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            className="flex-1 bg-gray-800 text-xs px-2 py-1 rounded border border-gray-700 focus:border-indigo-500 outline-none text-gray-100"
            data-testid="branch-name-input"
          />
          <button
            onClick={handleCreateBranch}
            disabled={!newBranchName.trim() || actionLoading}
            className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px]"
            data-testid="confirm-create-branch"
          >
            Create
          </button>
        </div>
      )}

      {/* Navigation Tabs (Changes vs History) */}
      <div className="flex border-b border-gray-800 bg-gray-950/20 text-gray-400">
        <button
          onClick={() => setActiveTab("changes")}
          className={`flex-1 py-1.5 text-center font-medium border-b-2 transition-colors ${
            activeTab === "changes"
              ? "text-indigo-400 border-indigo-500 bg-indigo-500/5"
              : "border-transparent hover:text-gray-200"
          }`}
          data-testid="tab-changes"
        >
          Changes ({stagedList.length + allChanges.length})
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 py-1.5 text-center font-medium border-b-2 transition-colors ${
            activeTab === "history"
              ? "text-indigo-400 border-indigo-500 bg-indigo-500/5"
              : "border-transparent hover:text-gray-200"
          }`}
          data-testid="tab-history"
        >
          History
        </button>
      </div>

      {/* Feedback Banner */}
      {error && (
        <div className="m-2 p-2 bg-red-900/30 border border-red-700/50 rounded text-red-200 text-[11px] flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <span className="flex-1 leading-tight">{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="m-2 p-2 bg-emerald-900/30 border border-emerald-700/50 rounded text-emerald-200 text-[11px] flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Merge Conflict Alert Banner */}
      {conflictsList.length > 0 && (
        <div className="m-2 p-2.5 bg-amber-950/60 border border-amber-600/60 rounded text-amber-200 text-[11px]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-semibold flex items-center gap-1.5 text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Merge Conflicts Detected ({conflictsList.length})
            </span>
            {!isViewer && (
              <button
                onClick={handleAbortMerge}
                className="text-[10px] bg-red-800 hover:bg-red-700 text-white px-1.5 py-0.5 rounded"
                title="Abort in-progress merge"
                data-testid="abort-merge-btn"
              >
                Abort Merge
              </button>
            )}
          </div>
          <p className="text-[10px] text-amber-300/80 mb-2">
            Resolve conflicts in the files below before completing the merge.
          </p>
          <div className="space-y-1">
            {conflictsList.map((c) => (
              <div key={c} className="flex items-center justify-between bg-amber-900/30 px-2 py-1 rounded">
                <span className="font-mono text-[10px] truncate">{c}</span>
                <button
                  onClick={() => handleOpenDiff(c)}
                  className="p-1 hover:bg-amber-800/50 rounded text-amber-300"
                  title="View conflict diff"
                >
                  <Eye className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB CONTENT: CHANGES */}
      {activeTab === "changes" && (
        <div className="flex-1 overflow-y-auto flex flex-col p-2 space-y-4">
          {/* Commit Message Box */}
          {!isViewer && (
            <div className="flex flex-col space-y-2 bg-gray-950/40 p-2.5 rounded-lg border border-gray-800">
              <textarea
                placeholder="Commit message..."
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                disabled={actionLoading}
                rows={2}
                className="w-full bg-gray-900 text-gray-100 text-xs p-2 rounded border border-gray-700 focus:border-indigo-500 outline-none resize-none placeholder-gray-500"
                data-testid="commit-message-input"
              />
              <button
                onClick={handleCommit}
                disabled={actionLoading || stagedList.length === 0 || !commitMessage.trim()}
                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-medium text-xs rounded transition-colors flex items-center justify-center gap-1.5 shadow"
                data-testid="commit-btn"
              >
                <GitCommit className="w-3.5 h-3.5" /> Commit Staged ({stagedList.length})
              </button>
            </div>
          )}

          {/* Staged Changes Section */}
          <div className="flex flex-col space-y-1">
            <div className="flex items-center justify-between px-1 py-1 text-gray-400">
              <span className="font-medium uppercase tracking-wider text-[10px]">
                Staged Changes ({stagedList.length})
              </span>
              {!isViewer && stagedList.length > 0 && (
                <button
                  onClick={handleUnstageAll}
                  className="p-0.5 hover:bg-gray-800 rounded text-gray-400 hover:text-gray-200"
                  title="Unstage All Changes"
                  data-testid="unstage-all-btn"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {stagedList.length === 0 ? (
              <div className="px-2 py-1.5 text-gray-500 text-[11px] italic">No staged changes</div>
            ) : (
              <div className="space-y-0.5">
                {stagedList.map((item) => (
                  <div
                    key={item.path}
                    className="flex items-center justify-between px-2 py-1 rounded hover:bg-gray-800/60 group"
                    data-testid={`staged-item-${item.path}`}
                  >
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span
                        className={`font-mono text-[10px] font-bold px-1 rounded ${
                          item.status === "A"
                            ? "text-emerald-400 bg-emerald-500/10"
                            : item.status === "D"
                            ? "text-red-400 bg-red-500/10"
                            : "text-amber-400 bg-amber-500/10"
                        }`}
                      >
                        {item.status}
                      </span>
                      <span className="truncate text-gray-300 font-mono text-[11px]">{item.path}</span>
                    </div>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      <button
                        onClick={() => handleOpenDiff(item.path, true)}
                        className="p-1 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded"
                        title="View Diff"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                      {!isViewer && (
                        <button
                          onClick={() => handleUnstageFile(item.path)}
                          className="p-1 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded"
                          title="Unstage File"
                          data-testid={`unstage-file-${item.path}`}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Working Tree Changes Section */}
          <div className="flex flex-col space-y-1">
            <div className="flex items-center justify-between px-1 py-1 text-gray-400">
              <span className="font-medium uppercase tracking-wider text-[10px]">
                Changes ({allChanges.length})
              </span>
              {!isViewer && allChanges.length > 0 && (
                <button
                  onClick={handleStageAll}
                  className="p-0.5 hover:bg-gray-800 rounded text-gray-400 hover:text-gray-200"
                  title="Stage All Changes"
                  data-testid="stage-all-btn"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {allChanges.length === 0 ? (
              <div className="px-2 py-1.5 text-gray-500 text-[11px] italic">Working tree clean</div>
            ) : (
              <div className="space-y-0.5">
                {allChanges.map((item) => (
                  <div
                    key={item.path}
                    className="flex items-center justify-between px-2 py-1 rounded hover:bg-gray-800/60 group"
                    data-testid={`change-item-${item.path}`}
                  >
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span
                        className={`font-mono text-[10px] font-bold px-1 rounded ${
                          item.status === "U"
                            ? "text-blue-400 bg-blue-500/10"
                            : item.status === "D"
                            ? "text-red-400 bg-red-500/10"
                            : "text-amber-400 bg-amber-500/10"
                        }`}
                      >
                        {item.status}
                      </span>
                      <span className="truncate text-gray-300 font-mono text-[11px]">{item.path}</span>
                    </div>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      <button
                        onClick={() => handleOpenDiff(item.path, false)}
                        className="p-1 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded"
                        title="View Diff"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                      {!isViewer && (
                        <>
                          <button
                            onClick={() => handleRestoreFile(item.path)}
                            className="p-1 hover:bg-gray-700 text-gray-400 hover:text-red-300 rounded"
                            title="Discard Changes"
                            data-testid={`discard-file-${item.path}`}
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleStageFile(item.path)}
                            className="p-1 hover:bg-gray-700 text-gray-400 hover:text-gray-200 rounded"
                            title="Stage File"
                            data-testid={`stage-file-${item.path}`}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT: HISTORY */}
      {activeTab === "history" && (
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {history.length === 0 ? (
            <div className="text-center py-8 text-gray-500 italic text-xs">No commits yet</div>
          ) : (
            <div className="space-y-2">
              {history.map((c) => (
                <div
                  key={c.hash || c.commitHash}
                  className="bg-gray-950/40 p-2.5 rounded-lg border border-gray-800/80 hover:border-gray-700 transition-colors"
                  data-testid={`commit-entry-${c.shortHash}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] text-indigo-400 font-bold bg-indigo-500/10 px-1.5 py-0.5 rounded">
                      {c.shortHash}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {c.date ? new Date(c.date).toLocaleDateString() : ""}
                    </span>
                  </div>
                  <p className="text-gray-200 text-xs font-medium line-clamp-2 mb-1">{c.message}</p>
                  <div className="text-[10px] text-gray-400 flex items-center justify-between">
                    <span>{c.author?.name || c.authorName || "CodeCraft"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Merge Modal Dialog */}
      {showMergeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 w-full max-w-sm shadow-xl">
            <h3 className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-indigo-400" /> Merge into &apos;{status?.branch}&apos;
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Select a source branch to merge into current branch:
            </p>
            <select
              value={selectedMergeBranch}
              onChange={(e) => setSelectedMergeBranch(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-xs text-gray-200 rounded p-2 mb-4 outline-none focus:border-indigo-500"
            >
              <option value="">-- Choose Branch --</option>
              {branches
                .filter((b) => (b.name || b) !== status?.branch)
                .map((b) => (
                  <option key={b.name || b} value={b.name || b}>
                    {b.name || b}
                  </option>
                ))}
            </select>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowMergeModal(false)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleMergeBranch}
                disabled={!selectedMergeBranch || actionLoading}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-xs font-medium"
                data-testid="confirm-merge-btn"
              >
                Confirm Merge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Monaco Diff Viewer Modal */}
      <MonacoDiffViewer
        isOpen={diffModal.isOpen}
        onClose={() => setDiffModal((prev) => ({ ...prev, isOpen: false }))}
        filePath={diffModal.filePath}
        original={diffModal.original}
        modified={diffModal.modified}
        title={diffModal.title}
      />
    </div>
  );
}
