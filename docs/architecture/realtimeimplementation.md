# CodeCraft Realtime Collaboration Engine — Phase 3 Implementation Report

## 1. Architectural Overview

Phase 3 transitions CodeCraft from a Firestore last-write-wins (LWW) polling mechanism to a production-grade, CRDT-powered realtime collaborative editing engine based on **Yjs**, **y-monaco**, and a dedicated Node.js WebSocket service (**collaborationserver/**).

```
   ┌─────────────────────────────────────────────────────────────┐
   │                     Next.js 15 Client                       │
   │  ┌───────────────────────────────────────────────────────┐  │
   │  │ Monaco Editor ──── MonacoBinding ──── Y.Doc (monaco)  │  │
   │  │                                     │                 │  │
   │  │ Awareness (Cursor/Selection)        │                 │  │
   │  └────────────────────────┬────────────┴─────────────────┘  │
   │                           │ WebsocketProvider               │
   └───────────────────────────┼─────────────────────────────────┘
                               │
                      Binary WebSocket (ws:// / wss://)
                      Room: workspace:{wsId}:file:{fileId}
                               │
   ┌───────────────────────────┴─────────────────────────────────┐
   │              collaborationserver/ (Node.js Service)          │
   │  ┌───────────────────────────────────────────────────────┐  │
   │  │ Auth & Authz Gate: Token Verification + Role Check   │  │
   │  │ Room Manager: In-Memory Y.Doc & Awareness Hub        │  │
   │  │ Sync Protocol: Broadcasts CRDT Delts & Steps          │  │
   │  │ Debounced Persistence: 3.5s quiet period flush        │  │
   │  └────────────────────────┬──────────────────────────────┘  │
   └───────────────────────────┼─────────────────────────────────┘
                               │
                        Firestore Snapshot
            `workspaces/{wsId}/files/{fileId}.content`
```

---

## 2. Protocol Specification

Communication utilizes the binary `y-protocols` format over WebSockets:

| Message Type | ID | Purpose | Description |
| :--- | :--- | :--- | :--- |
| `messageSync` | `0` | CRDT Document Sync | Encapsulates `SyncStep1`, `SyncStep2`, and `Update` payloads |
| `messageAwareness` | `1` | Ephemeral Presence | Distributes active client selections, cursor line/col, and user meta |
| `messageAuth` | `2` | Authentication Exchange | Handshake credential and denial notification |
| `messageQueryAwareness` | `3` | Presence Query | Requests immediate full awareness table broadcast |

### Connection Handshake
1. Client initiates HTTP Upgrade request to `ws://{host}:{port}/workspace:{workspaceId}:file:{fileId}?token={token}&workspaceId={workspaceId}&fileId={fileId}`.
2. Server validates Firebase ID token via Google Identity Toolkit REST API (`/accounts:lookup`).
3. Server looks up user membership and role in `workspaces/{workspaceId}/members/{uid}` and validates file existence.
4. Server completes WebSocket handshake.
5. Server sends `messageSync (0) -> syncStep1` followed by current room awareness state.
6. Client responds with missing state vectors, completing full two-way synchronization.

---

## 3. Server Architecture (`collaborationserver/`)

The collaboration service is structured cleanly into dedicated modules:

- **`config.js`**: Environment management (reads `.env.local` or environment variables for port, allowed origins, and Firebase project configuration).
- **`auth.js`**: Secure token verification via Google Identity Toolkit; supports deterministic test-suite tokens in automated testing.
- **`authorization.js`**: Workspace membership evaluation (`owner`, `contributor`, `viewer`) and target file validation.
- **`persistence.js`**: Cold snapshot retrieval on room creation, debounced persistence (3.5s quiet period with 10s maximum quiet bound), and clean teardown flushes.
- **`rooms.js`**: In-memory room lifecycle registry. Manages `Y.Doc`, `Awareness`, role-based sync message filtering, and awareness state cleanup on client disconnect.
- **`server.js`**: HTTP and WebSocket server, CORS preflight handling, health endpoint (`GET /health`), upgrade router, and graceful shutdown handlers (`SIGINT`/`SIGTERM`).

---

## 4. Role Enforcement & Security

- **Viewer Role (`viewer`)**:
  - **Client-Side**: Monaco Editor configured with `readOnly: true`, AI generation and syntax fix buttons disabled.
  - **Server-Side**: Server inspects incoming sync sub-messages (`messageYjsUpdate` and `messageYjsSyncStep2`). Any update from a connection flagged with `role: "viewer"` is rejected and logged without mutating the Y.Doc or broadcasting to peers.
  - **Awareness**: Viewers retain cursor awareness broadcast so collaborators see their viewing focus without granting write permissions.
- **Contributor Role (`contributor`)**: Full collaborative editing and cursor/selection presence.
- **Owner Role (`owner`)**: Full editing, cursor presence, and workspace administration.

---

## 5. Persistence & Failure Recovery

| Scenario | Behavior |
| :--- | :--- |
| **Keystroke Burst** | Debounced server-side; reset 3.5s quiet timer; writes clean consolidated snapshot once editing pauses. |
| **Last User Leaves Room** | Pending debounced save timer is immediately cancelled and snapshot is synchronously flushed to Firestore. |
| **Server Restart / Crash** | Clients automatically reconnect with exponential backoff; server loads latest snapshot from Firestore and re-synchronizes with client state vectors. |
| **Client Disconnect / Tab Close** | `Awareness.removeAwarenessStates` triggers, instantly removing remote cursor and selection tags from peer editors. |
| **Network Partition** | Local edits accumulate in Yjs CRDT structure offline; on reconnect, bidirectional `SyncStep1`/`SyncStep2` seamlessly merges diverged edits without loss. |

---

## 6. Fixes Delivered for Phase 2 Identified Issues

1. **Global Chat Query Leakage (P1)**:
   - Previously: `Chat.jsx` listened to `collection(db, "messages")` globally and filtered in memory.
   - Now: Scoped with `where("workspaceId", "==", workspaceId)`, eliminating cross-tenant data leakage and enabling strict Firestore security rules compliance.
2. **Cascading Workspace Deletion (P2)**:
   - Previously: `deleteDoc(doc(db, "workspaces", workspaceId))` left subcollections (`files`, `folders`, `members`) orphaned.
   - Now: Iteratively purges `files`, `folders`, `members`, and workspace `messages` before deleting the parent workspace document.
3. **Firestore Security Rules**:
   - Deployed comprehensive `firestore.rules` enforcing role-based access control across all collections.
