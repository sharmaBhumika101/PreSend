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

export type RuleId =
  | "new_payee"
  | "fraud_keyword"
  | "high_amount"
  | "new_device"
  | "velocity"
  | "off_hours";

export interface FiredRule {
  id: RuleId;
  label: string;
  points: number;
  detail: string;
}

export type Decision = "hold" | "release" | "escalate";

export interface ScoreResult {
  score: number; // 0-100, capped
  band: RiskBand;
  typology: Typology;
  firedRules: FiredRule[];
  /** Deterministic default action for this band. The analyst can always
   * override it — this is a suggestion, never an automatic action. */
  recommendedDecision: Decision;
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
}
