import { NextRequest, NextResponse } from "next/server";
import type { TriageContext, TriageResponse } from "@/lib/types";
import { scorePayment } from "@/lib/rules";
import { validatePaymentInput } from "@/lib/validation";
import { explainRiskAssessment } from "@/lib/ai/triage";

// -----------------------------------------------------------------------
// IMPORTANT: Fraud risk scoring happens independently and deterministically
// on the server using src/lib/rules.ts.
//
// Client-provided scores are NEVER trusted or used: any 'score' field in the
// request body is strictly ignored. The server validates the inbound payment
// data, calculates the ground-truth score, and passes that server-computed
// verdict to the AI explanation layer.
// -----------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Support both { payment: Payment } and flat Payment objects in request body
  const rawPayment =
    body && typeof body === "object" && "payment" in body
      ? (body as Record<string, unknown>).payment
      : body;

  // Server-side validation of all transaction/payment fields
  const validation = validatePaymentInput(rawPayment);
  if (!validation.success) {
    return NextResponse.json(
      {
        error: "Validation failed for transaction data",
        details: validation.errors,
      },
      { status: 400 }
    );
  }

  const payment = validation.data;

  // -------------------------------------------------------------------------
  // DETERMINISTIC SERVER-SIDE RISK SCORING
  // Single source of truth: scorePayment(payment).
  // Any client-provided score field in the request payload is ignored.
  // -------------------------------------------------------------------------
  const serverScore = scorePayment(payment);

  const context: TriageContext = {
    payment: {
      amount: payment.amount,
      payeeName: payment.payeeName,
      memo: payment.memo,
      channel: payment.channel,
    },
    score: serverScore,
  };

  const triageResult = await explainRiskAssessment(context);
  const response: TriageResponse = { ...triageResult, score: serverScore };
  return NextResponse.json(response);
}

