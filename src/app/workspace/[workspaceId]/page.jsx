"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { doc, getDoc, collection, getDocs, onSnapshot } from "firebase/firestore";
import { db, auth } from "@/config/firebase";
import SearchBar from "@/components/Searchbar";
import { MessageCircle, PanelLeftOpen, PanelLeftClose, Files, FolderGit2, Bot, X, Users } from "lucide-react";
import Header from "@/components/Header";
import ShowMembers from "@/components/Members";
import NavPanel from "@/components/Navpanel";
import GitPanel from "@/components/GitPanel";
import AgentPanel from "@/components/AgentPanel";
import Link from "next/link";

// Phase 4R Performance Optimization: Dynamic imports for heavy client components
const Editor = dynamic(() => import("@/components/Editor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full w-full bg-[#070B14] text-slate-400">
      <div className="flex items-center gap-3">
        <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-xs font-mono">Initializing CodeCraft Editor...</span>
      </div>
    </div>
  ),
});

const Chat = dynamic(() => import("@/components/Chat"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-slate-900/60 text-gray-400">
      <span className="text-sm font-mono">Loading Collaborative Chat...</span>
    </div>
  ),
});

const LiveCursor = dynamic(() => import("@/components/LiveCursor"), {
  ssr: false,
});

const Workspace = () => {
  const { workspaceId } = useParams();
  const router = useRouter();
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [membersCount, setMembersCount] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isNavOpen, setIsNavOpen] = useState(true);
  const [isFloatingAIOpen, setIsFloatingAIOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState("files");
  const [userRole, setUserRole] = useState("contributor");
  const [workspaceNotFound, setWorkspaceNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(260);
  const [isResizingExplorer, setIsResizingExplorer] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const floatingPanelRef = useRef(null);
  const floatingTriggerRef = useRef(null);

  // Close floating AI panel on outside click or Escape key
  useEffect(() => {
    if (!isFloatingAIOpen) return;

    const handlePointerDown = (e) => {
      // Do nothing if click is inside the panel
      if (floatingPanelRef.current && floatingPanelRef.current.contains(e.target)) {
        return;
      }
      // Do nothing if click is on the trigger button
      if (floatingTriggerRef.current && floatingTriggerRef.current.contains(e.target)) {
        return;
      }
      setIsFloatingAIOpen(false);
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsFloatingAIOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFloatingAIOpen]);

  // Lock document scrolling strictly to the workspace IDE shell during mount, clean up on unmount
  useEffect(() => {
    if (typeof window !== "undefined") {
      document.body.classList.add("ide-shell-active");
      return () => {
        document.body.classList.remove("ide-shell-active");
      };
    }
  }, []);

  // Initialize and persist explorer width; responsive mobile detection
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedWidth = localStorage.getItem("codecraft_explorer_width");
      if (savedWidth) {
        const parsed = parseInt(savedWidth, 10);
        if (!isNaN(parsed) && parsed >= 200 && parsed <= 360) {
          setExplorerWidth(parsed);
          document.documentElement.style.setProperty("--explorer-width", `${parsed}px`);
        }
      }
      let prevWidth = window.innerWidth;
      const checkMobile = () => {
        const currentWidth = window.innerWidth;
        const wasMobile = prevWidth < 768;
        const isNowMobile = currentWidth < 768;
        setIsMobile(isNowMobile);
        if (!wasMobile && isNowMobile) {
          // Transitioning from desktop to mobile: close drawer so it doesn't pop up as an overlay
          setIsNavOpen(false);
        } else if (wasMobile && !isNowMobile) {
          // Transitioning from mobile to desktop: restore primary sidebar open
          setIsNavOpen(true);
        }
        prevWidth = currentWidth;
      };
      // Initial check on mount
      if (window.innerWidth < 768) {
        setIsMobile(true);
        setIsNavOpen(false);
      }
      window.addEventListener("resize", checkMobile);
      return () => window.removeEventListener("resize", checkMobile);
    }
  }, []);

  const startExplorerResize = useCallback((e) => {
    e.preventDefault();
    setIsResizingExplorer(true);

    const onMouseMove = (moveEvent) => {
      const clientX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
      // Activity bar width is 52px on desktop
      const newWidth = Math.min(360, Math.max(200, clientX - 52));
      setExplorerWidth(newWidth);
      if (typeof window !== "undefined") {
        document.documentElement.style.setProperty("--explorer-width", `${newWidth}px`);
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

  // Synchronize openFiles with Firestore file renames
  useEffect(() => {
    if (!workspaceId) return;
    const filesRef = collection(db, `workspaces/${workspaceId}/files`);
    const unsub = onSnapshot(
      filesRef,
      (snapshot) => {
        const liveMap = new Map(snapshot.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
        setOpenFiles((prev) => {
          let hasChange = false;
          const updated = prev.map((f) => {
            const live = liveMap.get(f.id);
            if (live && live.name !== f.name) {
              hasChange = true;
              return { ...f, name: live.name };
            }
            return f;
          });
          return hasChange ? updated : prev;
        });
      },
      (err) => {
        console.warn("Files sync listener warning:", err.message);
      }
    );
    return () => unsub();
  }, [workspaceId]);

  // Handle opening a file in tabs (switch to tab if already open, else append)
  const handleOpenFile = (file) => {
    if (!file) return;
    const fileWithWs = { ...file, workspaceId: file.workspaceId || workspaceId };
    setOpenFiles((prev) => {
      if (!prev.some((f) => f.id === file.id)) {
        return [...prev, fileWithWs];
      }
      return prev;
    });
    setActiveFileId(file.id);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setIsNavOpen(false);
    }
  };

  // Handle closing a tab (remove and activate adjacent tab if closing active)
  const handleCloseFile = (fileId) => {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.id !== fileId);
      if (activeFileId === fileId) {
        const closedIdx = prev.findIndex((f) => f.id === fileId);
        const nextActive = next[closedIdx] || next[closedIdx - 1] || null;
        setActiveFileId(nextActive ? nextActive.id : null);
      }
      return next;
    });
  };

  const [authToken, setAuthToken] = useState(null);

  // Cache auth token once on workspace load to eliminate repeated getIdToken async delays
  useEffect(() => {
    if (auth.currentUser) {
      auth.currentUser.getIdToken().then(setAuthToken).catch(() => {});
    }
  }, []);

  // Fetch workspace data in parallel (P0 Critical Path Optimization)
  useEffect(() => {
    const fetchWorkspace = async () => {
      if (!workspaceId) return;

      try {
        const workspaceRef = doc(db, "workspaces", workspaceId);
        const membersRef = collection(db, `workspaces/${workspaceId}/members`);

        // Concurrently fetch workspace document and members collection
        const [workspaceSnap, membersSnap] = await Promise.all([
          getDoc(workspaceRef),
          getDocs(membersRef),
        ]);

        if (workspaceSnap.exists()) {
          const workspaceData = workspaceSnap.data();
          setWorkspaceName(workspaceData.name || "Untitled Workspace");
          setMembersCount(membersSnap.size);

          const currentUid = auth.currentUser?.uid;
          if (workspaceData.userId === currentUid || workspaceData.ownerId === currentUid) {
            setUserRole("owner");
          } else if (currentUid) {
            const memberDoc = membersSnap.docs.find((d) => d.id === currentUid);
            if (memberDoc) {
              setUserRole(memberDoc.data().role || "contributor");
            } else if (workspaceData.isPublic) {
              setUserRole("viewer");
            }
          }
        } else {
          setWorkspaceNotFound(true);
        }
      } catch (error) {
        console.error("Error fetching workspace:", error);
        setWorkspaceNotFound(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchWorkspace();
  }, [workspaceId]);

  if (isLoading) {
    return (
      <div className="flex h-screen bg-gray-950 items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-400 text-sm">Loading workspace...</p>
        </div>
      </div>
    );
  }

  if (workspaceNotFound) {
    return (
      <div className="flex h-screen bg-gray-950 items-center justify-center text-white">
        <div className="bg-gray-900 border border-gray-800 p-8 rounded-xl max-w-md text-center shadow-xl">
          <h2 className="text-2xl font-bold text-red-400 mb-2">Workspace Not Found</h2>
          <p className="text-gray-400 text-sm mb-6">
            The workspace you are looking for does not exist or you do not have permission to view it.
          </p>
          <Link
            href="/dashboard"
            className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const handleActivityTabClick = (tab) => {
    if (sidebarTab === tab && isNavOpen) {
      setIsNavOpen(false);
    } else {
      setSidebarTab(tab);
      setIsNavOpen(true);
    }
  };

  const selectedFile = openFiles.find((f) => f.id === activeFileId) || null;

  return (
    <div className="ide-shell flex flex-col w-full overflow-hidden h-[100dvh] bg-[#070B14] text-white relative select-none">
      {/* 1. Global Compact IDE Header */}
      <Header
        workspaceId={workspaceId}
        onToggleMobileNav={() => setIsNavOpen((prev) => !prev)}
        isMobileNavOpen={isNavOpen}
      />

      {/* 2. Main Workbench Area: Activity Bar + Primary Sidebar + Editor Canvas */}
      <div className="flex flex-1 overflow-hidden relative min-h-0 min-w-0 flex-row">
        {/* Leftmost Activity Bar (VS Code style vertical rail - Desktop only) */}
        <aside className="hidden md:flex w-[52px] flex-[0_0_52px] bg-[#090E1B] border-r border-white/[0.08] flex-col justify-between items-center py-2 z-20 flex-shrink-0 select-none">
          {/* Top Activity Icons */}
          <div className="flex flex-col items-center w-full gap-1">
            <button
              onClick={() => handleActivityTabClick("files")}
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
              onClick={() => handleActivityTabClick("git")}
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
              onClick={() => handleActivityTabClick("agent")}
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
              onClick={() => handleActivityTabClick("chat")}
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

          {/* Bottom Activity Icons */}
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

        {/* Primary Desktop Collapsible & Resizable Sidebar */}
        {isNavOpen && (
          <>
            <aside
              style={{ width: `${explorerWidth}px` }}
              className="hidden md:flex flex-col h-full bg-[#0A0F1E] border-r border-white/[0.08] overflow-hidden flex-shrink-0 select-none z-10"
            >
              {/* Sidebar Section Header */}
              <div className="h-9 px-3 bg-[#090E1B] border-b border-white/[0.08] flex items-center justify-between flex-shrink-0">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-300 truncate">
                  {sidebarTab === "files"
                    ? "Explorer"
                    : sidebarTab === "git"
                    ? "Source Control"
                    : sidebarTab === "agent"
                    ? "AI Agent"
                    : "Team Chat"}
                </span>
                <button
                  onClick={() => setIsNavOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                  title="Collapse Sidebar"
                >
                  <PanelLeftClose size={13} />
                </button>
              </div>

              {/* Sidebar Content */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {sidebarTab === "files" ? (
                  <NavPanel
                    workspaceId={workspaceId}
                    openFile={handleOpenFile}
                    selectedFile={selectedFile}
                    openFiles={openFiles}
                    onCloseFile={handleCloseFile}
                    userRole={userRole}
                  />
                ) : sidebarTab === "git" ? (
                  <GitPanel
                    workspaceId={workspaceId}
                    userRole={userRole}
                    onOpenFile={handleOpenFile}
                  />
                ) : sidebarTab === "agent" ? (
                  <AgentPanel
                    workspaceId={workspaceId}
                    userRole={userRole}
                    onOpenFile={handleOpenFile}
                    openFiles={openFiles}
                  />
                ) : (
                  <Chat
                    workspaceId={workspaceId}
                    isChatOpen={true}
                    setIsChatOpen={() => setIsNavOpen(false)}
                  />
                )}
              </div>
            </aside>

            {/* Desktop Vertical Drag Handle between Explorer & Workspace */}
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

        {/* Mobile Slide-in Drawer with Backdrop (< 768px) */}
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
              {/* Mobile Drawer Header with Tab Switcher & Close */}
              <div className="h-10 px-3 bg-[#090E1B] border-b border-white/[0.08] flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
                  <button
                    onClick={() => setSidebarTab("files")}
                    className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                      sidebarTab === "files"
                        ? "bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Files
                  </button>
                  <button
                    onClick={() => setSidebarTab("git")}
                    className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                      sidebarTab === "git"
                        ? "bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Git
                  </button>
                  <button
                    onClick={() => setSidebarTab("agent")}
                    className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                      sidebarTab === "agent"
                        ? "bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Agent
                  </button>
                  <button
                    onClick={() => setSidebarTab("chat")}
                    className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                      sidebarTab === "chat"
                        ? "bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Chat
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

              {/* Drawer Content */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {sidebarTab === "files" ? (
                  <NavPanel
                    workspaceId={workspaceId}
                    openFile={handleOpenFile}
                    selectedFile={selectedFile}
                    openFiles={openFiles}
                    onCloseFile={handleCloseFile}
                    userRole={userRole}
                  />
                ) : sidebarTab === "git" ? (
                  <GitPanel
                    workspaceId={workspaceId}
                    userRole={userRole}
                    onOpenFile={handleOpenFile}
                  />
                ) : sidebarTab === "agent" ? (
                  <AgentPanel
                    workspaceId={workspaceId}
                    userRole={userRole}
                    onOpenFile={handleOpenFile}
                    openFiles={openFiles}
                  />
                ) : (
                  <Chat
                    workspaceId={workspaceId}
                    isChatOpen={true}
                    setIsChatOpen={() => setIsNavOpen(false)}
                  />
                )}
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
                {workspaceName}
              </span>
              <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold uppercase ${
                userRole === "owner"
                  ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                  : userRole === "contributor"
                  ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              }`}>
                {userRole}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="hidden sm:flex items-center">
                <SearchBar workspaceId={workspaceId} />
              </div>
              <div className="flex items-center">
                <ShowMembers workspaceId={workspaceId} />
              </div>
            </div>
          </div>

          {/* Full Edge-to-Edge Collaborative Editor Container */}
          <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
            <Editor
              workspaceId={workspaceId}
              openFiles={openFiles}
              activeFileId={activeFileId}
              onSelectTab={setActiveFileId}
              onCloseTab={handleCloseFile}
              onOpenFile={handleOpenFile}
              file={selectedFile}
              userRole={userRole}
              authToken={authToken}
            />
          </div>
        </main>
      </div>

      {/* Floating Team Chat Drawer (if opened via standalone trigger) */}
      {isChatOpen && (
        <aside className="fixed bottom-0 right-0 w-[420px] max-w-full h-[75%] bg-[#0A0F1E] border-t border-l border-white/[0.1] shadow-2xl z-40 flex flex-col overflow-hidden transition-all duration-200">
          <div className="h-8 px-3 bg-[#090E1B] border-b border-white/[0.08] flex items-center justify-between">
            <span className="text-xs font-mono text-slate-300 font-semibold">Team Chat</span>
            <button
              onClick={() => setIsChatOpen(false)}
              className="p-1 rounded text-slate-400 hover:text-white transition-colors"
            >
              <X size={13} />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <Chat workspaceId={workspaceId} isChatOpen={isChatOpen} setIsChatOpen={setIsChatOpen} />
          </div>
        </aside>
      )}

      {/* Right-Side Floating AI Trigger Icon */}
      {!isFloatingAIOpen && (
        <button
          ref={floatingTriggerRef}
          id="floating-ai-trigger"
          data-testid="floating-ai-btn"
          onClick={() => setIsFloatingAIOpen(true)}
          className="fixed bottom-6 right-6 z-40 p-3 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-full shadow-2xl hover:shadow-indigo-500/30 transition-all duration-200 transform hover:scale-110 active:scale-95 flex items-center justify-center group focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-[#070B14] cursor-pointer"
          title="Open AI Coding Agent"
          aria-label="Open AI Coding Agent"
        >
          <Bot className="w-5 h-5 group-hover:rotate-12 transition-transform duration-200" />
          <span className="sr-only">Open AI Coding Agent</span>
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500 border border-slate-900"></span>
          </span>
        </button>
      )}

      {/* Floating AI Coding Agent Panel on the Right */}
      <aside
        ref={floatingPanelRef}
        id="floating-ai-panel"
        data-testid="floating-ai-panel"
        style={{ display: isFloatingAIOpen ? "flex" : "none" }}
        className="fixed bottom-6 right-6 z-50 w-[94vw] sm:w-[420px] max-w-[460px] h-[600px] max-h-[85vh] bg-[#0A0F1E] border border-white/[0.12] rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
        aria-label="Floating AI Coding Agent"
      >
        <AgentPanel
          isFloating={true}
          workspaceId={workspaceId}
          userRole={userRole}
          onOpenFile={handleOpenFile}
          openFiles={openFiles}
          activeFile={openFiles.find((f) => f.id === activeFileId) || null}
          onClose={() => setIsFloatingAIOpen(false)}
        />
      </aside>

      <LiveCursor workspaceId={workspaceId} />
    </div>
  );
};

export default Workspace;
