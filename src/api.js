import axios from "axios";
import { auth } from "./config/firebase.js";
import { normalizeError, scrubErrorMessage } from "./lib/errorUtils.js";

/**
 * Executes code via the secure CodeCraft execution API.
 * Viewers are blocked at the workspace authorization layer.
 *
 * @param {string} language
 * @param {string} sourceCode
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export const executeCode = async (language, sourceCode, options = {}) => {
  const { workspaceId, stdin = "", files = [], provider = "sandbox", executionId } = options;

  if (workspaceId) {
    let token = options.token;
    if (!token && auth?.currentUser) {
      try {
        token = await auth.currentUser.getIdToken();
      } catch (err) {
        console.warn("Failed to retrieve auth ID token for execution", err);
      }
    }

    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (executionId) {
      headers["x-execution-id"] = executionId;
    }

    try {
      const response = await axios.post(
        `/api/workspace/${workspaceId}/execute`,
        {
          language,
          sourceCode,
          stdin,
          files,
          provider,
          executionId,
        },
        { headers }
      );

      const data = response.data;
      const result = data.result || data;

      const fullOutput = (result.stdout || "") + (result.stderr ? ((result.stdout ? "\n" : "") + result.stderr) : "");

      return {
        run: {
          output: fullOutput || "(no output)",
          stdout: result.stdout || "",
          stderr: result.stderr || "",
          exitCode: result.exitCode ?? 0,
          status: result.status || (result.exitCode === 0 ? "SUCCESS" : "RUNTIMEERROR"),
          durationMs: result.durationMs ?? 0,
          executionId: result.executionId,
          timedOut: result.timedOut ?? false,
          outputTruncated: result.outputTruncated ?? false,
        },
        executionId: result.executionId,
        status: result.status,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } catch (err) {
      const normalized = normalizeError(err, "Execution failed");
      const errorData = err?.response?.data;
      const errorMessage = scrubErrorMessage(errorData?.error || normalized.message || "Execution failed");
      const errorCode = errorData?.code || normalized.code || "SANDBOX_ERROR";

      return {
        run: {
          output: `[Execution Error - ${errorCode}]: ${errorMessage}`,
          stderr: errorMessage,
          exitCode: 1,
          status: errorCode,
          durationMs: 0,
        },
        error: errorMessage,
        code: errorCode,
        status: errorCode,
      };
    }
  }

  // Fallback if no workspaceId provided
  return {
    run: {
      output: "[Error]: Code execution requires an active workspace session.",
      stderr: "Missing workspace context",
      exitCode: 1,
      status: "INVALID_REQUEST",
      durationMs: 0,
    },
  };
};

/**
 * Cancels a running execution in the workspace.
 *
 * @param {string} workspaceId
 * @param {string} executionId
 * @param {string} [token]
 * @returns {Promise<object>}
 */
export const cancelExecution = async (workspaceId, executionId, token) => {
  if (!workspaceId || !executionId) return { cancelled: false };

  let authToken = token;
  if (!authToken && auth?.currentUser) {
    try {
      authToken = await auth.currentUser.getIdToken();
    } catch {}
  }

  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  try {
    const response = await axios.post(
      `/api/workspace/${workspaceId}/execute/${executionId}/cancel`,
      {},
      { headers }
    );
    return response.data;
  } catch (err) {
    const normalized = normalizeError(err, "Failed to cancel execution");
    const errorData = err?.response?.data;
    const status = normalized.status || err?.response?.status || 500;
    return {
      cancelled: false,
      error: scrubErrorMessage(errorData?.error || normalized.message || "Failed to cancel execution"),
      code: errorData?.code || normalized.code || "CANCEL_FAILED",
      status,
    };
  }
};

/**
 * Polls status of an execution session.
 *
 * @param {string} workspaceId
 * @param {string} executionId
 * @param {string} [token]
 * @returns {Promise<object>}
 */
