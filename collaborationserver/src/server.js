import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { verifyToken } from "./auth.js";
import { authorizeUser } from "./authorization.js";
import { getDb, flushAll, getPendingSavesCount, cancelPendingSavesForWorkspace } from "./persistence.js";
import { getOrCreateRoom, setupWSConnection, rooms, getTotalActiveClients, notifyExternalMutation, destroyWorkspaceRooms } from "./rooms.js";
import { logger } from "./logger.js";

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health" || url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "codecraft-collaboration-server",
        uptimeSeconds: Math.floor(process.uptime()),
        activeRooms: rooms.size,
        activeClients: getTotalActiveClients(),
        pendingSaves: getPendingSavesCount(),
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  const MAX_HTTP_BODY_BYTES = 1024 * 1024; // 1 MB limit

  if (req.method === "POST" && url.pathname === "/flush") {
    if (!verifyInternalAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing internal service token" }));
      return;
    }

    let body = "";
    let tooLarge = false;

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_HTTP_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload Too Large: Maximum request body is 1MB" }));
        req.destroy();
      }
    });

    req.on("end", async () => {
      if (tooLarge) return;
      try {
        if (body.trim().length > 0) {
          try {
            const payload = JSON.parse(body);
            if (payload.workspaceId && (typeof payload.workspaceId !== "string" || !/^[a-zA-Z0-9_\-\.]+$/.test(payload.workspaceId))) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid workspaceId format" }));
              return;
            }
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Malformed JSON payload" }));
            return;
          }
        }
        await flushAll();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", flushed: true }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/notify-mutation") {
    if (!verifyInternalAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing internal service token" }));
      return;
    }

    let body = "";
    let tooLarge = false;

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_HTTP_BODY_BYTES) {
        tooLarge = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload Too Large: Maximum request body is 1MB" }));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (tooLarge) return;
      try {
        let payload;
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Malformed JSON payload" }));
          return;
        }

        const { workspaceId, fileId, content } = payload;
        if (!workspaceId || !fileId || typeof content !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing workspaceId, fileId, or content" }));
          return;
        }

        // Validate workspaceId and fileId (alphanumeric/safe chars, no path traversal)
        if (
          typeof workspaceId !== "string" ||
          !/^[a-zA-Z0-9_\-\.]+$/.test(workspaceId) ||
          typeof fileId !== "string" ||
          fileId.includes("..") ||
          fileId.startsWith("/") ||
          fileId.startsWith("\\")
        ) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid workspaceId or fileId format" }));
          return;
        }

        // CC-018 & CC-023: Expected old content conflict verification
        const { expectedOldContent } = payload;
        const mutationResult = notifyExternalMutation(workspaceId, fileId, content, expectedOldContent);
        if (mutationResult && typeof mutationResult === "object" && mutationResult.conflict) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "Concurrent modification conflict: base content is stale",
            conflict: true,
            currentContent: mutationResult.currentContent,
          }));
          return;
        }

        const roomUpdated = Boolean(mutationResult?.applied || mutationResult === true);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", notified: true, roomUpdated }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // CC-015: Endpoint to evict and destroy rooms when workspace is deleted
  if (req.method === "POST" && url.pathname === "/destroy-workspace-rooms") {
    if (!verifyInternalAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing internal service token" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        let payload = {};
        try {
          payload = JSON.parse(body || "{}");
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Malformed JSON payload" }));
          return;
        }

        const { workspaceId } = payload;
        if (!workspaceId || typeof workspaceId !== "string" || !/^[a-zA-Z0-9_\-\.]+$/.test(workspaceId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid workspaceId" }));
          return;
        }

        const cancelledSaves = cancelPendingSavesForWorkspace(workspaceId);
        const destroyedRooms = destroyWorkspaceRooms(workspaceId);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          workspaceId,
          destroyedRooms,
          cancelledSaves,
        }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

// CC-017: Explicit max payload limit configured on WebSocketServer instance
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: config.limits?.maxPayloadBytes || 2 * 1024 * 1024,
});

