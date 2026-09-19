import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ExecutionError, ExecutionErrorCodes } from "./errors.js";
import { EXECUTION_LIMITS } from "./limits.js";
import { getRuntimeConfig } from "./runtimeRegistry.js";
import {
  validateExecutionFilePath,
  validateExecutionPayload,
  buildDockerSecurityArgs,
} from "./security.js";
import { checkDockerAvailability } from "./dockerDetector.js";
import { resolveJavaExecutionPlan } from "./javaResolver.js";

// In-flight executions map for cancellation: executionId => { containerName, killed, process }
const activeExecutions = new Map();

/**
 * Docker Sandbox Execution Provider.
 */
export class SandboxExecutor {
  /**
   * Executes code within a sandboxed Docker container.
   *
   * @param {object} params
   * @param {string} params.language
   * @param {string} [params.source]
   * @param {Array<{ name: string, content: string }>} [params.files]
   * @param {string} [params.stdin]
   * @param {string} [params.workspaceId]
   * @param {string} [params.userId]
   * @returns {Promise<object>} Structured execution result
   */
  static async execute(params) {
    const startTime = Date.now();
    validateExecutionPayload(params);

    const runtime = getRuntimeConfig(params.language);
    // CC-013: Accept caller-supplied executionId early for cancelation lifecycle, or generate safely
    const executionId = params.executionId && /^[a-zA-Z0-9_\-]{8,64}$/.test(params.executionId)
      ? params.executionId
      : `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const containerName = `cc_run_${executionId}`;

    // 1. Verify Docker Availability (FAIL CLOSED)
    const dockerStatus = await checkDockerAvailability();
    if (!dockerStatus.available) {
      throw new ExecutionError(
        ExecutionErrorCodes.EXECUTION_SANDBOX_UNAVAILABLE,
        `Docker sandbox is unavailable (${dockerStatus.reason || "daemon offline"}). Host execution fallback is strictly prohibited.`,
        503
      );
    }

    // 2. Setup Temporary Isolated Workspace (CC-021: mode 0775 for safe runner/container permissions)
    const baseExecDir = path.resolve(process.cwd(), "data", "executions");
    fs.mkdirSync(baseExecDir, { recursive: true, mode: 0o775 });
    const tempDir = path.join(baseExecDir, executionId);
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o775 });

    let executionRecord = {
      containerName,
      killed: false,
      process: null,
      userId: params.userId || "anon",
      workspaceId: params.workspaceId || null,
      language: params.language,
      startTime,
    };
    activeExecutions.set(executionId, executionRecord);

    let compileCmd = runtime.compile;
    let runCmd = runtime.run;
    let primarySourceFileName = runtime.sourceFileName;

    if (params.language === "java" || runtime.language === "java") {
      const plan = resolveJavaExecutionPlan(params, runtime);
      primarySourceFileName = plan.sourceFileName;
      compileCmd = plan.compile;
      runCmd = plan.run;
    }

    try {
      // 3. Write Source Files
      const filesToWrite = [];

      // Primary source file
      if (typeof params.source === "string") {
        filesToWrite.push({
          name: primarySourceFileName,
          content: params.source,
        });
      }

      // Auxiliary files
      if (Array.isArray(params.files)) {
        for (const file of params.files) {
          if (!file?.name) continue;
          // Avoid duplicate or case-mismatched writes for the primary source file
          if (
            typeof params.source === "string" &&
            path.basename(file.name).toLowerCase() === primarySourceFileName.toLowerCase()
          ) {
            continue;
          }
          filesToWrite.push(file);
        }
      }

      for (const item of filesToWrite) {
        const relPath = validateExecutionFilePath(item.name, tempDir);
        const fullPath = path.resolve(tempDir, relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, typeof item.content === "string" ? item.content : "", "utf8");
      }

      // Stdin file
      let stdinFilePath = null;
      if (typeof params.stdin === "string" && params.stdin.length > 0) {
        stdinFilePath = path.join(tempDir, ".codecraft_stdin");
        fs.writeFileSync(stdinFilePath, params.stdin, "utf8");
      }

      // 4. Compilation Step (if required by language)
      if (runtime.requiresCompilation && Array.isArray(compileCmd)) {
        const compileContainer = `cc_cmp_${executionId}`;
        const compileArgs = [
          ...buildDockerSecurityArgs({
            containerName: compileContainer,
            tempDir,
            memoryMb: runtime.memoryMb || EXECUTION_LIMITS.DEFAULT_MEMORY_MB,
            cpus: EXECUTION_LIMITS.DEFAULT_CPUS,
            pids: EXECUTION_LIMITS.MAX_PIDS,
            executionId: `cmp_${executionId}`,
            workspaceId: params.workspaceId,
          }),
          runtime.image,
          ...compileCmd,
        ];

        const compileResult = await this.runProcess("docker", compileArgs, {
          timeoutMs: EXECUTION_LIMITS.COMPILE_TIMEOUT_MS,
          maxOutputBytes: EXECUTION_LIMITS.MAX_OUTPUT_BYTES,
          containerName: compileContainer,
        });

        if (compileResult.exitCode !== 0 || compileResult.timedOut) {
          return {
            executionId,
            status: compileResult.timedOut ? "TIMEOUT" : "COMPILEERROR",
            stdout: compileResult.stdout,
            stderr: compileResult.stderr || (compileResult.timedOut ? "Compilation timed out" : "Compilation failed"),
            exitCode: compileResult.exitCode,
            signal: compileResult.signal,
            durationMs: Date.now() - startTime,
            timedOut: compileResult.timedOut,
            outputTruncated: compileResult.truncated,
          };
        }
      }

      // 5. Execution Step
      const runDockerArgs = [
        ...buildDockerSecurityArgs({
          containerName,
          tempDir,
          memoryMb: runtime.memoryMb || EXECUTION_LIMITS.DEFAULT_MEMORY_MB,
          cpus: EXECUTION_LIMITS.DEFAULT_CPUS,
          pids: EXECUTION_LIMITS.MAX_PIDS,
          executionId,
          workspaceId: params.workspaceId,
        }),
        runtime.image,
        ...runCmd,
      ];

      const runTimeout = runtime.timeoutMs || EXECUTION_LIMITS.DEFAULT_TIMEOUT_MS;
      const result = await this.runProcess("docker", runDockerArgs, {
        timeoutMs: runTimeout,
        maxOutputBytes: EXECUTION_LIMITS.MAX_OUTPUT_BYTES,
        stdinFilePath,
        containerName,
        onSpawn: (proc) => {
          executionRecord.process = proc;
        },
      });

      const durationMs = Date.now() - startTime;

      // Classify execution status
      let status = "SUCCESS";
      if (result.cancelled) {
        status = "CANCELLED";
      } else if (result.timedOut) {
        status = "TIMEOUT";
      } else if (result.truncated) {
        status = "OUTPUTLIMIT";
      } else if (result.exitCode === 137) {
        // Exit code 137 typically indicates OOM kill (SIGKILL) or container kill
        status = result.timedOut ? "TIMEOUT" : "MEMORYLIMIT";
      } else if (result.exitCode !== 0) {
        status = "RUNTIMEERROR";
      }

      return {
        executionId,
        workspaceId: params.workspaceId || null,
        status,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs,
        timedOut: result.timedOut,
        outputTruncated: result.truncated,
      };
    } finally {
      // 6. Guaranteed Cleanup
      activeExecutions.delete(executionId);

      // Force terminate and remove container if still running
      try {
        const cleanupProc = spawn("docker", ["rm", "-f", containerName], {
          windowsHide: true,
          stdio: "ignore",
        });
        cleanupProc.on("error", () => {});
      } catch {
        // ignore
      }

      // Delete temporary workspace directory
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {
        // ignore Windows file locks
      }
    }
  }

  /**
   * Spawns a child process and captures stdout/stderr with limits and timeouts.
   *
   * @param {string} command
   * @param {string[]} args
   * @param {object} options
   * @returns {Promise<object>}
   */
  static runProcess(command, args, options = {}) {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let truncated = false;
      let timedOut = false;
      let cancelled = false;

      const maxBytes = options.maxOutputBytes || EXECUTION_LIMITS.MAX_OUTPUT_BYTES;
      const timeoutMs = options.timeoutMs || EXECUTION_LIMITS.DEFAULT_TIMEOUT_MS;

      const proc = spawn(command, args, {
        windowsHide: true,
      });

      if (typeof options.onSpawn === "function") {
        options.onSpawn(proc);
      }

      // Handle stdin streaming if present
      if (options.stdinFilePath && fs.existsSync(options.stdinFilePath)) {
        const stdinStream = fs.createReadStream(options.stdinFilePath);
        stdinStream.pipe(proc.stdin);
        stdinStream.on("error", () => {});
      }

      // Enforce host timer timeout
      const timer = setTimeout(() => {
        timedOut = true;
        if (options.containerName) {
          try {
            spawn("docker", ["kill", options.containerName], {
              windowsHide: true,
              stdio: "ignore",
            });
          } catch {}
        }
        try {
          proc.kill("SIGKILL");
        } catch {}
      }, timeoutMs);

      proc.stdout.on("data", (chunk) => {
        if (outputBytes + chunk.length > maxBytes) {
          truncated = true;
          const remaining = Math.max(0, maxBytes - outputBytes);
          stdout += chunk.slice(0, remaining).toString("utf8");
          outputBytes = maxBytes;
          if (options.containerName) {
            try {
              spawn("docker", ["kill", options.containerName], {
                windowsHide: true,
                stdio: "ignore",
              });
            } catch {}
          }
          proc.kill("SIGTERM");
        } else {
          outputBytes += chunk.length;
          stdout += chunk.toString("utf8");
        }
      });

      proc.stderr.on("data", (chunk) => {
        if (outputBytes + chunk.length > maxBytes) {
          truncated = true;
          const remaining = Math.max(0, maxBytes - outputBytes);
          stderr += chunk.slice(0, remaining).toString("utf8");
          outputBytes = maxBytes;
          if (options.containerName) {
            try {
              spawn("docker", ["kill", options.containerName], {
                windowsHide: true,
                stdio: "ignore",
              });
            } catch {}
          }
          proc.kill("SIGTERM");
        } else {
          outputBytes += chunk.length;
          stderr += chunk.toString("utf8");
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: stderr || `Process execution failed: ${err.message}`,
          exitCode: 1,
          signal: null,
          timedOut,
          truncated,
          cancelled,
        });
      });

      proc.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode: code !== null ? code : (timedOut ? 124 : 1),
          signal,
          timedOut,
          truncated,
          cancelled,
        });
      });
    });
  }

  /**
   * Cancels a currently running execution.
   *
   * @param {string} executionId
   * @param {string} userId
   * @returns {boolean} Whether cancellation was initiated
   */
  /**
   * Retrieves status of an active execution if currently running.
   *
   * @param {string} executionId
   * @param {string} [workspaceId]
   * @returns {object | null}
   */
  static getActiveExecution(executionId, workspaceId = null) {
    const record = activeExecutions.get(executionId);
    if (!record) return null;
    if (workspaceId && record.workspaceId && record.workspaceId !== workspaceId) {
      return null;
    }
    return {
      executionId,
      workspaceId: record.workspaceId || null,
      status: record.killed ? "CANCELLED" : "RUNNING",
      language: record.language,
      startTime: record.startTime,
      elapsedMs: Date.now() - (record.startTime || Date.now()),
    };
  }

  static cancel(executionId, userId, workspaceId = null) {
    const record = activeExecutions.get(executionId);
    if (!record) return false;

    if (workspaceId && record.workspaceId && record.workspaceId !== workspaceId) {
      throw new ExecutionError(
        ExecutionErrorCodes.PERMISSION_DENIED,
        "Execution does not belong to this workspace",
        403
      );
    }

    if (record.userId && record.userId !== userId && userId !== "admin") {
      throw new ExecutionError(
        ExecutionErrorCodes.PERMISSION_DENIED,
        "Cannot cancel an execution started by another user",
        403
      );
    }

    record.killed = true;
    if (record.containerName) {
      try {
        spawn("docker", ["kill", record.containerName], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {}
    }

    if (record.process) {
      try {
        record.process.kill("SIGKILL");
      } catch {}
    }

    return true;
  }

  static registerActiveExecutionForTesting(executionId, record) {
    activeExecutions.set(executionId, record);
  }

  static removeActiveExecutionForTesting(executionId) {
    activeExecutions.delete(executionId);
  }
}
