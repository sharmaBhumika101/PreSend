import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerBaseline,
  computeMean,
  computeMedian,
  evaluateBehavioralAnomalies,
  MAX_BEHAVIORAL_SCORE,
} from "./engine";
import type { Payment } from "@/lib/types";

function makeBasePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "PAY-TEST-001",
    merchant: "Test Merchant",
    amount: 10_000,
    payeeName: "Known Payee",
    payeeAgeDays: 100,
    memo: "Routine invoice",
    channel: "Bank Transfer",
    deviceIsNew: false,
    transfersIn24h: 1,
    hourOfDay: 14,
    initiatedBy: "Finance Desk",
    ...overrides,
  };
}

describe("Behavioral Engine - Math Helpers", () => {
  it("computeMedian accurately calculates median for odd and even sets", () => {
    assert.equal(computeMedian([]), 0);
    assert.equal(computeMedian([50]), 50);
    assert.equal(computeMedian([10, 30, 20]), 20);
    assert.equal(computeMedian([40, 10, 20, 30]), 25);
    assert.equal(computeMedian([100, 50, 10, 20]), 35);
  });

  it("computeMean accurately calculates arithmetic mean", () => {
    assert.equal(computeMean([]), 0);
    assert.equal(computeMean([10, 20, 30]), 20);
    assert.equal(computeMean([15, 25]), 20);
  });
});

describe("Behavioral Engine - Baseline Extraction & Cold Start", () => {
  it("returns insufficient_data when history is empty or < 3 transactions", () => {
    const payment = makeBasePayment();
    const resultEmpty = evaluateBehavioralAnomalies(payment, []);
    assert.equal(resultEmpty.status, "insufficient_data");
    assert.equal(resultEmpty.score, 0);
    assert.equal(resultEmpty.anomalies.length, 0);
    assert.equal(resultEmpty.baseline.hasSufficientData, false);

    const historyTwo = [
      makeBasePayment({ id: "H-1" }),
      makeBasePayment({ id: "H-2" }),
    ];
    const resultTwo = evaluateBehavioralAnomalies(payment, historyTwo);
    assert.equal(resultTwo.status, "insufficient_data");
    assert.equal(resultTwo.score, 0);
  });

  it("strictly enforces self-exclusion: excludes the evaluated payment from its own baseline", () => {
    const payment = makeBasePayment({ id: "PAY-ACTIVE" });
    // History contains 3 items, but ONE of them has the same ID as the active payment
    const historyWithSelf = [
      makeBasePayment({ id: "H-1" }),
      makeBasePayment({ id: "H-2" }),
      makeBasePayment({ id: "PAY-ACTIVE", amount: 999_999 }),
    ];

    // After filtering out PAY-ACTIVE, only 2 remain, which is < 3
    const result = evaluateBehavioralAnomalies(payment, historyWithSelf);
    assert.equal(result.status, "insufficient_data");
    assert.equal(result.score, 0);
    assert.equal(result.baseline.sampleSize, 2);
  });

  it("falls back to merchant-level baseline when desk-level has < 3 records", () => {
    const payment = makeBasePayment({
      merchant: "Retail Co",
      initiatedBy: "New Desk",
    });

    const history = [
      makeBasePayment({ id: "H-1", merchant: "Retail Co", initiatedBy: "HQ Desk" }),
      makeBasePayment({ id: "H-2", merchant: "Retail Co", initiatedBy: "HQ Desk" }),
      makeBasePayment({ id: "H-3", merchant: "Retail Co", initiatedBy: "HQ Desk" }),
    ];

    const baseline = buildCustomerBaseline(payment.merchant, payment.initiatedBy, history);
    assert.equal(baseline.scope, "merchant");
    assert.equal(baseline.hasSufficientData, true);
    assert.equal(baseline.sampleSize, 3);
  });
});