export const getExecutionStatus = async (workspaceId, executionId, token) => {
  if (!workspaceId || !executionId) return null;

  let authToken = token;
  if (!authToken && auth?.currentUser) {
    try {
      authToken = await auth.currentUser.getIdToken();
    } catch {}
  }

  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  try {
    const response = await axios.get(
      `/api/workspace/${workspaceId}/execute/${executionId}`,
      { headers }
    );
    return response.data;
  } catch (err) {
    const normalized = normalizeError(err, "Failed to fetch execution status");
    const errorData = err?.response?.data;
    const status = normalized.status || err?.response?.status || 500;
    return {
      error: scrubErrorMessage(errorData?.error || normalized.message || "Failed to fetch execution status"),
      code: errorData?.code || normalized.code || "EXECUTION_LOOKUP_FAILED",
      status,
    };
  }
};

/**
 * Dispatches an AI Coding Agent task for a workspace.
 *
 * @param {string} workspaceId
 * @param {string} task
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export const runAIAgent = async (workspaceId, task, options = {}) => {
  if (!workspaceId || !task) {
    throw new Error("workspaceId and task are required for AI Agent execution");
  }

  let token = options.token;
  if (!token && auth?.currentUser) {
    try {
      token = await auth.currentUser.getIdToken();
    } catch {}
  }

  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await axios.post(
      `/api/workspace/${workspaceId}/agent`,
      {
        task,
        openFiles: options.openFiles || [],
        activeFile: options.activeFile || null,
        selectedCode: options.selectedCode || "",
        diagnostics: options.diagnostics || [],
      },
      { headers }
    );
    return response.data;
  } catch (err) {
    const normalized = normalizeError(err, "Agent execution failed");
    const errorData = err?.response?.data;
    const status = normalized.status || err?.response?.status || 500;
    const retryAfter =
      err?.response?.headers?.["retry-after"] ||
      errorData?.retryAfter ||
      null;
    const rawError = errorData?.error || normalized.message || "Agent execution failed";
    const errorMessage = scrubErrorMessage(typeof rawError === "object" ? JSON.stringify(rawError) : rawError);
    const errorCode = errorData?.code || normalized.code || (status === 429 ? "AI_RATE_LIMITED" : "AGENT_ERROR");

    return {
      success: false,
      error: errorMessage,
      code: errorCode,
      status,
      retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
      details: errorData?.details || null,
    };
  }
};

/**
 * Rolls back changes made during a specific AI Agent run.
 *
 * @param {string} workspaceId
 * @param {string} runId
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export const rollbackAIAgent = async (workspaceId, runId, options = {}) => {
  if (!workspaceId || !runId) {
    throw new Error("workspaceId and runId are required for agent rollback");
  }

  let token = options.token;
  if (!token && auth?.currentUser) {
    try {
      token = await auth.currentUser.getIdToken();
    } catch {}
  }

  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await axios.post(
      `/api/workspace/${workspaceId}/agent/rollback`,
      { runId },
      { headers }
    );
    return response.data;
  } catch (err) {
    const normalized = normalizeError(err, "Rollback failed");
    const errorData = err?.response?.data;
    const status = normalized.status || err?.response?.status || 500;
    const rawError = errorData?.error || normalized.message || "Rollback failed";
    const errorMessage = scrubErrorMessage(typeof rawError === "object" ? JSON.stringify(rawError) : rawError);
    const errorCode = errorData?.code || normalized.code || "AGENT_ERROR";

    return {
      success: false,
      error: errorMessage,
      code: errorCode,
      status,
    };
  }
};

/**
 * Retrieves an agent run status.
 *
 * @param {string} workspaceId
 * @param {string} runId
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export const getAIAgentRun = async (workspaceId, runId, options = {}) => {
  if (!workspaceId || !runId) return null;

  let token = options.token;
  if (!token && auth?.currentUser) {
    try {
      token = await auth.currentUser.getIdToken();
    } catch {}
  }

  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await axios.get(
      `/api/workspace/${workspaceId}/agent?runId=${encodeURIComponent(runId)}`,
      { headers }
    );
    return response.data;
  } catch (err) {
    const normalized = normalizeError(err, "Failed to fetch agent run");
    const errorData = err?.response?.data;
    const status = normalized.status || err?.response?.status || 500;
    const rawError = errorData?.error || normalized.message || "Failed to fetch agent run";
    const errorMessage = scrubErrorMessage(typeof rawError === "object" ? JSON.stringify(rawError) : rawError);
    return {
      run: null,
      error: errorMessage,
      code: errorData?.code || normalized.code || "AGENT_RUN_LOOKUP_FAILED",
      status,
    };
  }
};
