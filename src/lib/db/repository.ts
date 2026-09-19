import { getServiceSupabaseClient, isDatabaseConfigured } from "./client";
import type {
  DbAnalystDecision,
  DbAuditLog,
  DbRiskAssessment,
  DbTransaction,
  InsertAnalystDecision,
  InsertAuditLog,
  InsertRiskAssessment,
  InsertTransaction,
  TransactionStatus,
} from "./types";
import {
  dbRiskAssessmentToScoreResult,
  dbTransactionToPayment,
  paymentToDbInsert,
} from "./types";
import type { Decision, Payment, QueueItem, ScoreResult } from "@/lib/types";
import { scorePayment } from "@/lib/rules";

// =============================================================================
// TRANSACTIONS REPOSITORY
// =============================================================================

export async function createTransaction(tx: InsertTransaction): Promise<DbTransaction> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("transactions")
    .insert(tx)
    .select()
    .single();

  if (error) {
    throw new Error(`[PreSend DB] Failed to create transaction: ${error.message}`);
  }
  return data;
}

export async function getTransactionById(id: string): Promise<DbTransaction | null> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("transactions")
    .select()
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`[PreSend DB] Failed to fetch transaction by id ${id}: ${error.message}`);
  }
  return data;
}

export async function getTransactionByReferenceId(referenceId: string): Promise<DbTransaction | null> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("transactions")
    .select()
    .eq("reference_id", referenceId)
    .maybeSingle();

  if (error) {
    throw new Error(`[PreSend DB] Failed to fetch transaction by reference_id ${referenceId}: ${error.message}`);
  }
  return data;
}

export async function listTransactions(options?: {
  status?: TransactionStatus;
  limit?: number;
  offset?: number;
}): Promise<DbTransaction[]> {
  const supabase = getServiceSupabaseClient();
  let query = supabase
    .from("transactions")
    .select()
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }
  if (typeof options?.limit === "number") {
    query = query.limit(options.limit);
  }
  if (typeof options?.offset === "number") {
    query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`[PreSend DB] Failed to list transactions: ${error.message}`);
  }
  return data ?? [];
}

export async function updateTransactionStatus(
  id: string,
  status: TransactionStatus
): Promise<DbTransaction> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("transactions")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new Error(`[PreSend DB] Failed to update transaction status: ${error.message}`);
  }
  return data;
}

// =============================================================================
// RISK ASSESSMENTS REPOSITORY
// =============================================================================

export async function createRiskAssessment(
  assessment: InsertRiskAssessment
): Promise<DbRiskAssessment> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("risk_assessments")
    .insert(assessment)
    .select()
    .single();

  if (error) {
    throw new Error(`[PreSend DB] Failed to save risk assessment: ${error.message}`);
  }
  return data;
}

export async function getLatestRiskAssessment(
  transactionId: string
): Promise<DbRiskAssessment | null> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("risk_assessments")
    .select()
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`[PreSend DB] Failed to fetch latest risk assessment: ${error.message}`);
  }
  return data;
}

export async function listRiskAssessments(
  transactionId: string
): Promise<DbRiskAssessment[]> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("risk_assessments")
    .select()
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`[PreSend DB] Failed to list risk assessments: ${error.message}`);
  }
  return data ?? [];
}

// =============================================================================
// ANALYST DECISIONS REPOSITORY
// =============================================================================

export async function createAnalystDecision(
  decision: InsertAnalystDecision
): Promise<DbAnalystDecision> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("analyst_decisions")
    .insert(decision)
    .select()
    .single();

  if (error) {
    throw new Error(`[PreSend DB] Failed to record analyst decision: ${error.message}`);
  }
  return data;
}

export async function getDecisionsForTransaction(
  transactionId: string
): Promise<DbAnalystDecision[]> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("analyst_decisions")
    .select()
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`[PreSend DB] Failed to fetch decisions for transaction: ${error.message}`);
  }
  return data ?? [];
}

// =============================================================================
// AUDIT LOGS REPOSITORY
// =============================================================================

export async function createAuditLog(log: InsertAuditLog): Promise<DbAuditLog> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .insert(log)
    .select()
    .single();

  if (error) {
    throw new Error(`[PreSend DB] Failed to write audit log: ${error.message}`);
  }
  return data;
}

export async function getAuditLogsForTransaction(
  transactionId: string
): Promise<DbAuditLog[]> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select()
    .eq("transaction_id", transactionId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`[PreSend DB] Failed to get audit logs for transaction: ${error.message}`);
  }
  return data ?? [];
}

export async function listRecentAuditLogs(limit: number = 50): Promise<DbAuditLog[]> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select()
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`[PreSend DB] Failed to list audit logs: ${error.message}`);
  }
  return data ?? [];
}

// =============================================================================
// WORKFLOW / COMPOSITE HELPERS
// =============================================================================

function decisionToStatus(decision: Decision): TransactionStatus {
  switch (decision) {
    case "hold":
      return "held";
    case "release":
      return "released";
    case "escalate":
      return "escalated";
  }
}

/**
 * Executes an analyst decision workflow:
 * 1. Updates transaction status (pending -> held | released | escalated)
 * 2. Writes to analyst_decisions
 * 3. Records an immutable audit log entry
 */
