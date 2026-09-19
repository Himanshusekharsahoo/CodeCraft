# CodeCraft — Phase 5: Multi-File Workspace, Collaboration UX & AI Context Foundation

## 1. Executive Summary

Phase 5 elevates CodeCraft from single-file collaborative editing to a multi-file development workspace. It introduces an independent multi-tab session architecture with isolated Yjs CRDT documents per open file, bidirectional synchronization between the file tree and tab registry, real-time collaborator cursor labels with floating presence tags, inline code commenting anchored to line numbers with Firestore persistence and strict security rules, a sanitized AI context foundation for LLM operations, and Playwright-verified end-to-end browser automation.

---

## 2. Multi-File Session & Tab Architecture

CodeCraft manages multi-file state through an isolated, client-side session registry (`FileSession`) keyed by `fileId`:

```
   ┌─────────────────────────────────────────────────────────────────────────────┐
   │                           Workspace Page State                              │
   │  openFiles: [ FileA, FileB, FileC ]            activeFileId: "fileB"        │
   └──────────────────────────────────────┬──────────────────────────────────────┘
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   ▼                                             ▼
   ┌────────────────────────────────┐            ┌────────────────────────────────┐
   │  NavPanel (File Explorer)      │            │  Editor (Multi-Tab Container)  │
   │  - Open file -> Append tab     │            │  - Render Tabs Bar             │
   │  - Active tab visual highlight │            │  - Switch active tab           │
   │  - Auto-rename synchronization │            │  - Close tab -> Evict session  │
   │  - Delete file -> Close tab    │            │  - Inline comments toggle      │
   └────────────────────────────────┘            └────────────────┬───────────────┘
                                                                  │
                   ┌──────────────────────────────────────────────┴──────────────┐
                   │                 FileSession Registry (Map)                  │
                   │                                                             │
                   │  ┌───────────────────────────────────────────────────────┐  │
                   │  │ FileSession: FileA (Inactive in background)           │  │
                   │  │  - Y.Doc (Room: workspace:ws1:file:fileA)             │  │
                   │  │  - WebsocketProvider (Connected & syncing)            │  │
                   │  │  - IndexeddbPersistence (Offline local cache)         │  │
                   │  │  - Monaco Model (inmemory://.../fileA)                │  │
                   │  │  - Saved ViewState (cursor & scroll position)         │  │
                   │  └───────────────────────────────────────────────────────┘  │
                   │                                                             │
                   │  ┌───────────────────────────────────────────────────────┐  │
                   │  │ FileSession: FileB (ACTIVE in Monaco Editor)          │  │
                   │  │  - Y.Doc (Room: workspace:ws1:file:fileB)             │  │
                   │  │  - WebsocketProvider (Connected & syncing)            │  │
                   │  │  - Monaco Model (Attached to active editor)           │  │
                   │  │  - MonacoBinding (ytext <-> model <-> awareness)      │  │
                   │  │  - Active Collaborators Presence Stack                │  │
                   │  └───────────────────────────────────────────────────────┘  │
                   └─────────────────────────────────────────────────────────────┘
```

---

## 3. Core Architectural Guarantees

### 3.1 Strict Room & Session Isolation
- Each open file maintains its own `Y.Doc`, `WebsocketProvider`, `IndexeddbPersistence`, and Monaco `ITextModel`.
- Network updates for File A are delivered strictly to Room `workspace:{wsId}:file:fileA` and never touch File B.
- Monaco bindings check `editor.getModel() === monacoModel` before processing editor events, guaranteeing zero cursor/selection bleeding across tabs.

### 3.2 ViewState Preservation Across Tab Switches
- When switching away from Tab A to Tab B:
  1. Tab A saves its view state: `sessionA.viewState = editor.saveViewState()`.
  2. The editor swaps the active model: `editor.setModel(sessionB.model)`.
  3. If Tab B has saved view state: `editor.restoreViewState(sessionB.viewState)`.
  4. Cursor positions, scroll positions, and folding states are fully preserved.

### 3.3 Clean Session Eviction & Zero Memory Leaks
- Closing a tab invokes `teardownSession(fileId)`:
  1. `session.binding.destroy()`
  2. `session.provider.destroy()`
  3. `session.idbProvider.destroy()`
  4. `session.model.dispose()`
  5. `session.ydoc.destroy()`
  6. `session.unsubFile()`
- Evicts the room from the server when all peers disconnect (verified in test suite 15).

---

## 4. Realtime Collaborator Presence UX

### 4.1 Header & Active File Presence Indicators
- Per-file awareness tracks connected collaborators with deterministic color hashing (`COLOR_PALETTE`).
- The editor toolbar displays active collaborator avatars with their assigned identity colors.

### 4.2 Floating Remote Cursor Labels
- Dynamic stylesheet (`#codecraft-cursor-styles`) injects scoped CSS rules:
```css
.yRemoteSelectionHead-CLIENTID::before {
  content: "Alice";
  position: absolute;
  top: -1.35em;
  background-color: #3b82f6;
  color: white;
  font-size: 10px;
  font-family: monospace;
  padding: 1px 5px;
  border-radius: 3px;
  z-index: 20;
}
```
- Renders collaborator names directly above their active cursor line in Monaco with zero ghosting.

---

## 5. Inline Code Comments System

### 5.1 Data Model
Comments are stored in Firestore under `workspaces/{workspaceId}/comments/{commentId}`:
- `workspaceId`: Workspace document reference
- `fileId`: Target file ID
- `line`: Line number anchor (1-indexed)
- `content`: Comment message body (sanitized against XSS)
- `authorUid`, `authorName`, `authorEmail`: Author identity
- `resolved`: Boolean flag
- `replies`: Array of reply objects (`{ id, authorUid, authorName, content, createdAt }`)
- `createdAt`: Server timestamp

### 5.2 Security Rules (`firestore.rules`)
- **Read**: Authenticated workspace members (viewer, contributor, owner) or public workspaces.
- **Create**: Authenticated workspace contributors or owners matching author ID.
- **Update**: Comment author, workspace contributor, or owner (supports resolve/reopen and threaded replies).
- **Delete**: Comment author, workspace contributor, or owner.

---

## 6. AI Context Foundation (`src/lib/aiContext.js`)

Constructs structured, safe payloads for Gemini AI operations without leaking sensitive tokens or environment secrets:
- Enforces character truncation bounds (12,000 chars max).
- Automatically sanitizes Bearer tokens and API key patterns before transmission.
- Captures active cursor position, selection range, active file metadata, and currently open tabs for contextual prompt generation.

---

## 7. Verification & Test Coverage

| Test Suite | Target | Status |
| :--- | :--- | :--- |
| **Suites 1–15** | Auth, Authorization, Health, CRUD, CRDT Concurrency, Offline Resync, Memory Eviction | 100% PASS |
| **Suite 16** | Multi-File Room Concurrency & Strict CRDT Data Isolation | 100% PASS |
| **Suite 17** | Multi-Client Awareness Isolation across Independent Rooms | 100% PASS |
| **Playwright E2E** | Multi-Client Browser Context Isolation, DOM/IndexedDB/WebSocket validation, Tab Switching | 100% PASS |
| **Next.js Production Build** | Zero syntax/type errors, Page Optimization, Bundle JS 355 kB preserved | 100% PASS (Exit code 0) |
