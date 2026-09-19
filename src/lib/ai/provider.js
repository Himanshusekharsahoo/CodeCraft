/**
 * Base AIProvider interface for CodeCraft (Phase 8 MVP).
 * Abstract provider decouples the Agent Orchestrator from concrete model implementations.
 */

export class AIProvider {
  /**
   * Initializes a session or generates a response with tool execution support.
   *
   * @param {object} params
   * @param {string} params.systemInstruction
   * @param {Array<object>} params.tools - Declarations for registered tools
   * @param {Array<object>} params.history - Conversation history
   * @param {string|Array<object>} params.message - New user prompt or tool responses
   * @returns {Promise<{ text?: string, toolCalls?: Array<{ name: string, args: object }>, raw?: any }>}
   */
  async sendMessage(params) {
    throw new Error("sendMessage must be implemented by concrete AIProvider subclass");
  }

  /**
   * Verifies provider readiness (e.g. valid API key present).
   * @returns {{ ready: boolean, reason?: string }}
   */
  isConfigured() {
    return { ready: false, reason: "Not implemented" };
  }
}
