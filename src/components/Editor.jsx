"use client";
import {
  Moon,
  Sun,
  Sparkles,
  Wrench,
  File,
  FileCode,
  Expand,
  Shrink,
  Settings,
  Lock,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  X,
  MessageSquare,
  Users,
  Terminal,
  PanelRightClose,
  PanelRightOpen,
  PanelBottomClose,
  PanelBottomOpen,
  ChevronRight,
} from "lucide-react";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Editor, { loader } from "@monaco-editor/react";
import axios from "axios";
import { toast } from "react-toastify";
import LanguageSelector from "./LanguageSelector";
import { CODE_SNIPPETS } from "@/constants";
import { Box } from "@chakra-ui/react";
import Output from "./Output";
import CommentsPanel from "./Comments";
import { buildAIContext } from "@/lib/aiContext";
import { isBinaryOrOversizedFile } from "@/lib/editorSafety";
import { doc, onSnapshot, collection, query, where } from "firebase/firestore";
import { db, auth } from "@/config/firebase";
import { normalizeError } from "@/lib/errorUtils";

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { MonacoBinding } from "y-monaco";
import { IndexeddbPersistence } from "y-indexeddb";

const EXTENSION_LANGUAGE_MAP = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  java: "java",
  cs: "csharp",
  php: "php",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "cpp",
  h: "cpp",
  hpp: "cpp",
  html: "html",
  css: "css",
  json: "json",
  md: "markdown",
  sql: "sql",
  sh: "shell",
};

const getLanguageFromFile = (fileName) => {
  if (!fileName || typeof fileName !== "string") return "javascript";
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex === -1) return "javascript";
  const ext = fileName.substring(lastDotIndex + 1).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] || "javascript";
};

const COLOR_PALETTE = [
  "#EF4444",
  "#F59E0B",
  "#10B981",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#22D3EE",
  "#84CC16",
  "#F97316",
  "#14B8A6",
];

/**
 * Safe Monaco Loader Hook.
 * Intercepts and catches manual cancellations during unmount / StrictMode remounts,
 * preventing unhandled promise rejections and Next.js dev overlay crashes.
 */
function useSafeMonaco() {
  const [monaco, setMonaco] = useState(() => {
    if (typeof window === "undefined") return null;
    return loader.__getMonacoInstance() || window.monaco || null;
  });

  useEffect(() => {
    let isCancelled = false;
    let cancelable = null;

    if (!monaco) {
      cancelable = loader.init();
      cancelable
        .then((instance) => {
          if (!isCancelled) {
            setMonaco(instance);
          }
        })
        .catch((error) => {
          // Explicitly absorb expected cancellation to prevent unhandled rejection
          if (
            isCancelled ||
            error?.type === "cancelation" ||
            error?.msg === "operation is manually canceled"
          ) {
            return;
          }
          console.error("[CodeCraft] Monaco initialization error:", error);
        });
    }

    return () => {
      isCancelled = true;
      if (cancelable && typeof cancelable.cancel === "function") {
        try {
          cancelable.cancel();
        } catch {
          // ignore synchronous cancel errors
        }
      }
    };
  }, [monaco]);

  return monaco;
}

