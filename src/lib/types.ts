// Core domain types for PreSend.
// Kept dependency-free so both the rules engine and the LLM route can import
// them without pulling in React or Next.js types.

export type Channel = "UPI" | "Bank Transfer";

export interface Payment {
  id: string;
  merchant: string;
  amount: number; // in INR
  payeeName: string;
  payeeAgeDays: number; // how long this payee has been known to the merchant
  memo: string;
  channel: Channel;
  deviceIsNew: boolean;
  transfersIn24h: number;
  hourOfDay: number; // 0-23, local time the payment was initiated
  initiatedBy: string; // which internal account/desk on the merchant side sent it
}

export type RiskBand = "green" | "amber" | "red";

export type Typology =
  | "impersonation scam"
  | "mule pattern"
  | "benign"
  | "unclear";

export type StaticRuleId =
  | "new_payee"
  | "fraud_keyword"
  | "high_amount"
  | "new_device"
  | "velocity"
  | "off_hours";

export type BehavioralRuleId =
  | "amount_spike"
  | "velocity_spike"
  | "unseen_payee_for_account"
  | "unusual_timing"
  | "unusual_channel";

export type RuleId = StaticRuleId | BehavioralRuleId;

export interface FiredRule {
  id: RuleId;
  label: string;
  points: number;
  detail: string;
  category?: "static" | "behavioral";
}

/**
 * Baseline statistics for a synthetic/demo account identity (merchant, initiatedBy).
 *
 * NOTE on Account Identity & Contextual Velocity:
 * 1. Treat (merchant, initiatedBy) explicitly as a synthetic/demo account identity,
 *    not a real PII customer identity. In a production payments platform, this would
 *    map to a verified merchant account ID, virtual account number (VAN), or client credential.
 * 2. 'avgContextualTransfersIn24h' represents the baseline average of the contextual
 *    'transfersIn24h' field reported on inbound payment payloads for this demo account.
 *    It is distinct from a true database-derived transaction frequency (counting persisted
 *    records within a 24h window).
 */
export interface CustomerBaseline {
  merchant: string;
  initiatedBy: string;
  scope: "account" | "merchant";
  sampleSize: number;
  medianAmount: number;
  meanAmount: number;
  avgTransfersIn24h: number; // Alias for backward compatibility
  avgContextualTransfersIn24h: number; // Explicit naming distinguishing contextual velocity
  typicalHourRange: { min: number; max: number };
  knownPayees: string[];
  knownChannels: Channel[];
  hasSufficientData: boolean;
}

export interface BehavioralAnomaly {
  id: BehavioralRuleId;
  label: string;
  points: number;
  detail: string;
  baselineMetric: string;
  observedValue: string;
}

export interface BehavioralAssessment {
  score: number; // Sum of behavioral anomaly points, capped at 50
  anomalies: BehavioralAnomaly[];
  baseline: CustomerBaseline;
  status: "evaluated" | "insufficient_data";
}

export type Decision = "hold" | "release" | "escalate";

export interface ScoreResult {
  score: number; // 0-100, authoritative composite score
  band: RiskBand;
  typology: Typology;
  firedRules: FiredRule[];
  /** Deterministic default action for this band. The analyst can always
   * override it — this is a suggestion, never an automatic action. */
  recommendedDecision: Decision;
  /** Static deterministic score from core checklist (scorePayment) */
  staticScore?: number;
  /** Behavioral anomaly score contribution (capped at 50) */
  behavioralScore?: number;
  /** Behavioral assessment details and account baseline metrics */
  behavioral?: BehavioralAssessment;
}

/** What the UI/API sends to the LLM layer. The model never sees raw payment
 * fields it could use to "recompute" a score — only the verdict + reasons. */
export interface TriageContext {
  payment: Pick<Payment, "amount" | "payeeName" | "memo" | "channel">;
  score: ScoreResult;
}

export type TriageSource = "model" | "rules";

export interface TriageResult {
  brief: string;
  /** Short numbered lines an analyst can read aloud, in order. */
  callScript: string[];
  source: TriageSource;
}

/** The server response from /api/triage combining the server-authoritative score and the explanation. */
export interface TriageResponse extends TriageResult {
  score: ScoreResult;
}

export interface TriageRequestBody {
  payment: Payment;
  /**
   * Client-provided score is explicitly ignored and discarded on the server.
   * Defined here only to accurately type adversarial or legacy requests.
   */
  score?: unknown;
}

/** Input payload when submitting a new transaction from the UI or API. */
export type CreateTransactionInput = Omit<Payment, "id"> & {
  id?: string;
};

export interface CreateTransactionRequestBody {
  transaction?: CreateTransactionInput;
  payment?: CreateTransactionInput;
  /**
   * Client-provided score is strictly ignored and discarded on the server.
   * Defined here only to type adversarial or tampered requests.
   */
  score?: unknown;
}

export interface CreateTransactionResponse {
  transaction: Payment;
  score: ScoreResult;
  triage: TriageResult;
  dbTransactionId?: string;
  assessmentId?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string; // ISO string
  paymentId: string;
  payeeName: string;
  decision: Decision;
  score: number;
  band: RiskBand;
  source: TriageSource;
  amount: number;
  reason?: string;
}

export interface DecisionRequestBody {
  transactionId: string;
  decision: Decision;
  reason: string;
  analystId?: string;
  /**
   * Client-provided scores/bands/typologies are strictly ignored and discarded on the server.
   * Defined here to accurately type adversarial requests.
   */
  score?: unknown;
  band?: unknown;
  typology?: unknown;
}

export interface DecisionResponse {
  success: boolean;
  decision: Decision;
  reason: string;
  transactionId: string;
  dbTransactionId?: string;
  status: string;
  auditLogId?: string;
  score: number;
  band: RiskBand;
  typology: Typology;
  timestamp: string;
}

export type TransactionStatus = "pending" | "held" | "escalated" | "released";

export interface QueueItem {
  payment: Payment;
  score: ScoreResult;
  decision: Decision | null;
  status?: TransactionStatus;
  decisionReason?: string | null;
  dbId?: string;
  createdAt?: string;
}

export type QueueFilter =
  | "all"
  | "pending"
  | "released"
  | "held"
  | "escalated"
  | "red"
  | "amber"
  | "green";

export interface GetTransactionsResponse {
  transactions: QueueItem[];
  total: number;
  source: "database" | "seed";
}
