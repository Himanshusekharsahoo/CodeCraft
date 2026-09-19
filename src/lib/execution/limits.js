/**
 * Centralized CodeCraft Execution Resource Quotas & Limits.
 * All limits are server-controlled; user requests cannot override these values.
 */
export const EXECUTION_LIMITS = {
  // Input limits
  MAX_SOURCE_BYTES: 256 * 1024, // 256 KB max source code size
  MAX_STDIN_BYTES: 64 * 1024,   // 64 KB max standard input
  MAX_FILES: 20,
  MAX_FILES_COUNT: 20,
  MAX_REQUESTS_PER_MINUTE: 20,                // 20 files maximum in multi-file execution
  MAX_TOTAL_FILE_BYTES: 512 * 1024, // 512 KB total across all files

  // Output limits
  MAX_OUTPUT_BYTES: 1024 * 1024, // 1 MB combined stdout/stderr ceiling

  // Container sandbox resource limits
  DEFAULT_TIMEOUT_MS: 8000,     // 8.0 seconds execution timeout
  MAX_TIMEOUT_MS: 15000,        // 15.0 seconds absolute hard limit
  COMPILE_TIMEOUT_MS: 10000,    // 10.0 seconds compilation timeout
  DEFAULT_MEMORY_MB: 256,       // 256 MB RAM limit
  MAX_MEMORY_MB: 512,           // 512 MB RAM hard limit
  DEFAULT_CPUS: "0.5",          // 0.5 CPU share
  MAX_PIDS: 64,                 // 64 processes maximum (fork bomb defense)

  // Abuse prevention and rate limits
  RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 minute window
  RATE_LIMIT_PER_USER: 20,         // 20 executions per minute per user
  MAX_CONCURRENT_PER_USER: 2,      // 2 simultaneous executions per user
  MAX_CONCURRENT_GLOBAL: 10,       // 10 simultaneous executions globally
};