describe("Behavioral Engine - Anomaly Signals", () => {
  const standardHistory: Payment[] = [
    makeBasePayment({ id: "H-1", amount: 10_000, payeeName: "Alpha Vendor", transfersIn24h: 1, hourOfDay: 10, channel: "Bank Transfer" }),
    makeBasePayment({ id: "H-2", amount: 12_000, payeeName: "Beta Services", transfersIn24h: 1, hourOfDay: 14, channel: "Bank Transfer" }),
    makeBasePayment({ id: "H-3", amount: 10_000, payeeName: "Gamma Traders", transfersIn24h: 1, hourOfDay: 16, channel: "Bank Transfer" }),
  ];

  it("detects amount_spike when >= 3.0x median and (amount - median) >= 15,000", () => {
    // Median is 10,000
    // 1. Amount 35,000 is 3.5x median and diff is 25,000 >= 15,000 -> 12 points
    const p1 = makeBasePayment({ id: "P-1", amount: 35_000, payeeName: "Alpha Vendor" });
    const res1 = evaluateBehavioralAnomalies(p1, standardHistory);
    const amountAnomaly1 = res1.anomalies.find((a) => a.id === "amount_spike");
    assert.ok(amountAnomaly1);
    assert.equal(amountAnomaly1.points, 12);

    // 2. Amount 60,000 is 6.0x median -> 20 points
    const p2 = makeBasePayment({ id: "P-2", amount: 60_000, payeeName: "Alpha Vendor" });
    const res2 = evaluateBehavioralAnomalies(p2, standardHistory);
    const amountAnomaly2 = res2.anomalies.find((a) => a.id === "amount_spike");
    assert.ok(amountAnomaly2);
    assert.equal(amountAnomaly2.points, 20);

    // 3. Amount 25,000 is 2.5x median -> does NOT trigger (< 3.0x)
    const p3 = makeBasePayment({ id: "P-3", amount: 25_000, payeeName: "Alpha Vendor" });
    const res3 = evaluateBehavioralAnomalies(p3, standardHistory);
    assert.equal(res3.anomalies.some((a) => a.id === "amount_spike"), false);
  });

  it("does not trigger amount_spike if rupee increase is below 15,000 even if multiplier >= 3x", () => {
    // Baseline median = 1,000
    const smallHistory: Payment[] = [
      makeBasePayment({ id: "S-1", amount: 1_000, payeeName: "Chaiwala" }),
      makeBasePayment({ id: "S-2", amount: 1_000, payeeName: "Chaiwala" }),
      makeBasePayment({ id: "S-3", amount: 1_000, payeeName: "Chaiwala" }),
    ];
    // Amount 4,000 is 4.0x median, but (4,000 - 1,000) = 3,000 < 15,000
    const payment = makeBasePayment({ id: "P-SMALL", amount: 4_000, payeeName: "Chaiwala" });
    const res = evaluateBehavioralAnomalies(payment, smallHistory);
    assert.equal(res.anomalies.some((a) => a.id === "amount_spike"), false);
  });

  it("detects velocity_spike when transfersIn24h >= 3 and >= 2.0x contextual average", () => {
    // Standard history has avg transfersIn24h = 1.0
    const payment = makeBasePayment({ id: "P-VEL", transfersIn24h: 3, payeeName: "Alpha Vendor" });
    const res = evaluateBehavioralAnomalies(payment, standardHistory);
    const velAnomaly = res.anomalies.find((a) => a.id === "velocity_spike");
    assert.ok(velAnomaly);
    assert.equal(velAnomaly.points, 12);
    assert.match(velAnomaly.detail, /Contextual velocity/);

    // Contextual transfers of 2 does not meet >= 3 threshold
    const payment2 = makeBasePayment({ id: "P-VEL-2", transfersIn24h: 2, payeeName: "Alpha Vendor" });
    const res2 = evaluateBehavioralAnomalies(payment2, standardHistory);
    assert.equal(res2.anomalies.some((a) => a.id === "velocity_spike"), false);
  });

  it("detects unseen_payee_for_account when payee is new to account and amount >= median", () => {
    // Known payees: Alpha Vendor, Beta Services, Gamma Traders. Median = 10,000
    const paymentNew = makeBasePayment({
      id: "P-NEW-P",
      payeeName: "Brand New Contractor",
      amount: 12_000,
    });
    const res = evaluateBehavioralAnomalies(paymentNew, standardHistory);
    const payeeAnomaly = res.anomalies.find((a) => a.id === "unseen_payee_for_account");
    assert.ok(payeeAnomaly);
    assert.equal(payeeAnomaly.points, 15);

    // Case insensitivity check: "alpha vendor" is known
    const paymentKnownCase = makeBasePayment({
      id: "P-KNOWN-CASE",
      payeeName: "alpha vendor",
      amount: 12_000,
    });
    const resKnown = evaluateBehavioralAnomalies(paymentKnownCase, standardHistory);
    assert.equal(resKnown.anomalies.some((a) => a.id === "unseen_payee_for_account"), false);

    // Payee is unseen, but amount is tiny (< median 10,000) -> does not trigger
    const paymentLowAmount = makeBasePayment({
      id: "P-LOW",
      payeeName: "Brand New Contractor",
      amount: 2_000,
    });
    const resLow = evaluateBehavioralAnomalies(paymentLowAmount, standardHistory);
    assert.equal(resLow.anomalies.some((a) => a.id === "unseen_payee_for_account"), false);
  });

  it("detects unusual_timing for off-hours transfer when baseline is strictly daytime", () => {
    // Standard history has hours 10, 14, 16 (window 10..16, all daytime 07..22)
    // Hour 2 is off-hours, distance from min (10 - 2) = 8 >= 2
    const paymentOffHours = makeBasePayment({
      id: "P-OFF",
      hourOfDay: 2,
      payeeName: "Alpha Vendor",
    });
    const res = evaluateBehavioralAnomalies(paymentOffHours, standardHistory);
    const timingAnomaly = res.anomalies.find((a) => a.id === "unusual_timing");
    assert.ok(timingAnomaly);
    assert.equal(timingAnomaly.points, 10);

    // Daytime payment at hour 12 does not trigger
    const paymentDay = makeBasePayment({
      id: "P-DAY",
      hourOfDay: 12,
      payeeName: "Alpha Vendor",
    });
    const resDay = evaluateBehavioralAnomalies(paymentDay, standardHistory);
    assert.equal(resDay.anomalies.some((a) => a.id === "unusual_timing"), false);
  });

  it("detects unusual_channel when switching from 100% historical channel with amount >= 20,000", () => {
    // Standard history is 100% Bank Transfer
    const paymentUPI = makeBasePayment({
      id: "P-UPI",
      channel: "UPI",
      amount: 25_000,
      payeeName: "Alpha Vendor",
    });
    const res = evaluateBehavioralAnomalies(paymentUPI, standardHistory);
    const chanAnomaly = res.anomalies.find((a) => a.id === "unusual_channel");
    assert.ok(chanAnomaly);
    assert.equal(chanAnomaly.points, 8);

    // Switching with amount < 20,000 does not trigger
    const paymentUPILow = makeBasePayment({
      id: "P-UPI-LOW",
      channel: "UPI",
      amount: 5_000,
      payeeName: "Alpha Vendor",
    });
    const resLow = evaluateBehavioralAnomalies(paymentUPILow, standardHistory);
    assert.equal(resLow.anomalies.some((a) => a.id === "unusual_channel"), false);
  });

  it("caps behavioral score at 50 even when all anomalies trigger simultaneously", () => {
    // Payment triggering amount_spike (20) + velocity_spike (12) + unseen_payee (15) + unusual_timing (10) + unusual_channel (8) = 65 pts
    const stackedPayment = makeBasePayment({
      id: "P-STACKED",
      amount: 75_000, // 7.5x median -> 20 pts
      transfersIn24h: 4, // 4.0x vel -> 12 pts
      payeeName: "Completely Unknown Recipient", // unseen -> 15 pts
      hourOfDay: 3, // off-hours -> 10 pts
      channel: "UPI", // channel switch -> 8 pts
    });

    const res = evaluateBehavioralAnomalies(stackedPayment, standardHistory);
    assert.equal(res.anomalies.length, 5);
    assert.equal(res.score, MAX_BEHAVIORAL_SCORE);
    assert.equal(res.score, 50);
  });

  it("is strictly deterministic: identical inputs yield identical outputs", () => {
    const payment = makeBasePayment({ id: "P-DET", amount: 35_000, payeeName: "New Person" });
    const run1 = evaluateBehavioralAnomalies(payment, standardHistory);
    const run2 = evaluateBehavioralAnomalies(payment, standardHistory);
    assert.deepEqual(run1, run2);
  });
});
