/**
 * Helper utilities for AI Agent UI state rendering and phase formatting.
 */

/**
 * Formats raw agent status states into human-friendly descriptive phase messages.
 *
 * @param {string} status - Raw status string (e.g. PLANNING, INSPECTING, TESTING, etc.)
 * @param {number} [iterations=0] - Current repair iteration
 * @returns {string} Human-friendly phase description
 */
export function formatAgentPhase(status, iterations = 0) {
  switch (status) {
    case "IDLE":
      return "Idle";
    case "PLANNING":
      return "Understanding request";
    case "INSPECTING":
      return "Inspecting files";
    case "EDITING":
      return "Preparing changes";
    case "MODIFYING":
      return "Applying Code Edits...";
    case "EXECUTING":
      return "Running code";
    case "TESTING":
      return iterations > 0 ? "Rerunning tests" : "Running tests";
    case "RUNNING_TESTS":
      return "Running Validation Tests...";
    case "ANALYZING":
      return iterations > 0 ? "Analyzing failure" : "Analyzing Workspace...";
    case "FIXING":
      return "Fixing issue";
    case "COMPLETED":
      return "Completed";
    case "SUCCESS":
      return "Task Completed Successfully";
    case "FAILED":
      return "Task Failed or Incomplete";
    case "CANCELLED":
      return "Cancelled";
    case "TIMED_OUT":
      return "Timed out";
    default:
      return status || "Ready";
  }
}