export async function submitAnalystDecision(params: {
  transactionId: string;
  decision: Decision;
  reason?: string | null;
  analystId?: string;
  score: number;
  band: string;
  typology?: string;
  source: string;
}): Promise<{
  decision: DbAnalystDecision;
  updatedTransaction: DbTransaction;
  auditLog: DbAuditLog;
}> {
  const newStatus = decisionToStatus(params.decision);

  const updatedTransaction = await updateTransactionStatus(params.transactionId, newStatus);

  const recordedDecision = await createAnalystDecision({
    transaction_id: params.transactionId,
    decision: params.decision,
    reason: params.reason ?? null,
    analyst_id: params.analystId ?? "analyst-1",
  });

  const auditLog = await createAuditLog({
    transaction_id: params.transactionId,
    event_type: "ANALYST_DECISION_RECORDED",
    actor: params.analystId ?? "analyst:desk-01",
    details: {
      decision: params.decision,
      reason: params.reason ?? null,
      score: params.score,
      band: params.band,
      typology: params.typology ?? "unknown",
      triageSource: params.source,
      previousStatus: "pending",
      newStatus,
      timestamp: new Date().toISOString(),
    },
  });

  return {
    decision: recordedDecision,
    updatedTransaction,
    auditLog,
  };
}

/**
 * Seeds synthetic transactions into the database if the transactions table is currently empty.
 * Ensures initial zero-setup demo experience for local or preview setups connected to Supabase.
 */
export async function seedTransactionsIfEmpty(
  payments: Payment[]
): Promise<{ inserted: number; skipped: boolean }> {
  if (!isDatabaseConfigured()) {
    return { inserted: 0, skipped: true };
  }

  const supabase = getServiceSupabaseClient();
  const { count, error: countError } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true });

  if (countError) {
    throw new Error(`[PreSend DB] Failed to check transaction count: ${countError.message}`);
  }

  if ((count ?? 0) > 0) {
    return { inserted: 0, skipped: true };
  }

  const inserts: InsertTransaction[] = payments.map((p) => paymentToDbInsert(p));
  const { data, error: insertError } = await supabase
    .from("transactions")
    .insert(inserts)
    .select();

  if (insertError) {
    throw new Error(`[PreSend DB] Failed to seed transactions: ${insertError.message}`);
  }

  // Also log the seed event in audit_logs
  await createAuditLog({
    transaction_id: null,
    event_type: "SYSTEM_SEEDED",
    actor: "system:seeder",
    details: { count: data?.length ?? 0 },
  });

  return { inserted: data?.length ?? 0, skipped: false };
}

/**
 * Optional testing overrides for mocking repository calls in isolated unit tests.
 */
export const repositoryTestingOverrides: {
  listTransactionsWithDetails: ((options?: {
    status?: TransactionStatus;
    limit?: number;
    offset?: number;
  }) => Promise<QueueItem[]>) | null;
} = {
  listTransactionsWithDetails: null,
};

/**
 * Retrieves transactions from Supabase joined with their latest risk assessments
 * and analyst decisions, mapped cleanly into domain QueueItem entities.
 */
export async function listTransactionsWithDetails(options?: {
  status?: TransactionStatus;
  limit?: number;
  offset?: number;
}): Promise<QueueItem[]> {
  if (repositoryTestingOverrides.listTransactionsWithDetails) {
    return repositoryTestingOverrides.listTransactionsWithDetails(options);
  }

  const supabase = getServiceSupabaseClient();
  let query = supabase
    .from("transactions")
    .select(`
      *,
      risk_assessments (*),
      analyst_decisions (*)
    `)
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }
  const limit = options?.limit ?? 100;
  query = query.limit(limit);

  if (typeof options?.offset === "number" && options.offset > 0) {
    query = query.range(options.offset, options.offset + limit - 1);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`[PreSend DB] Failed to list transactions with details: ${error.message}`);
  }

  if (!data) return [];

  return (data as Array<DbTransaction & {
    risk_assessments?: DbRiskAssessment[];
    analyst_decisions?: DbAnalystDecision[];
  }>).map((row) => {
    const payment = dbTransactionToPayment(row);

    // Latest risk assessment
    const riskAssessments: DbRiskAssessment[] = row.risk_assessments ?? [];
    const latestAssessment = riskAssessments.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

    const scoreResult: ScoreResult = latestAssessment
      ? dbRiskAssessmentToScoreResult(latestAssessment)
      : scorePayment(payment);

    // Latest analyst decision
    const analystDecisions: DbAnalystDecision[] = row.analyst_decisions ?? [];
    const latestDecision = analystDecisions.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

    // Determine decision
    let decision: Decision | null = null;
    if (latestDecision) {
      decision = latestDecision.decision;
    } else if (row.status && row.status !== "pending") {
      decision =
        row.status === "held"
          ? "hold"
          : row.status === "released"
          ? "release"
          : row.status === "escalated"
          ? "escalate"
          : null;
    }

    return {
      payment,
      score: scoreResult,
      decision,
      status: row.status,
      decisionReason: latestDecision?.reason ?? null,
      dbId: row.id,
      createdAt: row.created_at,
    };
  });
}
