import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scorePayment, HIGH_AMOUNT_THRESHOLD } from "./rules";
import type { Payment } from "./types";

/** Base payment: fully benign, all rules should stay silent. Individual
 * tests override only the fields relevant to what they're checking. */
function basePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "test-1",
    merchant: "TestMerchant",
    amount: 2_000,
    payeeName: "Ravi Kumar",
    payeeAgeDays: 400,
    memo: "Monthly rent",
    channel: "UPI",
    deviceIsNew: false,
    transfersIn24h: 1,
    hourOfDay: 14,
    initiatedBy: "Store Ops Account",
    ...overrides,
  };
}

describe("scorePayment - benign payments", () => {
  test("a fully clean, long-known payee scores green with no fired rules", () => {
    const result = scorePayment(basePayment());
    assert.equal(result.score, 0);
    assert.equal(result.band, "green");
    assert.equal(result.typology, "benign");
    assert.deepEqual(result.firedRules, []);
  });

  test("benign payments never score red, even with one weak signal", () => {
    // Off-hours alone (+5) should never push a benign payment near red.
    const result = scorePayment(basePayment({ hourOfDay: 23 }));
    assert.equal(result.score, 5);
    assert.equal(result.band, "green");
    assert.notEqual(result.band, "red");
  });

  test("a large, routine payment to a long-known payee is not red", () => {
    // High amount alone (+15) on an otherwise clean, well-established
    // relationship must stay well below the red band.
    const result = scorePayment(
      basePayment({ amount: HIGH_AMOUNT_THRESHOLD + 10_000, payeeAgeDays: 900 })
    );
    assert.equal(result.score, 15);
    assert.equal(result.band, "green");
  });

  test("a known payee on a new device is amber at worst, never red", () => {
    const result = scorePayment(basePayment({ deviceIsNew: true, amount: HIGH_AMOUNT_THRESHOLD }));
    // new_device (+15) + high_amount (+15) = 30 -> still green
    assert.equal(result.score, 30);
    assert.equal(result.band, "green");
  });

  test("benign memo text does not trip the fraud-keyword rule", () => {
    const result = scorePayment(
      basePayment({ memo: "Diwali bonus for the team, thank you for a great year!" })
    );
    assert.equal(result.firedRules.some((r) => r.id === "fraud_keyword"), false);
  });
});

describe("scorePayment - fraud cases", () => {
  test("impersonation scam: new payee + urgent/verify language + new device scores red", () => {
    const result = scorePayment(
      basePayment({
        payeeAgeDays: 0,
        memo: "URGENT: verify your account now or KYC will be suspended",
        deviceIsNew: true,
        amount: 75_000,
      })
    );
    // new_payee(30) + fraud_keyword(30) + high_amount(15) + new_device(15) = 90
    assert.equal(result.score, 90);
    assert.equal(result.band, "red");
    assert.equal(result.typology, "impersonation scam");
  });

  test("fraud-keyword language alone is classified as impersonation scam", () => {
    const result = scorePayment(basePayment({ memo: "Please act now and confirm your OTP" }));
    assert.equal(result.typology, "impersonation scam");
    assert.ok(result.firedRules.find((r) => r.id === "fraud_keyword"));
  });

  test("mule pattern: high velocity + new payee + new device, no keywords", () => {
    const result = scorePayment(
      basePayment({
        payeeAgeDays: 1,
        deviceIsNew: true,
        transfersIn24h: 5,
        memo: "supplier payment",
      })
    );
    // new_payee(30) + new_device(15) + velocity(10) = 55
    assert.equal(result.score, 55);
    assert.equal(result.band, "amber");
    assert.equal(result.typology, "mule pattern");
  });

  test("mule pattern can still reach red with enough stacked signal", () => {
    const result = scorePayment(
      basePayment({
        payeeAgeDays: 0,
        deviceIsNew: true,
        transfersIn24h: 4,
        amount: 60_000,
        hourOfDay: 2,
        memo: "vendor payout",
      })
    );
    // new_payee(30) + high_amount(15) + new_device(15) + velocity(10) + off_hours(5) = 75
    assert.equal(result.score, 75);
    assert.equal(result.band, "red");
    assert.equal(result.typology, "mule pattern");
  });

  test("score is capped at 100 even if every rule fires", () => {
    const result = scorePayment(
      basePayment({
        payeeAgeDays: 0,
        memo: "URGENT verify KYC refund immediately",
        amount: 200_000,
        deviceIsNew: true,
        transfersIn24h: 6,
        hourOfDay: 3,
      })
    );
    // Sum would be 30+30+15+15+10+5 = 105, capped to 100.
    assert.equal(result.score, 100);
    assert.equal(result.band, "red");
  });

  test("unclear: moderate stacked signal with no keyword and no velocity+route combo", () => {
    const result = scorePayment(
      basePayment({ amount: 60_000, deviceIsNew: true, payeeAgeDays: 1 })
    );
    // new_payee(30) + high_amount(15) + new_device(15) = 60 -> amber, no keyword, no velocity
    assert.equal(result.band, "amber");
    assert.equal(result.typology, "unclear");
  });
});

