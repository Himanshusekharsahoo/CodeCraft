import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { loadSnapshot, scheduleSave, flushSave } from "./persistence.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

export const messageSync = 0;
export const messageAwareness = 1;
export const messageAuth = 2;
export const messageQueryAwareness = 3;

/**
 * Sends a binary message through a WebSocket connection safely.
 *
 * @param {import("ws").WebSocket} conn
 * @param {Uint8Array} message
 */
export function send(conn, message) {
  if (conn.readyState === 1 /* OPEN */) {
    conn.send(message, (err) => {
      if (err) {
        logger.warn("WS_SEND_ERROR", { error: err.message });
      }
    });
  }
}

export class Room {
  /**
   * @param {string} name - e.g. "workspace:ws123:file:file456"
   * @param {string} workspaceId
   * @param {string} fileId
   */
  constructor(name, workspaceId, fileId) {
    this.name = name;
    this.workspaceId = workspaceId;
    this.fileId = fileId;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    /** @type {Map<import("ws").WebSocket, { uid: string, role: string, displayName: string, controlledUserIds: Set<number> }>} */
    this.conns = new Map();
    this.isInitialized = false;
    this.lastAuthorizedToken = null;

    // Document update listener: broadcasts updates to peers and triggers debounced persistence
    this.doc.on("update", (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      // Broadcast to all clients except origin
      for (const [client] of this.conns) {
        if (client !== origin) {
          send(client, message);
        }
      }

      // Schedule persistence of Monaco content snapshot (skip external mutations already written to Firestore)
      if (origin !== "external-mutation") {
        const currentContent = this.doc.getText("monaco").toString();
        scheduleSave(this.workspaceId, this.fileId, currentContent, this.lastAuthorizedToken);
      }
    });

    // Awareness update listener: broadcasts presence/cursor updates to peers
    this.awareness.on("update", ({ added, updated, removed }, origin) => {
      const changedClients = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      const buff = encoding.toUint8Array(encoder);

      for (const [client] of this.conns) {
        if (client !== origin) {
          send(client, buff);
        }
      }
    });

    logger.info("ROOM_INITIALIZED", { room: this.name, workspaceId, fileId });
  }

  /**
   * Initializes room state from cold Firestore snapshot if not already done.
   *
   * @param {string} [token] - Authenticated caller Firebase ID token
   */
  async initDoc(token = null) {
    if (this.isInitialized) return;
    const initialContent = await loadSnapshot(this.workspaceId, this.fileId, token);
    const ytext = this.doc.getText("monaco");
    if (initialContent && ytext.length === 0) {
      ytext.insert(0, initialContent);
    }
    this.isInitialized = true;
  }

  /**
   * Applies an external file mutation (from Git restore or AI patch) to the active Yjs document
   * and broadcasts the update to all connected Monaco editors without triggering reverse save loops.
   * CC-018: Verifies expectedOldContent to prevent destroying concurrent human edits.
   *
   * @param {string} newContent
   * @param {string | null} [expectedOldContent=null]
   * @returns {{ applied: boolean, conflict: boolean, currentContent?: string } | boolean}
   */
  applyExternalMutation(newContent, expectedOldContent = null) {
    if (typeof newContent !== "string") {
      return expectedOldContent !== null && expectedOldContent !== undefined
        ? { applied: false, conflict: false }
        : false;
    }
    const ytext = this.doc.getText("monaco");
    const current = ytext.toString();

    // CC-018 / CC-023: Concurrency protection against overwriting newer human edits
    const hasExpectedCheck = expectedOldContent !== undefined && expectedOldContent !== null;
    if (hasExpectedCheck) {
      if (current !== expectedOldContent) {
        logger.warn("EXTERNAL_MUTATION_CONFLICT", {
          room: this.name,
          workspaceId: this.workspaceId,
          fileId: this.fileId,
        });
        return { applied: false, conflict: true, currentContent: current };
      }
    }

    if (current === newContent) {
      return hasExpectedCheck ? { applied: true, conflict: false } : false;
    }

    this.doc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, newContent);
    }, "external-mutation");

    return hasExpectedCheck ? { applied: true, conflict: false } : true;
  }

  /**
   * Cleans up all resources associated with this room.
   */
  destroy() {
    try {
      this.awareness.destroy();
      this.doc.destroy();
      this.conns.clear();
      logger.info("ROOM_DESTROYED", { room: this.name });
    } catch (e) {
      logger.warn("ROOM_DESTROY_ERROR", { room: this.name, error: e.message });
    }
  }
}

