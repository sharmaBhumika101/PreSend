import { NextRequest, NextResponse } from "next/server";
import { validateDecisionInput } from "@/lib/validation";
import { isDatabaseConfigured } from "@/lib/db/client";
import {
  createRiskAssessment,
  createTransaction,
  getLatestRiskAssessment,
  getTransactionById,
  getTransactionByReferenceId,
  submitAnalystDecision,
} from "@/lib/db/repository";
import {
  dbTransactionToPayment,
  paymentToDbInsert,
  scoreResultToDbInsert,
} from "@/lib/db/types";
import { SEED_PAYMENTS } from "@/lib/seed";
import { scorePayment } from "@/lib/rules";
import type { DecisionResponse, RiskBand, Typology } from "@/lib/types";

// -----------------------------------------------------------------------------
// Dedicated Analyst Decision Endpoint: POST /api/decisions
// -----------------------------------------------------------------------------
// WORKFLOW:
// 1. Parse inbound request body
// 2. Validate decision ("release" | "hold" | "escalate") and require concise non-empty reason
// 3. SECURITY: Never trust client-provided scores, bands, or typologies.
// 4. Retrieve authoritative transaction and risk assessment from Supabase/server.
// 5. Persist decision record in `analyst_decisions`.
// 6. Persist immutable audit log entry in `audit_logs` with authoritative risk data.
// 7. Return 200 with persisted decision and audit details.
// -----------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateDecisionInput(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        error: "Validation failed for decision data",
        details: validation.errors,
      },
      { status: 400 }
    );
  }

  const { transactionId, decision, reason, analystId } = validation.data;

  // Graceful offline demo fallback if Supabase is unconfigured in the current environment
  if (!isDatabaseConfigured()) {
    const seed = SEED_PAYMENTS.find((p) => p.id === transactionId);
    if (!seed) {
      return NextResponse.json(
        { error: `Transaction with ID '${transactionId}' not found` },
        { status: 404 }
      );
    }

    const scoreResult = scorePayment(seed);

    const simulatedResponse: DecisionResponse = {
      success: true,
      decision,
      reason,
      transactionId,
      status: decision === "hold" ? "held" : decision === "release" ? "released" : "escalated",
      auditLogId: `audit-offline-${Date.now()}`,
      score: scoreResult.score,
      band: scoreResult.band,
      typology: scoreResult.typology,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(simulatedResponse, { status: 200 });
  }

  try {
    // 1. Identify transaction by UUID or reference_id
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(transactionId);
    let dbTx = isUuid ? await getTransactionById(transactionId) : null;
    if (!dbTx) {
      dbTx = await getTransactionByReferenceId(transactionId);
    }

    // If transaction is from SEED_PAYMENTS and hasn't been seeded to DB yet, persist it now
    if (!dbTx) {
      const seed = SEED_PAYMENTS.find((p) => p.id === transactionId);
      if (seed) {
        dbTx = await createTransaction(paymentToDbInsert(seed, "pending"));
        const seedScore = scorePayment(seed);
        await createRiskAssessment(scoreResultToDbInsert(dbTx.id, seedScore));
      } else {
        return NextResponse.json(
          { error: `Transaction with ID '${transactionId}' not found` },
          { status: 404 }
        );
      }
    }

    // 2. Fetch authoritative risk assessment from database (single source of truth)
    let authoritativeScore: number;
    let authoritativeBand: RiskBand;
    let authoritativeTypology: Typology;

    const dbAssessment = await getLatestRiskAssessment(dbTx.id);
    if (dbAssessment) {
      authoritativeScore = dbAssessment.score;
      authoritativeBand = dbAssessment.risk_band;
      authoritativeTypology = dbAssessment.typology;
    } else {
      const computed = scorePayment(dbTransactionToPayment(dbTx));
      await createRiskAssessment(scoreResultToDbInsert(dbTx.id, computed));
      authoritativeScore = computed.score;
      authoritativeBand = computed.band;
      authoritativeTypology = computed.typology;
    }

    // 3. Persist decision in analyst_decisions & audit event in audit_logs
    const result = await submitAnalystDecision({
      transactionId: dbTx.id,
      decision,
      reason,
      analystId: analystId ?? "analyst-1",
      score: authoritativeScore,
      band: authoritativeBand,
      typology: authoritativeTypology,
      source: "analyst",
    });

    const response: DecisionResponse = {
      success: true,
      decision: result.decision.decision,
      reason: result.decision.reason ?? reason,
      transactionId: dbTx.reference_id ?? dbTx.id,
      dbTransactionId: dbTx.id,
      status: result.updatedTransaction.status,
      auditLogId: result.auditLog.id,
      score: authoritativeScore,
      band: authoritativeBand,
      typology: authoritativeTypology,
      timestamp: result.decision.created_at,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[decisions] Database error persisting decision:", err);
    return NextResponse.json(
      {
        error: "Database error while persisting decision",
        details: err instanceof Error ? err.message : "Unknown database error",
      },
      { status: 500 }
    );
  }
}
