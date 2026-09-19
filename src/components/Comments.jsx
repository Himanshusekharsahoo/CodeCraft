"use client";
import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "@/config/firebase";
import { MessageSquare, CheckCircle, RotateCcw, Trash2, Send, X, CornerDownRight, Plus } from "lucide-react";

/**
 * Basic HTML escaping helper to prevent XSS in user comments.
 */
function sanitizeText(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function CommentsPanel({
  workspaceId,
  fileId,
  currentLine = 1,
  onJumpToLine,
  onClose,
  userRole = "contributor",
}) {
  const [comments, setComments] = useState([]);
  const [newCommentText, setNewCommentText] = useState("");
  const [targetLine, setTargetLine] = useState(currentLine || 1);
  const [replyTextMap, setReplyTextMap] = useState({});
  const [activeReplyId, setActiveReplyId] = useState(null);
  const [filterResolved, setFilterResolved] = useState(false);

  const currentUser = auth.currentUser;

  // Sync target line when editor cursor line changes
  useEffect(() => {
    if (currentLine) {
      setTargetLine(currentLine);
    }
  }, [currentLine]);

  // Subscribe to comments for this file in Firestore
  useEffect(() => {
    if (!workspaceId || !fileId) return;

    const commentsRef = collection(db, `workspaces/${workspaceId}/comments`);
    const q = query(commentsRef, where("fileId", "==", fileId));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        // Sort by line ascending, then createdAt
        list.sort((a, b) => {
          if (a.line !== b.line) return a.line - b.line;
          const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt || 0);
          const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt || 0);
          return timeA - timeB;
        });
        setComments(list);
      },
      (err) => {
        console.warn("Comments listener warning:", err.message);
      }
    );

    return () => unsubscribe();
  }, [workspaceId, fileId]);

  const handleCreateComment = async (e) => {
    e.preventDefault();
    if (!newCommentText.trim() || !currentUser || !workspaceId || !fileId) return;

    try {
      const commentsRef = collection(db, `workspaces/${workspaceId}/comments`);
      await addDoc(commentsRef, {
        workspaceId,
        fileId,
        line: parseInt(targetLine, 10) || 1,
        column: 1,
        content: newCommentText.trim(),
        authorUid: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email?.split("@")[0] || "User",
        authorEmail: currentUser.email || "",
        resolved: false,
        replies: [],
        createdAt: serverTimestamp(),
      });
      setNewCommentText("");
    } catch (err) {
      console.error("Error creating comment:", err.message);
    }
  };

  const handleAddReply = async (commentId) => {
    const replyText = replyTextMap[commentId];
    if (!replyText || !replyText.trim() || !currentUser) return;

    try {
      const comment = comments.find((c) => c.id === commentId);
      if (!comment) return;

      const newReply = {
        replyId: Date.now().toString(),
        authorUid: currentUser.uid,
        authorName: currentUser.displayName || currentUser.email?.split("@")[0] || "User",
        content: replyText.trim(),
        createdAt: new Date().toISOString(),
      };

      const updatedReplies = [...(comment.replies || []), newReply];
      const commentDocRef = doc(db, `workspaces/${workspaceId}/comments/${commentId}`);
      await updateDoc(commentDocRef, {
        replies: updatedReplies,
        updatedAt: serverTimestamp(),
      });

      setReplyTextMap((prev) => ({ ...prev, [commentId]: "" }));
      setActiveReplyId(null);
    } catch (err) {
      console.error("Error adding reply:", err.message);
    }
  };

  const handleToggleResolve = async (comment) => {
    try {
      const commentDocRef = doc(db, `workspaces/${workspaceId}/comments/${comment.id}`);
      await updateDoc(commentDocRef, {
        resolved: !comment.resolved,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Error updating resolve status:", err.message);
    }
  };

  const handleDeleteComment = async (comment) => {
    const isOwnerOrAuthor =
      userRole === "owner" || (currentUser && currentUser.uid === comment.authorUid);

    if (!isOwnerOrAuthor) return;

    try {
      const commentDocRef = doc(db, `workspaces/${workspaceId}/comments/${comment.id}`);
      await deleteDoc(commentDocRef);
    } catch (err) {
      console.error("Error deleting comment:", err.message);
    }
  };

  const filteredComments = useMemo(() => {
    if (filterResolved) return comments;
    return comments.filter((c) => !c.resolved);
  }, [comments, filterResolved]);

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800 text-gray-200 w-80 flex-shrink-0 z-20">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-gray-950/60">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-indigo-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-200">
            Comments ({comments.filter((c) => !c.resolved).length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilterResolved((p) => !p)}
            className={`text-[10px] px-2 py-0.5 rounded transition ${
              filterResolved ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {filterResolved ? "All" : "Active"}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Comment List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {filteredComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center text-gray-500 text-xs">
            <MessageSquare size={24} className="mb-2 opacity-40" />
            <p>No comments on this file.</p>
            <p className="text-[10px] text-gray-600 mt-1">Select a line and leave a note below.</p>
          </div>
        ) : (
          filteredComments.map((c) => {
            const isAuthorOrOwner =
              userRole === "owner" || (currentUser && currentUser.uid === c.authorUid);

            return (
              <div
                key={c.id}
                className={`p-2.5 rounded-lg border text-xs transition ${
                  c.resolved
                    ? "bg-gray-950/40 border-gray-800 opacity-60"
                    : "bg-gray-800/60 border-gray-700/60"
                }`}
              >
                {/* Comment Header */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onJumpToLine && onJumpToLine(c.line)}
                      className="bg-indigo-950/80 text-indigo-300 font-mono text-[10px] px-1.5 py-0.5 rounded border border-indigo-700/40 hover:bg-indigo-800/80"
                      title="Jump to line"
                    >
                      Line {c.line}
                    </button>
                    <span className="font-semibold text-gray-300">{c.authorName}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggleResolve(c)}
                      className={`p-1 rounded transition ${
                        c.resolved
                          ? "text-green-400 hover:bg-green-950/60"
                          : "text-gray-400 hover:text-green-400 hover:bg-gray-700/50"
                      }`}
                      title={c.resolved ? "Reopen comment" : "Resolve comment"}
                    >
                      {c.resolved ? <RotateCcw size={12} /> : <CheckCircle size={12} />}
                    </button>
                    {isAuthorOrOwner && (
                      <button
                        onClick={() => handleDeleteComment(c)}
                        className="p-1 text-gray-400 hover:text-red-400 hover:bg-gray-700/50 rounded transition"
                        title="Delete comment"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Comment Body */}
                <p className="text-gray-200 whitespace-pre-wrap break-words">{c.content}</p>

                {/* Replies */}
                {c.replies && c.replies.length > 0 && (
                  <div className="mt-2 pl-2 border-l border-gray-700 space-y-1.5">
                    {c.replies.map((rep) => (
                      <div key={rep.replyId} className="text-[11px] bg-gray-900/40 p-1.5 rounded">
                        <span className="font-semibold text-gray-300">{rep.authorName}: </span>
                        <span className="text-gray-200 whitespace-pre-wrap">{rep.content}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply Form */}
                <div className="mt-2">
                  {activeReplyId === c.id ? (
                    <div className="flex gap-1.5 mt-1">
                      <input
                        type="text"
                        value={replyTextMap[c.id] || ""}
                        onChange={(e) =>
                          setReplyTextMap({ ...replyTextMap, [c.id]: e.target.value })
                        }
                        onKeyDown={(e) => e.key === "Enter" && handleAddReply(c.id)}
                        placeholder="Write a reply..."
                        className="flex-1 bg-gray-700/60 border border-gray-600/40 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        autoFocus
                      />
                      <button
                        onClick={() => handleAddReply(c.id)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white p-1 rounded"
                      >
                        <Send size={11} />
                      </button>
                      <button
                        onClick={() => setActiveReplyId(null)}
                        className="text-gray-400 hover:text-white p-1"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setActiveReplyId(c.id)}
                      className="text-[10px] text-gray-400 hover:text-indigo-300 flex items-center gap-1 mt-1"
                    >
                      <CornerDownRight size={10} /> Reply
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* New Comment Input Section */}
      <form onSubmit={handleCreateComment} className="p-2.5 border-t border-gray-800 bg-gray-950/40">
        <div className="flex items-center gap-2 mb-1.5">
          <label className="text-[10px] text-gray-400">At Line:</label>
          <input
            type="number"
            min="1"
            value={targetLine}
            onChange={(e) => setTargetLine(Number(e.target.value))}
            className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-white text-center focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="flex gap-1.5">
          <textarea
            rows="2"
            value={newCommentText}
            onChange={(e) => setNewCommentText(e.target.value)}
            placeholder="Add inline note..."
            className="flex-1 bg-gray-800/80 border border-gray-700/60 rounded p-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
          />
          <button
            type="submit"
            disabled={!newCommentText.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-2.5 rounded flex items-center justify-center transition"
          >
            <Send size={13} />
          </button>
        </div>
      </form>
    </div>
  );
}
