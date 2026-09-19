import { ExecutionError, ExecutionErrorCodes } from "./errors.js";
import { EXECUTION_LIMITS } from "./limits.js";

// Map tracking recent execution timestamps per userId: userId => Array<number>
const requestTimestamps = new Map();

// Map tracking active concurrent execution count per userId: userId => number
const activeUserExecutions = new Map();

// Global active execution counter
let activeGlobalExecutions = 0;

/**
 * Checks and acquires a concurrency and rate limit slot for a user.
 * Throws ExecutionError if limits are exceeded.
 *
 * @param {string} userId
 */
export function acquireExecutionSlot(userId) {
  const uid = userId || "anonymous";
  const now = Date.now();

  // 1. Rate Limiting (sliding window)
  const windowStart = now - EXECUTION_LIMITS.RATE_LIMIT_WINDOW_MS;
  let timestamps = requestTimestamps.get(uid) || [];
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= EXECUTION_LIMITS.RATE_LIMIT_PER_USER) {
    throw new ExecutionError(
      ExecutionErrorCodes.RATE_LIMIT_EXCEEDED,
      `Rate limit exceeded: maximum ${EXECUTION_LIMITS.RATE_LIMIT_PER_USER} executions per minute`,
      429
    );
  }

  // 2. Concurrency Limiting (per-user)
  const userActive = activeUserExecutions.get(uid) || 0;
  if (userActive >= EXECUTION_LIMITS.MAX_CONCURRENT_PER_USER) {
    throw new ExecutionError(
      ExecutionErrorCodes.CONCURRENCY_LIMIT_EXCEEDED,
      `Concurrency limit exceeded: maximum ${EXECUTION_LIMITS.MAX_CONCURRENT_PER_USER} concurrent executions per user`,
      429
    );
  }

  // 3. Concurrency Limiting (global)
  if (activeGlobalExecutions >= EXECUTION_LIMITS.MAX_CONCURRENT_GLOBAL) {
    throw new ExecutionError(
      ExecutionErrorCodes.CONCURRENCY_LIMIT_EXCEEDED,
      "Server execution queue is currently at maximum capacity. Please retry shortly.",
      429
    );
  }

  // Record slot
  timestamps.push(now);
  requestTimestamps.set(uid, timestamps);
  activeUserExecutions.set(uid, userActive + 1);
  activeGlobalExecutions += 1;
}

/**
 * Releases active concurrency slots upon execution completion or error.
 *
 * @param {string} userId
 */
export function releaseExecutionSlot(userId) {
  const uid = userId || "anonymous";
  const userActive = activeUserExecutions.get(uid) || 0;
  if (userActive > 0) {
    activeUserExecutions.set(uid, userActive - 1);
  }
  if (activeGlobalExecutions > 0) {
    activeGlobalExecutions -= 1;
  }
}

/**
 * Resets all rate limiting and concurrency tracking state (for testing).
 */
export function resetRateLimiter() {
  requestTimestamps.clear();
  activeUserExecutions.clear();
  activeGlobalExecutions = 0;
}
