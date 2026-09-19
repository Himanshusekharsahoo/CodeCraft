"use client";

import { useState, useRef, useEffect } from "react";
import {
  Bot,
  Play,
  RotateCcw,
  GitCompare,
  FileCode,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Clock,
  Check,
  Shield,
  FileText,
  Terminal,
  X,
} from "lucide-react";
import axios from "axios";
import MonacoDiffViewer from "./MonacoDiffViewer";
import { runAIAgent, rollbackAIAgent } from "@/api";
import { formatAgentPhase } from "@/lib/agentUiHelpers";

export default function AgentPanel({
  workspaceId,
  userRole = "contributor",
  onOpenFile,
  openFiles = [],
  authToken = null,
  onClose = null,
  isFloating = false,
  activeFile = null,
}) {
  const draftKey = workspaceId ? `codecraft_agent_draft_${workspaceId}` : null;
  const [taskPrompt, setTaskPrompt] = useState(() => {
    if (typeof window !== "undefined" && draftKey) {
      try {
        return sessionStorage.getItem(draftKey) || "";
      } catch {
        return "";
      }
    }
    return "";
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [currentRun, setCurrentRun] = useState(null);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffFile, setDiffFile] = useState(null);
  const [diffContent, setDiffContent] = useState({ original: "", modified: "" });

  const isViewer = userRole === "viewer";
  const logEndRef = useRef(null);

  // Sync draft prompt to sessionStorage to preserve unsent input across panel toggles and reloads
  useEffect(() => {
    if (typeof window !== "undefined" && draftKey) {
      try {
        if (taskPrompt) {
          sessionStorage.setItem(draftKey, taskPrompt);
        } else {
          sessionStorage.removeItem(draftKey);
        }
      } catch {
        // ignore storage errors
      }
    }
  }, [taskPrompt, draftKey]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [currentRun?.activityLog]);

  const isRunningRef = useRef(false);

  const handleRunAgent = async () => {
    if (!taskPrompt.trim() || isRunning || isRunningRef.current || isViewer) return;

    isRunningRef.current = true;
    setIsRunning(true);
    setError(null);
    setStatusMessage("Starting AI Coding Agent...");
    setCurrentRun(null);

    // Extract live Monaco editor context (selected code snippet and problem diagnostics)
    let selectedCode = "";
    let diagnostics = [];
    if (typeof window !== "undefined") {
      const editor = window.__codecraftEditor;
      const monaco = window.monaco;
      if (editor) {
        try {
          const selection = editor.getSelection();
          if (selection && !selection.isEmpty()) {
            selectedCode = editor.getModel()?.getValueInRange(selection) || "";
          }
        } catch {
          // ignore
        }
      }
      if (monaco && monaco.editor) {
        try {
          const markers = monaco.editor.getModelMarkers({});
          diagnostics = markers.map((m) => ({
            severity: m.severity === 8 ? "ERROR" : m.severity === 4 ? "WARNING" : "INFO",
            message: m.message,
            startLineNumber: m.startLineNumber,
            startColumn: m.startColumn,
            endLineNumber: m.endLineNumber,
            endColumn: m.endColumn,
            source: m.source || "monaco",
          }));
        } catch {
          // ignore
        }
      }
    }

    const currentActive = activeFile || (openFiles.length > 0 ? openFiles[0] : null);

    try {
      const response = await runAIAgent(workspaceId, taskPrompt.trim(), {
        token: authToken,
        openFiles: openFiles.map((f) => ({
          id: f.id,
          name: f.name,
          path: f.path || f.name,
          content: typeof f.content === "string" ? f.content : undefined,
        })),
        activeFile: currentActive
          ? {
              id: currentActive.id,
              name: currentActive.name,
              path: currentActive.path || currentActive.name,
            }
          : null,
        selectedCode,
        diagnostics,
      });

      if (response?.success && response?.result) {
        setCurrentRun(response.result);
        setStatusMessage("Agent run completed successfully.");
      } else {
        const errorMsg = response?.error || "Agent execution failed";
        if (response?.status === 429 || response?.code === "AI_RATE_LIMITED") {
          const waitMsg = response?.retryAfter ? ` (Retry after ${response.retryAfter}s)` : "";
          setError(`${errorMsg}${waitMsg}`);
        } else if (response?.status === 401 || response?.status === 403) {
          setError(`Permission denied: ${errorMsg}`);
        } else {
          setError(errorMsg);
        }
        setStatusMessage("Agent run failed.");
        if (response?.details) {
          console.warn("Agent error details:", response.details);
        }
      }
    } catch (err) {
      const msg = err?.message || "Failed to execute agent task";
      setError(msg);
      setStatusMessage("Agent run failed.");
    } finally {
      isRunningRef.current = false;
      setIsRunning(false);
    }
  };

  const handleRollback = async () => {
    if (!currentRun?.runId || isRollingBack || isViewer) return;

    setIsRollingBack(true);
    setError(null);

    try {
      const res = await rollbackAIAgent(workspaceId, currentRun.runId, {
        token: authToken,
      });

      if (res?.success) {
        setStatusMessage(`Successfully rolled back changes from run.`);
        setCurrentRun((prev) => (prev ? { ...prev, rolledBack: true } : null));
      } else {
        setError(res?.error || "Rollback failed");
        setStatusMessage("Rollback failed.");
      }
    } catch (err) {
      const msg = err?.message || "Failed to rollback agent changes";
      setError(msg);
      setStatusMessage("Rollback failed.");
    } finally {
      setIsRollingBack(false);
    }
  };

  const handleViewDiff = async (filePath = null) => {
    try {
      const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
      const target = filePath || (currentRun?.filesModified?.[0] || "");
      const url = target
        ? `/api/workspace/${workspaceId}/git/diff?file=${encodeURIComponent(target)}`
        : `/api/workspace/${workspaceId}/git/diff`;

      const res = await axios.get(url, { headers });
      if (res.data?.diff) {
        setDiffFile(target || "working-tree.diff");
        setDiffContent({
          original: res.data.diff.original || "",
          modified: res.data.diff.modified || res.data.diff.patch || res.data.diff.diff || "",
        });
        setDiffModalOpen(true);
      }
    } catch (err) {
      console.warn("Failed to fetch diff:", err.message);
    }
  };


  return (
    <div
      className={`flex flex-col h-full bg-gray-900 text-gray-200 select-none overflow-hidden ${
        isFloating ? "border border-white/[0.1] rounded-xl shadow-2xl" : "border-r border-gray-800"
      }`}
      data-testid="agent-panel"
      role="region"
      aria-label="AI Coding Agent"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-gray-950/80 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-300">
            AI Coding Agent
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {currentRun?.status && (
            <div className="flex items-center gap-1.5">
              {currentRun.iterations > 0 && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-amber-950/80 text-amber-300 border border-amber-800"
                  data-testid="agent-iteration-badge"
                >
                  iter {currentRun.iterations}/3
                </span>
              )}
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium ${
                  currentRun.status === "COMPLETED"
                    ? "bg-emerald-950/80 text-emerald-400 border border-emerald-800"
                    : currentRun.status === "FAILED" || currentRun.status === "TIMED_OUT"
                    ? "bg-red-950/80 text-red-400 border border-red-800"
                    : "bg-indigo-950/80 text-indigo-300 border border-indigo-700 animate-pulse"
                }`}
                data-testid="agent-status-badge"
                role="status"
                title={formatAgentPhase(currentRun.status, currentRun.iterations)}
              >
                {currentRun.status}
              </span>
            </div>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-400 ml-1"
              aria-label="Close AI Coding Agent"
              title="Close Panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Viewer Warning */}
      {isViewer && (
        <div
          className="flex items-center gap-2 px-3 py-2 bg-amber-950/60 border-b border-amber-800/60 text-amber-300 text-xs"
          data-testid="agent-viewer-warning"
          role="alert"
        >
          <Shield className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Viewer role is read-only. Agent file edits and code executions are disabled.</span>
        </div>
      )}

      {/* Input & Run Control */}
      <div className="p-3 border-b border-gray-800 flex flex-col gap-2 bg-gray-900/50">
        <label htmlFor="agent-task-input" className="text-[11px] font-medium text-gray-400">Ask AI / Coding Task</label>
        <textarea
          id="agent-task-input"
          value={taskPrompt}
          onChange={(e) => setTaskPrompt(e.target.value)}
          placeholder="Ask AI... e.g. Find the bug in main.java, fix the syntax error, and run tests."
          disabled={isRunning || isViewer}
          rows={3}
          className="w-full bg-gray-950 border border-gray-800 rounded p-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none disabled:opacity-50"
          data-testid="agent-prompt-input"
          aria-label="Ask AI / Coding Task Input"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={handleRunAgent}
            disabled={!taskPrompt.trim() || isRunning || isViewer}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-400"
            data-testid="agent-run-btn"
            aria-label="Execute AI Coding Agent Task"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Running Agent...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Agent</span>
              </>
            )}
          </button>

          {currentRun?.filesModified?.length > 0 && !currentRun.rolledBack && (
            <button
              onClick={handleRollback}
              disabled={isRollingBack || isViewer}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded text-xs font-medium transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-400"
              title="Rollback changes made by this agent run"
              data-testid="agent-rollback-btn"
              aria-label="Rollback changes made by agent"
            >
              {isRollingBack ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              <span>Rollback</span>
            </button>
          )}
        </div>

        {error && (
          <div
            className="flex items-start gap-1.5 p-2 bg-red-950/60 border border-red-800/80 rounded text-red-300 text-xs"
            data-testid="agent-error-banner"
            role="alert"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
            <span className="leading-tight">{error}</span>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
        {/* Empty State */}
        {!currentRun && !isRunning && (
          <div className="flex flex-col items-center justify-center p-6 text-center text-gray-500 h-64 gap-2 select-none" data-testid="empty-agent-state">
            <Bot className="w-10 h-10 text-indigo-500/40 mb-1" />
            <p className="text-xs font-medium text-gray-300">Autonomous AI Coding Agent</p>
            <p className="text-[11px] text-gray-500 max-w-[220px] leading-relaxed">
              Describe a bug, feature, or refactoring task above. The agent will inspect files, apply safe patches, run tests, and present diffs for review.
            </p>
          </div>
        )}

        {/* Files Inspected Section */}
        {currentRun?.filesRead && currentRun.filesRead.length > 0 && (
          <div className="flex flex-col gap-1.5" data-testid="agent-inspected-section">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Files Inspected ({currentRun.filesRead.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-1 bg-gray-950 border border-gray-800/80 rounded p-2 text-xs font-mono">
              {currentRun.filesRead.map((file) => (
                <span
                  key={file}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-900 border border-gray-800 text-gray-300 text-[11px]"
                >
                  <FileText className="w-3 h-3 text-gray-400" />
                  {file}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Activity Log */}
        {currentRun?.activityLog && currentRun.activityLog.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Activity Log
            </span>
            <div
              className="flex flex-col gap-1 bg-gray-950 border border-gray-800/80 rounded p-2 max-h-48 overflow-y-auto text-xs font-mono"
              data-testid="agent-activity-log"
            >
              {currentRun.activityLog.map((item, idx) => (
                <div key={idx} className="flex items-start gap-1.5 text-gray-300 leading-snug">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  <span className="text-gray-200">{item.action}</span>
                  {item.detail && <span className="text-gray-500 truncate">({item.detail})</span>}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* Changes Summary */}
        {currentRun && (
          <div className="flex flex-col gap-1.5" data-testid="agent-changes-section">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Changes Made
              </span>
              {(currentRun.filesModified?.length > 0 || currentRun.filesCreated?.length > 0) && (
                <button
                  onClick={() => handleViewDiff()}
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                  data-testid="agent-view-diff-btn"
                >
                  <GitCompare className="w-3 h-3" />
                  <span>View Diff</span>
                </button>
              )}
            </div>

            {currentRun.rolledBack ? (
              <div className="text-xs text-amber-400 italic bg-gray-950 p-2 rounded border border-gray-800">
                All changes from this run were rolled back.
              </div>
            ) : currentRun.filesModified?.length === 0 && currentRun.filesCreated?.length === 0 ? (
              <div className="text-xs text-gray-500 italic bg-gray-950 p-2 rounded border border-gray-800">
                No files modified.
              </div>
            ) : (
              <div className="flex flex-col gap-1 bg-gray-950 border border-gray-800/80 rounded p-2 text-xs">
                {currentRun.filesModified?.map((file) => (
                  <div
                    key={file}
                    className="flex items-center justify-between text-amber-300 font-mono py-0.5"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-bold text-amber-400">M</span>
                      <span className="truncate">{file}</span>
                    </div>
                    {onOpenFile && (
                      <button
                        onClick={() => onOpenFile({ id: file, name: file.split("/").pop(), path: file })}
                        className="text-[10px] text-gray-400 hover:text-white underline ml-2"
                      >
                        open
                      </button>
                    )}
                  </div>
                ))}
                {currentRun.filesCreated?.map((file) => (
                  <div
                    key={file}
                    className="flex items-center justify-between text-emerald-300 font-mono py-0.5"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-bold text-emerald-400">A</span>
                      <span className="truncate">{file}</span>
                    </div>
                    {onOpenFile && (
                      <button
                        onClick={() => onOpenFile({ id: file, name: file.split("/").pop(), path: file })}
                        className="text-[10px] text-gray-400 hover:text-white underline ml-2"
                      >
                        open
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tests Summary */}
        {currentRun?.testsRun && currentRun.testsRun.length > 0 && (
          <div className="flex flex-col gap-1.5" data-testid="agent-tests-section">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Tests Executed
            </span>
            <div className="flex flex-col gap-1 bg-gray-950 border border-gray-800/80 rounded p-2 text-xs font-mono">
              {currentRun.testsRun.map((t, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-gray-300">{t.testName}</span>
                  <span
                    className={`font-semibold ${
                      t.passed ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {t.passed ? "PASSED" : "FAILED"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Honest Execution Outcome Notice */}
        {currentRun?.status === "COMPLETED" && (
          <div
            className={`p-2 rounded border text-xs flex items-center gap-2 ${
              currentRun.testsRun && currentRun.testsRun.some((t) => !t.passed)
                ? "bg-amber-950/60 border-amber-800/80 text-amber-300"
                : "bg-emerald-950/60 border-emerald-800/80 text-emerald-300"
            }`}
            data-testid="agent-outcome-banner"
            role="status"
          >
            {currentRun.testsRun && currentRun.testsRun.some((t) => !t.passed) ? (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span>Task finished, but some test cases are failing. Review activity log and diff before committing.</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Task completed successfully. All automated checks verified.</span>
              </>
            )}
          </div>
        )}

        {/* Final Summary */}
        {currentRun?.summary && (
          <div className="flex flex-col gap-1.5" data-testid="agent-summary-section">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Summary
            </span>
            <div className="bg-gray-950 border border-gray-800/80 rounded p-2.5 text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
              {currentRun.summary}
            </div>
          </div>
        )}
      </div>

      {/* Diff Viewer Modal */}
      {diffModalOpen && (
        <MonacoDiffViewer
          isOpen={diffModalOpen}
          onClose={() => setDiffModalOpen(false)}
          filePath={diffFile}
          original={diffContent.original}
          modified={diffContent.modified}
          title={`Agent Diff: ${diffFile || "Workspace"}`}
        />
      )}
    </div>
  );
}
