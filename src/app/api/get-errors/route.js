import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/serverAuth";
import { GeminiProvider } from "@/lib/ai/geminiProvider";
import { redactSecrets } from "@/lib/ai/secretRedaction";
import { wrapUntrustedData } from "@/lib/ai/promptInjectionDefense";
import { checkAIRateLimit } from "@/lib/ai/aiRateLimiter";
import { verifyAIWorkspaceAccess } from "@/lib/ai/aiWorkspaceAuth";

export async function POST(request) {
  try {
    const { auth, response } = await requireAuth(request);
    if (response) return response;

    const body = await request.json().catch(() => null);
    if (!body || !body.code || typeof body.code !== "string") {
      return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }

    // CC-011: Enforce workspace authorization (contributor role required for syntax auto-fix)
    const workspaceId = body.workspaceId || body.context?.workspaceId || request.headers.get("x-workspace-id");
    const authz = await verifyAIWorkspaceAccess(request, auth, workspaceId, "contributor");
    if (!authz.authorized) {
      return NextResponse.json({ error: authz.error }, { status: authz.status || 403 });
    }

    // CC-011: Enforce rate limiting per user
    const rateCheck = checkAIRateLimit(auth.uid, 20);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds || 60) } }
      );
    }

    const { code, language, codeLanguage } = body;
    const targetLanguage = language || codeLanguage || "code";

    const provider = new GeminiProvider();
    const configCheck = provider.isConfigured();
    if (!configCheck.ready) {
      return NextResponse.json({ error: "AI service is currently unavailable" }, { status: 503 });
    }

    const sanitizedCode = redactSecrets(code).slice(0, 12000);
    const guardedCode = wrapUntrustedData(sanitizedCode, `input-${targetLanguage}-source`);

    const systemInstruction = `You are an expert ${targetLanguage} compiler and linter. Fix all syntax, logic, and runtime errors in the user's code. Return ONLY the raw executable corrected code. Do NOT enclose in markdown triple backticks. Do NOT add conversational introductory or concluding text. Preserve existing comments and code formatting.`;
    const prompt = `Fix the errors in this ${targetLanguage} code:\n\n${guardedCode}`;

    const res = await provider.sendMessage({
      systemInstruction,
      message: prompt,
    });

    let fixedCode = (res.text || "").trim();
    fixedCode = fixedCode.replace(/^```[a-zA-Z]*\n?|```$/gm, "").trim();

    if (fixedCode) {
      return NextResponse.json({ fixedCode, aiFixed: true }, { status: 200 });
    }

    return NextResponse.json({ error: "Failed to fix code syntax" }, { status: 422 });
  } catch (error) {
    console.error("AI Error Auto-Fix Error:", error.message);
    const status = error.statusCode || error.status || 500;
    const headers = {};
    if (status === 429 && error.retryAfterSeconds) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return NextResponse.json(
      { error: error.message || "Failed to process request" },
      { status, headers }
    );
  }
}
