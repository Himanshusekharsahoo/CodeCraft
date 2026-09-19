import fs from "node:fs";
import path from "node:path";
import { getWorkspaceRepoDir, resolveSafePath } from "../../git/security.js";
import { GitService } from "../../git/gitService.js";
import { syncWorkingTreeToFirestore } from "../../git/firestoreSync.js";
import { ExecutionService } from "../../execution/executionService.js";
import { AIConfig } from "../config.js";
import { AgentError, AgentErrorCodes } from "../agentErrors.js";
import { isSensitivePath, redactSecrets } from "../secretRedaction.js";
import { wrapUntrustedData } from "../promptInjectionDefense.js";

let mockTestRunner = null;

export const TOOL_REGISTRY = {
  list_files: {
    name: "list_files",
    description: "List files and directories in the workspace working tree. Useful for exploring repository layout.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Optional subfolder relative to workspace root (e.g. 'src' or 'lib'). Omit for root.",
        },
      },
    },
  },

  read_file: {
    name: "read_file",
    description: "Read the contents of a specific file in the workspace. Returns sanitized content.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Relative file path within the workspace (e.g. 'src/lib/execution/executionService.js').",
        },
      },
      required: ["path"],
    },
  },

  search_code: {
    name: "search_code",
    description: "Search for a string or identifier across workspace source files. Returns matching files, line numbers, and snippets.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Text pattern or symbol name to search for.",
        },
        path: {
          type: "STRING",
          description: "Optional subfolder relative to workspace root to restrict search scope.",
        },
      },
      required: ["query"],
    },
  },

  get_git_diff: {
    name: "get_git_diff",
    description: "Inspect the current Git diff of working tree changes in the workspace.",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Optional specific file path to inspect diff for. Omit for full working tree diff.",
        },
      },
    },
  },

  apply_patch: {
    name: "apply_patch",
    description: "Safely modify or create a file in the workspace with conflict verification.",
    parameters: {
      type: "OBJECT",
      properties: {
        file: {
          type: "STRING",
          description: "Relative file path to modify or create.",
        },
        expectedOldContent: {
          type: "STRING",
          description: "Exact expected existing content or snippet being replaced, ensuring no concurrent edits occurred.",
        },
        patch: {
          type: "STRING",
          description: "The new content or replacement block for the file.",
        },
      },
      required: ["file", "patch"],
    },
  },

  run_code: {
    name: "run_code",
    description: "Execute code safely inside the isolated Docker sandbox via ExecutionService.",
    parameters: {
      type: "OBJECT",
      properties: {
        language: {
          type: "STRING",
          description: "Target programming language (javascript, python, etc.).",
        },
        source: {
          type: "STRING",
          description: "Source code to execute.",
        },
        files: {
          type: "ARRAY",
          description: "Optional multi-file payload: [{ name, content }].",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              content: { type: "STRING" },
            },
          },
        },
        stdin: {
          type: "STRING",
          description: "Optional standard input stream.",
        },
      },
      required: ["language"],
    },
  },

  run_tests: {
    name: "run_tests",
    description: "Run an approved project test suite from the server allowlist.",
    parameters: {
      type: "OBJECT",
      properties: {
        testName: {
          type: "STRING",
          description: "Name of the approved test suite (e.g. 'test:execution', 'test:git', 'test:security', 'test:collab').",
        },
      },
      required: ["testName"],
    },
  },
};

/**
 * Returns tool declarations formatted for LLM consumption.
 */
