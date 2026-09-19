import { GoogleGenerativeAI } from "@google/generative-ai";
import { AIProvider } from "./provider.js";
import { AIConfig } from "./config.js";
import { AgentError, AgentErrorCodes } from "./agentErrors.js";
import { isExplicitTestEnvironment } from "../authEnv.js";

function redactGeminiSecrets(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/AIza[0-9A-Za-z\-_]{35}/g, "[REDACTED]")
    .replace(/AQ[A-Za-z0-9\-_]{20,}/g, "[REDACTED]")
    .replace(/([?&](?:key|api_key)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]+/gi, "$1[REDACTED]");
}

let mockProviderHandler = null;

export class GeminiProvider extends AIProvider {
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey !== undefined ? options.apiKey : AIConfig.apiKey;
    this.modelName = options.model || AIConfig.model;
    this.temperature = options.temperature ?? AIConfig.generation.temperature;
    this.maxOutputTokens = options.maxOutputTokens || AIConfig.generation.maxOutputTokens;
    this.timeoutMs = options.requestTimeoutMs || AIConfig.generation.requestTimeoutMs;
    this.allowTestFallback = Boolean(options.allowTestFallback);
  }

  /**
   * Allows injecting a mock provider for deterministic tests without network calls.
   *
   * @param {Function|null} handler
   */
  static setMockHandler(handler) {
    mockProviderHandler = handler;
  }

  static getMockHandler() {
    return mockProviderHandler;
  }

  /**
   * Checks whether Gemini provider is configured with an API key.
   *
   * @returns {{ ready: boolean, reason?: string }}
   */
  isConfigured() {
    if (mockProviderHandler) {
      return { ready: true };
    }
    if (!this.apiKey || typeof this.apiKey !== "string" || !this.apiKey.trim()) {
      return {
        ready: false,
        reason: "GEMINI_API_KEY is not configured on the server",
      };
    }
    return { ready: true };
  }

  /**
   * Normalizes unknown errors from Gemini API into standard AgentError codes.
   *
   * @param {Error} error
   * @returns {AgentError}
   */
  normalizeError(error) {
    if (error instanceof AgentError) {
      return error;
    }

    const rawMsg = error?.message || String(error);
    const safeMsg = redactGeminiSecrets(rawMsg);
    const lower = safeMsg.toLowerCase();

    // Extract HTTP status code if available
    const explicitStatus =
      error?.status ||
      error?.statusCode ||
      error?.response?.status ||
      null;

    let status = explicitStatus ? parseInt(explicitStatus, 10) : null;
    if (!status) {
      const match = rawMsg.match(/\[(\d{3})\s+[^\]]*\]/) || rawMsg.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/);
      if (match) {
        status = parseInt(match[1], 10);
      }
    }

    // 1. Authentication / Authorization / Invalid API Key (401, 403)
    if (
      status === 401 ||
      status === 403 ||
      lower.includes("api_key") ||
      lower.includes("api key not valid") ||
      lower.includes("api_key_invalid") ||
      lower.includes("unauthenticated") ||
      lower.includes("permission_denied") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden") ||
      lower.includes("caller does not have permission")
    ) {
      return new AgentError(
        AgentErrorCodes.AI_PROVIDER_NOT_CONFIGURED,
        "Gemini API key is invalid or not authorized",
        status === 403 ? 403 : 401
      );
    }

    // 2. Rate Limit & Quota Exceeded (429)
    if (
      status === 429 ||
      lower.includes("resource has been exhausted") ||
      lower.includes("resource_exhausted") ||
      lower.includes("rate limit") ||
      (lower.includes("quota") && (lower.includes("exceeded") || lower.includes("exhausted") || lower.includes("check quota")))
    ) {
      return new AgentError(
        AgentErrorCodes.AI_RATE_LIMITED,
        "Gemini rate limit or quota exceeded. Please wait a moment before trying again.",
        429
      );
    }

    // 3. Model Not Found / Unsupported Model (404)
    if (
      status === 404 ||
      lower.includes("not found") ||
      lower.includes("is not supported for generatecontent") ||
      lower.includes("model not found")
    ) {
      return new AgentError(
        AgentErrorCodes.MODEL_ERROR,
        "The configured Gemini model is invalid or not found. Please verify GEMINI_MODEL.",
        404
      );
    }

    // 4. Context & Token Length Limit Exceeded (400)
    if (lower.includes("context") || lower.includes("token limit") || lower.includes("maximum context length")) {
      return new AgentError(
        AgentErrorCodes.CONTEXT_LIMIT_EXCEEDED,
        "Prompt exceeded the maximum context limit for the model",
        400
      );
    }

    // 5. Invalid Tool Call (400)
    if (lower.includes("invalid tool") || lower.includes("function call")) {
      return new AgentError(
        AgentErrorCodes.INVALID_TOOL_CALL,
        `Model generated an invalid tool call: ${safeMsg}`,
        400
      );
    }

    // 6. Malformed Request / Invalid Argument (400)
    if (
      status === 400 ||
      lower.includes("invalid argument") ||
      lower.includes("invalid_argument") ||
      lower.includes("bad request") ||
      lower.includes("malformed")
    ) {
      return new AgentError(
        AgentErrorCodes.AGENT_INVALID_REQUEST,
        "The request sent to Gemini was malformed or contains invalid arguments.",
        400
      );
    }

    // 7. Network Connectivity / Timeouts (504, 408)
    if (
      status === 504 ||
      status === 408 ||
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      lower.includes("etimedout") ||
      lower.includes("econnreset") ||
      lower.includes("econnrefused") ||
      lower.includes("fetch failed") ||
      lower.includes("deadline exceeded") ||
      lower.includes("deadline_exceeded") ||
      lower.includes("aborterror")
    ) {
      return new AgentError(
        AgentErrorCodes.AI_PROVIDER_TIMEOUT,
        "Gemini request timed out while generating response",
        status === 408 ? 408 : 504
      );
    }

    // 8. Service Unavailable / High Demand (503)
    if (
      status === 503 ||
      lower.includes("503") ||
      lower.includes("service unavailable") ||
      lower.includes("high demand") ||
      lower.includes("overloaded")
    ) {
      return new AgentError(
        AgentErrorCodes.MODEL_ERROR,
        "Gemini service is currently unavailable or experiencing high demand.",
        503
      );
    }

    // 9. Generic Model or Server Error (500 / 502)
    return new AgentError(
      AgentErrorCodes.MODEL_ERROR,
      `Gemini model error: ${safeMsg}`,
      status && status >= 500 && status < 600 ? status : 502
    );
  }

  /**
   * Executes a call with bounded retries for transient failures.
   *
   * @param {Function} fn
   * @param {number} maxRetries
   * @returns {Promise<any>}
   */
  async withRetry(fn, maxRetries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const normalized = this.normalizeError(err);
        // Only transient server timeouts/outages (503, 504) are eligible for fast retry.
        // Rate-limits and quota exhaustion (429) must fail immediately without rapid retry loops.
        const isTransient =
          normalized.code === AgentErrorCodes.AI_PROVIDER_TIMEOUT ||
          normalized.status === 503 ||
          normalized.status === 504;

        if (!isTransient || attempt === maxRetries) {
          throw normalized;
        }

        // Exponential backoff: 500ms, 1000ms
        const delay = 500 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw this.normalizeError(lastError);
  }

  /**
   * Sends prompt and tool results to Gemini, handling function calling responses.
   *
   * @param {object} params
   * @param {string} params.systemInstruction
   * @param {Array<object>} params.tools
   * @param {Array<object>} [params.history]
   * @param {string|Array<object>} params.message
   * @returns {Promise<{ text: string, toolCalls: Array<{ name: string, args: object }>, raw: any }>}
   */
  async sendMessage({ systemInstruction, tools = [], history = [], message }) {
    if (isExplicitTestEnvironment()) {
      if (mockProviderHandler) {
        return await mockProviderHandler({ systemInstruction, tools, history, message });
      }

      if (this.allowTestFallback || process.env.AGENT_TEST_MOCK === "true") {
        return this.generateDeterministicTestResponse({ history, message });
      }
    }

    const check = this.isConfigured();
    if (!check.ready) {
      throw new AgentError(
        AgentErrorCodes.AI_PROVIDER_NOT_CONFIGURED,
        check.reason || "Gemini API key is not configured on the server",
        503
      );
    }

    return await this.withRetry(async () => {
      const genAI = new GoogleGenerativeAI(this.apiKey);

      // Convert tool declarations into Gemini functionDeclarations
      const geminiTools = [];
      if (Array.isArray(tools) && tools.length > 0) {
        const functionDeclarations = tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters || { type: "OBJECT", properties: {} },
        }));
        geminiTools.push({ functionDeclarations });
      }

      const model = genAI.getGenerativeModel({
        model: this.modelName,
        systemInstruction,
        tools: geminiTools.length > 0 ? geminiTools : undefined,
        generationConfig: {
          temperature: this.temperature,
          maxOutputTokens: this.maxOutputTokens,
        },
      });

      // Prepare chat history in Gemini format
      const formattedHistory = (history || []).map((entry) => ({
        role: entry.role === "assistant" || entry.role === "model" ? "model" : "user",
        parts: Array.isArray(entry.parts)
          ? entry.parts
          : [{ text: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content) }],
      }));

      // Execute request with timeout
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new AgentError(AgentErrorCodes.AI_PROVIDER_TIMEOUT, "Gemini request timed out", 504));
        }, this.timeoutMs);
      });

      try {
        const sendPromise = (async () => {
          let messageParts = [];
          if (typeof message === "string") {
            messageParts = [{ text: message }];
          } else if (Array.isArray(message)) {
            messageParts = message;
          } else if (message?.functionResponse) {
            messageParts = [{ functionResponse: message.functionResponse }];
          } else if (message) {
            messageParts = [{ text: JSON.stringify(message) }];
          }

          const contents = [...formattedHistory];
          if (messageParts.length > 0) {
            contents.push({
              role: "user",
              parts: messageParts,
            });
          }

          const result = await model.generateContent({ contents });
          const response = result.response;

          // Extract function calls if any
          const functionCalls = typeof response.functionCalls === "function" ? response.functionCalls() : [];
          const toolCalls = (functionCalls || []).map((fc) => ({
            name: fc.name,
            args: fc.args || {},
          }));

          let text = "";
          try {
            text = response.text() || "";
          } catch {
            // response.text() can throw if candidate has only function calls
          }

          return {
            text,
            toolCalls,
            candidateParts: response.candidates?.[0]?.content?.parts || null,
            raw: response,
          };
        })();

        return await Promise.race([sendPromise, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    });
  }

  /**
   * Deterministic mock response generator for offline and CI E2E test runs.
   */
  generateDeterministicTestResponse({ history = [], message }) {
    if (Array.isArray(message) && message.some((m) => m?.functionResponse)) {
      const resp = message.find((m) => m?.functionResponse)?.functionResponse;
      const toolName = resp?.name;

      if (toolName === "search_code" || toolName === "list_files" || toolName === "read_file") {
        return {
          toolCalls: [
            {
              name: "apply_patch",
              args: {
                file: "main.js",
                expectedOldContent: "export function run()",
                patch: "// Patched by CodeCraft AI Coding Agent\nexport function run()",
              },
            },
          ],
        };
      }

      if (toolName === "apply_patch") {
        return {
          toolCalls: [
            {
              name: "get_git_diff",
              args: {},
            },
          ],
        };
      }

      if (toolName === "get_git_diff") {
        return {
          text: "Task completed: inspected repository, applied verified code change to main.js, and reviewed Git diff.",
          toolCalls: [],
        };
      }
    }

    const msgStr = typeof message === "string" ? message : JSON.stringify(message);
    if (
      msgStr.toLowerCase().includes("find") ||
      msgStr.toLowerCase().includes("search") ||
      msgStr.toLowerCase().includes("fix") ||
      msgStr.toLowerCase().includes("main.js")
    ) {
      return {
        toolCalls: [
          {
            name: "search_code",
            args: { query: "main" },
          },
        ],
      };
    }

    return {
      toolCalls: [
        {
          name: "list_files",
          args: {},
        },
      ],
    };
  }
}
