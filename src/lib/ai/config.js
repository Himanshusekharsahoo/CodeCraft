/**
 * Centralized Gemini and AI Agent Configuration (Phase 8 MVP).
 *
 * Enforces server-only access to GEMINI_API_KEY, bounds context, limits iterations,
 * and sets deterministic generation settings for coding agent operations.
 */

export const AIConfig = {
  // Server-only credentials (NEVER expose to client)
  get apiKey() {
    return process.env.GEMINI_API_KEY || "";
  },

  // Central model selector (default: gemini-1.5-flash)
  get model() {
    return process.env.GEMINI_MODEL || "gemini-1.5-flash";
  },

  // Deterministic generation settings for coding tasks
  generation: {
    temperature: 0.1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 4096,
    requestTimeoutMs: 45000,
  },

  // Operational limits to guarantee safety and resource bounds
  limits: {
    maxIterations: 3, // Bounded self-repair loop limit
    maxToolCalls: 25, // Maximum total tool calls per agent run
    maxExecutionCalls: 5, // Maximum Docker code executions per run
    maxFilesModified: 10, // Maximum number of files touched in one run
    maxFileSize: 131072, // 128 KB max file size for reads/patches
    maxFilesToScan: 20, // Max files returned in listings
    maxSearchResults: 30, // Max search matches returned
    maxSearchSnippetLength: 300, // Max chars per search snippet
    maxTotalContextChars: 40000, // Total character ceiling for LLM prompt context
    maxPatchBytes: 131072, // 128 KB max single patch payload
    agentTimeoutMs: 90000, // 90 seconds overall agent timeout
    maxConcurrentRunsPerUser: 1, // Single active agent run per user
    rateLimitPerUser: 10, // Max 10 runs per user per 10 minutes
  },

  // Allowlisted sandboxed test targets (Host shell execution strictly prohibited!)
  allowedTests: [
    {
      name: "test:execution",
      description: "CodeCraft Phase 7 Execution & Sandbox Security Tests",
      language: "javascript",
    },
    {
      name: "test:git",
      description: "CodeCraft Phase 6 Git Engine & Version Control Tests",
      language: "javascript",
    },
    {
      name: "test:security",
      description: "CodeCraft Phase 5 Security, Auth & AI Context Tests",
      language: "javascript",
    },
    {
      name: "test:collab",
      description: "CodeCraft Phase 5 Yjs Collaboration Tests",
      language: "javascript",
    },
    {
      name: "test:workspace",
      description: "Workspace Sandboxed JavaScript/Node Test Suite",
      language: "javascript",
    },
    {
      name: "test:python",
      description: "Workspace Sandboxed Python Test Suite",
      language: "python",
    },
  ],
};
