import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateCompositeRisk } from "./composite";
import type { BehavioralAssessment, Payment, ScoreResult } from "@/lib/types";

function makeBasePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "PAY-COMP-01",
    merchant: "Test Merchant",
    amount: 25_000,
    payeeName: "Vendor A",
    payeeAgeDays: 50,
    memo: "Standard payment",
    channel: "UPI",
    deviceIsNew: false,
    transfersIn24h: 1,
    hourOfDay: 12,
    initiatedBy: "Finance Desk",
    ...overrides,
  };
}

function makeStaticScore(overrides: Partial<ScoreResult> = {}): ScoreResult {
  return {
    score: 0,
    band: "green",
    typology: "benign",
    firedRules: [],
    recommendedDecision: "release",
    ...overrides,
  };
}

function makeBehavioralAssessment(
  overrides: Partial<BehavioralAssessment> = {}
): BehavioralAssessment {
  return {
    score: 0,
    anomalies: [],
    baseline: {
      merchant: "Test Merchant",
      initiatedBy: "Finance Desk",
      scope: "account",
      sampleSize: 5,
      medianAmount: 10_000,
      meanAmount: 12_000,
      avgTransfersIn24h: 1,
      avgContextualTransfersIn24h: 1,
      typicalHourRange: { min: 9, max: 18 },
      knownPayees: ["Vendor A"],
      knownChannels: ["UPI"],
      hasSufficientData: true,
    },
    status: "evaluated",
    ...overrides,
  };
}

describe("Composite Risk Calculation", () => {
  it("computes final score from static score + behavioral score", () => {
    const payment = makeBasePayment();
    const staticScore = makeStaticScore({
      score: 30,
      band: "green",
      firedRules: [
        {
          id: "new_payee",
          label: "New payee",
          points: 30,
          detail: "Payee first seen 0 day(s) ago",
        },
      ],
    });

    const behavioral = makeBehavioralAssessment({
      score: 15,
      anomalies: [
        {
          id: "unseen_payee_for_account",
          label: "Unseen payee for account",
          points: 15,
          detail: "First-ever transfer to payee",
          baselineMetric: "1 known payee",
          observedValue: "New recipient",
        },
      ],
    });

    // Static 30 + Behavioral 15 = 45 -> Amber band!
    const composite = calculateCompositeRisk(payment, staticScore, behavioral);
    assert.equal(composite.score, 45);
    assert.equal(composite.band, "amber");
    assert.equal(composite.recommendedDecision, "hold");
    assert.equal(composite.staticScore, 30);
    assert.equal(composite.behavioralScore, 15);
    assert.equal(composite.firedRules.length, 2);
  });

  it("strictly caps final composite score at 100", () => {
    const payment = makeBasePayment();
    const staticScore = makeStaticScore({ score: 75, band: "red" });
    const behavioral = makeBehavioralAssessment({ score: 45 });

    const composite = calculateCompositeRisk(payment, staticScore, behavioral);
    assert.equal(composite.score, 100);
    assert.equal(composite.band, "red");
  });

  it("assigns risk bands and default recommendations correctly across thresholds", () => {
    const payment = makeBasePayment();

    // 1. Score 39 -> green, release
    const c1 = calculateCompositeRisk(
      payment,
      makeStaticScore({ score: 25 }),
      makeBehavioralAssessment({ score: 14 })
    );
    assert.equal(c1.score, 39);
    assert.equal(c1.band, "green");
    assert.equal(c1.recommendedDecision, "release");

    // 2. Score 40 -> amber, hold
    const c2 = calculateCompositeRisk(
      payment,
      makeStaticScore({ score: 25 }),
      makeBehavioralAssessment({ score: 15 })
    );
    assert.equal(c2.score, 40);
    assert.equal(c2.band, "amber");
    assert.equal(c2.recommendedDecision, "hold");

    // 3. Score 69 -> amber, hold
    const c3 = calculateCompositeRisk(
      payment,
      makeStaticScore({ score: 50 }),
      makeBehavioralAssessment({ score: 19 })
    );
    assert.equal(c3.score, 69);
    assert.equal(c3.band, "amber");
    assert.equal(c3.recommendedDecision, "hold");

    // 4. Score 70 -> red, hold
    const c4 = calculateCompositeRisk(
      payment,
      makeStaticScore({ score: 50 }),
      makeBehavioralAssessment({ score: 20 })
    );
    assert.equal(c4.score, 70);
    assert.equal(c4.band, "red");
    assert.equal(c4.recommendedDecision, "hold");
  });

  it("classifies typology accurately with behavioral signals", () => {
    const payment = makeBasePayment();

    // 1. Fraud keyword always takes precedence -> impersonation scam
    const c1 = calculateCompositeRisk(
      payment,
      makeStaticScore({
        score: 30,
        firedRules: [{ id: "fraud_keyword", label: "Fraud-pattern language", points: 30, detail: "urgent" }],
      }),
      makeBehavioralAssessment({
        score: 12,
        anomalies: [{ id: "velocity_spike", label: "Elevated velocity", points: 12, detail: "...", baselineMetric: "...", observedValue: "..." }],
      })
    );
    assert.equal(c1.typology, "impersonation scam");

    // 2. Mule pattern: velocity_spike + unseen_payee_for_account
    const c2 = calculateCompositeRisk(
      payment,
      makeStaticScore({ score: 0, firedRules: [] }),
      makeBehavioralAssessment({
        score: 27,
        anomalies: [
          { id: "velocity_spike", label: "Elevated velocity", points: 12, detail: "...", baselineMetric: "...", observedValue: "..." },
          { id: "unseen_payee_for_account", label: "Unseen payee", points: 15, detail: "...", baselineMetric: "...", observedValue: "..." },
        ],
      })
    );
    assert.equal(c2.typology, "mule pattern");

    // 3. Mule pattern: static velocity + unseen_payee_for_account
    const c3 = calculateCompositeRisk(
      payment,
      makeStaticScore({
        score: 10,
        firedRules: [{ id: "velocity", label: "Velocity", points: 10, detail: "..." }],
      }),
      makeBehavioralAssessment({
        score: 15,
        anomalies: [
          { id: "unseen_payee_for_account", label: "Unseen payee", points: 15, detail: "...", baselineMetric: "...", observedValue: "..." },
        ],
      })
    );
    assert.equal(c3.typology, "mule pattern");

    // 4. Benign when composite score < 40 and no suspicious combination
    const c4 = calculateCompositeRisk(
      payment,
      makeStaticScore({ score: 15, firedRules: [{ id: "high_amount", label: "High amount", points: 15, detail: "..." }] }),
      makeBehavioralAssessment({ score: 0 })
    );
    assert.equal(c4.typology, "benign");

    // 5. Unclear when composite score >= 40 without keyword or mule combination
    const c5 = calculateCompositeRisk(
      payment,
      makeStaticScore({ score: 15, firedRules: [{ id: "high_amount", label: "High amount", points: 15, detail: "..." }] }),
      makeBehavioralAssessment({
        score: 28,
        anomalies: [
          { id: "amount_spike", label: "Amount spike", points: 20, detail: "...", baselineMetric: "...", observedValue: "..." },
          { id: "unusual_channel", label: "Channel switch", points: 8, detail: "...", baselineMetric: "...", observedValue: "..." },
        ],
      })
    );
    assert.equal(c5.score, 43);
    assert.equal(c5.typology, "unclear");
  });
});
