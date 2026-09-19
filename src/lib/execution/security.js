import { getRuntimeConfig } from "./runtimeRegistry.js";
import path from "node:path";
import { ExecutionError, ExecutionErrorCodes } from "./errors.js";
import { EXECUTION_LIMITS } from "./limits.js";

/**
 * Validates an untrusted relative file path inside a temporary execution sandbox.
 * Defends against path traversal (../), absolute paths, root escape, and sensitive filenames.
 *
 * @param {string} rawPath - Untrusted relative path from request
 * @param {string} sandboxDir - The root temporary execution directory
 * @returns {{ relativePath: string, fullPath: string }}
 */
export function validateExecutionFilePath(rawPath, sandboxDir = process.cwd()) {
  if (!rawPath || typeof rawPath !== "string") {
    throw new ExecutionError(
      ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED,
      "File path must be a non-empty string",
      400
    );
  }

  // Reject drive letters on Windows (e.g. C:, D:), null bytes, shell chars, or leading slashes
  if (
    rawPath.includes("\0") ||
    /[\r\n\0`$;|&><]/.test(rawPath) ||
    path.isAbsolute(rawPath) ||
    /^[a-zA-Z]:/.test(rawPath) ||
    rawPath.startsWith("/") ||
    rawPath.startsWith("\\")
  ) {
    throw new ExecutionError(
      ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED,
      "Absolute paths, drive prefixes, null bytes, and shell characters are strictly prohibited",
      400
    );
  }

  const normalized = path.normalize(rawPath).replace(/\\/g, "/");

  // Check for traversal sequences
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..")
  ) {
    throw new ExecutionError(
      ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED,
      "Path traversal sequence detected in file path",
      400
    );
  }

  // Protect sensitive filenames and system locations
  const segments = normalized.split("/");
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (
      lower === ".git" ||
      lower === ".env" ||
      lower === "node_modules" ||
      lower === "docker.sock" ||
      lower === "passwd" ||
      lower === "shadow"
    ) {
      throw new ExecutionError(
        ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED,
        `Access to sensitive path '${seg}' is prohibited`,
        403
      );
    }
  }

  const fullPath = path.resolve(sandboxDir, normalized);

  // Strict boundary check
  if (!fullPath.startsWith(sandboxDir + path.sep) && fullPath !== sandboxDir) {
    throw new ExecutionError(
      ExecutionErrorCodes.PATH_TRAVERSAL_DETECTED,
      "Resolved file path escapes the temporary execution sandbox boundary",
      403
    );
  }

  return normalized;
}

/**
 * Validates request payload sizes, file counts, and stdin bounds.
 *
 * @param {object} payload
 */
export function validateExecutionPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new ExecutionError(
      ExecutionErrorCodes.INVALID_REQUEST,
      "Invalid execution request body",
      400
    );
  }

  // Reject client-controlled execution provider override (CC-006)
  if (payload.provider !== undefined && payload.provider !== null && payload.provider !== "sandbox") {
    throw new ExecutionError(
      ExecutionErrorCodes.INVALID_REQUEST,
      `Execution provider '${payload.provider}' is not permitted. Docker sandbox is the only valid execution provider.`,
      400
    );
  }

  // Reject client-controlled execution image (CC-006)
  if (payload.image !== undefined && payload.image !== null) {
    throw new ExecutionError(
      ExecutionErrorCodes.INVALID_REQUEST,
      "Client-specified Docker images are strictly prohibited",
      400
    );
  }

  // Reject client-controlled execution command or executor (CC-006)
  if (payload.command !== undefined || payload.cmd !== undefined || payload.executor !== undefined) {
    throw new ExecutionError(
      ExecutionErrorCodes.INVALID_REQUEST,
      "Client-specified execution commands or executors are strictly prohibited",
      400
    );
  }

  // Validate language
  if (!payload.language || typeof payload.language !== "string") {
    throw new ExecutionError(
      ExecutionErrorCodes.INVALID_REQUEST,
      "Execution request must specify a valid language",
      400
    );
  }
  getRuntimeConfig(payload.language);

  // Validate single source code
  if (typeof payload.source === "string") {
    const sourceBytes = Buffer.byteLength(payload.source, "utf8");
    if (sourceBytes > EXECUTION_LIMITS.MAX_SOURCE_BYTES) {
      throw new ExecutionError(
        ExecutionErrorCodes.SOURCE_LIMIT_EXCEEDED,
        `Source code size (${sourceBytes} bytes) exceeds limit of ${EXECUTION_LIMITS.MAX_SOURCE_BYTES} bytes`,
        400
      );
    }
  }

  // Validate multi-file inputs if present
  if (Array.isArray(payload.files)) {
    if (payload.files.length > EXECUTION_LIMITS.MAX_FILES) {
      throw new ExecutionError(
        ExecutionErrorCodes.FILE_COUNT_LIMIT_EXCEEDED,
        `File count (${payload.files.length}) exceeds maximum limit of ${EXECUTION_LIMITS.MAX_FILES} files`,
        400
      );
    }

    let totalBytes = 0;
    for (const f of payload.files) {
      if (!f?.name) {
        throw new ExecutionError(
          ExecutionErrorCodes.INVALID_REQUEST,
          "Each file in files array must have a valid name",
          400
        );
      }
      validateExecutionFilePath(f.name);
      const content = typeof f.content === "string" ? f.content : "";
      totalBytes += Buffer.byteLength(content, "utf8");
    }

    if (totalBytes > EXECUTION_LIMITS.MAX_TOTAL_FILE_BYTES) {
      throw new ExecutionError(
        ExecutionErrorCodes.SOURCE_LIMIT_EXCEEDED,
        `Total files size (${totalBytes} bytes) exceeds limit of ${EXECUTION_LIMITS.MAX_TOTAL_FILE_BYTES} bytes`,
        400
      );
    }
  }

  // Validate stdin
  if (typeof payload.stdin === "string") {
    const stdinBytes = Buffer.byteLength(payload.stdin, "utf8");
    if (stdinBytes > EXECUTION_LIMITS.MAX_STDIN_BYTES) {
      throw new ExecutionError(
        ExecutionErrorCodes.STDIN_LIMIT_EXCEEDED,
        `Standard input size (${stdinBytes} bytes) exceeds limit of ${EXECUTION_LIMITS.MAX_STDIN_BYTES} bytes`,
        400
      );
    }
  }
}

/**
 * Builds the strict, defense-in-depth Docker CLI argument array.
 * Enforces network isolation, non-root execution, capability dropping,
 * memory ceilings, CPU shares, PID limits, and strict workspace-only volume binding.
 *
 * @param {object} params
 * @param {string} params.containerName
 * @param {string} params.tempDir
 * @param {number} params.memoryMb
 * @param {string} params.cpus
 * @param {number} params.pids
 * @param {string} params.executionId
 * @param {string} params.workspaceId
 * @returns {string[]} Argument array for child_process.execFile("docker", args)
 */
export function buildDockerSecurityArgs(params) {
  const opts = typeof params === "string" ? { tempDir: params } : (params || {});
  const {
    containerName = "codecraft_exec",
    tempDir = process.cwd(),
    memoryMb = EXECUTION_LIMITS.DEFAULT_MEMORY_MB,
    cpus = EXECUTION_LIMITS.DEFAULT_CPUS,
    pids = EXECUTION_LIMITS.MAX_PIDS,
    executionId = "exec_anon",
    workspaceId = "none",
  } = opts;

  // Mount path: on Windows or Linux, Docker CLI accepts absolute path for volume
  const mountSource = path.resolve(tempDir);

  return [
    "run",
    "--name", containerName,
    "--rm",

    // 1. Total Network Isolation
    "--network", "none",

    // Read-only filesystem
    "--read-only",

    // 2. Privilege and Linux Capability Dropping
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",

    // 3. Process limit (Fork bomb defense)
    "--pids-limit", String(pids),

    // 4. Memory limit
    "-m", `${memoryMb}m`,
    "--memory", `${memoryMb}m`,
    "--memory-swap", `${memoryMb}m`,

    // 5. CPU limit
    "--cpus", String(cpus),

    // 6. Non-root user (CC-021: harmonized with runner process or configured UID, never root)
    "--user", getExecutionContainerUser(),

    // 7. Writable execution workspace and isolated tempfs
    "-w", "/app",
    "-v", `${mountSource}:/app:rw`,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",

    // 8. Safe metadata labels (no sensitive code or secrets stored in labels)
    "--label", "codecraft.execution=true",
    "--label", `codecraft.executionId=${executionId}`,
    "--label", `codecraft.workspaceId=${workspaceId}`,

    // 9. Minimal safe environment variables (zero host environment leakage)
    "-e", "LANG=C.UTF-8",
    "-e", "PYTHONUNBUFFERED=1",
    "-e", "NODE_ENV=production",
  ];
}

/**
 * Returns the non-root UID:GID string for execution containers.
 * Prevents host filesystem write errors while strictly barring root execution (CC-021).
 */
export function getExecutionContainerUser() {
  if (process.env.EXECUTION_CONTAINER_USER) {
    return process.env.EXECUTION_CONTAINER_USER;
  }
  if (typeof process.getuid === "function") {
    const uid = process.getuid();
    const gid = typeof process.getgid === "function" ? process.getgid() : uid;
    if (uid !== 0) {
      return `${uid}:${gid}`;
    }
  }
  return "1000:1000";
}
