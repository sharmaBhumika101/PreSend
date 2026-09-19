import type { Channel, Decision, Payment } from "./types";

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };

const ALLOWED_CHANNELS: ReadonlySet<string> = new Set<Channel>(["UPI", "Bank Transfer"]);

/**
 * Validates an unknown input object against the required Payment domain schema.
 * Pure and deterministic, suitable for use in both server-side API handlers and client checks.
 */
export function validatePaymentInput(input: unknown): ValidationResult<Payment> {
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { success: false, errors: ["Payment payload must be a non-null object"] };
  }

  const raw = input as Record<string, unknown>;

  // id
  if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
    errors.push("Field 'id' is required and must be a non-empty string");
  }

  // merchant
  if (typeof raw.merchant !== "string" || raw.merchant.trim().length === 0) {
    errors.push("Field 'merchant' is required and must be a non-empty string");
  }

  // amount
  if (typeof raw.amount !== "number" || !Number.isFinite(raw.amount) || raw.amount < 0) {
    errors.push("Field 'amount' must be a non-negative finite number");
  }

  // payeeName
  if (typeof raw.payeeName !== "string" || raw.payeeName.trim().length === 0) {
    errors.push("Field 'payeeName' is required and must be a non-empty string");
  }

  // payeeAgeDays
  if (
    typeof raw.payeeAgeDays !== "number" ||
    !Number.isInteger(raw.payeeAgeDays) ||
    raw.payeeAgeDays < 0
  ) {
    errors.push("Field 'payeeAgeDays' must be a non-negative integer");
  }

  // memo
  if (typeof raw.memo !== "string") {
    errors.push("Field 'memo' must be a string");
  }

  // channel
  if (typeof raw.channel !== "string" || !ALLOWED_CHANNELS.has(raw.channel)) {
    errors.push("Field 'channel' must be either 'UPI' or 'Bank Transfer'");
  }

  // deviceIsNew
  if (typeof raw.deviceIsNew !== "boolean") {
    errors.push("Field 'deviceIsNew' must be a boolean");
  }

  // transfersIn24h
  if (
    typeof raw.transfersIn24h !== "number" ||
    !Number.isInteger(raw.transfersIn24h) ||
    raw.transfersIn24h < 0
  ) {
    errors.push("Field 'transfersIn24h' must be a non-negative integer");
  }

  // hourOfDay
  if (
    typeof raw.hourOfDay !== "number" ||
    !Number.isInteger(raw.hourOfDay) ||
    raw.hourOfDay < 0 ||
    raw.hourOfDay > 23
  ) {
    errors.push("Field 'hourOfDay' must be an integer between 0 and 23");
  }

  // initiatedBy
  if (typeof raw.initiatedBy !== "string" || raw.initiatedBy.trim().length === 0) {
    errors.push("Field 'initiatedBy' is required and must be a non-empty string");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const validated: Payment = {
    id: (raw.id as string).trim(),
    merchant: (raw.merchant as string).trim(),
    amount: raw.amount as number,
    payeeName: (raw.payeeName as string).trim(),
    payeeAgeDays: raw.payeeAgeDays as number,
    memo: raw.memo as string,
    channel: raw.channel as Channel,
    deviceIsNew: raw.deviceIsNew as boolean,
    transfersIn24h: raw.transfersIn24h as number,
    hourOfDay: raw.hourOfDay as number,
    initiatedBy: (raw.initiatedBy as string).trim(),
  };

  return { success: true, data: validated };
}

/**
 * Validates a payload submitted to create a new synthetic transaction.
 * Requires amount > 0, enforces domain boundaries, and auto-generates a
 * reference ID if not explicitly supplied.
 */
