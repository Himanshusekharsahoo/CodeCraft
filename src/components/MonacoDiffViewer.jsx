"use client";

import React from "react";
import { DiffEditor } from "@monaco-editor/react";
import { X, FileCode } from "lucide-react";

const EXT_TO_LANG = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  java: "java",
  cpp: "cpp",
  c: "cpp",
  html: "html",
  css: "css",
  json: "json",
  md: "markdown",
  sh: "shell",
  sql: "sql",
};

export default function MonacoDiffViewer({
  isOpen,
  onClose,
  filePath,
  original = "",
  modified = "",
  title = "Diff Viewer",
}) {
  if (!isOpen) return null;

  const ext = (filePath || "").split(".").pop()?.toLowerCase();
  const language = EXT_TO_LANG[ext] || "javascript";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      data-testid="monaco-diff-modal"
    >
      <div className="flex flex-col w-[92vw] h-[88vh] bg-gray-950 border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-gray-900 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <FileCode className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
                <span>{title}</span>
                {filePath && (
                  <span className="text-xs text-gray-400 font-mono bg-gray-800 px-2 py-0.5 rounded">
                    {filePath}
                  </span>
                )}
              </h3>
              <p className="text-xs text-gray-400">Left: Original (HEAD) &bull; Right: Working Copy</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            title="Close Diff Viewer"
            data-testid="close-diff-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Diff Editor Container */}
        <div className="flex-1 w-full h-full min-h-0 bg-[#1e1e1e]">
          <DiffEditor
            original={original}
            modified={modified}
            language={language}
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: true,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              fontSize: 13,
            }}
          />
        </div>
      </div>
    </div>
  );
}
