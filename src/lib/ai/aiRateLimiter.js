/**
 * In-memory sliding-window rate limiter for AI assistant endpoints (CC-011).
 */

const userTimestamps = new Map();
const DEFAULT_MAX_REQUESTS = 20;
const DEFAULT_WINDOW_MS = 60000; // 1 minute

export function checkAIRateLimit(userId, maxRequests = DEFAULT_MAX_REQUESTS, windowMs = DEFAULT_WINDOW_MS) {
  const uid = userId || "anonymous";
  const now = Date.now();
  const windowStart = now - windowMs;

  let timestamps = userTimestamps.get(uid) || [];
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((timestamps[0] + windowMs - now) / 1000),
      limit: maxRequests,
    };
  }

  timestamps.push(now);
  userTimestamps.set(uid, timestamps);

  return {
    allowed: true,
    remaining: maxRequests - timestamps.length,
    limit: maxRequests,
  };
}

export function resetAIRateLimiter() {
  userTimestamps.clear();
}