export function validateCreateTransactionInput(input: unknown): ValidationResult<Payment> {
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { success: false, errors: ["Transaction payload must be a non-null object"] };
  }

  const raw = input as Record<string, unknown>;

  // id: optional; if provided must be a string, otherwise auto-generated
  let id: string;
  if (raw.id !== undefined && raw.id !== null) {
    if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
      errors.push("Field 'id', if provided, must be a non-empty string");
      id = "";
    } else {
      id = raw.id.trim();
    }
  } else {
    id = `PAY-${Math.floor(10000 + Math.random() * 90000)}`;
  }

  // merchant
  if (typeof raw.merchant !== "string" || raw.merchant.trim().length === 0) {
    errors.push("Field 'merchant' is required and must be a non-empty string");
  }

  // amount: must be greater than 0
  if (typeof raw.amount !== "number" || !Number.isFinite(raw.amount) || raw.amount <= 0) {
    errors.push("Field 'amount' must be a positive finite number greater than 0");
  }

  // payeeName
  if (typeof raw.payeeName !== "string" || raw.payeeName.trim().length === 0) {
    errors.push("Field 'payeeName' is required and must be a non-empty string");
  }

  // payeeAgeDays
  if (
    typeof raw.payeeAgeDays !== "number" ||
    !Number.isInteger(raw.payeeAgeDays) ||
    raw.payeeAgeDays < 0
  ) {
    errors.push("Field 'payeeAgeDays' must be a non-negative integer");
  }

  // memo
  if (raw.memo !== undefined && typeof raw.memo !== "string") {
    errors.push("Field 'memo' must be a string");
  }

  // channel
  if (typeof raw.channel !== "string" || !ALLOWED_CHANNELS.has(raw.channel)) {
    errors.push("Field 'channel' must be either 'UPI' or 'Bank Transfer'");
  }

  // deviceIsNew
  if (typeof raw.deviceIsNew !== "boolean") {
    errors.push("Field 'deviceIsNew' must be a boolean");
  }

  // transfersIn24h
  if (
    typeof raw.transfersIn24h !== "number" ||
    !Number.isInteger(raw.transfersIn24h) ||
    raw.transfersIn24h < 0
  ) {
    errors.push("Field 'transfersIn24h' must be a non-negative integer");
  }

  // hourOfDay
  if (
    typeof raw.hourOfDay !== "number" ||
    !Number.isInteger(raw.hourOfDay) ||
    raw.hourOfDay < 0 ||
    raw.hourOfDay > 23
  ) {
    errors.push("Field 'hourOfDay' must be an integer between 0 and 23");
  }

  // initiatedBy
  if (typeof raw.initiatedBy !== "string" || raw.initiatedBy.trim().length === 0) {
    errors.push("Field 'initiatedBy' is required and must be a non-empty string");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const validated: Payment = {
    id,
    merchant: (raw.merchant as string).trim(),
    amount: raw.amount as number,
    payeeName: (raw.payeeName as string).trim(),
    payeeAgeDays: raw.payeeAgeDays as number,
    memo: typeof raw.memo === "string" ? raw.memo.trim() : "",
    channel: raw.channel as Channel,
    deviceIsNew: raw.deviceIsNew as boolean,
    transfersIn24h: raw.transfersIn24h as number,
    hourOfDay: raw.hourOfDay as number,
    initiatedBy: (raw.initiatedBy as string).trim(),
  };

  return { success: true, data: validated };
}

export interface ValidatedDecisionInput {
  transactionId: string;
  decision: Decision;
  reason: string;
  analystId?: string;
}

const ALLOWED_DECISIONS: ReadonlySet<string> = new Set<Decision>(["hold", "release", "escalate"]);

/**
 * Validates inbound decision submissions (POST /api/decisions).
 * Enforces valid decision choices and requires a non-empty, trimmed reason.
 */
export function validateDecisionInput(input: unknown): ValidationResult<ValidatedDecisionInput> {
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { success: false, errors: ["Decision payload must be a non-null object"] };
  }

  const raw = input as Record<string, unknown>;

  if (typeof raw.transactionId !== "string" || raw.transactionId.trim().length === 0) {
    errors.push("Field 'transactionId' is required and must be a non-empty string");
  }

  if (typeof raw.decision !== "string" || !ALLOWED_DECISIONS.has(raw.decision)) {
    errors.push("Field 'decision' must be one of: 'hold', 'release', 'escalate'");
  }

  if (typeof raw.reason !== "string" || raw.reason.trim().length === 0) {
    errors.push("Field 'reason' is required and must be a non-empty string");
  }

  let analystId: string | undefined;
  if (raw.analystId !== undefined && raw.analystId !== null) {
    if (typeof raw.analystId !== "string" || raw.analystId.trim().length === 0) {
      errors.push("Field 'analystId', if provided, must be a non-empty string");
    } else {
      analystId = raw.analystId.trim();
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      transactionId: (raw.transactionId as string).trim(),
      decision: raw.decision as Decision,
      reason: (raw.reason as string).trim(),
      analystId,
    },
  };
}