server.on("upgrade", async (req, socket, head) => {
  try {
    // CC-017: Total connection capacity check
    const maxConns = config.limits?.maxTotalConnections || 500;
    if (getTotalActiveClients() >= maxConns) {
      logger.warn("SERVER_CAPACITY_REACHED", { totalClients: getTotalActiveClients(), limit: maxConns });
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\nServer connection capacity reached");
      socket.destroy();
      return;
    }

    const origin = req.headers.origin;

    // Origin verification for production deployments
    if (
      process.env.NODE_ENV === "production" &&
      !config.allowedOrigins.includes("*") &&
      origin
    ) {
      const isOriginAllowed = config.allowedOrigins.some(
        (allowed) => allowed === origin || allowed === new URL(origin).origin
      );

      if (!isOriginAllowed) {
        logger.warn("ORIGIN_REJECTED", { origin });
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\nOrigin not allowed");
        socket.destroy();
        return;
      }
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname.replace(/^\/+/, ""); // e.g. "workspace:ws123:file:file456"

    // Extract query parameters
    const token =
      url.searchParams.get("token") ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : "");

    let workspaceId = url.searchParams.get("workspaceId");
    let fileId = url.searchParams.get("fileId");

    // If not supplied in params, parse from pathname if formatted as workspace:<id>:file:<id>
    if (!workspaceId || !fileId) {
      const roomMatch = pathname.match(/^workspace:([^:]+):file:(.+)$/);
      if (roomMatch) {
        workspaceId = workspaceId || roomMatch[1];
        fileId = fileId || roomMatch[2];
      }
    }

    if (!pathname || !workspaceId || !fileId) {
      logger.warn("UPGRADE_BAD_REQUEST", { pathname, workspaceId, fileId });
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\nMissing room, workspaceId, or fileId");
      socket.destroy();
      return;
    }

    // 1. Authenticate Token
    let user;
    try {
      user = await verifyToken(token);
    } catch (authError) {
      logger.warn("AUTH_FAILED", { reason: authError.message });
      socket.write(`HTTP/1.1 401 Unauthorized\r\n\r\n${authError.message}`);
      socket.destroy();
      return;
    }

    // 2. Authorize Workspace / File Access
    const db = getDb();
    const authz = await authorizeUser(db, {
      uid: user.uid,
      workspaceId,
      fileId,
      tokenHint: token,
      token,
    });

    if (!authz.authorized) {
      logger.warn("AUTHZ_DENIED", { uid: user.uid, workspaceId, fileId, reason: authz.reason });
      socket.write(`HTTP/1.1 403 Forbidden\r\n\r\n${authz.reason || "Access denied"}`);
      socket.destroy();
      return;
    }

    // 3. Upgrade Connection
    wss.handleUpgrade(req, socket, head, async (conn) => {
      try {
        const room = await getOrCreateRoom(pathname, workspaceId, fileId, token);
        setupWSConnection(conn, room, {
          uid: user.uid,
          role: authz.role,
          displayName: user.displayName,
          token,
        });
      } catch (connError) {
        logger.error("UPGRADE_SETUP_ERROR", { error: connError.message });
        conn.close(1011, "Internal Server Error");
      }
    });
  } catch (error) {
    logger.error("UPGRADE_EXCEPTION", { error: error.message });
    socket.write(`HTTP/1.1 500 Internal Server Error\r\n\r\n${error.message}`);
    socket.destroy();
  }
});

// Graceful shutdown handling
const shutdown = async () => {
  logger.info("SERVER_SHUTTING_DOWN");
  try {
    await flushAll();
    wss.close();
    server.close(() => {
      logger.info("SERVER_STOPPED_CLEANLY");
      process.exit(0);
    });
  } catch (err) {
    logger.error("SHUTDOWN_ERROR", { error: err.message });
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Only start listening if this file is executed directly (not when imported as a library by test-collaboration.js)
const isMainModule = process.argv[1] && (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) || process.argv[1].endsWith("server.js"));
if (isMainModule) {
  server.listen(config.port, config.host, () => {
    logger.info("SERVER_LISTENING", { host: config.host, port: config.port });
  });
}

// Helper verifying internal service authorization for HTTP bridge endpoints (CC-003)
export function verifyInternalAuth(req) {
  const token =
    req.headers?.["x-collab-internal-token"] ||
    (req.headers?.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null);

  if (!token || !config.internalSecret) {
    return false;
  }
  return token === config.internalSecret;
}

export { server, wss };
