import { NextRequest, NextResponse } from "next/server";
import type {
  CreateTransactionResponse,
  GetTransactionsResponse,
  QueueItem,
  TransactionStatus,
  TriageContext,
} from "@/lib/types";
import { scorePayment } from "@/lib/rules";
import { SEED_PAYMENTS } from "@/lib/seed";
import { sortQueueByRisk } from "@/lib/queue";
import { validateCreateTransactionInput } from "@/lib/validation";
import { explainRiskAssessment } from "@/lib/ai/triage";
import { isDatabaseConfigured } from "@/lib/db/client";
import {
  createAuditLog,
  createRiskAssessment,
  createTransaction,
  listTransactionsWithDetails,
} from "@/lib/db/repository";
import { paymentToDbInsert, scoreResultToDbInsert } from "@/lib/db/types";

// -----------------------------------------------------------------------------
// Dedicated Transaction Creation Endpoint: POST /api/transactions
// -----------------------------------------------------------------------------
// WORKFLOW:
// 1. Parse inbound request body (supports flat payload or nested { transaction } / { payment })
// 2. Validate all transaction fields server-side with domain boundaries (amount > 0, etc.)
// 3. Reject invalid or malformed requests with 400 Bad Request
// 4. ANTI-TAMPERING: Discard any client-submitted risk score. Compute score
//    independently and deterministically via scorePayment(payment).
// 5. If Supabase is configured:
//    - Persist transaction record (status = "pending")
//    - Persist server-computed risk assessment record
//    - Append audit log entry (TRANSACTION_CREATED)
// 6. Generate AI explanation via Claude -> Gemini -> Template fallback pipeline.
//    (AI failure never rolls back or aborts transaction/risk persistence)
// 7. Return 201 Created with transaction, ground-truth score, and AI triage
// -----------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Support { transaction: ... }, { payment: ... }, or flat transaction object
  const rawTx =
    body && typeof body === "object"
      ? "transaction" in body && body.transaction
        ? (body as Record<string, unknown>).transaction
        : "payment" in body && body.payment
        ? (body as Record<string, unknown>).payment
        : body
      : body;

  // Server-side validation
  const validation = validateCreateTransactionInput(rawTx);
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

  // ---------------------------------------------------------------------------
  // DETERMINISTIC SERVER-SIDE RISK SCORING (AUTHORITATIVE)
  // Any client-provided score field in the request payload is strictly ignored.
  // ---------------------------------------------------------------------------
  const serverScore = scorePayment(payment);

  // ---------------------------------------------------------------------------
  // DATABASE PERSISTENCE (SUPABASE)
  // ---------------------------------------------------------------------------
  let dbTransactionId: string | undefined;
  let assessmentId: string | undefined;

  if (isDatabaseConfigured()) {
    try {
      const insertTx = paymentToDbInsert(payment, "pending");
      const dbTx = await createTransaction(insertTx);
      dbTransactionId = dbTx.id;

      const insertAssessment = scoreResultToDbInsert(dbTx.id, serverScore);
      const dbAssessment = await createRiskAssessment(insertAssessment);
      assessmentId = dbAssessment.id;

      // Immutable audit log
      await createAuditLog({
        transaction_id: dbTx.id,
        event_type: "TRANSACTION_CREATED",
        actor: payment.initiatedBy || "system:web-console",
        details: {
          referenceId: payment.id,
          merchant: payment.merchant,
          amount: payment.amount,
          channel: payment.channel,
          score: serverScore.score,
          band: serverScore.band,
          typology: serverScore.typology,
          firedRuleCount: serverScore.firedRules.length,
        },
      });
    } catch (dbErr) {
      console.error("[transactions] Supabase persistence error:", dbErr);
      return NextResponse.json(
        {
          error: "Database error while persisting transaction",
          details: dbErr instanceof Error ? dbErr.message : "Unknown database error",
        },
        { status: 500 }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // AI EXPLANATION PIPELINE
  // LLM receives the SERVER-CALCULATED risk assessment.
  // Resilient fallback: Claude -> Gemini -> deterministic template.
  // ---------------------------------------------------------------------------
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

  const response: CreateTransactionResponse = {
    transaction: payment,
    score: serverScore,
    triage: triageResult,
    dbTransactionId,
    assessmentId,
  };

  return NextResponse.json(response, { status: 201 });
}

// -----------------------------------------------------------------------------
// Transaction Retrieval Endpoint: GET /api/transactions
// -----------------------------------------------------------------------------
// WORKFLOW:
// 1. Check if database is configured.
//    - If not configured: return SEED_PAYMENTS mapped into domain QueueItem entities.
// 2. If configured:
//    - Fetch transactions from Supabase joined with their latest risk assessments
//      and analyst decisions via listTransactionsWithDetails.
//    - Deterministically sort queue items by risk score (descending).
//    - Never expose service role key or internal credentials to the browser.
// 3. Handle errors gracefully: return 500 with error details if database fails.
// -----------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // Offline / Demo fallback when Supabase is not configured
  if (!isDatabaseConfigured()) {
    const seedItems: QueueItem[] = SEED_PAYMENTS.map((payment) => ({
      payment,
      score: scorePayment(payment),
      decision: null,
      status: "pending" as TransactionStatus,
    }));

    const sortedSeedItems = sortQueueByRisk(seedItems);

    const response: GetTransactionsResponse = {
      transactions: sortedSeedItems,
      total: sortedSeedItems.length,
      source: "seed",
    };
    return NextResponse.json(response, { status: 200 });
  }

  // Authoritative database retrieval from Supabase
  try {
    const url = req.nextUrl;
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");
    const statusParam = url.searchParams.get("status");

    const limit = limitParam
      ? Math.min(Math.max(1, parseInt(limitParam, 10) || 100), 200)
      : 100;
    const offset = offsetParam
      ? Math.max(0, parseInt(offsetParam, 10) || 0)
      : undefined;
    const status = statusParam ? (statusParam as TransactionStatus) : undefined;

    const items = await listTransactionsWithDetails({
      limit,
      offset,
      status,
    });

    const sortedItems = sortQueueByRisk(items);

    const response: GetTransactionsResponse = {
      transactions: sortedItems,
      total: sortedItems.length,
      source: "database",
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[transactions] Failed to retrieve transactions from database:", err);
    return NextResponse.json(
      {
        error: "Failed to retrieve transactions from database",
        details: err instanceof Error ? err.message : "Database unavailable",
      },
      { status: 500 }
    );
  }
}
