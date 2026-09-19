import { ExecutionError, ExecutionErrorCodes } from "./errors.js";
import { SandboxExecutor } from "./sandboxExecutor.js";
import { acquireExecutionSlot, releaseExecutionSlot } from "./rateLimiter.js";
import { validateExecutionPayload } from "./security.js";
import { checkDockerAvailability } from "./dockerDetector.js";

// Cache of recent execution results: executionId => result
const executionCache = new Map();
const MAX_CACHE_ENTRIES = 100;

let mockExecutionHandler = null;

/**
 * Centralized CodeCraft Execution Service.
 * Coordinates validation, rate limiting, concurrency quotas, and executor dispatch.
 */
export class ExecutionService {
  /**
   * Dispatches code execution to the secure Docker Sandbox (or configured provider).
   *
   * @param {object} request
   * @param {string} request.language
   * @param {string} [request.source]
   * @param {Array<{ name: string, content: string }>} [request.files]
   * @param {string} [request.stdin]
   * @param {string} [request.workspaceId]
   * @param {string} [request.userId]
   * @param {"sandbox" | "piston"} [request.provider="sandbox"]
   * @returns {Promise<object>} Structured execution result
   */
  static async execute(request) {
    if (!request?.language) {
      throw new ExecutionError(
        ExecutionErrorCodes.INVALID_REQUEST,
        "Execution request must specify a target language",
        400
      );
    }

    // 1. Validate payload bounds
    validateExecutionPayload(request);

    // 2. Mock handler for isolated test runs
    if (mockExecutionHandler) {
      return await mockExecutionHandler(request);
    }

    const userId = request.userId || "anonymous";

    // 3. Acquire rate limit & concurrency slot
    acquireExecutionSlot(userId);

    try {
      // CC-006: Server-side provider lockdown (Docker sandbox is the only permitted provider)
      const requestedProvider = request.provider;
      if (requestedProvider && requestedProvider !== "sandbox") {
        throw new ExecutionError(
          ExecutionErrorCodes.INVALID_REQUEST,
          `Execution provider '${requestedProvider}' is not permitted. Docker sandbox is the only valid execution provider.`,
          400
        );
      }

      // Strict Docker Sandbox Execution (FAIL CLOSED: Zero Host Fallback)
      const dockerStatus = await checkDockerAvailability();
      if (!dockerStatus.available) {
        throw new ExecutionError(
          ExecutionErrorCodes.EXECUTION_SANDBOX_UNAVAILABLE,
          `Docker execution sandbox is currently offline or unreachable (${dockerStatus.reason || "daemon offline"}). Host execution fallback is strictly prohibited.`,
          503
        );
      }

      const result = await SandboxExecutor.execute(request);

      // 4. Cache result for polling (CC-010: bind workspaceId to cached execution state)
      if (result?.executionId) {
        if (executionCache.size >= MAX_CACHE_ENTRIES) {
          const firstKey = executionCache.keys().next().value;
          executionCache.delete(firstKey);
        }
        executionCache.set(result.executionId, {
          ...result,
          workspaceId: result.workspaceId || request.workspaceId || null,
        });
      }

      return result;
    } finally {
      // 5. Always release concurrency slot
      releaseExecutionSlot(userId);
    }
  }

  /**
   * Retrieves a cached execution result by ID.
   *
   * @param {string} executionId
   * @returns {object | null}
   */
  /**
   * Retrieves an execution status or result by ID.
   *
   * @param {string} executionId
   * @returns {object | null}
   */
  static getStatus(executionId) {
    const cached = executionCache.get(executionId);
    if (cached) return cached;
    if (typeof SandboxExecutor.getActiveExecution === "function") {
      const active = SandboxExecutor.getActiveExecution(executionId);
      if (active) return active;
    }
    return null;
  }

  static getExecutionResult(executionId) {
    return executionCache.get(executionId) || null;
  }

  /**
   * Cancels an active execution.
   *
   * @param {string} executionId
   * @param {string} userId
   * @param {string} [workspaceId]
   * @returns {boolean}
   */
  static cancel(executionId, userId, workspaceId = null) {
    // CC-013: Completed executions cannot be incorrectly cancelled; check completed cache first
    const cached = executionCache.get(executionId);
    if (cached) {
      if (workspaceId && cached.workspaceId && cached.workspaceId !== workspaceId) {
        throw new ExecutionError(
          ExecutionErrorCodes.PERMISSION_DENIED,
          "Execution does not belong to this workspace",
          403
        );
      }
      return false; // Already finished, cannot cancel
    }
    return SandboxExecutor.cancel(executionId, userId, workspaceId);
  }

  /**
   * Injects a mock execution handler for tests.
   *
   * @param {Function | null} handler
   */
  static setMockHandler(handler) {
    mockExecutionHandler = handler;
  }
}
