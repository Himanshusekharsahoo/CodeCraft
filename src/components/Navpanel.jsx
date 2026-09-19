"use client";

import { useState, useEffect } from "react";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  onSnapshot,
} from "firebase/firestore";
import { db, auth } from "@/config/firebase";
import {
  Folder,
  File,
  FileCode,
  FolderPlus,
  FilePlus,
  Trash2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { normalizeError } from "@/lib/errorUtils";

const getFileIcon = (fileName) => {
  if (!fileName || typeof fileName !== "string") {
    return <File size={14} className="mr-1.5 text-gray-400 flex-shrink-0" />;
  }
  const ext = fileName.split(".").pop().toLowerCase();
  if (["js", "jsx", "mjs"].includes(ext)) {
    return <FileCode size={14} className="mr-1.5 text-yellow-400 flex-shrink-0" />;
  }
  if (["ts", "tsx"].includes(ext)) {
    return <FileCode size={14} className="mr-1.5 text-blue-400 flex-shrink-0" />;
  }
  if (["json"].includes(ext)) {
    return <FileCode size={14} className="mr-1.5 text-amber-400 flex-shrink-0" />;
  }
  if (["css", "scss"].includes(ext)) {
    return <FileCode size={14} className="mr-1.5 text-purple-400 flex-shrink-0" />;
  }
  if (["html"].includes(ext)) {
    return <FileCode size={14} className="mr-1.5 text-orange-400 flex-shrink-0" />;
  }
  if (["py"].includes(ext)) {
    return <FileCode size={14} className="mr-1.5 text-emerald-400 flex-shrink-0" />;
  }
  if (["md", "txt"].includes(ext)) {
    return <File size={14} className="mr-1.5 text-sky-400 flex-shrink-0" />;
  }
  return <File size={14} className="mr-1.5 text-gray-400 flex-shrink-0" />;
};

const NavPanel = ({
  workspaceId,
  openFile,
  selectedFile,
  openFiles = [],
  onCloseFile,
  userRole: propUserRole = null,
}) => {
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [folderStates, setFolderStates] = useState({});
  const [userRole, setUserRole] = useState(propUserRole || null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [creatingType, setCreatingType] = useState(null);
  const [creatingParentFolderId, setCreatingParentFolderId] = useState(null);
  const [newItemName, setNewItemName] = useState("");
  const [renamingItem, setRenamingItem] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const router = useRouter();

  const truncateName = (name) => {
    return name.length > 22 ? `${name.substring(0, 22)}...` : name;
  };

  useEffect(() => {
    if (propUserRole) {
      setUserRole(propUserRole);
    }
  }, [propUserRole]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      router.push("/login");
      return;
    }

    // If role is passed from workspace parent, skip redundant whole-collection listener
    let unsubscribeMembers = () => {};
    if (!propUserRole) {
      const membersRef = collection(db, `workspaces/${workspaceId}/members`);
      unsubscribeMembers = onSnapshot(
        membersRef,
        (snapshot) => {
          const membersData = snapshot.docs.map((doc) => doc.data());
          const member = membersData.find((m) => m.userId === user.uid);
          if (member) setUserRole(member.role);
        },
        (err) => {
          const norm = normalizeError(err, "Members listener warning");
          console.warn("[NavPanel Members]", norm.message);
        }
      );
    }

    const foldersRef = collection(db, `workspaces/${workspaceId}/folders`);
    const unsubscribeFolders = onSnapshot(
      foldersRef,
      (snapshot) => {
        const foldersData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setFolders(foldersData);

        // Preserve previously expanded folders rather than collapsing all
        setFolderStates((prev) => {
          const next = { ...prev };
          foldersData.forEach((folder) => {
            if (next[folder.id] === undefined) {
              next[folder.id] = true; // Default open for better developer experience
            }
          });
          return next;
        });
      },
      (err) => {
        const norm = normalizeError(err, "Folders listener warning");
        console.warn("[NavPanel Folders]", norm.message);
      }
    );

    const filesRef = collection(db, `workspaces/${workspaceId}/files`);
    const unsubscribeFiles = onSnapshot(
      filesRef,
      (snapshot) => {
        setFiles(snapshot.docs.map((doc) => ({ id: doc.id, workspaceId, ...doc.data() })));
      },
      (err) => {
        const norm = normalizeError(err, "Files listener warning");
        console.warn("[NavPanel Files]", norm.message);
      }
    );

    return () => {
      unsubscribeMembers();
      unsubscribeFolders();
      unsubscribeFiles();
    };
  }, [workspaceId, router]);

  const toggleFolder = (folderId) => {
    setFolderStates((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  const handleDragStart = (e, item, type) => {
    e.stopPropagation();
    setDraggedItem({ id: item.id, type });
  };

  const handleDragOver = (e, targetFolderId) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Helper to prevent circular folder hierarchy
  const isDescendant = (potentialAncestorId, targetId, allFolders) => {
    let current = allFolders.find((f) => f.id === targetId);
    while (current && current.parentFolderId) {
      if (current.parentFolderId === potentialAncestorId) {
        return true;
      }
      current = allFolders.find((f) => f.id === current.parentFolderId);
    }
    return false;
  };

  const handleDrop = async (e, targetFolderId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedItem || draggedItem.id === targetFolderId) return;

    // Guard against dropping a folder into itself or its descendants
    if (draggedItem.type === "folder" && targetFolderId) {
      if (isDescendant(draggedItem.id, targetFolderId, folders)) {
        console.warn("Cannot move a folder into its own descendant");
        setDraggedItem(null);
        return;
      }
    }

    try {
      const isFolder = draggedItem.type === "folder";
      const collectionName = isFolder ? "folders" : "files";
      const fieldName = isFolder ? "parentFolderId" : "folderId";

      await updateDoc(
        doc(db, `workspaces/${workspaceId}/${collectionName}/${draggedItem.id}`),
        { [fieldName]: targetFolderId || null }
      );
    } catch (error) {
      console.error("Error moving item:", error);
    }
    setDraggedItem(null);
  };

  const createItem = async (folderid) => {
    const trimmed = (newItemName || "").trim();
    if (!trimmed) {
      setCreatingType(null);
      setCreatingParentFolderId(null);
      setValidationError(null);
      return;
    }

    if (trimmed.includes("/") || trimmed.includes("\\") || trimmed === ".." || trimmed === ".") {
      setValidationError("Name cannot contain '/' or '\\'");
      return;
    }

    setValidationError(null);
    try {
      if (creatingType === "folder") {
        await addDoc(collection(db, `workspaces/${workspaceId}/folders`), {
          name: trimmed,
          parentFolderId: creatingParentFolderId,
        });
      } else {
        await addDoc(collection(db, `workspaces/${workspaceId}/files`), {
          name: trimmed,
          folderId: creatingParentFolderId,
          workspaceId,
        });
      }
      setNewItemName("");
      setCreatingType(null);
      setCreatingParentFolderId(null);
      if (folderid) {
        setFolderStates((prev) => ({ ...prev, [folderid]: true }));
      }
    } catch (error) {
      console.error("Error creating item:", error);
      setValidationError("Failed to create item");
    }
  };

  const renameItem = async () => {
    if (!renamingItem?.name) {
      setRenamingItem(null);
      return;
    }
    const trimmed = renamingItem.name.trim();
    if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
      setRenamingItem(null);
      return;
    }

    try {
      const collectionName = renamingItem.type === "folder" ? "folders" : "files";
      await updateDoc(
        doc(db, `workspaces/${workspaceId}/${collectionName}/${renamingItem.id}`),
        { name: trimmed }
      );
      setRenamingItem(null);
    } catch (error) {
      console.error("Error renaming item:", error);
    }
  };

  const executeDelete = async (type, id) => {
    try {
      if (type === "folders") {
        await deleteDoc(doc(db, `workspaces/${workspaceId}/folders/${id}`));
        const nestedFolders = folders.filter(
          (folder) => folder.parentFolderId === id
        );
        for (const nestedFolder of nestedFolders) {
          await executeDelete("folders", nestedFolder.id);
        }
        const folderFiles = files.filter((file) => file.folderId === id);
        for (const file of folderFiles) {
          await deleteDoc(doc(db, `workspaces/${workspaceId}/files/${file.id}`));
          if (onCloseFile) {
            onCloseFile(file.id);
          } else if (selectedFile?.id === file.id && openFile) {
            openFile(null);
          }
        }
      } else {
        await deleteDoc(doc(db, `workspaces/${workspaceId}/files/${id}`));
        if (onCloseFile) {
          onCloseFile(id);
        } else if (selectedFile?.id === id && openFile) {
          openFile(null);
        }
      }
    } catch (error) {
      console.error("Error deleting item:", error);
    }
  };

  const requestDelete = (type, id, name) => {
    setItemToDelete({ type, id, name });
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    const { type, id } = itemToDelete;
    setItemToDelete(null);
    await executeDelete(type, id);
  };

  const isEditable = userRole === "contributor" || userRole === "owner";

  const renderFolder = (folder) => {
    const nestedFolders = folders.filter((f) => f.parentFolderId === folder.id);
    const folderFiles = files.filter((file) => file.folderId === folder.id);
    const isOpen = folderStates[folder.id];

    return (
      <div
        key={folder.id}
        className="ml-2 border-l border-white/[0.06]"
        draggable
        onDragStart={(e) => handleDragStart(e, folder, "folder")}
        onDragOver={(e) => handleDragOver(e, folder.id)}
        onDrop={(e) => handleDrop(e, folder.id)}
      >
        <div className="flex items-center justify-between group hover:bg-slate-800/50 px-1.5 py-1 rounded text-xs transition-colors select-none">
          <div
            className="flex items-center flex-1 min-w-0 cursor-pointer text-gray-300 group-hover:text-white"
            onClick={() => toggleFolder(folder.id)}
          >
            {isOpen ? (
              <ChevronDown size={14} className="mr-1 text-gray-500 flex-shrink-0" />
            ) : (
              <ChevronRight size={14} className="mr-1 text-gray-500 flex-shrink-0" />
            )}
            <Folder size={14} className="mr-1.5 text-blue-400 flex-shrink-0" />
            {renamingItem?.id === folder.id ? (
              <input
                className="text-xs bg-slate-950 text-white px-1.5 py-0.5 rounded border border-blue-500 outline-none w-full"
                value={renamingItem.name}
                onChange={(e) => setRenamingItem({ ...renamingItem, name: e.target.value })}
                onBlur={renameItem}
                onKeyDown={(e) => {
                  if (e.key === "Enter") renameItem();
                  if (e.key === "Escape") setRenamingItem(null);
                }}
                autoFocus
              />
            ) : (
              <span
                className="text-xs font-mono truncate"
                onDoubleClick={() => isEditable && setRenamingItem({ id: folder.id, name: folder.name, type: "folder" })}
                title="Double click to rename"
              >
                {truncateName(folder.name)}
              </span>
            )}
          </div>

          {isEditable && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                className="p-1 text-gray-400 hover:text-white hover:bg-slate-700/60 rounded"
                title="New file in folder"
                onClick={(e) => {
                  e.stopPropagation();
                  setCreatingType((prev) => (prev === "file" ? null : "file"));
                  setCreatingParentFolderId(folder.id);
                  setNewItemName("");
                  setFolderStates({ ...folderStates, [folder.id]: true });
                }}
              >
                <FilePlus size={12} />
              </button>
              <button
                type="button"
                className="p-1 text-gray-400 hover:text-white hover:bg-slate-700/60 rounded"
                title="New folder in folder"
                onClick={(e) => {
                  e.stopPropagation();
                  setCreatingType((prev) => (prev === "folder" ? null : "folder"));
                  setCreatingParentFolderId(folder.id);
                  setNewItemName("");
                  setFolderStates({ ...folderStates, [folder.id]: true });
                }}
              >
                <FolderPlus size={12} />
              </button>
              <button
                type="button"
                className="p-1 text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 rounded"
                title={`Delete folder ${folder.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  requestDelete("folders", folder.id, folder.name);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>

        {isOpen && (
          <div className="ml-1">
            {creatingType && creatingParentFolderId === folder.id && (
              <div className="ml-3 my-0.5 flex items-center px-1.5 py-0.5">
                <input
                  className="text-xs bg-slate-950 text-white px-2 py-0.5 rounded flex-1 border border-blue-500 outline-none font-mono"
                  placeholder={`New ${creatingType} name`}
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onBlur={() => createItem(folder.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createItem(folder.id);
                    if (e.key === "Escape") {
                      setCreatingType(null);
                      setNewItemName("");
                    }
                  }}
                  autoFocus
                />
              </div>
            )}
            {nestedFolders.map((nestedFolder) => renderFolder(nestedFolder))}
            {folderFiles.map((file) => {
              const isSelected = selectedFile?.id === file.id;
              const isOpenInTabs = openFiles?.some((f) => f.id === file.id);

              return (
                <div
                  key={file.id}
                  className={`ml-3.5 flex items-center justify-between group px-1.5 py-1 rounded text-xs transition-colors cursor-pointer select-none ${
                    isSelected
                      ? "bg-blue-600/15 border-l-2 border-blue-500 text-blue-200 font-semibold"
                      : isOpenInTabs
                      ? "text-gray-200 bg-slate-800/40 hover:bg-slate-800/70"
                      : "text-gray-400 hover:text-gray-200 hover:bg-slate-800/40"
                  }`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, file, "file")}
                  onDragOver={(e) => handleDragOver(e, folder.id)}
                  onDrop={(e) => handleDrop(e, folder.id)}
                >
                  <div
                    className="flex items-center flex-1 min-w-0"
                    onClick={() => openFile(file)}
                  >
                    {getFileIcon(file.name)}
                    {renamingItem?.id === file.id ? (
                      <input
                        className="text-xs bg-slate-950 text-white px-1.5 py-0.5 rounded border border-blue-500 outline-none font-mono w-full"
                        value={renamingItem.name}
                        onChange={(e) => setRenamingItem({ ...renamingItem, name: e.target.value })}
                        onBlur={renameItem}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameItem();
                          if (e.key === "Escape") setRenamingItem(null);
                        }}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="truncate font-mono text-xs"
                        onDoubleClick={() => isEditable && setRenamingItem({ id: file.id, name: file.name, type: "file" })}
                        title="Double click to rename"
                      >
                        {truncateName(file.name)}
                      </span>
                    )}
                  </div>
                  {isEditable && (
                    <button
                      type="button"
                      className="p-1 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title={`Delete file ${file.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        requestDelete("files", file.id, file.name);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-[#0A0F1E] text-gray-300 h-full w-full flex flex-col font-sans select-none border-r border-white/[0.08]">
      {/* Sleek Explorer Header */}
      <div className="h-9 px-3 border-b border-white/[0.08] flex items-center justify-between bg-[#070B14]">
        <span className="text-[11px] font-bold font-mono text-gray-400 uppercase tracking-wider">
          Explorer
        </span>
        {isEditable && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setCreatingParentFolderId(null);
                setNewItemName("");
                setCreatingType((prev) => (prev === "file" ? null : "file"));
              }}
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="New File"
              aria-label="New File"
            >
              <FilePlus size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatingParentFolderId(null);
                setNewItemName("");
                setCreatingType((prev) => (prev === "folder" ? null : "folder"));
              }}
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="New Folder"
              aria-label="New Folder"
            >
              <FolderPlus size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Tree Content */}
      <div
        className="flex-1 overflow-y-auto py-2 px-1.5 font-mono text-xs"
        onDragOver={(e) => handleDragOver(e, null)}
        onDrop={(e) => handleDrop(e, null)}
      >
        {validationError && (
          <div className="mx-2 mb-2 p-2 bg-rose-950/80 border border-rose-800 text-rose-300 text-xs rounded flex items-center gap-1.5">
            <AlertCircle size={14} />
            <span>{validationError}</span>
          </div>
        )}

        {creatingType && !creatingParentFolderId && (
          <div className="flex items-center px-2 py-1 mb-1 bg-slate-900 rounded border border-blue-500">
            {creatingType === "folder" ? (
              <Folder size={14} className="mr-1.5 text-blue-400 flex-shrink-0" />
            ) : (
              <File size={14} className="mr-1.5 text-gray-400 flex-shrink-0" />
            )}
            <input
              className="text-xs bg-transparent text-white px-1 py-0.5 rounded flex-1 outline-none font-mono"
              placeholder={`New ${creatingType} name`}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onBlur={() => createItem()}
              onKeyDown={(e) => {
                if (e.key === "Enter") createItem();
                if (e.key === "Escape") {
                  setCreatingType(null);
                  setNewItemName("");
                  setValidationError(null);
                }
              }}
              autoFocus
            />
          </div>
        )}

        {folders.length === 0 && files.length === 0 && !creatingType && (
          <div
            className="flex flex-col items-center justify-center p-6 text-center text-gray-500 h-48 gap-2 select-none"
            data-testid="empty-file-tree"
          >
            <Folder className="w-8 h-8 text-gray-600 mb-1 opacity-50" />
            <p className="text-xs font-medium text-gray-300">No files in workspace</p>
            <p className="text-[11px] text-gray-500 max-w-[180px]">
              Use &quot;Add file&quot; above to create your first code file.
            </p>
          </div>
        )}

        {folders
          .filter((folder) => !folder.parentFolderId)
          .map((folder) => renderFolder(folder))}

        {files
          .filter((file) => !file.folderId)
          .map((file) => {
            const isSelected = selectedFile?.id === file.id;
            const isOpenInTabs = openFiles?.some((f) => f.id === file.id);

            return (
              <div
                key={file.id}
                className={`flex items-center justify-between group px-2 py-1 rounded transition-colors select-none cursor-pointer ${
                  isSelected
                    ? "bg-blue-600/15 border-l-2 border-blue-500 text-blue-200 font-semibold"
                    : isOpenInTabs
                    ? "text-gray-200 bg-slate-800/40 hover:bg-slate-800/70"
                    : "text-gray-400 hover:text-gray-200 hover:bg-slate-800/40"
                }`}
                draggable
                onDragStart={(e) => handleDragStart(e, file, "file")}
                onDragOver={(e) => handleDragOver(e, null)}
                onDrop={(e) => handleDrop(e, null)}
              >
                <div
                  className="flex items-center flex-1 min-w-0"
                  onClick={() => openFile(file)}
                >
                  {getFileIcon(file.name)}
                  {renamingItem?.id === file.id ? (
                    <input
                      className="text-xs bg-slate-950 text-white px-1.5 py-0.5 rounded border border-blue-500 outline-none font-mono w-full"
                      value={renamingItem.name}
                      onChange={(e) => setRenamingItem({ ...renamingItem, name: e.target.value })}
                      onBlur={renameItem}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameItem();
                        if (e.key === "Escape") setRenamingItem(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="truncate font-mono text-xs"
                      onDoubleClick={() => isEditable && setRenamingItem({ id: file.id, name: file.name, type: "file" })}
                      title="Double click to rename"
                    >
                      {truncateName(file.name)}
                    </span>
                  )}
                </div>
                {isEditable && (
                  <button
                    type="button"
                    className="p-1 text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    title={`Delete file ${file.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestDelete("files", file.id, file.name);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
      </div>

      {/* Delete Confirmation Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-[#0f172a] border border-gray-700 rounded-lg p-4 max-w-xs w-full shadow-2xl flex flex-col gap-3">
            <div className="flex items-center gap-2 text-rose-400 font-medium text-sm">
              <Trash2 size={16} />
              <span>Delete {itemToDelete.type === "folders" ? "Folder" : "File"}?</span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              Are you sure you want to permanently delete <strong className="text-white font-mono">{itemToDelete.name}</strong>? This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 mt-1">
              <button
                onClick={() => setItemToDelete(null)}
                data-testid="cancel-delete-btn"
                className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                data-testid="confirm-delete-btn"
                className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NavPanel;