/**
 * Applies external mutation to an active room if currently open in memory.
 *
 * @param {string} workspaceId
 * @param {string} fileId
 * @param {string} newContent
 * @param {string | null} [expectedOldContent=null]
 * @returns {{ applied: boolean, conflict: boolean, currentContent?: string, roomActive?: boolean } | boolean}
 */
export function notifyExternalMutation(workspaceId, fileId, newContent, expectedOldContent = null) {
  const roomKey = `workspace:${workspaceId}:file:${fileId}`;
  const room = rooms.get(roomKey);
  const hasExpectedCheck = expectedOldContent !== undefined && expectedOldContent !== null;
  if (room) {
    return room.applyExternalMutation(newContent, expectedOldContent);
  }
  return hasExpectedCheck ? { applied: false, conflict: false, roomActive: false } : false;
}

/**
 * Global registry of active rooms.
 * @type {Map<string, Room>}
 */
export const rooms = new Map();

/**
 * Returns total count of active clients across all rooms.
 */
export function getTotalActiveClients() {
  let count = 0;
  for (const room of rooms.values()) {
    count += room.conns.size;
  }
  return count;
}

/**
 * Retrieves an existing room or creates and initializes a new one.
 *
 * @param {string} roomName
 * @param {string} workspaceId
 * @param {string} fileId
 * @returns {Promise<Room>}
 */
export async function getOrCreateRoom(roomName, workspaceId, fileId, token = null) {
  let room = rooms.get(roomName);
  if (!room) {
    room = new Room(roomName, workspaceId, fileId);
    rooms.set(roomName, room);
    await room.initDoc(token);
  }
  return room;
}

/**
 * Configures WebSocket connection lifecycle, sync protocol, and role enforcement.
 *
 * @param {import("ws").WebSocket} conn
 * @param {Room} room
 * @param {{ uid: string, role: string, displayName: string, token?: string }} userMeta
 */
