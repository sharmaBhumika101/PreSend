/**
 * Behavioral Anomaly Detection Engine for PreSend.
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. Pure & Deterministic: Same input payment and history always produces the exact same result.
 *    No opaque ML, no external network calls, no model drift.
 * 2. Strict Self-Exclusion: The payment under evaluation is strictly filtered out of history (id !== payment.id).
 * 3. Graceful Cold Start: If fewer than 3 historical transactions exist, behavioral score is 0 with
 *    status 'insufficient_data', falling back 100% to core static rules without false-positive penalties.
 * 4. Account Identity: In this demo environment, (merchant, initiatedBy) explicitly represents a
 *    synthetic/demo account identity, not a real PII customer identity. In a production payments
 *    platform, this would map to a verified merchant account ID, virtual account number (VAN),
 *    or authenticated API key.
 * 5. Contextual Velocity vs Historical Frequency: 'transfersIn24h' is a synthetic contextual attribute
 *    reported with the inbound payment payload. It is compared against the baseline contextual average
 *    reported for this demo account, clearly distinguished from true database-derived transaction frequency.
 */

import type {
  BehavioralAnomaly,
  BehavioralAssessment,
  Channel,
  CustomerBaseline,
  Payment,
} from "@/lib/types";

export const MIN_HISTORICAL_SAMPLE_SIZE = 3;
export const MAX_BEHAVIORAL_SCORE = 50;

/**
 * Calculates the mathematical median of an array of numbers.
 * Pure and exact.
 */
export function computeMedian(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculates the arithmetic mean of an array of numbers.
 */
export function computeMean(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, val) => acc + val, 0);
  return sum / numbers.length;
}

/**
 * Extracts account baseline statistics from historical transactions.
 * Prioritizes (merchant, initiatedBy) demo account scope; falls back to merchant scope
 * if the specific desk has fewer than MIN_HISTORICAL_SAMPLE_SIZE transactions.
 */
export function buildCustomerBaseline(
  merchant: string,
  initiatedBy: string,
  history: Payment[]
): CustomerBaseline {
  // Filter for the specific synthetic demo account
  const accountRecords = history.filter(
    (tx) => tx.merchant === merchant && tx.initiatedBy === initiatedBy
  );

  let targetRecords: Payment[];
  let scope: "account" | "merchant";

  if (accountRecords.length >= MIN_HISTORICAL_SAMPLE_SIZE) {
    targetRecords = accountRecords;
    scope = "account";
  } else {
    // Fallback to merchant-level baseline
    const merchantRecords = history.filter((tx) => tx.merchant === merchant);
    if (merchantRecords.length >= MIN_HISTORICAL_SAMPLE_SIZE) {
      targetRecords = merchantRecords;
      scope = "merchant";
    } else {
      targetRecords = accountRecords.length > 0 ? accountRecords : merchantRecords;
      scope = "account";
    }
  }

  const sampleSize = targetRecords.length;
  const hasSufficientData = sampleSize >= MIN_HISTORICAL_SAMPLE_SIZE;

  if (!hasSufficientData || sampleSize === 0) {
    return {
      merchant,
      initiatedBy,
      scope,
      sampleSize,
      medianAmount: 0,
      meanAmount: 0,
      avgTransfersIn24h: 0,
      avgContextualTransfersIn24h: 0,
      typicalHourRange: { min: 0, max: 23 },
      knownPayees: [],
      knownChannels: [],
      hasSufficientData: false,
    };
  }

  const amounts = targetRecords.map((t) => t.amount);
  const medianAmount = computeMedian(amounts);
  const meanAmount = computeMean(amounts);

  // Contextual velocity baseline (average of reported transfersIn24h across past records)
  const velocities = targetRecords.map((t) => t.transfersIn24h);
  const avgContextualTransfersIn24h = computeMean(velocities);

  // Typical operating hour window
  const hours = targetRecords.map((t) => t.hourOfDay);
  const minHour = Math.min(...hours);
  const maxHour = Math.max(...hours);

  // Known payees set
  const payeeSet = new Set<string>();
  for (const t of targetRecords) {
    const trimmed = t.payeeName.trim();
    if (trimmed) payeeSet.add(trimmed);
  }

  // Known channels set
  const channelSet = new Set<Channel>();
  for (const t of targetRecords) {
    channelSet.add(t.channel);
  }

  return {
    merchant,
    initiatedBy,
    scope,
    sampleSize,
    medianAmount,
    meanAmount,
    avgTransfersIn24h: avgContextualTransfersIn24h,
    avgContextualTransfersIn24h,
    typicalHourRange: { min: minHour, max: maxHour },
    knownPayees: Array.from(payeeSet),
    knownChannels: Array.from(channelSet),
    hasSufficientData: true,
  };
}

