"use client";
import { useState, useRef } from "react";
import { Play, Square, Trash2, Terminal, AlertCircle, CheckCircle2, Clock, ShieldAlert, Copy, Check } from "lucide-react";
import { executeCode, cancelExecution } from "../api";
import { parseExecutionDiagnostics } from "@/lib/diagnostics";

const MAX_DISPLAY_LINES = 1000;

const Output = ({
  editorRef,
  language,
  workspaceId,
  userRole,
  files = [],
  activeFile = null,
  authToken = null,
  onDiagnostics = null,
  onJumpToProblem = null,
}) => {
  const [output, setOutput] = useState(null);
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const [outputTab, setOutputTab] = useState("all"); // 'all' | 'stdout' | 'stderr' | 'problems'
  const [diagnostics, setDiagnostics] = useState([]);
  const [copied, setCopied] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [executionStatus, setExecutionStatus] = useState(null);
  const [durationMs, setDurationMs] = useState(null);
  const [exitCode, setExitCode] = useState(null);
  const [currentExecutionId, setCurrentExecutionId] = useState(null);
  const [showStdin, setShowStdin] = useState(false);
  const [stdinValue, setStdinValue] = useState("");

  const isExecutingRef = useRef(false);
  const isViewer = userRole === "viewer";

  const runCode = async () => {
    if (isViewer) return;
    if (isExecutingRef.current || isLoading) return;
    if (!editorRef?.current) return;
    const sourceCode = editorRef.current.getValue();
    if (sourceCode === undefined || sourceCode === null) return;

    // CC-013: Generate executionId upfront so cancelExecution is immediately actionable during execution
    const earlyExecutionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setCurrentExecutionId(earlyExecutionId);
    isExecutingRef.current = true;
    setIsLoading(true);
    setExecutionStatus("RUNNING");
    setDurationMs(null);
    setExitCode(null);
    setIsTruncated(false);

    // Prepare multi-file context if workspace files exist
    const workspaceFiles = Array.isArray(files) && files.length > 0
      ? files.map((f) => ({
          name: f.name || f.path || "main",
          content: f.id === activeFile?.id ? sourceCode : (f.content || ""),
        }))
      : [];

    try {
      const response = await executeCode(language, sourceCode, {
        workspaceId,
        stdin: stdinValue,
        files: workspaceFiles,
        token: authToken,
        executionId: earlyExecutionId,
      });

      const run = response.run || {};
      const outText = run.output || "(no output returned)";
      const rawStdout = run.stdout || "";
      const rawStderr = run.stderr || "";

      setStdout(rawStdout);
      setStderr(rawStderr);

      if (run.status === "SUCCESS" && run.exitCode === 0) {
        setDiagnostics([]);
        if (onDiagnostics) {
          onDiagnostics([]);
        }
      } else {
        const errorText = rawStderr || outText;
        const currentFile = activeFile?.name || (language === "python" ? "main.py" : language === "java" ? "Main.java" : language === "c" ? "main.c" : language === "cpp" ? "main.cpp" : "main.js");
        let parsed = parseExecutionDiagnostics(errorText, language, currentFile);

        // Fallback 1: match against any file reported by the sandbox container (e.g. /app/main.js)
        if (parsed.length === 0 && currentFile) {
          parsed = parseExecutionDiagnostics(errorText, language, "");
        }

        // Fallback 2: if execution failed with non-zero exit code or error status, synthesize fallback diagnostic
        if (
          parsed.length === 0 &&
          (run.exitCode !== 0 || run.status === "RUNTIMEERROR" || run.status === "COMPILEERROR" || run.status === "SANDBOX_ERROR")
        ) {
          const firstMeaningfulLine = (rawStderr || outText || "")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l && !l.startsWith("at ") && !l.startsWith("Traceback") && !l.startsWith("npm ") && !l.startsWith("yarn "));

          parsed = [
            {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 120,
              message: firstMeaningfulLine || `Execution failed with exit code ${run.exitCode || 1} (${run.status || "RUNTIMEERROR"})`,
              severity: 8,
            },
          ];
        }

        setDiagnostics(parsed);
        if (onDiagnostics) {
          onDiagnostics(parsed);
        }
      }

      if (run.status === "CANCELLED") {
        setExecutionStatus("CANCELLED");
        setOutput((prev) => {
          const arr = (prev || []).filter(Boolean);
          if (!arr.some((l) => l.includes("Execution terminated by user"))) {
            return [...arr, "[Execution terminated by user]"];
          }
          return arr;
        });
      } else {
        const rawLines = outText.split("\n");
        if (rawLines.length > MAX_DISPLAY_LINES) {
          setIsTruncated(true);
          setOutput(rawLines.slice(0, MAX_DISPLAY_LINES));
        } else {
          setIsTruncated(false);
          setOutput(rawLines);
        }
        setExecutionStatus(run.status || (run.exitCode === 0 ? "SUCCESS" : "RUNTIMEERROR"));
      }
      setDurationMs(run.durationMs ?? 0);
      setExitCode(run.exitCode ?? 0);
      setCurrentExecutionId(run.executionId || null);
    } catch (error) {
      console.error("Execution error:", error);
      setExecutionStatus("SANDBOX_ERROR");
      setOutput(["An unexpected error occurred while dispatching execution"]);
      const fallbackDiag = [
        {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 120,
          message: error.message || "Failed to dispatch sandbox execution",
          severity: 8,
        },
      ];
      setDiagnostics(fallbackDiag);
      if (onDiagnostics) {
        onDiagnostics(fallbackDiag);
      }
    } finally {
      isExecutingRef.current = false;
      setIsLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!currentExecutionId || !workspaceId) return;
    try {
      await cancelExecution(workspaceId, currentExecutionId, authToken);
      setExecutionStatus("CANCELLED");
      setOutput((prev) => {
        const arr = (prev || []).filter(Boolean);
        if (!arr.some((l) => l.includes("Execution terminated by user"))) {
          return [...arr, "[Execution terminated by user]"];
        }
        return arr;
      });
    } catch (err) {
      console.warn("Failed to cancel execution", err);
    } finally {
      setIsLoading(false);
    }
  };

  const copyOutput = async () => {
    let textToCopy = "";
    if (outputTab === "stdout") textToCopy = stdout;
    else if (outputTab === "stderr") textToCopy = stderr;
    else if (outputTab === "problems") {
      textToCopy = diagnostics
        .map((d) => `[${d.severity === 4 ? "WARNING" : "ERROR"}] Line ${d.startLineNumber}, Col ${d.startColumn}: ${d.message}`)
        .join("\n");
    } else if (Array.isArray(output)) {
      textToCopy = output.join("\n");
    }
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("Clipboard write failed:", e);
    }
  };

  const clearOutput = () => {
    setOutput(null);
    setStdout("");
    setStderr("");
    setDiagnostics([]);
    setIsTruncated(false);
    setExecutionStatus(null);
    setDurationMs(null);
    setExitCode(null);
    setCurrentExecutionId(null);
    if (onDiagnostics) {
      onDiagnostics([]);
    }
  };

  const getStatusBadge = () => {
    if (isLoading) {
      return (
        <span
          data-testid="output-status-badge"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-900/60 text-blue-300 border border-blue-700/50"
          role="status"
        >
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
          Running
        </span>
      );
    }

    if (!executionStatus) return null;

    if (executionStatus === "SUCCESS") {
      return (
        <span
          data-testid="output-status-badge"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-950/70 text-emerald-300 border border-emerald-700/50"
          role="status"
        >
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          Success {durationMs !== null ? `(${durationMs}ms)` : ""}
        </span>
      );
    }

    if (executionStatus === "EXECUTIONSANDBOXUNAVAILABLE" || executionStatus === "SANDBOX_UNAVAILABLE") {
      return (
        <span
          data-testid="output-status-badge"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-950/70 text-amber-300 border border-amber-700/50"
          role="status"
        >
          <AlertCircle className="w-3 h-3 text-amber-400" />
          Sandbox Offline
        </span>
      );
    }

    if (executionStatus === "PERMISSION_DENIED") {
      return (
        <span
          data-testid="output-status-badge"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-rose-950/70 text-rose-300 border border-rose-700/50"
          role="status"
        >
          <ShieldAlert className="w-3 h-3 text-rose-400" />
          Permission Denied
        </span>
      );
    }

    if (executionStatus === "TIMEOUT") {
      return (
        <span
          data-testid="output-status-badge"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-rose-950/70 text-rose-300 border border-rose-700/50"
          role="status"
        >
          <Clock className="w-3 h-3 text-rose-400" />
          Timeout
        </span>
      );
    }

    // Generic error status
    return (
      <span
        data-testid="output-status-badge"
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-rose-950/70 text-rose-300 border border-rose-700/50"
        role="status"
      >
        <AlertCircle className="w-3 h-3 text-rose-400" />
        {executionStatus} {exitCode !== null ? `[code ${exitCode}]` : ""}
      </span>
    );
  };

  const isErrorState =
    executionStatus &&
    executionStatus !== "SUCCESS" &&
    executionStatus !== "RUNNING";

  return (
    <div
      data-testid="output-panel"
      className="flex flex-col h-full bg-[#0A0F1E] border-0 overflow-hidden font-sans select-none"
    >
      {/* Header bar */}
      <div className="h-9 px-3 bg-[#070B14] border-b border-white/[0.08] flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[11px] font-bold font-mono text-gray-400 tracking-wider">
            OUTPUT
          </span>
          {getStatusBadge()}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowStdin(!showStdin)}
            title="Toggle standard input (stdin)"
            className={`p-1 rounded text-xs transition ${
              showStdin
                ? "bg-indigo-600/40 text-indigo-300 border border-indigo-500/50"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
            }`}
          >
            stdin
          </button>
          <button
            onClick={copyOutput}
            data-testid="copy-output-button"
            title="Copy output to clipboard"
            className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={clearOutput}
            data-testid="clear-output-button"
            title="Clear output"
            className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Action controls */}
      <div className="p-2 bg-[#090E1B] border-b border-white/[0.08] flex items-center gap-2">
        {isLoading ? (
          <button
            onClick={handleCancel}
            data-testid="cancel-execution-button"
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded transition border border-rose-600 shadow-sm"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            Stop Execution
          </button>
        ) : (
          <button
            onClick={runCode}
            disabled={isViewer || isLoading}
            data-testid="run-code-button"
            title={isViewer ? "Viewers cannot execute code (read-only)" : "Run Code in Isolated Sandbox"}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold rounded transition shadow-sm ${
              isViewer
                ? "bg-slate-800 text-gray-500 cursor-not-allowed border border-gray-700"
                : "text-white bg-blue-600 hover:bg-blue-500 border border-blue-500"
            }`}
          >
            <Play className="w-3 h-3 fill-current" />
            {isViewer ? "Execution Disabled (Viewer)" : "Run in Sandbox"}
          </button>
        )}
      </div>

      {/* Stdin Drawer */}
      {showStdin && (
        <div className="p-2 bg-[#070B14] border-b border-white/[0.08] flex flex-col gap-1">
          <label className="text-[11px] font-medium text-gray-400">
            Standard Input (stdin):
          </label>
          <textarea
            data-testid="stdin-input"
            rows={2}
            value={stdinValue}
            onChange={(e) => setStdinValue(e.target.value)}
            placeholder="Type input passed to standard input..."
            className="w-full bg-[#090E1B] text-gray-200 text-xs font-mono p-1.5 rounded border border-gray-700 focus:outline-none focus:border-blue-500 resize-y"
          />
        </div>
      )}

      {/* Stream Tabs Bar */}
      {(output || diagnostics.length > 0) && !isLoading && (
        <div className="flex items-center gap-1 px-3 py-1 bg-[#090E1B] border-b border-white/[0.08] text-[11px] overflow-x-auto">
          <button
            onClick={() => setOutputTab("all")}
            className={`px-2 py-0.5 rounded font-mono transition ${
              outputTab === "all" ? "bg-indigo-900/60 text-indigo-300 border border-indigo-700/60" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            All
          </button>
          {stdout && (
            <button
              onClick={() => setOutputTab("stdout")}
              className={`px-2 py-0.5 rounded font-mono transition ${
                outputTab === "stdout" ? "bg-emerald-950/60 text-emerald-300 border border-emerald-700/60" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              stdout
            </button>
          )}
          {stderr && (
            <button
              onClick={() => setOutputTab("stderr")}
              className={`px-2 py-0.5 rounded font-mono transition ${
                outputTab === "stderr" ? "bg-rose-950/60 text-rose-300 border border-rose-700/60" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              stderr
            </button>
          )}
          <button
            onClick={() => setOutputTab("problems")}
            data-testid="tab-problems"
            className={`px-2 py-0.5 rounded font-mono transition flex items-center gap-1 ${
              outputTab === "problems"
                ? "bg-rose-950/60 text-rose-300 border border-rose-700/60"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            <span>Problems</span>
            {diagnostics.length > 0 && (
              <span className="text-[10px] px-1 rounded-full font-bold bg-rose-600 text-white leading-tight">
                {diagnostics.length}
              </span>
            )}
          </button>
          {isTruncated && (
            <span className="ml-auto text-[10px] text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60">
              Truncated ({MAX_DISPLAY_LINES} lines max)
            </span>
          )}
        </div>
      )}

      {/* Terminal Output Viewer */}
      <div
        data-testid="output-container"
        className={`flex-1 p-3 font-mono text-xs overflow-auto leading-relaxed select-text ${
          outputTab === "stderr" ? "text-red-400" : "text-gray-200"
        }`}
        role="log"
        aria-live="polite"
        aria-label="Code execution terminal output"
      >
        {isLoading ? (
          <div className="flex flex-col justify-center items-center h-full gap-3 text-gray-400">
            <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-sans tracking-wide">Executing in isolated sandbox...</span>
          </div>
        ) : outputTab === "problems" ? (
          diagnostics.length > 0 ? (
            <div className="flex flex-col gap-2" data-testid="problems-list">
              {diagnostics.map((prob, idx) => (
                <div
                  key={idx}
                  onClick={() => onJumpToProblem && onJumpToProblem(prob.startLineNumber, prob.startColumn)}
                  className="flex items-start justify-between p-2 rounded bg-gray-900 border border-gray-800 hover:border-gray-700 cursor-pointer transition-colors group"
                >
                  <div className="flex items-start gap-2 flex-1">
                    <AlertCircle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${prob.severity === 4 ? "text-amber-400" : "text-rose-400"}`} />
                    <div className="flex flex-col">
                      <span className="text-xs text-gray-200 font-mono leading-tight">{prob.message}</span>
                      <span className="text-[11px] text-gray-500 font-mono mt-1">
                        Line {prob.startLineNumber}, Col {prob.startColumn}
                      </span>
                    </div>
                  </div>
                  <button
                    className="text-[11px] px-2 py-0.5 rounded bg-gray-800 group-hover:bg-indigo-600 text-gray-400 group-hover:text-white transition-colors ml-2"
                    title="Jump to code location"
                  >
                    Jump
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 text-center select-none py-8">
              <CheckCircle2 className="w-8 h-8 mb-2 text-emerald-500/60" />
              <p className="text-xs font-medium text-gray-300">No problems detected</p>
              <p className="text-[11px] text-gray-500">Execution and compiler output produced zero diagnostics.</p>
            </div>
          )
        ) : output ? (
          (outputTab === "stdout" ? (stdout || "(no stdout)").split("\n") : outputTab === "stderr" ? (stderr || "(no stderr)").split("\n") : output).map((line, i) => (
            <p key={i} className="whitespace-pre-wrap break-all">
              {line}
            </p>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 text-center select-none">
            <Terminal className="w-8 h-8 mb-2 opacity-40 text-gray-400" />
            <p className="text-xs">Click &quot;Run Code&quot; to execute in Docker sandbox</p>
            {isViewer && (
              <p className="text-[11px] text-amber-500/80 mt-1">
                You have Viewer permissions (Execution is disabled)
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Output;
