"use client";
import { useState, useEffect, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import GitPanel from "@/components/GitPanel";
import AgentPanel from "@/components/AgentPanel";
import Header from "@/components/Header";
import {
  Files,
  FolderGit2,
  Bot,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";

const Editor = dynamic(() => import("@/components/Editor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full w-full bg-[#070B14] text-slate-400">
      <span className="text-xs font-mono">Loading test editor...</span>
    </div>
  ),
});

function TestCollabContent() {
  const searchParams = useSearchParams();
  const user = searchParams.get("user") || "alice";
  const role = searchParams.get("role") || "contributor";
  const wsId = searchParams.get("ws") || "ws-e2e-default";
  const initialFileId = searchParams.get("file") || "file-1";
  const filesParam = searchParams.get("files");
  const wsNameParam = searchParams.get("wsName") || "CodeCraft IDE";
  const isIdeLayout = searchParams.get("layout") === "ide";

  const [openFiles, setOpenFiles] = useState(() => {
    if (filesParam === "0") return [];
    if (filesParam === "multi") {
      return [
        { id: "file-js", name: "app.js", workspaceId: wsId },
        { id: "file-ts", name: "types.ts", workspaceId: wsId },
        { id: "file-py", name: "script.py", workspaceId: wsId },
        { id: "file-cpp", name: "main.cpp", workspaceId: wsId },
        { id: "file-java", name: "Application.java", workspaceId: wsId },
        { id: "file-html", name: "index.html", workspaceId: wsId },
        { id: "file-long", name: "very_long_collaborative_enterprise_configuration_file_name_v2.json", workspaceId: wsId },
      ];
    }
    const list = [
      { id: "file-1", name: "main.js", workspaceId: wsId },
      { id: "file-2", name: "utils.js", workspaceId: wsId },
    ];
    if (!list.some((f) => f.id === initialFileId)) {
      list.unshift({ id: initialFileId, name: `${initialFileId}.js`, workspaceId: wsId });
    }
    return list;
  });

  const [activeFileId, setActiveFileId] = useState(() => {
    if (filesParam === "0") return null;
    if (filesParam === "multi") return "file-js";
    return initialFileId;
  });

  const [textToInsert, setTextToInsert] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [showGit, setShowGit] = useState(() => searchParams.get("git") === "true");
  const [showAgent, setShowAgent] = useState(() => searchParams.get("agent") === "true");

  const [isNavOpen, setIsNavOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState("files");
  const [explorerWidth, setExplorerWidth] = useState(260);
  const [isResizingExplorer, setIsResizingExplorer] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedWidth = localStorage.getItem("codecraft_explorer_width");
      if (savedWidth) {
        const parsed = parseInt(savedWidth, 10);
        if (!isNaN(parsed) && parsed >= 200 && parsed <= 360) {
          setExplorerWidth(parsed);
        }
      }
      const checkMobile = () => {
        if (window.innerWidth < 768) {
          setIsNavOpen(false);
        }
      };
      checkMobile();
      window.addEventListener("resize", checkMobile);
      return () => window.removeEventListener("resize", checkMobile);
    }
  }, []);

  const startExplorerResize = useCallback((e) => {
    e.preventDefault();
    setIsResizingExplorer(true);

    const onMouseMove = (moveEvent) => {
      const clientX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const newWidth = Math.min(360, Math.max(200, clientX - 52));
      setExplorerWidth(newWidth);
      if (typeof window !== "undefined") {
        localStorage.setItem("codecraft_explorer_width", String(newWidth));
      }
    };

    const onMouseUp = () => {
      setIsResizingExplorer(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onMouseMove);
      window.removeEventListener("touchend", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onMouseMove);
    window.addEventListener("touchend", onMouseUp);
  }, []);

  // Sync editor content to DOM preview for deterministic Playwright locator assertions
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof window !== "undefined" && window.__codecraftEditor) {
        try {
          const val = window.__codecraftEditor.getValue();
          setEditorContent(val);
        } catch (e) {}
      }
    }, 150);
    return () => clearInterval(interval);
  }, []);

  const handleOpenFile = (file) => {
    setOpenFiles((prev) => (prev.some((f) => f.id === file.id) ? prev : [...prev, file]));
    setActiveFileId(file.id);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setIsNavOpen(false);
    }
  };

  const handleCloseFile = (fileId) => {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.id !== fileId);
      if (activeFileId === fileId) {
        const idx = prev.findIndex((f) => f.id === fileId);
        const nextActive = next[idx] || next[idx - 1] || null;
        setActiveFileId(nextActive ? nextActive.id : null);
      }
      return next;
    });
  };

  const handleInsert = () => {
    if (typeof window !== "undefined" && window.__codecraftEditor) {
      const model = window.__codecraftEditor.getModel();
      if (model) {
        const lineCount = model.getLineCount();
        const maxCol = model.getLineMaxColumn(lineCount);
        model.applyEdits([
          {
            range: { startLineNumber: lineCount, startColumn: maxCol, endLineNumber: lineCount, endColumn: maxCol },
            text: textToInsert,
            forceMoveMarkers: true,
          },
        ]);
      }
    }
  };

  // 1. Full IDE Layout View (exact architectural hierarchy for responsive QA)
  if (isIdeLayout) {
    const selectedFile = openFiles.find((f) => f.id === activeFileId) || null;
    return (
      <div className="ide-shell flex flex-col w-full overflow-hidden h-[100dvh] bg-[#070B14] text-white relative select-none">
        {/* Hidden synchronized content preview element */}
        <pre id="editor-preview" className="hidden" aria-hidden="true">{editorContent}</pre>

        {/* 1. Global Header */}
        <Header
          workspaceId={wsId}
          onToggleMobileNav={() => setIsNavOpen((prev) => !prev)}
          isMobileNavOpen={isNavOpen}
        />

        {/* 2. Main Workbench Area: Activity Bar + Primary Sidebar + Editor Canvas */}
        <div className="flex flex-1 overflow-hidden relative min-h-0 min-w-0 flex-row">
          {/* Leftmost Activity Bar */}
          <aside className="hidden md:flex w-[52px] flex-[0_0_52px] bg-[#090E1B] border-r border-white/[0.08] flex-col justify-between items-center py-2 z-20 flex-shrink-0 select-none">
            <div className="flex flex-col items-center w-full gap-1">
              <button
                onClick={() => {
                  if (sidebarTab === "files" && isNavOpen) setIsNavOpen(false);
                  else { setSidebarTab("files"); setIsNavOpen(true); }
                }}
                className={`w-full h-10 flex items-center justify-center transition-colors relative ${
                  isNavOpen && sidebarTab === "files"
                    ? "text-white bg-white/[0.06] border-l-2 border-indigo-400"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02] border-l-2 border-transparent"
                }`}
                data-testid="tab-sidebar-files"
                title="Explorer (Files)"
              >
                <Files className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  if (sidebarTab === "git" && isNavOpen) setIsNavOpen(false);
                  else { setSidebarTab("git"); setIsNavOpen(true); }
                }}
                className={`w-full h-10 flex items-center justify-center transition-colors relative ${
                  isNavOpen && sidebarTab === "git"
                    ? "text-white bg-white/[0.06] border-l-2 border-indigo-400"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02] border-l-2 border-transparent"
                }`}
                data-testid="tab-sidebar-git"
                title="Source Control (Git)"
              >
                <FolderGit2 className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  if (sidebarTab === "agent" && isNavOpen) setIsNavOpen(false);
                  else { setSidebarTab("agent"); setIsNavOpen(true); }
                }}
                className={`w-full h-10 flex items-center justify-center transition-colors relative ${
                  isNavOpen && sidebarTab === "agent"
                    ? "text-white bg-white/[0.06] border-l-2 border-indigo-400"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02] border-l-2 border-transparent"
                }`}
                data-testid="tab-sidebar-agent"
                title="AI Coding Agent"
              >
                <Bot className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  if (sidebarTab === "chat" && isNavOpen) setIsNavOpen(false);
                  else { setSidebarTab("chat"); setIsNavOpen(true); }
                }}
                className={`w-full h-10 flex items-center justify-center transition-colors relative ${
                  isNavOpen && sidebarTab === "chat"
                    ? "text-white bg-white/[0.06] border-l-2 border-indigo-400"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02] border-l-2 border-transparent"
                }`}
                title="Team Chat"
              >
                <MessageCircle className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col items-center w-full gap-1">
              <button
                onClick={() => setIsNavOpen(!isNavOpen)}
                className="w-full h-9 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
                title={isNavOpen ? "Collapse Primary Sidebar" : "Expand Primary Sidebar"}
              >
                {isNavOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              </button>
            </div>
          </aside>

          {/* Primary Desktop Resizable Sidebar */}
          {isNavOpen && (
            <>
              <aside
                style={{ width: `${explorerWidth}px` }}
                className="hidden md:flex flex-col h-full bg-[#0A0F1E] border-r border-white/[0.08] overflow-hidden flex-shrink-0 select-none z-10"
              >
                <div className="h-9 px-3 bg-[#090E1B] border-b border-white/[0.08] flex items-center justify-between flex-shrink-0">
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-300 truncate">
                    {sidebarTab === "files" ? "Explorer" : sidebarTab === "git" ? "Source Control" : sidebarTab === "agent" ? "AI Agent" : "Team Chat"}
                  </span>
                  <button
                    onClick={() => setIsNavOpen(false)}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                    title="Collapse Sidebar"
                  >
                    <PanelLeftClose size={13} />
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden p-2">
                  <div className="text-xs font-mono text-slate-400 mb-2 px-1">WORKSPACE FILES</div>
                  <div className="space-y-1">
                    {openFiles.map((f) => (
                      <div
                        key={f.id}
                        onClick={() => handleOpenFile(f)}
                        className={`px-2 py-1.5 rounded text-xs font-mono cursor-pointer truncate transition-colors ${
                          f.id === activeFileId ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30" : "text-slate-300 hover:bg-white/[0.04]"
                        }`}
                        data-testid={`file-item-${f.id}`}
                      >
                        {f.name}
                      </div>
                    ))}
                    {openFiles.length === 0 && (
                      <div className="text-xs text-slate-500 italic px-1">No files in workspace</div>
                    )}
                  </div>
                </div>
              </aside>

              <div
                id="explorer-resize-handle"
                onMouseDown={startExplorerResize}
                onTouchStart={startExplorerResize}
                className={`hidden md:block w-1.5 hover:w-2 -ml-1 hover:-ml-1 cursor-col-resize z-30 transition-all select-none flex-shrink-0 ${
                  isResizingExplorer ? "bg-indigo-500" : "bg-transparent hover:bg-indigo-500/50"
                }`}
                title="Drag to resize Explorer panel"
              />
            </>
          )}

          {/* Mobile Drawer */}
          {isNavOpen && (
            <>
              <div
                id="mobile-drawer-backdrop"
                onClick={() => setIsNavOpen(false)}
                className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-40 transition-opacity"
                aria-hidden="true"
              />
              <aside
                id="mobile-drawer"
                className="md:hidden fixed inset-y-0 left-0 z-50 h-full w-[85vw] max-w-[320px] bg-[#0A0F1E] border-r border-white/[0.1] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-left duration-200 select-none"
              >
                <div className="h-10 px-3 bg-[#090E1B] border-b border-white/[0.08] flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
                    <button
                      onClick={() => setSidebarTab("files")}
                      className={`px-2 py-1 text-xs font-mono rounded ${sidebarTab === "files" ? "bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30" : "text-slate-400"}`}
                    >
                      Files
                    </button>
                    <button
                      onClick={() => setSidebarTab("git")}
                      className={`px-2 py-1 text-xs font-mono rounded ${sidebarTab === "git" ? "bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30" : "text-slate-400"}`}
                    >
                      Git
                    </button>
                    <button
                      onClick={() => setSidebarTab("agent")}
                      className={`px-2 py-1 text-xs font-mono rounded ${sidebarTab === "agent" ? "bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30" : "text-slate-400"}`}
                    >
                      Agent
                    </button>
                  </div>
                  <button
                    id="btn-close-mobile-drawer"
                    onClick={() => setIsNavOpen(false)}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors ml-2"
                    title="Close Navigation Drawer"
                    aria-label="Close navigation drawer"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-hidden p-2">
                  <div className="space-y-1">
                    {openFiles.map((f) => (
                      <div
                        key={f.id}
                        onClick={() => handleOpenFile(f)}
                        className="px-2 py-2 rounded text-xs font-mono cursor-pointer truncate text-slate-200 hover:bg-white/[0.04]"
                        data-testid={`mobile-file-item-${f.id}`}
                      >
                        {f.name}
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </>
          )}

          {/* Main Editor Surface */}
          <main className="flex-1 h-full flex flex-col overflow-hidden min-w-0 min-h-0 bg-[#070B14]">
            {/* Workspace Context Strip */}
            <div className="h-9 px-3 bg-[#070B14] border-b border-white/[0.06] flex items-center justify-between flex-shrink-0 select-none min-w-0 overflow-hidden">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-mono text-slate-500 hidden sm:inline">workspace /</span>
                <span id="context-ws-name" className="text-xs font-mono font-semibold text-indigo-300 truncate max-w-[140px] sm:max-w-xs">
                  {wsNameParam}
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold uppercase bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  {role}
                </span>
              </div>
            </div>

            {/* Editor Container */}
            <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
              <Editor
                openFiles={openFiles}
                activeFileId={activeFileId}
                onSelectTab={setActiveFileId}
                onCloseTab={handleCloseFile}
                onOpenFile={handleOpenFile}
                workspaceId={wsId}
                authToken={`test-token-${role}:${user}`}
                userDisplayName={user}
                userUid={user}
                userRole={role}
                file={selectedFile}
              />
            </div>
          </main>
        </div>
      </div>
    );
  }

  // 2. Default E2E Collab Harness View (preserves 100% backward compatibility for existing specs)
  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-white p-2">
      <div id="test-controls" className="flex flex-wrap items-center gap-2 p-2 bg-gray-900 border-b border-gray-800 text-xs">
        <span id="test-user" className="font-mono text-indigo-400 font-bold px-2 py-0.5 bg-indigo-950/60 rounded border border-indigo-700/50">{user}</span>
        <span id="test-role" className="font-mono text-amber-400">({role})</span>
        <span id="test-workspace" className="font-mono text-gray-400">ws:{wsId}</span>

        <button
          id="btn-open-file-1"
          onClick={() => handleOpenFile({ id: "file-1", name: "main.js", workspaceId: wsId })}
          className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700"
        >
          main.js
        </button>
        <button
          id="btn-open-file-2"
          onClick={() => handleOpenFile({ id: "file-2", name: "utils.js", workspaceId: wsId })}
          className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700"
        >
          utils.js
        </button>
        <button
          id="btn-open-file-3"
          onClick={() => handleOpenFile({ id: "file-3", name: "config.json", workspaceId: wsId })}
          className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-700"
        >
          config.json
        </button>

        <button
          id="btn-toggle-git"
          onClick={() => setShowGit(!showGit)}
          className={`px-2.5 py-1 rounded border font-medium transition-colors ${
            showGit ? "bg-indigo-600 border-indigo-500 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"
          }`}
        >
          Source Control
        </button>

        <button
          id="btn-toggle-agent"
          data-testid="btn-toggle-agent"
          onClick={() => setShowAgent(!showAgent)}
          className={`px-2.5 py-1 rounded border font-medium transition-colors ${
            showAgent ? "bg-indigo-600 border-indigo-500 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"
          }`}
        >
          AI Agent
        </button>

        <div className="flex items-center gap-1 ml-auto">
          <input
            id="input-text"
            placeholder="Text payload..."
            value={textToInsert}
            onChange={(e) => setTextToInsert(e.target.value)}
            className="bg-gray-800 text-white px-2 py-1 rounded border border-gray-700 text-xs w-48 font-mono"
          />
          <button
            id="btn-insert"
            onClick={handleInsert}
            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium"
          >
            Insert Text
          </button>
        </div>
      </div>

      {/* Synchronized content preview element for Playwright to watch without polling eval */}
      <pre id="editor-preview" className="hidden" aria-hidden="true">{editorContent}</pre>

      <div className="flex-1 flex overflow-hidden">
        {showGit && (
          <div id="git-panel-container" className="w-80 h-full border-r border-gray-800 flex-shrink-0">
            <GitPanel
              workspaceId={wsId}
              userRole={role}
              onOpenFile={handleOpenFile}
            />
          </div>
        )}
        {showAgent && (
          <div id="agent-panel-container" data-testid="agent-panel-container" className="w-80 h-full border-r border-gray-800 flex-shrink-0">
            <AgentPanel
              workspaceId={wsId}
              userRole={role}
              onOpenFile={handleOpenFile}
              openFiles={openFiles}
              authToken={`test-token-${role}:${user}`}
            />
          </div>
        )}
        <div className="flex-1 h-full overflow-hidden">
          <Editor
            openFiles={openFiles}
            activeFileId={activeFileId}
            onSelectTab={setActiveFileId}
            onCloseTab={handleCloseFile}
            onOpenFile={handleOpenFile}
            workspaceId={wsId}
            authToken={`test-token-${role}:${user}`}
            userDisplayName={user}
            userUid={user}
            userRole={role}
          />
        </div>
      </div>
    </div>
  );
}

export default function TestCollabPage() {
  return (
    <Suspense fallback={<div>Loading Test Harness...</div>}>
      <TestCollabContent />
    </Suspense>
  );
}