/**
 * Evaluates deterministic behavioral anomaly signals for an inbound payment against
 * its historical account baseline.
 *
 * Pure function:
 * - Guarantees self-exclusion: payment.id is never included in history evaluation.
 * - Guarantees cold-start safety: returns 0 points when history < 3 records.
 * - Score capped at MAX_BEHAVIORAL_SCORE (50 points).
 */
export function evaluateBehavioralAnomalies(
  payment: Payment,
  history: Payment[]
): BehavioralAssessment {
  // SELF-EXCLUSION GUARANTEE: Never include the current transaction in its own baseline
  const cleanHistory = history.filter((tx) => tx.id !== payment.id);

  const baseline = buildCustomerBaseline(payment.merchant, payment.initiatedBy, cleanHistory);

  if (!baseline.hasSufficientData) {
    return {
      score: 0,
      anomalies: [],
      baseline,
      status: "insufficient_data",
    };
  }

  const anomalies: BehavioralAnomaly[] = [];

  // ---------------------------------------------------------------------------
  // 1. Amount Spike vs Account Median
  // Trigger: amount >= 3.0 * median AND (amount - median) >= 15,000
  // Multiplier >= 5.0x yields 20 pts, >= 3.0x yields 12 pts
  // ---------------------------------------------------------------------------
  if (
    baseline.medianAmount > 0 &&
    payment.amount >= 3.0 * baseline.medianAmount &&
    payment.amount - baseline.medianAmount >= 15_000
  ) {
    const ratio = payment.amount / baseline.medianAmount;
    const points = ratio >= 5.0 ? 20 : 12;
    anomalies.push({
      id: "amount_spike",
      label: "Behavioral amount spike",
      points,
      detail: `Amount \u20b9${payment.amount.toLocaleString("en-IN")} is ${ratio.toFixed(
        1
      )}x higher than demo account median (\u20b9${Math.round(
        baseline.medianAmount
      ).toLocaleString("en-IN")} over ${baseline.sampleSize} past transactions).`,
      baselineMetric: `Median \u20b9${Math.round(baseline.medianAmount).toLocaleString("en-IN")}`,
      observedValue: `\u20b9${payment.amount.toLocaleString("en-IN")} (${ratio.toFixed(1)}x)`,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Velocity Spike vs Contextual Average
  // Trigger: transfersIn24h >= 3 AND transfersIn24h >= 2.0 * avgContextualTransfersIn24h
  // Points: 12 pts
  // ---------------------------------------------------------------------------
  const baselineAvgVel = baseline.avgContextualTransfersIn24h;
  if (
    payment.transfersIn24h >= 3 &&
    (baselineAvgVel === 0 || payment.transfersIn24h >= 2.0 * baselineAvgVel)
  ) {
    const ratio = baselineAvgVel > 0 ? payment.transfersIn24h / baselineAvgVel : payment.transfersIn24h;
    anomalies.push({
      id: "velocity_spike",
      label: "Elevated contextual velocity",
      points: 12,
      detail: `Contextual velocity of ${payment.transfersIn24h} transfers in 24h is ${ratio.toFixed(
        1
      )}x higher than demo account baseline contextual average (${baselineAvgVel.toFixed(
        1
      )} transfers).`,
      baselineMetric: `${baselineAvgVel.toFixed(1)} transfers/day (contextual avg)`,
      observedValue: `${payment.transfersIn24h} transfers/24h (${ratio.toFixed(1)}x)`,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Unseen Payee for Account
  // Trigger: Payee NOT in baseline.knownPayees AND amount >= medianAmount
  // Points: 15 pts
  // ---------------------------------------------------------------------------
  const normalizedPayee = payment.payeeName.trim().toLowerCase();
  const isKnownPayee = baseline.knownPayees.some(
    (name) => name.trim().toLowerCase() === normalizedPayee
  );

  if (!isKnownPayee && payment.amount >= baseline.medianAmount) {
    anomalies.push({
      id: "unseen_payee_for_account",
      label: "Unseen payee for account",
      points: 15,
      detail: `First-ever transfer to payee "${payment.payeeName}" from this demo account (0 matches across ${baseline.sampleSize} historical transactions).`,
      baselineMetric: `${baseline.knownPayees.length} known payee(s)`,
      observedValue: `New recipient "${payment.payeeName}"`,
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Unusual Timing Deviation
  // Trigger: Transaction hour is outside [H_min, H_max] window by >= 2 hours
  //          AND hour is in off-hours (23:00 - 07:00)
  //          AND 100% of historical transactions occurred during business hours (07:00 - 23:00)
  // Points: 10 pts
  // ---------------------------------------------------------------------------
  const isOffHours = payment.hourOfDay >= 23 || payment.hourOfDay < 7;
  const historyExclusivelyBusinessHours = cleanHistory
    .filter((tx) =>
      baseline.scope === "account"
        ? tx.merchant === payment.merchant && tx.initiatedBy === payment.initiatedBy
        : tx.merchant === payment.merchant
    )
    .every((tx) => tx.hourOfDay >= 7 && tx.hourOfDay < 23);

  const { min: minH, max: maxH } = baseline.typicalHourRange;
  const timingDistance =
    payment.hourOfDay < minH
      ? minH - payment.hourOfDay
      : payment.hourOfDay > maxH
      ? payment.hourOfDay - maxH
      : 0;

  if (timingDistance >= 2 && isOffHours && historyExclusivelyBusinessHours) {
    anomalies.push({
      id: "unusual_timing",
      label: "Unusual off-hours timing",
      points: 10,
      detail: `Initiated at ${String(payment.hourOfDay).padStart(
        2,
        "0"
      )}:00; demo account has exclusively transacted between ${String(minH).padStart(
        2,
        "0"
      )}:00 and ${String(maxH).padStart(2, "0")}:00 (${baseline.sampleSize} past transactions).`,
      baselineMetric: `Historical window ${String(minH).padStart(2, "0")}:00\u2013${String(
        maxH
      ).padStart(2, "0")}:00`,
      observedValue: `${String(payment.hourOfDay).padStart(2, "0")}:00 (off-hours)`,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Unusual Payment Channel Switch
  // Trigger: Customer/account has 100% history on one channel (>= 3 txs)
  //          and switches to alternate channel for amount >= 20,000
  // Points: 8 pts
  // ---------------------------------------------------------------------------
  if (
    baseline.knownChannels.length === 1 &&
    baseline.knownChannels[0] !== payment.channel &&
    payment.amount >= 20_000
  ) {
    const dominantChannel = baseline.knownChannels[0];
    anomalies.push({
      id: "unusual_channel",
      label: "Unusual payment channel switch",
      points: 8,
      detail: `Payment initiated via ${payment.channel}, whereas 100% of past demo account transfers (${baseline.sampleSize}/${baseline.sampleSize}) used ${dominantChannel}.`,
      baselineMetric: `100% ${dominantChannel}`,
      observedValue: `Switched to ${payment.channel} (\u20b9${payment.amount.toLocaleString(
        "en-IN"
      )})`,
    });
  }

  const rawScore = anomalies.reduce((sum, a) => sum + a.points, 0);
  const score = Math.min(MAX_BEHAVIORAL_SCORE, rawScore);

  return {
    score,
    anomalies,
    baseline,
    status: "evaluated",
  };
}