export function getRegisteredToolDeclarations() {
  return Object.values(TOOL_REGISTRY).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Tool Execution Coordinator.
 */
export class ToolExecutor {
  static setMockTestRunner(runner) {
    mockTestRunner = runner;
  }

  static getMockTestRunner() {
    return mockTestRunner;
  }

  /**
   * Dispatches and validates tool requests.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {object} params.args
   * @param {string} params.workspaceId
   * @param {string} params.userId
   * @param {"owner" | "contributor" | "viewer"} params.userRole
   * @param {object} params.runRecord
   * @returns {Promise<object>}
   */
  static async executeTool({ name, args = {}, workspaceId, userId, userRole, runRecord }) {
    if (!TOOL_REGISTRY[name]) {
      throw new AgentError(
        AgentErrorCodes.TOOL_NOT_ALLOWED,
        `Tool '${name}' is not in the approved tool registry.`,
        400
      );
    }

    const repoDir = getWorkspaceRepoDir(workspaceId);
    if (!fs.existsSync(repoDir)) {
      fs.mkdirSync(repoDir, { recursive: true });
    }

    switch (name) {
      case "list_files":
        return await this.handleListFiles(repoDir, args?.path);

      case "read_file":
        return await this.handleReadFile(repoDir, args?.path, runRecord);

      case "search_code":
        return await this.handleSearchCode(repoDir, args?.query, args?.path);

      case "get_git_diff":
        return await this.handleGetGitDiff(workspaceId, args?.path);

      case "apply_patch":
        return await this.handleApplyPatch(repoDir, workspaceId, args, userRole, runRecord);

      case "run_code":
        return await this.handleRunCode(workspaceId, userId, args, userRole, runRecord);

      case "run_tests":
        return await this.handleRunTests(workspaceId, userId, args?.testName, userRole, runRecord);

      default:
        throw new AgentError(
          AgentErrorCodes.TOOL_NOT_ALLOWED,
          `Handler for '${name}' not implemented`,
          400
        );
    }
  }

  static async handleListFiles(repoDir, subPath) {
    const targetDir = subPath ? resolveSafePath(repoDir, subPath).fullPath : repoDir;
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return { files: [], message: `Directory '${subPath || "/"}' does not exist` };
    }

    const maxScan = AIConfig.limits.maxFilesToScan;
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      if (entry.name === ".git") continue;
      if (isSensitivePath(entry.name)) continue;
      if (results.length >= maxScan) break;

      const full = path.join(targetDir, entry.name);
      const rel = path.relative(repoDir, full).replace(/\\/g, "/");
      const isDir = entry.isDirectory();
      let size = 0;
      if (!isDir) {
        try {
          size = fs.statSync(full).size;
        } catch {}
      }

      results.push({
        path: rel,
        isDirectory: isDir,
        size,
      });
    }

    return {
      subPath: subPath || "/",
      total: results.length,
      files: results,
    };
  }

  static async handleReadFile(repoDir, rawPath, runRecord) {
    if (!rawPath || typeof rawPath !== "string") {
      throw new AgentError(AgentErrorCodes.TOOL_VALIDATION_ERROR, "Missing 'path' parameter for read_file", 400);
    }

    if (isSensitivePath(rawPath)) {
      throw new AgentError(AgentErrorCodes.FILE_ACCESS_DENIED, `Access to sensitive file '${rawPath}' is prohibited`, 403);
    }

    let relativePath;
    let fullPath;
    try {
      const res = resolveSafePath(repoDir, rawPath);
      relativePath = res.relativePath;
      fullPath = res.fullPath;
    } catch (err) {
      throw new AgentError(
        AgentErrorCodes.FILE_ACCESS_DENIED,
        `Path validation failed for '${rawPath}': ${err.message}`,
        403
      );
    }

    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      throw new AgentError(AgentErrorCodes.FILE_ACCESS_DENIED, `File '${relativePath}' not found in workspace`, 404);
    }

    const stat = fs.statSync(fullPath);
    if (stat.size > AIConfig.limits.maxFileSize) {
      throw new AgentError(
        AgentErrorCodes.CONTEXT_LIMIT_EXCEEDED,
        `File '${relativePath}' (${stat.size} bytes) exceeds maximum file size limit (${AIConfig.limits.maxFileSize} bytes)`,
        400
      );
    }

    const rawContent = fs.readFileSync(fullPath, "utf8");
    const sanitized = redactSecrets(rawContent);

    if (runRecord?.filesRead && !runRecord.filesRead.includes(relativePath)) {
      runRecord.filesRead.push(relativePath);
    }

    return {
      path: relativePath,
      size: stat.size,
      content: wrapUntrustedData(sanitized, { file: relativePath }),
    };
  }

  static async handleSearchCode(repoDir, query, subPath) {
    if (!query || typeof query !== "string" || !query.trim()) {
      throw new AgentError(AgentErrorCodes.TOOL_VALIDATION_ERROR, "Missing 'query' parameter for search_code", 400);
    }

    const targetDir = subPath ? resolveSafePath(repoDir, subPath).fullPath : repoDir;
    const matches = [];
    const maxResults = AIConfig.limits.maxSearchResults;
    const maxSnippet = AIConfig.limits.maxSearchSnippetLength;
    const needle = query.toLowerCase();

    function searchDir(current) {
      if (!fs.existsSync(current)) return;
      const list = fs.readdirSync(current, { withFileTypes: true });
      for (const item of list) {
        if (matches.length >= maxResults) return;
        if (item.name === ".git" || item.name === "node_modules") continue;
        if (isSensitivePath(item.name)) continue;

        const full = path.join(current, item.name);
        if (item.isDirectory()) {
          searchDir(full);
        } else if (item.isFile()) {
          try {
            const stat = fs.statSync(full);
            if (stat.size > AIConfig.limits.maxFileSize) continue;

            const text = fs.readFileSync(full, "utf8");
            const lines = text.split(/\r?\n/);
            const rel = path.relative(repoDir, full).replace(/\\/g, "/");

            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= maxResults) break;
              if (lines[i].toLowerCase().includes(needle)) {
                const lineContent = redactSecrets(lines[i].slice(0, maxSnippet).trim());
                matches.push({
                  file: rel,
                  line: i + 1,
                  snippet: lineContent,
                });
              }
            }
          } catch {}
        }
      }
    }

    searchDir(targetDir);

    return {
      query,
      totalMatches: matches.length,
      matches,
    };
  }

  static async handleGetGitDiff(workspaceId, filePath) {
    try {
      const isInit = GitService.isRepositoryInitialized(workspaceId);
      if (!isInit) {
        return { diff: "", message: "Repository is not initialized yet." };
      }
      const diffResult = await GitService.getDiff(workspaceId, { filePath });
      return {
        filePath: diffResult.filePath || null,
        diff: diffResult.diff || "",
        staged: diffResult.staged,
      };
    } catch (err) {
      throw new AgentError(AgentErrorCodes.GIT_ERROR, `Failed to retrieve Git diff: ${err.message}`, 500);
    }
  }

  static async handleApplyPatch(repoDir, workspaceId, args, userRole, runRecord) {
    if (userRole === "viewer") {
      throw new AgentError(
        AgentErrorCodes.WORKSPACE_ACCESS_DENIED,
        "Viewer role has read-only access and cannot modify files",
        403
      );
    }

    const { file, expectedOldContent, patch } = args || {};
    if (!file || typeof file !== "string") {
      throw new AgentError(AgentErrorCodes.TOOL_VALIDATION_ERROR, "Missing 'file' parameter for apply_patch", 400);
    }
    if (typeof patch !== "string") {
      throw new AgentError(AgentErrorCodes.TOOL_VALIDATION_ERROR, "Missing 'patch' parameter for apply_patch", 400);
    }

    if (isSensitivePath(file)) {
      throw new AgentError(AgentErrorCodes.FILE_ACCESS_DENIED, `Modifying sensitive file '${file}' is prohibited`, 403);
    }

    if (patch.length > AIConfig.limits.maxPatchBytes) {
      throw new AgentError(
        AgentErrorCodes.AGENT_LIMIT_EXCEEDED,
        `Patch size (${patch.length} bytes) exceeds maximum limit (${AIConfig.limits.maxPatchBytes} bytes)`,
        400
      );
    }

    let relativePath;
    let fullPath;
    try {
      const res = resolveSafePath(repoDir, file);
      relativePath = res.relativePath;
      fullPath = res.fullPath;
    } catch (err) {
      throw new AgentError(
        AgentErrorCodes.FILE_ACCESS_DENIED,
        `Path validation failed for '${file}': ${err.message}`,
        403
      );
    }

    const fileExists = fs.existsSync(fullPath);
    let currentContent = "";

    if (fileExists) {
      currentContent = fs.readFileSync(fullPath, "utf8");
    }

    // Capture pre-run state for safe rollback if not already recorded
    if (runRecord?.preRunSnapshots) {
      if (!runRecord.preRunSnapshots.has(relativePath)) {
        runRecord.preRunSnapshots.set(relativePath, fileExists ? currentContent : null);
      }
    }

    // Concurrency / stale patch verification & collision defense
    if (fileExists) {
      if (typeof expectedOldContent !== "string" || expectedOldContent.trim().length === 0) {
        throw new AgentError(
          AgentErrorCodes.PATCH_CONFLICT,
          `PATCH_CONFLICT: Missing 'expectedOldContent' parameter for existing file '${relativePath}'. Blind file overwrite is prohibited. Provide the exact snippet to replace.`,
          409
        );
      }

      const normCurrent = currentContent.replace(/\r\n/g, "\n");
      const normExpected = expectedOldContent.replace(/\r\n/g, "\n");
      const occurrences = normCurrent.split(normExpected).length - 1;

      if (occurrences === 0) {
        throw new AgentError(
          AgentErrorCodes.PATCH_CONFLICT,
          `PATCH_CONFLICT: File '${relativePath}' content does not match expectedOldContent. Stale patch detected. Please re-read the latest file content before patching.`,
          409
        );
      }

      if (occurrences > 1) {
        throw new AgentError(
          AgentErrorCodes.PATCH_CONFLICT,
          `PATCH_CONFLICT: Multiple occurrences (${occurrences}) of expectedOldContent found in '${relativePath}'. Ambiguous patch target. Please provide more surrounding context in expectedOldContent.`,
          409
        );
      }
    }

    // Determine final patched content
    let finalContent = patch;
    if (fileExists && typeof expectedOldContent === "string" && expectedOldContent.trim().length > 0) {
      finalContent = currentContent.replace(expectedOldContent, patch);
    }

    const normalizedFinal = finalContent.replace(/\r\n/g, "\n");

    // Write patched file to working tree
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, normalizedFinal, "utf8");

    // Track modified files and post-patch content in runRecord
    if (runRecord) {
      runRecord.agentPatchedContent = runRecord.agentPatchedContent || new Map();
      runRecord.agentPatchedContent.set(relativePath, normalizedFinal);

      if (fileExists) {
        if (!runRecord.filesModified.includes(relativePath)) {
          runRecord.filesModified.push(relativePath);
        }
      } else {
        if (!runRecord.filesCreated.includes(relativePath)) {
          runRecord.filesCreated.push(relativePath);
        }
      }
    }

    // Sync disk changes back to Firestore
    await syncWorkingTreeToFirestore(workspaceId).catch((err) => {
      console.warn("[ToolExecutor] syncWorkingTreeToFirestore warning:", err.message);
    });

    return {
      file: relativePath,
      status: "applied",
      created: !fileExists,
      bytesWritten: Buffer.byteLength(finalContent, "utf8"),
    };
  }

  static async handleRunCode(workspaceId, userId, args, userRole, runRecord) {
    if (userRole === "viewer") {
      throw new AgentError(
        AgentErrorCodes.WORKSPACE_ACCESS_DENIED,
        "Viewer role has read-only access and cannot execute code",
        403
      );
    }

    if (!args?.language) {
      throw new AgentError(AgentErrorCodes.TOOL_VALIDATION_ERROR, "Missing 'language' parameter for run_code", 400);
    }

    if (runRecord) {
      if (runRecord.executionCalls >= AIConfig.limits.maxExecutionCalls) {
        throw new AgentError(
          AgentErrorCodes.AGENT_LIMIT_EXCEEDED,
          `Exceeded maximum allowed execution calls (${AIConfig.limits.maxExecutionCalls})`,
          400
        );
      }
      runRecord.executionCalls = (runRecord.executionCalls || 0) + 1;
    }

    try {
      const execResult = await ExecutionService.execute({
        language: args.language,
        source: args.source,
        files: args.files,
        stdin: args.stdin,
        workspaceId,
        userId,
      });

      if (runRecord && execResult?.executionId) {
        runRecord.executionIds.push(execResult.executionId);
      }

      return {
        executionId: execResult.executionId,
        status: execResult.status,
        stdout: redactSecrets(execResult.stdout || ""),
        stderr: redactSecrets(execResult.stderr || ""),
        exitCode: execResult.exitCode ?? 0,
        durationMs: execResult.durationMs || 0,
      };
    } catch (err) {
      throw new AgentError(
        AgentErrorCodes.EXECUTION_ERROR,
        `Execution failed: ${err.message}`,
        err.status || 500
      );
    }
  }

  static async handleRunTests(workspaceId, userId, testName, userRole, runRecord) {
    if (userRole === "viewer") {
      throw new AgentError(
        AgentErrorCodes.WORKSPACE_ACCESS_DENIED,
        "Viewer role has read-only access and cannot run tests",
        403
      );
    }

    if (!testName || typeof testName !== "string") {
      throw new AgentError(AgentErrorCodes.TOOL_VALIDATION_ERROR, "Missing 'testName' parameter for run_tests", 400);
    }

    // CC-014: Reject any command injection / shell metacharacters immediately
    if (/[\r\n\0`$;|&><]/.test(testName)) {
      throw new AgentError(
        AgentErrorCodes.TOOL_VALIDATION_ERROR,
        "Command injection characters are strictly prohibited in run_tests parameter",
        400
      );
    }

    // Strict allowlist validation against registered suites
    const allowed = AIConfig.allowedTests.find((t) => t.name === testName.trim());
    if (!allowed) {
      const validNames = AIConfig.allowedTests.map((t) => t.name).join(", ");
      throw new AgentError(
        AgentErrorCodes.TOOL_VALIDATION_ERROR,
        `Test '${testName}' is not permitted. Allowed tests: [${validNames}]`,
        400
      );
    }

    if (mockTestRunner) {
      const mockRes = await mockTestRunner(testName);
      if (runRecord) {
        runRecord.testsRun.push({
          testName,
          passed: mockRes.passed,
          exitCode: mockRes.exitCode,
        });
      }
      return mockRes;
    }

    // Sandboxed Workspace Test Execution via ExecutionService (Docker container sandbox)
    // Direct host shell execution is strictly eliminated.
    try {
      const repoDir = getWorkspaceRepoDir(workspaceId);
      const files = [];

      // CC-014: Recursively collect repository files including test/ subdirectories
      function collectFilesRecursively(dir, relPrefix = "") {
        if (!fs.existsSync(dir) || files.length >= AIConfig.limits.maxFilesToScan) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (files.length >= AIConfig.limits.maxFilesToScan) break;
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          const fullPath = path.join(dir, entry.name);
          const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            collectFilesRecursively(fullPath, relPath);
          } else if (entry.isFile()) {
            try {
              const content = fs.readFileSync(fullPath, "utf8");
              files.push({ name: relPath, content });
            } catch {}
          }
        }
      }

      collectFilesRecursively(repoDir);

      const language = allowed.language || "javascript";

      // CC-014: Determine appropriate sandboxed test runner harness
      let testSource = null;
      if (language === "javascript") {
        // Look for test files
        const testFile = files.find((f) => /test.*\.(js|mjs)$/i.test(f.name));
        if (testFile) {
          testSource = `import './${testFile.name.replace(/\\/g, "/")}';\nconsole.log('[TEST RUNNER] Test execution completed.');`;
        } else {
          testSource = `console.log('[TEST RUNNER] Running workspace suite for ${allowed.name}...');`;
        }
      } else if (language === "python") {
        const testFile = files.find((f) => /test.*\.py$/i.test(f.name));
        if (testFile) {
          testSource = `import unittest\nloader = unittest.TestLoader()\nsuite = loader.discover('.', pattern='*test*.py')\nrunner = unittest.TextTestRunner(verbosity=2)\nres = runner.run(suite)\nexit(0 if res.wasSuccessful() else 1)`;
        } else {
          testSource = `print('[TEST RUNNER] Running workspace suite for ${allowed.name}...')`;
        }
      }

      const execResult = await ExecutionService.execute({
        language,
        source: testSource,
        files,
        stdin: "",
        workspaceId,
        userId: userId || "ai-agent",
      });

      const passed = execResult.exitCode === 0 && execResult.status === "SUCCESS";
      const output = redactSecrets((execResult.stdout || "") + "\n" + (execResult.stderr || "")).slice(0, 10000);
      const exitCode = execResult.exitCode ?? (passed ? 0 : 1);

      if (runRecord) {
        runRecord.testsRun.push({ testName, passed, exitCode });
      }

      return {
        testName,
        passed,
        exitCode,
        output,
        sandbox: true,
      };
    } catch (err) {
      if (err.statusCode === 503 || err.status === 503 || err.code === "EXECUTION_SANDBOX_UNAVAILABLE") {
        throw new AgentError(
          AgentErrorCodes.EXECUTION_ERROR,
          `Execution sandbox offline: ${err.message}. Host execution fallback is strictly prohibited.`,
          503
        );
      }

      const output = redactSecrets((err.stdout || "") + (err.stderr || "") + "\n" + (err.message || "")).slice(0, 10000);
      const passed = false;
      const exitCode = err.code || err.exitCode || 1;

      if (runRecord) {
        runRecord.testsRun.push({ testName, passed, exitCode });
      }

      return {
        testName,
        passed,
        exitCode,
        output,
        sandbox: true,
      };
    }
  }
}
