# CodeCraft — Phase 4: Production Hardening, Offline Persistence & Realtime UX

## 1. System Architecture Overview

Phase 4 hardens CodeCraft's collaborative engine for production environments, adding browser-level offline persistence, code-splitting heavy client dependencies, eliminating memory leaks, and securing the WebSocket server.

```
   ┌────────────────────────────────────────────────────────────────────────┐
   │                          Browser Client                                │
   │  ┌──────────────────────────────────────────────────────────────────┐  │
   │  │ Monaco Editor ──── MonacoBinding ────── Y.Doc ("monaco")         │  │
   │  │                                      ▲           ▲               │  │
   │  │ Awareness Presence                   │           │               │  │
   │  │ (Cursors & Selections)               │           │               │  │
   │  └──────────────────────────────────────┼───────────┼───────────────┘  │
   │                                         │           │                  │
   │                     IndexeddbPersistence│           │WebsocketProvider │
   │                     (Local Offline DB)  │           │(Binary Stream)   │
   │                                         ▼           ▼                  │
   │                                   [ IndexedDB ] [ WebSocket ]          │
   └─────────────────────────────────────────────────────┼──────────────────┘
                                                         │
                                               WSS / TLS (Port 1234)
                                               Room: workspace:{ws}:file:{file}
                                                         │
   ┌─────────────────────────────────────────────────────▼──────────────────┐
   │             Collaboration Server (collaborationserver/)                │
   │  ┌──────────────────────────────────────────────────────────────────┐  │
   │  │ Origin Gate & Token Authentication (Google Identity Toolkit API) │  │
   │  │ Authorization Subsystem (Workspace membership & role check)      │  │
   │  │ Active Room Registry (In-Memory Y.Doc & Awareness Hub)           │  │
   │  │ Role Enforcement (Viewer mutation rejection)                     │  │
   │  │ Debounced Persistence Scheduler (3.5s quiet period / 10s max)    │  │
   │  │ Memory Eviction (Room destroyed on last client disconnect)       │  │
   │  └──────────────────────────────────┬───────────────────────────────┘  │
   └─────────────────────────────────────┼──────────────────────────────────┘
                                         │
                                   updateDoc()
                                         ▼
                           [ Google Cloud Firestore ]
                      workspaces/{workspaceId}/files/{fileId}
```

---

## 2. Multi-Tier Persistence Model

CodeCraft implements a 3-tier persistence strategy:

| Tier | Technology | Lifetime | Authority |
| :--- | :--- | :--- | :--- |
| **Tier 1: In-Memory / Ephemeral** | Yjs CRDT + Monaco Model | Active session | Working document state |
| **Tier 2: Browser Offline Cache** | `y-indexeddb` (`IndexeddbPersistence`) | Browser storage | Offline backup & instant reload |
| **Tier 3: Durable Cloud Snapshot** | Cloud Firestore (`files/{id}.content`) | Cloud persistence | Authoritative cold recovery |

### Offline Editing Flow:
1. When offline, `WebsocketProvider` transitions to `offline`.
2. Keystrokes apply immediately to Monaco and local `Y.Doc`.
3. `IndexeddbPersistence` automatically flushes delta updates into browser IndexedDB.
4. UI displays: `○ Offline (Local saved)`.
5. If the user refreshes the browser while offline, `IndexeddbPersistence` hydrates `ydoc` from IndexedDB, preserving all local changes.
6. When network reconnects, `WebsocketProvider` re-establishes the connection, exchanges state vectors, and merges local offline edits with the server Y.Doc seamlessly.

---

## 3. WebSocket Handshake, Reconnect & Protocol Compliance

### Binary Message Protocol (`y-protocols`):
* `messageSync (0)`: Full sync step 1, step 2, and incremental CRDT updates.
* `messageAwareness (1)`: User presence (name, stable palette color, cursor line/col, selection range).
* `messageAuth (2)`: Authentication / access messages.
* `messageQueryAwareness (3)`: Query asking server to re-broadcast current room awareness states.

### Reconnect Behavior:
* Reconnections use exponential backoff with jitter to prevent server thundering herds.
* Status transitions cleanly: `connected` $\to$ `reconnecting` $\to$ `syncing` $\to$ `connected`.
* On disconnect, server removes the client's awareness entry immediately, eliminating ghost cursors.

---

## 4. Server Room Lifecycle & Memory Leak Elimination

* **Canonical Room Key**: `workspace:${workspaceId}:file:${fileId}`.
* **Cold Room Hydration**: When the first client connects, the server loads `workspaces/{workspaceId}/files/{fileId}.content` from Firestore and seeds `doc.getText("monaco")`.
* **Zero Memory Leak Guarantee**: When `room.conns.size === 0`:
  1. Any pending debounced persistence timer is cancelled.
  2. Final content is flushed immediately to Firestore.
  3. `room.awareness.destroy()` is executed.
  4. `room.doc.destroy()` is executed.
  5. The room is removed from `rooms.delete(room.name)`.

---

## 5. Security & Tenant Isolation

1. **Workspace Boundary**: Users in Workspace A cannot open rooms in Workspace B. Validated before WebSocket upgrade.
2. **File Boundary**: File must belong to the specified workspace subcollection (`workspaces/{ws}/files/{file}`).
3. **Viewer Role**:
   - **Client**: Monaco configured with `readOnly: true`, Docs/Fix buttons disabled.
   - **Server**: Server checks incoming sync sub-messages; `messageYjsUpdate` and `messageYjsSyncStep2` packets from viewers are logged and discarded.
4. **Deleted Resource Protection**: `flushSave` in `persistence.js` utilizes `updateDoc`, ensuring deleted documents or workspaces are never resurrected by stale clients.

---

## 6. Performance Optimization & Bundle Code-Splitting

### Measured Bundle Sizes (`npm run build`):

| Metric | Phase 3 Baseline | Phase 4 Optimized | Delta |
| :--- | :--- | :--- | :--- |
| **Workspace Page Size** | `902 kB` | `12.8 kB` | **-98.6%** |
| **Workspace First Load JS** | `1.28 MB` | `355 kB` | **-72.3%** |
| **Non-Workspace Routes** | `155 kB – 357 kB` | `155 kB – 357 kB` | Unchanged (No leak) |

### Optimization Techniques:
* `dynamic(() => import("@/components/Chat"), { ssr: false })`: Defers loading `react-syntax-highlighter` until chat drawer is toggled.
* `dynamic(() => import("@/components/Editor"), { ssr: false })`: Defers Monaco Editor and Yjs chunk parsing until the workspace shell renders.
* `dynamic(() => import("@/components/LiveCursor"), { ssr: false })`: Isolates legacy presence canvas.

---

## 7. Production Server Deployment Guide

To deploy `collaborationserver/` to containerized platforms (e.g., Cloud Run, Railway, Render, Fly.io):

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src/ ./src/
ENV NODE_ENV=production
ENV PORT=1234
EXPOSE 1234
CMD ["node", "src/server.js"]
```

### Environment Variables:
* `COLLAB_PORT`: Service listening port (default `1234`).
* `COLLAB_HOST`: Bind host (default `0.0.0.0`).
* `ALLOWED_ORIGINS`: Comma-delimited origins (e.g. `https://codecraft.app,https://www.codecraft.app`).
* `NEXT_PUBLIC_FIREBASE_API_KEY`: Google Identity Toolkit verification key.
* `NEXT_PUBLIC_FIREBASE_PROJECT_ID`: Cloud Firestore project ID.