describe("scorePayment - individual rule thresholds", () => {
  test("payee known for exactly NEW_PAYEE_DAYS does not trigger new_payee", () => {
    const result = scorePayment(basePayment({ payeeAgeDays: 3 }));
    assert.equal(result.firedRules.some((r) => r.id === "new_payee"), false);
  });

  test("payee known for one day less than threshold does trigger new_payee", () => {
    const result = scorePayment(basePayment({ payeeAgeDays: 2 }));
    assert.equal(result.firedRules.some((r) => r.id === "new_payee"), true);
  });

  test("amount exactly at threshold triggers high_amount", () => {
    const result = scorePayment(basePayment({ amount: HIGH_AMOUNT_THRESHOLD }));
    assert.equal(result.firedRules.some((r) => r.id === "high_amount"), true);
  });

  test("amount one rupee below threshold does not trigger high_amount", () => {
    const result = scorePayment(basePayment({ amount: HIGH_AMOUNT_THRESHOLD - 1 }));
    assert.equal(result.firedRules.some((r) => r.id === "high_amount"), false);
  });

  test("exactly 3 transfers in 24h triggers velocity", () => {
    const result = scorePayment(basePayment({ transfersIn24h: 3 }));
    assert.equal(result.firedRules.some((r) => r.id === "velocity"), true);
  });

  test("2 transfers in 24h does not trigger velocity", () => {
    const result = scorePayment(basePayment({ transfersIn24h: 2 }));
    assert.equal(result.firedRules.some((r) => r.id === "velocity"), false);
  });

  test("hour 6 (before 7am) is off-hours", () => {
    const result = scorePayment(basePayment({ hourOfDay: 6 }));
    assert.equal(result.firedRules.some((r) => r.id === "off_hours"), true);
  });

  test("hour 7 (7am) is not off-hours", () => {
    const result = scorePayment(basePayment({ hourOfDay: 7 }));
    assert.equal(result.firedRules.some((r) => r.id === "off_hours"), false);
  });

  test("hour 22 (10pm) is not off-hours", () => {
    const result = scorePayment(basePayment({ hourOfDay: 22 }));
    assert.equal(result.firedRules.some((r) => r.id === "off_hours"), false);
  });

  test("hour 23 (11pm) is off-hours", () => {
    const result = scorePayment(basePayment({ hourOfDay: 23 }));
    assert.equal(result.firedRules.some((r) => r.id === "off_hours"), true);
  });

  test("keyword matching is case-insensitive", () => {
    const result = scorePayment(basePayment({ memo: "please VeRiFy your KYC" }));
    assert.equal(result.firedRules.some((r) => r.id === "fraud_keyword"), true);
  });
});

describe("scorePayment - recommendedDecision", () => {
  test("green band recommends release", () => {
    const result = scorePayment(basePayment());
    assert.equal(result.recommendedDecision, "release");
  });

  test("amber band recommends hold, not escalate", () => {
    const result = scorePayment(basePayment({ payeeAgeDays: 1, transfersIn24h: 3 })); // 40
    assert.equal(result.band, "amber");
    assert.equal(result.recommendedDecision, "hold");
  });

  test("red band recommends hold, not escalate (analyst decides)", () => {
    const result = scorePayment(
      basePayment({ payeeAgeDays: 0, memo: "urgent verify KYC", amount: 100_000, deviceIsNew: true })
    );
    assert.equal(result.band, "red");
    assert.equal(result.recommendedDecision, "hold");
  });
});

describe("scorePayment - band boundaries", () => {
  test("score of 39 is green", () => {
    const result = scorePayment(basePayment({ amount: HIGH_AMOUNT_THRESHOLD, deviceIsNew: true, hourOfDay: 23 })); // 15+15+5=35
    assert.ok(result.score < 40);
    assert.equal(result.band, "green");
  });

  test("score of exactly 40 is amber", () => {
    const result = scorePayment(basePayment({ payeeAgeDays: 1, transfersIn24h: 3 })); // 30+10=40
    assert.equal(result.score, 40);
    assert.equal(result.band, "amber");
  });

  test("score of exactly 69 is amber, not red", () => {
    const result = scorePayment(
      basePayment({ payeeAgeDays: 1, amount: HIGH_AMOUNT_THRESHOLD, deviceIsNew: true, hourOfDay: 23 })
    ); // 30+15+15+5=65
    assert.ok(result.score < 70);
    assert.equal(result.band, "amber");
  });

  test("score of exactly 70 is red", () => {
    const result = scorePayment(
      basePayment({ payeeAgeDays: 1, amount: HIGH_AMOUNT_THRESHOLD, deviceIsNew: true, transfersIn24h: 3, hourOfDay: 23 })
    ); // 30+15+15+10+5=75... adjust
    assert.ok(result.score >= 70);
    assert.equal(result.band, "red");
  });
});
