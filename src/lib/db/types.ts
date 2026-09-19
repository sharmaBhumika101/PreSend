import type {
  Channel,
  Decision,
  FiredRule,
  Payment,
  RiskBand,
  ScoreResult,
  Typology,
} from "@/lib/types";

export type TransactionStatus = "pending" | "held" | "escalated" | "released";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type DbTransaction = {
  id: string;
  reference_id: string | null;
  merchant: string;
  amount: number;
  currency: string;
  payee_name: string;
  payee_age_days: number;
  memo: string;
  channel: Channel;
  device_is_new: boolean;
  transfers_in_24h: number;
  hour_of_day: number;
  initiated_by: string;
  status: TransactionStatus;
  created_at: string;
  updated_at: string;
};

export type InsertTransaction = {
  id?: string;
  reference_id?: string | null;
  merchant: string;
  amount: number;
  currency?: string;
  payee_name: string;
  payee_age_days: number;
  memo: string;
  channel: Channel;
  device_is_new: boolean;
  transfers_in_24h: number;
  hour_of_day: number;
  initiated_by: string;
  status?: TransactionStatus;
  created_at?: string;
  updated_at?: string;
};

export type UpdateTransaction = Partial<InsertTransaction>;

export type DbRiskAssessment = {
  id: string;
  transaction_id: string;
  score: number;
  risk_band: RiskBand;
  typology: Typology;
  fired_rules: FiredRule[];
  recommendation: Decision;
  created_at: string;
};

export type InsertRiskAssessment = {
  id?: string;
  transaction_id: string;
  score: number;
  risk_band: RiskBand;
  typology: Typology;
  fired_rules: FiredRule[];
  recommendation: Decision;
  created_at?: string;
};

export type UpdateRiskAssessment = Partial<InsertRiskAssessment>;

export type DbAnalystDecision = {
  id: string;
  transaction_id: string;
  decision: Decision;
  reason: string | null;
  analyst_id: string;
  created_at: string;
};

export type InsertAnalystDecision = {
  id?: string;
  transaction_id: string;
  decision: Decision;
  reason?: string | null;
  analyst_id?: string;
  created_at?: string;
};

export type UpdateAnalystDecision = Partial<InsertAnalystDecision>;

export type DbAuditLog = {
  id: string;
  transaction_id: string | null;
  event_type: string;
  actor: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type InsertAuditLog = {
  id?: string;
  transaction_id?: string | null;
  event_type: string;
  actor: string;
  details?: Record<string, unknown>;
  created_at?: string;
};

export type UpdateAuditLog = Partial<InsertAuditLog>;

// Database schema definition matching Supabase GenericSchema structure
export type Database = {
  public: {
    Tables: {
      transactions: {
        Row: DbTransaction;
        Insert: InsertTransaction;
        Update: UpdateTransaction;
        Relationships: [];
      };
      risk_assessments: {
        Row: DbRiskAssessment;
        Insert: InsertRiskAssessment;
        Update: UpdateRiskAssessment;
        Relationships: [
          {
            foreignKeyName: "risk_assessments_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      analyst_decisions: {
        Row: DbAnalystDecision;
        Insert: InsertAnalystDecision;
        Update: UpdateAnalystDecision;
        Relationships: [
          {
            foreignKeyName: "analyst_decisions_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: DbAuditLog;
        Insert: InsertAuditLog;
        Update: UpdateAuditLog;
        Relationships: [
          {
            foreignKeyName: "audit_logs_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
};

// -----------------------------------------------------------------------
// Domain <-> DB Mappers
// -----------------------------------------------------------------------

export function paymentToDbInsert(
  payment: Payment,
  status: TransactionStatus = "pending"
): InsertTransaction {
  return {
    reference_id: payment.id,
    merchant: payment.merchant,
    amount: payment.amount,
    currency: "INR",
    payee_name: payment.payeeName,
    payee_age_days: payment.payeeAgeDays,
    memo: payment.memo,
    channel: payment.channel,
    device_is_new: payment.deviceIsNew,
    transfers_in_24h: payment.transfersIn24h,
    hour_of_day: payment.hourOfDay,
    initiated_by: payment.initiatedBy,
    status,
  };
}

export function dbTransactionToPayment(dbTx: DbTransaction): Payment {
  return {
    id: dbTx.reference_id ?? dbTx.id,
    merchant: dbTx.merchant,
    amount: Number(dbTx.amount),
    payeeName: dbTx.payee_name,
    payeeAgeDays: dbTx.payee_age_days,
    memo: dbTx.memo,
    channel: dbTx.channel,
    deviceIsNew: dbTx.device_is_new,
    transfersIn24h: dbTx.transfers_in_24h,
    hourOfDay: dbTx.hour_of_day,
    initiatedBy: dbTx.initiated_by,
  };
}

export function scoreResultToDbInsert(
  transactionId: string,
  score: ScoreResult
): InsertRiskAssessment {
  return {
    transaction_id: transactionId,
    score: score.score,
    risk_band: score.band,
    typology: score.typology,
    fired_rules: score.firedRules,
    recommendation: score.recommendedDecision,
  };
}

export function dbRiskAssessmentToScoreResult(dbRisk: DbRiskAssessment): ScoreResult {
  return {
    score: dbRisk.score,
    band: dbRisk.risk_band,
    typology: dbRisk.typology,
    firedRules: dbRisk.fired_rules,
    recommendedDecision: dbRisk.recommendation,
  };
}