export function setupWSConnection(conn, room, userMeta) {
  conn.binaryType = "arraybuffer";

  const connInfo = {
    uid: userMeta.uid,
    role: userMeta.role,
    displayName: userMeta.displayName,
    token: userMeta.token || null,
    controlledUserIds: new Set(),
  };

  // CC-017: Room participant limit
  const maxRoomClients = config.limits?.maxClientsPerRoom || 50;
  if (room.conns.size >= maxRoomClients) {
    logger.warn("ROOM_LIMIT_REACHED", { room: room.name, limit: maxRoomClients });
    conn.close(1013, "Room connection limit reached");
    return;
  }

  if (userMeta.role === "owner" || userMeta.role === "contributor") {
    room.lastAuthorizedToken = userMeta.token || room.lastAuthorizedToken;
  }

  room.conns.set(conn, connInfo);
  logger.info("CLIENT_CONNECTED", {
    room: room.name,
    uid: userMeta.uid,
    role: userMeta.role,
    clientsInRoom: room.conns.size,
  });

  // CC-017: Heartbeat / ping mechanism to detect and clean up dropped/stale sockets
  conn.isAlive = true;
  conn.on("pong", () => {
    conn.isAlive = true;
  });

  const heartbeatInterval = setInterval(() => {
    if (conn.isAlive === false) {
      logger.info("TERMINATING_STALE_SOCKET", { room: room.name, uid: userMeta.uid });
      clearInterval(heartbeatInterval);
      return conn.terminate();
    }
    conn.isAlive = false;
    try {
      conn.ping();
    } catch {
      clearInterval(heartbeatInterval);
    }
  }, config.limits?.heartbeatIntervalMs || 30000);

  // 1. Initial Sync Step 1 from Server to Client
  const encoderSync = encoding.createEncoder();
  encoding.writeVarUint(encoderSync, messageSync);
  syncProtocol.writeSyncStep1(encoderSync, room.doc);
  send(conn, encoding.toUint8Array(encoderSync));

  // 2. Initial Awareness Exchange
  const awarenessStates = room.awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoderAwareness = encoding.createEncoder();
    encoding.writeVarUint(encoderAwareness, messageAwareness);
    encoding.writeVarUint8Array(
      encoderAwareness,
      awarenessProtocol.encodeAwarenessUpdate(
        room.awareness,
        Array.from(awarenessStates.keys())
      )
    );
    send(conn, encoding.toUint8Array(encoderAwareness));
  }

  // CC-017: Burst rate limit tracking
  let msgCounter = 0;
  let lastRateReset = Date.now();

  // 3. Message handling
  conn.on("message", (data) => {
    try {
      if (!data) return;
      const buf = new Uint8Array(data);

      // CC-017: Maximum payload size verification
      const maxPayload = config.limits?.maxPayloadBytes || 2 * 1024 * 1024;
      if (buf.byteLength > maxPayload) {
        logger.warn("OVERSIZED_WS_PAYLOAD_REJECTED", { room: room.name, bytes: buf.byteLength, limit: maxPayload });
        conn.close(1009, "Message payload exceeded maximum allowed size");
        return;
      }

      // CC-017: Burst rate limit per connection
      const now = Date.now();
      if (now - lastRateReset > 1000) {
        msgCounter = 0;
        lastRateReset = now;
      }
      msgCounter++;
      if (msgCounter > (config.limits?.maxMessagesPerSecond || 100)) {
        logger.warn("ABUSIVE_BURST_RATE_EXCEEDED", { room: room.name, uid: connInfo.uid });
        return;
      }

      if (buf.byteLength === 0) return; // Defense against malformed empty frames

      const decoder = decoding.createDecoder(buf);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync: {
          const syncMessageType = decoding.peekVarUint(decoder);

          // Role enforcement: reject document modifications from viewer role
          if (connInfo.role === "viewer") {
            if (
              syncMessageType === syncProtocol.messageYjsUpdate ||
              syncMessageType === syncProtocol.messageYjsSyncStep2
            ) {
              logger.warn("VIEWER_WRITE_ATTEMPT_REJECTED", {
                room: room.name,
                uid: connInfo.uid,
              });
              return;
            }
          }

          // If this client is contributor/owner and has a token, update lastAuthorizedToken for persistence
          if (connInfo.role !== "viewer" && connInfo.token) {
            room.lastAuthorizedToken = connInfo.token;
          }

          const replyEncoder = encoding.createEncoder();
          encoding.writeVarUint(replyEncoder, messageSync);
          syncProtocol.readSyncMessage(decoder, replyEncoder, room.doc, conn);

          if (encoding.length(replyEncoder) > 1) {
            send(conn, encoding.toUint8Array(replyEncoder));
          }
          break;
        }

        case messageAwareness: {
          const update = decoding.readVarUint8Array(decoder);
          // Parse clientIDs to keep track of controlled awareness states for cleanup
          try {
            const tempDecoder = decoding.createDecoder(update);
            const len = decoding.readVarUint(tempDecoder);
            for (let i = 0; i < len; i++) {
              const clientID = decoding.readVarUint(tempDecoder);
              decoding.readVarUint(tempDecoder); // clock
              decoding.readVarString(tempDecoder); // state
              connInfo.controlledUserIds.add(clientID);
            }
          } catch (e) {
            // Ignore parse errors in awareness preview
          }

          awarenessProtocol.applyAwarenessUpdate(room.awareness, update, conn);
          break;
        }

        case messageQueryAwareness: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageAwareness);
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(
              room.awareness,
              Array.from(room.awareness.getStates().keys())
            )
          );
          send(conn, encoding.toUint8Array(encoder));
          break;
        }

        default:
          logger.warn("UNRECOGNIZED_MESSAGE_TYPE", { messageType, room: room.name });
          break;
      }
    } catch (err) {
      logger.error("MESSAGE_PROCESSING_ERROR", { room: room.name, error: err.message });
    }
  });

  // 4. Connection teardown & room lifecycle cleanup
  conn.on("close", async () => {
    clearInterval(heartbeatInterval);
    room.conns.delete(conn);
    logger.info("CLIENT_DISCONNECTED", {
      room: room.name,
      uid: connInfo.uid,
      remainingInRoom: room.conns.size,
    });

    // Clean up awareness states for disconnected client
    if (connInfo.controlledUserIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        room.awareness,
        Array.from(connInfo.controlledUserIds),
        null
      );
    }

    // When last user disconnects, flush pending changes to Firestore immediately and release room
    if (room.conns.size === 0) {
      const finalContent = room.doc.getText("monaco").toString();
      await flushSave(room.workspaceId, room.fileId, finalContent);

      // Clean up room from global memory registry to prevent memory leak
      rooms.delete(room.name);
      room.destroy();
    }
  });
}

/**
 * Destroys all active rooms for a deleted workspace to prevent data resurrection (CC-015).
 *
 * @param {string} workspaceId
 * @returns {number} Destroyed rooms count
 */
export function destroyWorkspaceRooms(workspaceId) {
  let destroyed = 0;
  for (const [roomName, room] of rooms.entries()) {
    if (room.workspaceId === workspaceId) {
      rooms.delete(roomName);
      room.destroy();
      destroyed++;
    }
  }
  return destroyed;
}
