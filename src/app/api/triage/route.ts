import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { TriageContext, TriageResult } from "@/lib/types";
import { generateTemplateTriage } from "@/lib/template";

// -----------------------------------------------------------------------
// IMPORTANT: this route NEVER computes a fraud score. It receives a score
// that was already produced by the deterministic engine in src/lib/rules.ts,
// plus which rules fired, and its only job is to turn that verdict into a
// plain-English brief and a call script. If the request is missing a score,
// we reject it rather than let the model guess one.
// -----------------------------------------------------------------------

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";
const GEMINI_MODEL = "gemini-2.0-flash";

function buildPrompt(context: TriageContext): string {
  const { payment, score } = context;
  const rulesText =
    score.firedRules.length > 0
      ? score.firedRules.map((r) => `- ${r.label} (+${r.points}): ${r.detail}`).join("\n")
      : "- none, no risk signals fired";

  return `You are a fraud-operations assistant at an Indian payments platform. A deterministic rules engine has ALREADY scored a pending outbound payment and already decided the recommended action. Do not question, recompute, or contradict the score, band, typology, or recommended action - your only job is to explain the verdict clearly and produce a call script an analyst can read aloud.

VERDICT (already computed, treat as ground truth):
- Risk score: ${score.score}/100
- Risk band: ${score.band}
- Typology: ${score.typology}
- Recommended action: ${score.recommendedDecision}
- Fired rules:
${rulesText}

PAYMENT CONTEXT (for wording only):
- Amount: \u20b9${payment.amount.toLocaleString("en-IN")}
- Payee name: ${payment.payeeName}
- Channel: ${payment.channel}
- Memo/note: "${payment.memo}"

Respond with ONLY a JSON object (no markdown fences, no commentary) with exactly these fields:
{
  "brief": "2-3 sentence plain-English analyst brief explaining why this payment landed in this risk band, referencing the fired rules in plain language. Do not restate a hold/release/escalate instruction here - just explain the reasoning.",
  "callScript": ["An array of 1-4 short strings, each one line an analyst could read aloud to the customer in order, matched in tone to the risk band (firm and cautious for red, light-touch for green)."]
}`;
}

function parseModelJson(raw: string): { brief: string; callScript: string[] } | null {
  // Models sometimes wrap JSON in markdown fences despite instructions;
  // strip those defensively before parsing.
  const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "brief" in parsed &&
      "callScript" in parsed &&
      typeof (parsed as Record<string, unknown>).brief === "string" &&
      Array.isArray((parsed as Record<string, unknown>).callScript) &&
      (parsed as { callScript: unknown[] }).callScript.every((s) => typeof s === "string") &&
      (parsed as { callScript: unknown[] }).callScript.length > 0
    ) {
      return parsed as { brief: string; callScript: string[] };
    }
    return null;
  } catch {
    return null;
  }
}

async function tryAnthropic(context: TriageContext): Promise<TriageResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 400,
    messages: [{ role: "user", content: buildPrompt(context) }],
  });

  const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) return null;

  const parsed = parseModelJson(textBlock.text);
  if (!parsed) return null;

  return { ...parsed, source: "model" };
}

async function tryGemini(context: TriageContext): Promise<TriageResult | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  const result = await model.generateContent(buildPrompt(context));
  const text = result.response.text();

  const parsed = parseModelJson(text);
  if (!parsed) return null;

  return { ...parsed, source: "model" };
}

export async function POST(req: NextRequest) {
  let context: TriageContext;
  try {
    context = (await req.json()) as TriageContext;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!context?.score || typeof context.score.score !== "number") {
    return NextResponse.json(
      { error: "Missing pre-computed score. This route does not compute scores itself." },
      { status: 400 }
    );
  }

  // Primary: Anthropic (Claude). Falls through silently on any failure -
  // missing key, network error, rate limit, malformed response, etc.
  try {
    const result = await tryAnthropic(context);
    if (result) return NextResponse.json(result);
  } catch (err) {
    console.error("[triage] Anthropic call failed, falling back to Gemini:", err);
  }

  // Secondary: Gemini.
  try {
    const result = await tryGemini(context);
    if (result) return NextResponse.json(result);
  } catch (err) {
    console.error("[triage] Gemini call failed, falling back to template:", err);
  }

  // Final fallback: deterministic template. Always succeeds, never throws -
  // this is what makes PreSend fully functional with zero API keys.
  return NextResponse.json(generateTemplateTriage(context));
}