export default function CodeEditor({
  openFiles = [],
  activeFileId = null,
  onSelectTab,
  onCloseTab,
  onOpenFile,
  file,
  workspaceId: propWorkspaceId,
  authToken,
  userDisplayName,
  userUid,
  userRole: propUserRole,
}) {
  const effectiveFiles = useMemo(() => {
    if (Array.isArray(openFiles) && openFiles.length > 0) return openFiles;
    if (file && file.id) return [file];
    return [];
  }, [openFiles, file]);

  const effectiveActiveId = activeFileId || file?.id || effectiveFiles[0]?.id || null;
  const activeFile = effectiveFiles.find((f) => f.id === effectiveActiveId) || null;
  const workspaceId = activeFile?.workspaceId || propWorkspaceId || file?.workspaceId;

  const activeFileSafety = useMemo(() => isBinaryOrOversizedFile(activeFile), [activeFile]);
  const isUnsupportedActiveFile = activeFileSafety.isUnsupported;
  const unsupportedActiveReason = activeFileSafety.reason;

  const [selectedTheme, setSelectedTheme] = useState("vs-dark");
  const [fontSize, setFontSize] = useState(14);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [aiError, setAiError] = useState(null);
  const isGeneratingRef = useRef(false);
  const isFixingRef = useRef(false);

  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [isLocalSaved, setIsLocalSaved] = useState(false);
  const [isFileDeleted, setIsFileDeleted] = useState(false);
  const [userRole, setUserRole] = useState(() => {
    if (propUserRole) return propUserRole;
    if (authToken && authToken.includes("viewer")) return "viewer";
    if (authToken && authToken.includes("owner")) return "owner";
    if (authToken && authToken.includes("contributor")) return "contributor";
    return null;
  });
  const [codeLanguage, setCodeLanguage] = useState("javascript");
  const [activeCollaborators, setActiveCollaborators] = useState([]);

  const [showComments, setShowComments] = useState(false);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [commentsCount, setCommentsCount] = useState(0);
  const [rightDockTab, setRightDockTab] = useState("output");
  const [isRightDockOpen, setIsRightDockOpen] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(240);
  const [isResizingTerminal, setIsResizingTerminal] = useState(false);
  const workspaceContainerRef = useRef(null);

  // Responsive layout observer: recalculate Monaco layout on container resize (Explorer resize, Terminal resize, viewport resize, mobile drawer)
  useEffect(() => {
    if (typeof window === "undefined" || !window.ResizeObserver) return;
    const container = workspaceContainerRef.current;
    if (!container) return;

    let rafId = null;
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.layout();
        }
      });
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Initialize and persist bottom terminal panel height
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("codecraft_terminal_height");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 160) {
          setTerminalHeight(parsed);
        }
      }
    }
  }, []);

  const startTerminalResize = useCallback((e) => {
    e.preventDefault();
    setIsResizingTerminal(true);

    const container = workspaceContainerRef.current;
    if (!container) return;

    const onMouseMove = (moveEvent) => {
      const clientY = moveEvent.touches ? moveEvent.touches[0].clientY : moveEvent.clientY;
      const rect = container.getBoundingClientRect();
      const totalHeight = rect.height;
      const rawHeight = rect.bottom - clientY;
      const minHeight = 160;
      const maxHeight = Math.max(minHeight, Math.floor(totalHeight * 0.5));
      const newHeight = Math.min(maxHeight, Math.max(minHeight, rawHeight));
      setTerminalHeight(newHeight);
      if (typeof window !== "undefined") {
        localStorage.setItem("codecraft_terminal_height", String(newHeight));
      }
      editorRef.current?.layout();
    };

    const onMouseUp = () => {
      setIsResizingTerminal(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onMouseMove);
      window.removeEventListener("touchend", onMouseUp);
      setTimeout(() => editorRef.current?.layout(), 50);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onMouseMove);
    window.addEventListener("touchend", onMouseUp);
  }, []);

  const monaco = useSafeMonaco();
  const editorRef = useRef(null);
  const monacoInstanceRef = useRef(null);
  const settingsRef = useRef(null);

  const sessionsRef = useRef(new Map());
  const inFlightSessionsRef = useRef(new Map());
  const activeFileIdRef = useRef(effectiveActiveId);
  activeFileIdRef.current = effectiveActiveId;

  const userColor = useMemo(() => {
    const user = auth.currentUser;
    const seed = userUid || user?.uid || userDisplayName || user?.displayName || "collaborator";
    let sum = 0;
    for (let i = 0; i < seed.length; i++) sum = (sum + seed.charCodeAt(i)) >>> 0;
    return COLOR_PALETTE[sum % COLOR_PALETTE.length];
  }, [userUid, userDisplayName]);

  useEffect(() => {
    if (activeFile?.name) {
      setCodeLanguage(getLanguageFromFile(activeFile.name));
    }
  }, [activeFile?.name]);

  useEffect(() => {
    if (propUserRole) {
      setUserRole(propUserRole);
      if (editorRef.current) {
        editorRef.current.updateOptions({ readOnly: propUserRole === "viewer" });
      }
      return;
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !workspaceId) {
      if (authToken && authToken.includes("viewer")) {
        setUserRole("viewer");
        if (editorRef.current) {
          editorRef.current.updateOptions({ readOnly: true });
        }
      }
      return;
    }

    let fallbackUnsub = null;
    const memberRef = doc(db, `workspaces/${workspaceId}/members`, currentUser.uid);
    const unsub = onSnapshot(
      memberRef,
      (snap) => {
        if (snap.exists()) {
          if (fallbackUnsub) {
            fallbackUnsub();
            fallbackUnsub = null;
          }
          const role = snap.data()?.role || "viewer";
          setUserRole(role);
          if (editorRef.current) {
            editorRef.current.updateOptions({ readOnly: role === "viewer" });
          }
        } else {
          if (fallbackUnsub) {
            fallbackUnsub();
            fallbackUnsub = null;
          }
          const wsRef = doc(db, `workspaces/${workspaceId}`);
          fallbackUnsub = onSnapshot(
            wsRef,
            (wsSnap) => {
              if (wsSnap.exists()) {
                const wsData = wsSnap.data();
                const role = wsData.userId === currentUser.uid ? "owner" : wsData.isPublic ? "viewer" : null;
                setUserRole(role);
                if (editorRef.current) {
                  editorRef.current.updateOptions({ readOnly: role === "viewer" });
                }
              }
            },
            (wsErr) => {
              console.warn("Fallback workspace role listener warning:", normalizeError(wsErr).message);
            }
          );
        }
      },
      (error) => {
        console.error("Error watching user role:", error);
      }
    );

    return () => {
      if (fallbackUnsub) {
        fallbackUnsub();
      }
      unsub();
    };
  }, [workspaceId, propUserRole, authToken]);

  useEffect(() => {
    const handleOffline = () => {
      setConnectionStatus("offline");
      const currentSession = sessionsRef.current.get(effectiveActiveId);
      if (currentSession) currentSession.status = "offline";
    };
    const handleOnline = () => {
      const currentSession = sessionsRef.current.get(effectiveActiveId);
      if (currentSession?.provider?.wsconnected) {
        setConnectionStatus("connected");
      } else {
        setConnectionStatus("connecting");
      }
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [effectiveActiveId]);

  useEffect(() => {
    if (!workspaceId || !activeFile?.id) {
      setCommentsCount(0);
      return;
    }

    const commentsRef = collection(db, `workspaces/${workspaceId}/comments`);
    const q = query(commentsRef, where("fileId", "==", activeFile.id));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const unresolved = snap.docs.filter((d) => !d.data()?.resolved).length;
        setCommentsCount(unresolved);
      },
      (err) => {
        console.warn("Comments count listener warning:", err.message);
      }
    );

    return () => unsub();
  }, [workspaceId, activeFile?.id]);

  useEffect(() => {
    let styleEl = document.getElementById("codecraft-cursor-styles");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "codecraft-cursor-styles";
      document.head.appendChild(styleEl);
    }

    const rules = activeCollaborators
      .filter((c) => !c.isSelf)
      .map((c) => {
        const safeName = (c.name || "Collaborator").replace(/[^a-zA-Z0-9 _-]/g, "");
        return `
          .yRemoteSelection-${c.clientId} {
            background-color: ${c.color}28 !important;
          }
          .yRemoteSelectionHead-${c.clientId} {
            position: absolute;
            border-left: 2px solid ${c.color} !important;
            border-top: 2px solid ${c.color} !important;
            border-bottom: 2px solid ${c.color} !important;
            height: 100%;
            box-sizing: border-box;
          }
          .yRemoteSelectionHead-${c.clientId}::after {
            position: absolute;
            content: ' ';
            border: 3px solid ${c.color} !important;
            border-radius: 4px;
            left: -4px;
            top: -5px;
            background-color: ${c.color};
          }
          .yRemoteSelectionHead-${c.clientId}::before {
            content: "${safeName}";
            position: absolute;
            top: -1.35em;
            left: 0;
            background-color: ${c.color};
            color: #ffffff;
            font-size: 10px;
            font-family: ui-monospace, monospace;
            padding: 1px 5px;
            border-radius: 3px;
            white-space: nowrap;
            pointer-events: none;
            z-index: 20;
            font-weight: 600;
            line-height: 1.2;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          }
        `;
      })
      .join("\n");

    styleEl.innerHTML = rules;
  }, [activeCollaborators]);

  const teardownSession = useCallback((fileId) => {
    const session = sessionsRef.current.get(fileId);
    if (!session) return;

    try {
      if (session.unsubFile) session.unsubFile();
      if (session.binding) {
        session.binding.destroy();
        session.binding = null;
      }
      if (session.provider) {
        session.provider.destroy();
        session.provider = null;
      }
      if (session.idbProvider) {
        session.idbProvider.destroy();
        session.idbProvider = null;
      }
      if (session.model) {
        session.model.dispose();
        session.model = null;
      }
      if (session.ydoc) {
        session.ydoc.destroy();
        session.ydoc = null;
      }
    } catch (e) {
      console.warn("Session teardown warning for fileId", fileId, e);
    }
    sessionsRef.current.delete(fileId);
    inFlightSessionsRef.current.delete(fileId);
  }, []);

  const initSession = useCallback(
    async (targetFile) => {
      try {
        const mon = monacoInstanceRef.current || monaco;
        if (!mon || !targetFile?.id || !targetFile?.workspaceId) return null;

        const fileId = targetFile.id;
        const existingSession = sessionsRef.current.get(fileId);
        if (existingSession) return existingSession;

        if (inFlightSessionsRef.current.has(fileId)) {
          return await inFlightSessionsRef.current.get(fileId);
        }

        const createSessionPromise = (async () => {
          const wsId = targetFile.workspaceId;
          const roomName = `workspace:${wsId}:file:${fileId}`;
          const lang = getLanguageFromFile(targetFile.name);

          const safetyCheck = isBinaryOrOversizedFile(targetFile);
          if (safetyCheck.isUnsupported) {
            const unsupportedSession = {
              fileId,
              fileName: targetFile.name,
              workspaceId: wsId,
              isUnsupported: true,
              unsupportedReason: safetyCheck.reason,
              status: "ready",
              isLocalSaved: false,
              isFileDeleted: false,
              collaborators: [],
            };
            sessionsRef.current.set(fileId, unsupportedSession);
            return unsupportedSession;
          }

          const ydoc = new Y.Doc();

          let idbProvider = null;
          if (typeof window !== "undefined" && typeof window.indexedDB !== "undefined") {
            try {
              idbProvider = new IndexeddbPersistence(roomName, ydoc);
            } catch (err) {
              console.warn("IndexedDB persistence warning:", err.message);
            }
          }

          let token = authToken || "";
          if (!token) {
            try {
              token = (await auth.currentUser?.getIdToken()) || "";
            } catch (err) {
              console.warn("Could not retrieve auth token:", err);
            }
          }

          const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
          const host = typeof window !== "undefined" ? window.location.hostname || "localhost" : "localhost";
          const serverUrl =
            process.env.NEXT_PUBLIC_COLLAB_WS_URL || `${protocol}//${host}:1234`;

          const provider = new WebsocketProvider(serverUrl, roomName, ydoc, {
            params: {
              token,
              workspaceId: wsId,
              fileId: fileId,
            },
          });

          const uri = mon.Uri.parse(`inmemory://codecraft/${wsId}/${fileId}/${encodeURIComponent(targetFile.name)}`);
          let model = mon.editor.getModel(uri);
          if (!model) {
            model = mon.editor.createModel("", lang, uri);
          }
          model.setEOL(mon.editor.EndOfLineSequence.LF);

          const currentUser = auth.currentUser;
          const awareness = provider.awareness;
          awareness.setLocalStateField("user", {
            name: userDisplayName || currentUser?.displayName || (currentUser?.email ? currentUser.email.split("@")[0] : "Collaborator"),
            color: userColor,
            uid: userUid || currentUser?.uid || "anon",
          });

          const ytext = ydoc.getText("monaco");
          const binding = new MonacoBinding(
            ytext,
            model,
            new Set(editorRef.current ? [editorRef.current] : []),
            awareness
          );

          provider.once("sync", (isSynced) => {
            if (isSynced && ytext.length === 0) {
              if (CODE_SNIPPETS[lang]) {
                ytext.insert(0, CODE_SNIPPETS[lang]);
              }
            }
          });

          const session = {
            fileId,
            fileName: targetFile.name,
            workspaceId: wsId,
            ydoc,
            provider,
            idbProvider,
            model,
            binding,
            awareness,
            viewState: null,
            status: "connecting",
            isLocalSaved: false,
            isFileDeleted: false,
            collaborators: [],
            wasConnected: false,
            unsubFile: null,
          };

          awareness.on("change", () => {
            const states = awareness.getStates();
            const collabs = [];
            states.forEach((state, clientId) => {
              if (state.user) {
                collabs.push({
                  clientId,
                  name: state.user.name || "Collaborator",
                  color: state.user.color || "#3B82F6",
                  uid: state.user.uid,
                  isSelf: clientId === ydoc.clientID,
                });
              }
            });
            session.collaborators = collabs;
            if (activeFileIdRef.current === fileId) {
              setActiveCollaborators(collabs);
            }
          });

          provider.on("status", ({ status }) => {
            if (status === "connected") {
              session.wasConnected = true;
              session.status = "connected";
            } else if (status === "connecting") {
              session.status = session.wasConnected ? "reconnecting" : "connecting";
            } else if (status === "disconnected") {
              session.status = "offline";
            }
            if (activeFileIdRef.current === fileId) {
              setConnectionStatus(session.status);
            }
          });

          provider.on("sync", (isSynced) => {
            if (!isSynced && session.status === "connected") {
              session.status = "syncing";
            } else if (isSynced && provider.wsconnected) {
              session.status = "connected";
            }
            if (activeFileIdRef.current === fileId) {
              setConnectionStatus(session.status);
            }
          });

          if (idbProvider) {
            idbProvider.on("synced", () => {
              session.isLocalSaved = true;
              if (activeFileIdRef.current === fileId) {
                setIsLocalSaved(true);
              }
            });
          }

          const fileRef = doc(db, `workspaces/${wsId}/files/${fileId}`);
          session.unsubFile = onSnapshot(
            fileRef,
            (snap) => {
              if (!snap.exists()) {
                session.isFileDeleted = true;
                session.status = "error";
                if (session.binding) {
                  session.binding.destroy();
                  session.binding = null;
                }
                if (session.provider) {
                  session.provider.destroy();
                  session.provider = null;
                }
                if (activeFileIdRef.current === fileId) {
                  setIsFileDeleted(true);
                  setConnectionStatus("error");
                  if (editorRef.current) {
                    editorRef.current.updateOptions({ readOnly: true });
                  }
                }
              } else {
                session.isFileDeleted = false;
                if (activeFileIdRef.current === fileId) {
                  setIsFileDeleted(false);
                }
              }
            },
            (fileErr) => {
              console.warn("File snapshot listener warning:", normalizeError(fileErr).message);
            }
          );

          sessionsRef.current.set(fileId, session);
          return session;
        })();

        inFlightSessionsRef.current.set(fileId, createSessionPromise);
        try {
          return await createSessionPromise;
        } finally {
          inFlightSessionsRef.current.delete(fileId);
        }
      } catch (err) {
        const norm = normalizeError(err, "Failed to initialize editor session");
        console.warn("[Editor initSession]", norm.message);
        return null;
      }
    },
    [monaco, userColor, authToken, userDisplayName, userUid]
  );

  useEffect(() => {
    const openIdSet = new Set(effectiveFiles.map((f) => f.id));
    for (const [fileId] of sessionsRef.current.entries()) {
      if (!openIdSet.has(fileId)) {
        teardownSession(fileId);
      }
    }
  }, [effectiveFiles, teardownSession]);

  useEffect(() => {
    if (!activeFile?.id || !editorRef.current) return;

    let isMounted = true;

    const switchSession = async () => {
      try {
        const currentModel = editorRef.current.getModel();
        for (const [, session] of sessionsRef.current.entries()) {
          if (session.model && currentModel === session.model) {
            session.viewState = editorRef.current.saveViewState();
            break;
          }
        }

        let targetSession = sessionsRef.current.get(activeFile.id);
        if (!targetSession) {
          targetSession = await initSession(activeFile);
        }

        if (!isMounted || !targetSession) return;

        if (activeFile?.name && targetSession.fileName !== activeFile.name) {
          // File rename detected: update session metadata and Monaco language
          const newLang = getLanguageFromFile(activeFile.name);
          targetSession.fileName = activeFile.name;
          targetSession.language = newLang;
          if (monaco && targetSession.model) {
            monaco.editor.setModelLanguage(targetSession.model, newLang);
          }
          setCodeLanguage(newLang);
        }

        if (targetSession.isUnsupported) {
          setConnectionStatus("ready");
          setIsFileDeleted(false);
          return;
        }

        if (!editorRef.current) return;

        if (editorRef.current.getModel() !== targetSession.model) {
          editorRef.current.setModel(targetSession.model);
        }

        if (targetSession.viewState) {
          editorRef.current.restoreViewState(targetSession.viewState);
        }

        const isReadOnly = userRole === "viewer" || targetSession.isFileDeleted;
        editorRef.current.updateOptions({ readOnly: isReadOnly });

        setConnectionStatus(targetSession.status);
        setIsLocalSaved(targetSession.isLocalSaved);
        setIsFileDeleted(targetSession.isFileDeleted);
        setActiveCollaborators(targetSession.collaborators);
        setCodeLanguage(getLanguageFromFile(activeFile.name));

        try {
          targetSession.binding?._rerenderDecorations?.();
        } catch (e) {}

        editorRef.current.focus();
      } catch (err) {
        const norm = normalizeError(err, "Failed to switch editor session");
        console.warn("[Editor switchSession]", norm.message);
      }
    };

    switchSession();

    return () => {
      isMounted = false;
    };
  }, [activeFile?.id, activeFile?.name, initSession, userRole, monaco]);

  useEffect(() => {
    const activeSessions = sessionsRef.current;
    return () => {
      for (const [fileId] of activeSessions.entries()) {
        teardownSession(fileId);
      }
      const styleEl = document.getElementById("codecraft-cursor-styles");
      if (styleEl) styleEl.remove();
    };
  }, [teardownSession]);

  const handleDiagnostics = useCallback(
    (markers) => {
      const mon = monacoInstanceRef.current || monaco;
      const currentModel = editorRef.current?.getModel();
      if (mon && currentModel) {
        mon.editor.setModelMarkers(currentModel, "codecraft-diagnostics", markers || []);
      }
    },
    [monaco]
  );

  const onMount = (editor, mon) => {
    editorRef.current = editor;
    monacoInstanceRef.current = mon;
    if (typeof window !== "undefined") {
      window.monaco = mon;
      window.__codecraftEditor = editor;
    }

    editor.onDidChangeCursorPosition((e) => {
      setCursorLine(e.position.lineNumber);
      setCursorCol(e.position.column);
    });

    editor.onDidChangeModelContent(() => {
      const activeModel = editor.getModel();
      if (mon && activeModel) {
        mon.editor.setModelMarkers(activeModel, "codecraft-diagnostics", []);
      }
    });

    if (activeFile) {
      initSession(activeFile)
        .then((session) => {
          if (session && session.model) {
            editor.setModel(session.model);
            if (userRole === "viewer" || propUserRole === "viewer" || (authToken && authToken.includes("viewer")) || session.isFileDeleted) {
              editor.updateOptions({ readOnly: true });
            }
          }
        })
        .catch((err) => {
          const norm = normalizeError(err, "Failed to initialize editor session on mount");
          console.warn("[Editor onMount]", norm.message);
          setConnectionStatus("offline");
        });
    }

    try {
      editor.focus();
    } catch (e) {}
  };

  const onSelect = (selectedLang) => {
    setCodeLanguage(selectedLang);
    if (editorRef.current?.getModel()) {
      const mon = monacoInstanceRef.current || monaco;
      if (mon) {
        mon.editor.setModelLanguage(editorRef.current.getModel(), selectedLang);
      }
    }
  };

  const handleJumpToLine = (lineNumber) => {
    if (!editorRef.current) return;
    try {
      editorRef.current.revealLineInCenter(lineNumber);
      editorRef.current.setPosition({ lineNumber, column: 1 });
      editorRef.current.focus();
    } catch (err) {
      console.warn("Jump to line warning:", err);
    }
  };

  const handleJumpToProblem = useCallback((lineNumber, columnNumber = 1) => {
    if (!editorRef.current) return;
    try {
      editorRef.current.revealPositionInCenter({ lineNumber, column: columnNumber });
      editorRef.current.setPosition({ lineNumber, column: columnNumber });
      editorRef.current.focus();
    } catch (err) {
      console.warn("Jump to problem warning:", err);
    }
  }, []);

  const generateDocs = async () => {
    if (!editorRef.current || userRole === "viewer" || isFileDeleted || !activeFile) return;
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    setIsLoading(true);
    setAiError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const currentCode = editorRef.current.getValue();
      const selection = editorRef.current.getSelection();
      const selectedCode = editorRef.current.getModel()?.getValueInRange(selection) || "";

      const aiPayload = buildAIContext({
        workspaceId: activeFile.workspaceId,
        fileId: activeFile.id,
        fileName: activeFile.name,
        language: codeLanguage,
        currentCode,
        selectedCode,
        cursorPosition: editorRef.current.getPosition(),
        openTabs: effectiveFiles.map((f) => ({ id: f.id, name: f.name })),
      });

      const res = await axios.post(
        "/api/generate-documentation",
        { code: aiPayload.currentCode, language: codeLanguage, context: aiPayload, workspaceId: workspaceId || activeFile?.workspaceId },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );

      const documentation = res.data?.documentation;
      if (documentation) {
        const model = editorRef.current.getModel();
        const mon = monacoInstanceRef.current || monaco;
        if (model && mon) {
          const lineCount = model.getLineCount();
          const maxCol = model.getLineMaxColumn(lineCount);
          model.applyEdits([
            {
              range: new mon.Range(lineCount, maxCol, lineCount, maxCol),
              text: `\n\n${documentation}`,
              forceMoveMarkers: true,
            },
          ]);
          toast.success("Documentation generated successfully!");
          setAiError(null);
        }
      }
    } catch (error) {
      const status = error?.response?.status;
      const errorMsg = error?.response?.data?.error || error?.message || "Failed to generate documentation";
      const retryAfter = error?.response?.headers?.["retry-after"];

      if (status === 429) {
        const waitMsg = retryAfter ? ` Please wait ${retryAfter}s before trying again.` : " Please wait a moment before trying again.";
        const userMsg = `Rate limit reached: ${errorMsg}.${waitMsg}`;
        toast.warn(userMsg);
        setAiError(userMsg);
        console.warn(`[AI Documentation] Rate limited (429): ${errorMsg}`);
      } else if (status === 401 || status === 403) {
        const userMsg = `Permission denied: ${errorMsg}`;
        toast.error(userMsg);
        setAiError(userMsg);
        console.warn(`[AI Documentation] Auth error (${status}): ${errorMsg}`);
      } else if (status === 503) {
        const userMsg = "AI service temporarily unavailable. Please retry shortly.";
        toast.warn(userMsg);
        setAiError(userMsg);
        console.warn(`[AI Documentation] Service unavailable (503): ${errorMsg}`);
      } else {
        const userMsg = `Documentation generation failed: ${errorMsg}`;
        toast.error(userMsg);
        setAiError(userMsg);
        console.warn(`[AI Documentation] Request failed (${status || "unknown"}): ${errorMsg}`);
      }
    } finally {
      isGeneratingRef.current = false;
      setIsLoading(false);
    }
  };

  const fixSyntaxErrors = async () => {
    if (!editorRef.current || userRole === "viewer" || isFileDeleted || !activeFile) return;
    if (isFixingRef.current) return;
    isFixingRef.current = true;
    setIsFixing(true);
    setAiError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const currentCode = editorRef.current.getValue();

      const aiPayload = buildAIContext({
        workspaceId: activeFile.workspaceId,
        fileId: activeFile.id,
        fileName: activeFile.name,
        language: codeLanguage,
        currentCode,
        cursorPosition: editorRef.current.getPosition(),
        openTabs: effectiveFiles.map((f) => ({ id: f.id, name: f.name })),
      });

      const res = await axios.post(
        "/api/get-errors",
        { code: aiPayload.currentCode, codeLanguage, context: aiPayload, workspaceId: workspaceId || activeFile?.workspaceId },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );

      if (res.data?.fixedCode) {
        editorRef.current.setValue(res.data.fixedCode);
        toast.success("Syntax errors resolved by AI!");
        setAiError(null);
      }
    } catch (error) {
      const status = error?.response?.status;
      const errorMsg = error?.response?.data?.error || error?.message || "Failed to fix syntax";
      const retryAfter = error?.response?.headers?.["retry-after"];

      if (status === 429) {
        const waitMsg = retryAfter ? ` Please wait ${retryAfter}s before trying again.` : " Please wait a moment before trying again.";
        const userMsg = `Rate limit reached: ${errorMsg}.${waitMsg}`;
        toast.warn(userMsg);
        setAiError(userMsg);
        console.warn(`[AI Syntax Fixer] Rate limited (429): ${errorMsg}`);
      } else if (status === 401 || status === 403) {
        const userMsg = `Permission denied: ${errorMsg}`;
        toast.error(userMsg);
        setAiError(userMsg);
        console.warn(`[AI Syntax Fixer] Auth error (${status}): ${errorMsg}`);
      } else if (status === 503) {
        const userMsg = "AI service temporarily unavailable. Please retry shortly.";
        toast.warn(userMsg);
        setAiError(userMsg);
        console.warn(`[AI Syntax Fixer] Service unavailable (503): ${errorMsg}`);
      } else {
        const userMsg = `Syntax fix failed: ${errorMsg}`;
        toast.error(userMsg);
        setAiError(userMsg);
        console.warn(`[AI Syntax Fixer] Request failed (${status || "unknown"}): ${errorMsg}`);
      }
    } finally {
      isFixingRef.current = false;
      setIsFixing(false);
    }
  };

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
    setTimeout(() => editorRef.current?.layout(), 100);
  };

  const toggleComments = () => {
    if (!showComments) {
      setShowComments(true);
      setRightDockTab("comments");
      setIsRightDockOpen(true);
    } else {
      setShowComments(false);
      setRightDockTab("output");
    }
    setTimeout(() => editorRef.current?.layout(), 100);
  };

  const toggleRightDock = () => {
    setIsRightDockOpen((prev) => !prev);
    setTimeout(() => editorRef.current?.layout(), 100);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const themes = [
    { name: "Dark", value: "vs-dark" },
    { name: "Light", value: "light" },
    { name: "High Contrast", value: "hc-black" },
  ];

  const renderStatusBadge = () => {
    if (!activeFile) return null;

    if (isFileDeleted) {
      return (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border border-rose-500/40 bg-rose-500/10 text-rose-300">
          <AlertTriangle size={11} className="text-rose-400" />
          <span>Deleted</span>
        </div>
      );
    }

    switch (connectionStatus) {
      case "connected":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Connected</span>
            {isLocalSaved && (
              <span className="text-[10px] text-emerald-400/80 border-l border-emerald-500/30 pl-1.5 flex items-center gap-1">
                <CheckCircle2 size={10} /> Saved
              </span>
            )}
            {userRole === "viewer" && (
              <span className="flex items-center gap-1 bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded text-[10px] ml-1">
                <Lock size={9} /> View Only
              </span>
            )}
          </div>
        );

      case "syncing":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border border-blue-500/30 bg-blue-500/10 text-blue-300">
            <RefreshCw size={11} className="animate-spin text-blue-400" />
            <span>Syncing</span>
          </div>
        );

      case "reconnecting":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
            <span>Reconnecting</span>
          </div>
        );

      case "connecting":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>Connecting</span>
          </div>
        );

      case "offline":
      default:
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border border-slate-700 bg-slate-800/80 text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            <span>Offline</span>
            {isLocalSaved ? (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1 border-l border-slate-700 pl-1.5">
                <CheckCircle2 size={10} /> Saved
              </span>
            ) : (
              <span className="text-[10px] text-slate-500 border-l border-slate-700 pl-1.5">Unsynced</span>
            )}
          </div>
        );
    }
  };

  return (
    <div className={`h-full w-full flex flex-col bg-[#070B14] overflow-hidden ${isExpanded ? "fixed inset-0 z-50" : "relative"}`}>
      {/* 1. Tab Bar (VS Code style top bar) */}
      <div className="h-9 bg-[#090E1B] border-b border-white/[0.08] flex items-center justify-between px-2 overflow-hidden flex-shrink-0 min-w-0">
        <div className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0 scrollbar-none">
          {effectiveFiles.map((item) => {
            const isActive = item.id === effectiveActiveId;
            const itemSession = sessionsRef.current.get(item.id);
            const isItemDeleted = itemSession?.isFileDeleted;

            return (
              <div
                key={item.id}
                onClick={() => onSelectTab && onSelectTab(item.id)}
                className={`group flex items-center gap-2 px-3 h-8 text-xs font-mono cursor-pointer border-r border-white/[0.06] transition-colors select-none ${
                  isActive
                    ? "bg-[#070B14] text-slate-100 border-t-2 border-indigo-500 font-medium"
                    : "bg-[#090E1B] text-slate-400 hover:text-slate-200 hover:bg-white/[0.02] border-t-2 border-transparent"
                }`}
              >
                {isItemDeleted ? (
                  <AlertTriangle size={13} className="text-rose-400 flex-shrink-0" />
                ) : (
                  <FileCode size={13} className={isActive ? "text-indigo-400" : "text-slate-500"} />
                )}
                <span className={`truncate max-w-[130px] sm:max-w-[180px] ${isItemDeleted ? "line-through text-rose-300" : ""}`}>
                  {item.name}
                </span>

                {onCloseTab && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(item.id);
                    }}
                    className="p-0.5 rounded opacity-60 hover:opacity-100 hover:bg-white/10 text-slate-400 hover:text-white transition-opacity ml-1"
                    title="Close tab"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}

          {effectiveFiles.length === 0 && (
            <span className="text-xs text-slate-500 font-mono italic px-3">No files open</span>
          )}
        </div>

        {/* Tab Bar Right: Collaborators & Connection Badge */}
        <div className="flex items-center gap-2.5 flex-shrink-0 ml-2">
          {activeCollaborators.length > 0 && (
            <div className="flex items-center gap-1.5 bg-white/[0.04] px-2 py-0.5 rounded-full border border-white/[0.08]" title="Active collaborators in this file">
              <Users size={11} className="text-indigo-400" />
              <div className="flex -space-x-1.5">
                {activeCollaborators.slice(0, 4).map((c) => (
                  <span
                    key={c.clientId}
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white border border-[#090E1B]"
                    style={{ backgroundColor: c.color }}
                    title={c.name + (c.isSelf ? " (You)" : "")}
                  >
                    {(c.name || "U")[0].toUpperCase()}
                  </span>
                ))}
              </div>
              {activeCollaborators.length > 4 && (
                <span className="text-[10px] text-slate-400 font-mono">+{activeCollaborators.length - 4}</span>
              )}
            </div>
          )}

          {renderStatusBadge()}
        </div>
      </div>

      {/* 2. Contextual Toolbar */}
      <div className="h-8 bg-[#070B14] border-b border-white/[0.06] px-3 flex items-center justify-between flex-shrink-0 min-w-0 overflow-hidden">
        {/* Breadcrumb Trail */}
        <div className="flex items-center gap-1 text-xs font-mono text-slate-400 truncate min-w-0 mr-2 flex-shrink">
          {activeFile ? (
            <div className="flex items-center gap-1 text-slate-300">
              <span className="text-slate-500">src</span>
              <ChevronRight size={12} className="text-slate-600" />
              <File size={12} className="text-indigo-400" />
              <span className="text-slate-200 font-medium">{activeFile.name}</span>
            </div>
          ) : (
            <span className="text-slate-600">No active file</span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Settings Popover */}
          <div className="relative" ref={settingsRef}>
            <button
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
              onClick={() => setShowSettings(!showSettings)}
              title="Editor Preferences"
            >
              <Settings size={13} />
            </button>
            {showSettings && (
              <div className="absolute right-0 mt-2 w-48 bg-[#0D1424] rounded-lg shadow-2xl p-3 space-y-3 z-50 border border-white/[0.1] text-xs">
                <div>
                  <label className="text-slate-400 mb-1 block font-mono">Theme</label>
                  <select
                    className="w-full bg-[#070B14] text-slate-200 text-xs p-1.5 rounded border border-white/[0.08]"
                    value={selectedTheme}
                    onChange={(e) => setSelectedTheme(e.target.value)}
                  >
                    {themes.map((theme) => (
                      <option key={theme.value} value={theme.value}>
                        {theme.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 mb-1 block font-mono">Font Size: {fontSize}px</label>
                  <input
                    type="range"
                    min="11"
                    max="22"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-full bg-slate-700 rounded appearance-none cursor-pointer h-1.5"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Inline Comments */}
          <button
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors border ${
              showComments
                ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                : "bg-white/[0.02] text-slate-400 hover:text-slate-200 border-transparent hover:border-white/[0.08]"
            }`}
            onClick={toggleComments}
            disabled={!activeFile}
            title="Toggle Inline Code Comments"
          >
            <MessageSquare size={12} />
            <span className="hidden lg:inline">Comments</span>
            {commentsCount > 0 && (
              <span className="bg-amber-500/20 text-amber-300 text-[10px] font-bold px-1 rounded-full border border-amber-500/30">
                {commentsCount}
              </span>
            )}
          </button>

          {/* AI Documentation Generator */}
          <button
            className="flex items-center gap-1 bg-blue-500/10 border border-blue-500/20 text-blue-300 hover:bg-blue-500/20 px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-40"
            onClick={generateDocs}
            disabled={isLoading || userRole === "viewer" || isFileDeleted || !activeFile}
            title={userRole === "viewer" ? "Read-only mode" : isFileDeleted ? "File deleted" : "Generate Documentation with AI"}
          >
            <Sparkles size={12} className={isLoading ? "animate-spin" : "text-blue-400"} />
            <span className="hidden lg:inline">{isLoading ? "Generating..." : "Docs"}</span>
          </button>

          {/* AI Syntax Fixer */}
          <button
            className="flex items-center gap-1 bg-teal-500/10 border border-teal-500/20 text-teal-300 hover:bg-teal-500/20 px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-40"
            onClick={fixSyntaxErrors}
            disabled={isFixing || userRole === "viewer" || isFileDeleted || !activeFile}
            title={userRole === "viewer" ? "Read-only mode" : isFileDeleted ? "File deleted" : "Fix Syntax Errors with AI"}
          >
            <Wrench size={12} className={isFixing ? "animate-spin" : "text-teal-400"} />
            <span className="hidden lg:inline">{isFixing ? "Fixing..." : "Fix"}</span>
          </button>

          {/* Language Selector */}
          <LanguageSelector language={codeLanguage} onSelect={onSelect} />

          {/* Bottom Panel / Terminal Toggle */}
          {!isExpanded && (
            <button
              className={`p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors border ${
                isRightDockOpen ? "border-white/[0.08]" : "border-transparent"
              }`}
              onClick={toggleRightDock}
              title={isRightDockOpen ? "Collapse Terminal Panel" : "Open Terminal Panel"}
              aria-label="Toggle terminal bottom panel"
            >
              {isRightDockOpen ? <PanelBottomClose size={13} /> : <PanelBottomOpen size={13} />}
            </button>
          )}

          {/* Fullscreen Expand */}
          <button
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            onClick={toggleExpand}
            title={isExpanded ? "Restore Editor View" : "Maximize Editor"}
          >
            {isExpanded ? <Shrink size={13} /> : <Expand size={13} />}
          </button>
        </div>
      </div>

      {/* File Deleted Banner */}
      {isFileDeleted && (
        <div className="bg-rose-950/60 border-b border-rose-500/30 text-rose-200 px-3 py-1.5 text-xs flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={13} className="text-rose-400 flex-shrink-0" />
            <span>This file was deleted from the workspace by a collaborator. Local edits are disabled to prevent stale resurrects.</span>
          </div>
          {onCloseTab && activeFile && (
            <button
              onClick={() => onCloseTab(activeFile.id)}
              className="px-2 py-0.5 bg-rose-900/60 hover:bg-rose-800 text-white rounded text-[11px] font-mono border border-rose-700/50"
            >
              Close Tab
            </button>
          )}
        </div>
      )}

      {/* AI Error Notification Banner */}
      {aiError && (
        <div
          role="alert"
          data-testid="editor-ai-error-banner"
          className="bg-amber-950/70 border-b border-amber-500/40 text-amber-200 px-3 py-1.5 text-xs flex items-center justify-between flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
            <span className="leading-tight">{aiError}</span>
          </div>
          <button
            onClick={() => setAiError(null)}
            className="text-amber-400 hover:text-amber-200 text-xs px-1 font-bold"
            aria-label="Dismiss alert"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3. Main Workspace Area: Monaco Editor + Resizable Bottom Panel */}
      <div ref={workspaceContainerRef} className="relative flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
        {/* Editor Area (always flex: 1 1 0; min-w-0; min-h-0; overflow: hidden) */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col bg-[#070B14] overflow-hidden">
          {effectiveFiles.length === 0 ? (
            <div
              data-testid="empty-editor-state"
              className="editor-empty-state flex flex-col items-center justify-center h-full w-full bg-[#070B14] text-slate-400 gap-3 select-none"
            >
              <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center">
                <FileCode size={24} className="text-slate-500" />
              </div>
              <h3 className="text-sm font-medium text-slate-300">No Open Files</h3>
              <p className="text-xs text-slate-500 max-w-sm text-center px-4">
                Select a file from the Explorer on the left to start editing and collaborating in real-time.
              </p>
            </div>
          ) : isUnsupportedActiveFile ? (
            <div className="editor-empty-state flex flex-col items-center justify-center h-full w-full bg-[#070B14] text-slate-400 gap-3 p-6 text-center select-none">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <AlertTriangle size={24} className="text-amber-400" />
              </div>
              <h3 className="text-sm font-medium text-slate-200">File Cannot Be Displayed</h3>
              <p className="text-xs text-slate-400 max-w-md">
                {unsupportedActiveReason || "Binary files and files exceeding 512 KB cannot be loaded into the collaborative editor."}
              </p>
            </div>
          ) : (
            <Editor
              height="100%"
              theme={selectedTheme}
              language={codeLanguage}
              defaultValue="// Loading code session..."
              onMount={onMount}
              options={{
                fontSize: fontSize,
                wordWrap: "on",
                minimap: { enabled: false },
                automaticLayout: true,
                bracketPairColorization: true,
                readOnly: userRole === "viewer" || isFileDeleted,
                suggest: { preview: true },
                inlineSuggest: {
                  enabled: true,
                  showToolbar: "onHover",
                  mode: "subword",
                  suppressSuggestions: false,
                },
                quickSuggestions: { other: true, comments: true, strings: true },
                suggestSelection: "recentlyUsed",
                lineNumbersMinChars: 3,
                glyphMargin: false,
                folding: true,
                renderLineHighlight: "line",
              }}
            />
          )}
        </div>

        {/* Resizable Bottom Panel: Output / Terminal & Comments */}
        {!isExpanded && isRightDockOpen && (
          <>
            {/* Horizontal Drag Handle between Editor and Bottom Panel */}
            <div
              onMouseDown={startTerminalResize}
              onTouchStart={startTerminalResize}
              className={`h-1.5 w-full cursor-row-resize z-20 flex-shrink-0 transition-colors select-none ${
                isResizingTerminal ? "bg-indigo-500" : "bg-white/[0.06] hover:bg-indigo-500/50"
              }`}
              title="Drag to resize Terminal / Output panel"
            />

            <div
              style={{ height: `${terminalHeight}px`, minHeight: "160px", maxHeight: "50%" }}
              className="w-full flex-shrink-0 border-t border-white/[0.08] bg-[#0A0F1E] flex flex-col overflow-hidden select-none"
            >
              {/* Bottom Panel Header Tabs */}
              <div className="h-8 bg-[#090E1B] border-b border-white/[0.08] px-2 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setRightDockTab("output")}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono rounded transition-colors ${
                      rightDockTab === "output"
                        ? "text-indigo-400 bg-indigo-500/10 font-semibold border border-indigo-500/20"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Terminal size={12} />
                    <span>Terminal</span>
                  </button>
                  <button
                    onClick={() => {
                      setRightDockTab("comments");
                      setShowComments(true);
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono rounded transition-colors ${
                      rightDockTab === "comments"
                        ? "text-amber-400 bg-amber-500/10 font-semibold border border-amber-500/20"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <MessageSquare size={12} />
                    <span>Comments</span>
                    {commentsCount > 0 && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1 rounded-full font-bold">
                        {commentsCount}
                      </span>
                    )}
                  </button>
                </div>

                <button
                  onClick={toggleRightDock}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                  title="Collapse Terminal Panel"
                >
                  <PanelBottomClose size={13} />
                </button>
              </div>

              {/* Bottom Panel Body */}
              <div className="flex-1 min-h-0 relative overflow-hidden">
                <div className={`h-full ${rightDockTab === "output" ? "block" : "hidden"}`}>
                  <Output
                    editorRef={editorRef}
                    language={codeLanguage}
                    workspaceId={workspaceId}
                    userRole={userRole}
                    files={effectiveFiles}
                    activeFile={activeFile}
                    authToken={authToken}
                    onDiagnostics={handleDiagnostics}
                    onJumpToProblem={handleJumpToProblem}
                  />
                </div>

                <div className={`h-full ${rightDockTab === "comments" ? "block" : "hidden"}`}>
                  {activeFile ? (
                    <CommentsPanel
                      workspaceId={workspaceId}
                      fileId={activeFile.id}
                      currentLine={cursorLine}
                      onJumpToLine={handleJumpToLine}
                      onClose={() => {
                        setShowComments(false);
                        setRightDockTab("output");
                      }}
                      userRole={userRole}
                    />
                  ) : (
                    <div className="p-4 text-xs text-slate-500 font-mono text-center mt-8">
                      Open a file to view and leave code comments.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Hidden persistent mount of Output when bottom panel is collapsed, so background tasks & diagnostics remain active */}
        {!isExpanded && !isRightDockOpen && (
          <div className="hidden">
            <Output
              editorRef={editorRef}
              language={codeLanguage}
              workspaceId={workspaceId}
              userRole={userRole}
              files={effectiveFiles}
              activeFile={activeFile}
              authToken={authToken}
              onDiagnostics={handleDiagnostics}
              onJumpToProblem={handleJumpToProblem}
            />
          </div>
        )}
      </div>

      {/* 4. Bottom IDE Status Bar */}
      <footer className="h-6 bg-[#070B14] border-t border-white/[0.08] px-3 flex items-center justify-between text-[11px] font-mono text-slate-400 select-none flex-shrink-0 z-10 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-hidden">
          <span className="flex items-center gap-1.5 text-slate-300 truncate">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${connectionStatus === "connected" ? "bg-emerald-400" : connectionStatus === "syncing" ? "bg-blue-400 animate-pulse" : "bg-amber-400"}`} />
            <span className="capitalize truncate">{connectionStatus}</span>
          </span>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <span className="text-slate-400 hidden sm:inline">UTF-8</span>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <span className="text-slate-400 hidden sm:inline">Spaces: 2</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <span>
            Ln {cursorLine}, Col {cursorCol}
          </span>
          <span className="text-slate-700">|</span>
          <span className="text-indigo-400 font-medium">
            {codeLanguage.toUpperCase()}
          </span>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <span className={`hidden sm:inline-block px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase ${
            userRole === "owner"
              ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
              : userRole === "contributor"
              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
          }`}>
            {userRole || "viewer"}
          </span>
        </div>
      </footer>
    </div>
  );
}
