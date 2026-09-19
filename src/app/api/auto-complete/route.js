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

    // CC-011: Enforce workspace authorization
    const workspaceId = body.workspaceId || body.context?.workspaceId || request.headers.get("x-workspace-id");
    const authz = await verifyAIWorkspaceAccess(request, auth, workspaceId, "viewer");
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

    const { code, language } = body;
    const targetLanguage = language || "javascript";

    const provider = new GeminiProvider();
    const configCheck = provider.isConfigured();
    if (!configCheck.ready) {
      return NextResponse.json({ error: "AI service is currently unavailable" }, { status: 503 });
    }

    const sanitizedCode = redactSecrets(code).slice(0, 12000);
    const guardedCode = wrapUntrustedData(sanitizedCode, `input-${targetLanguage}-snippet`);

    const systemInstruction = `You are an AI code completion engine for ${targetLanguage}. Suggest the next logical block of code or documentation comments based on the provided code snippet. Return only the suggested snippet without conversational text.`;
    const prompt = `Complete or document the following ${targetLanguage} code:\n\n${guardedCode}`;

    const res = await provider.sendMessage({
      systemInstruction,
      message: prompt,
    });

    let documentation = (res.text || "").trim();
    documentation = documentation.replace(/^```[a-zA-Z]*\n?|```$/gm, "").trim();

    return NextResponse.json({ documentation }, { status: 200 });
  } catch (error) {
    console.error("Auto-complete API Error:", error.message);
    const status = error.statusCode || error.status || 500;
    return NextResponse.json({ error: "Failed to generate completion" }, { status });
  }
}
