import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateCreateTransactionInput,
  validateDecisionInput,
  validatePaymentInput,
} from "./validation";
import type { Payment } from "./types";

const VALID_PAYMENT: Payment = {
  id: "PAY-1001",
  merchant: "Chai Point Retail",
  amount: 45000,
  payeeName: "Ramesh Sharma",
  payeeAgeDays: 14,
  memo: "Vendor invoice payment",
  channel: "UPI",
  deviceIsNew: false,
  transfersIn24h: 1,
  hourOfDay: 14,
  initiatedBy: "Finance Desk",
};

describe("Validation - Payment Input Schema", () => {
  it("accepts a fully valid payment payload", () => {
    const result = validatePaymentInput(VALID_PAYMENT);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.id, "PAY-1001");
      assert.equal(result.data.merchant, "Chai Point Retail");
      assert.equal(result.data.amount, 45000);
      assert.equal(result.data.channel, "UPI");
    }
  });

  it("trims whitespace from string fields", () => {
    const raw = {
      ...VALID_PAYMENT,
      id: "  PAY-2002  ",
      merchant: " Kirana Express  ",
      payeeName: "  Suresh Patel ",
      initiatedBy: "  Store Ops  ",
    };
    const result = validatePaymentInput(raw);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.id, "PAY-2002");
      assert.equal(result.data.merchant, "Kirana Express");
      assert.equal(result.data.payeeName, "Suresh Patel");
      assert.equal(result.data.initiatedBy, "Store Ops");
    }
  });

  it("rejects non-object, null, or array inputs", () => {
    assert.equal(validatePaymentInput(null).success, false);
    assert.equal(validatePaymentInput(undefined).success, false);
    assert.equal(validatePaymentInput("string").success, false);
    assert.equal(validatePaymentInput(12345).success, false);
    assert.equal(validatePaymentInput([]).success, false);
  });

  it("rejects empty or whitespace-only required strings", () => {
    const invalid = { ...VALID_PAYMENT, merchant: "   ", payeeName: "" };
    const result = validatePaymentInput(invalid);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes("'merchant'")));
      assert.ok(result.errors.some((e) => e.includes("'payeeName'")));
    }
  });

  it("rejects invalid amounts (negative, NaN, infinity)", () => {
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, amount: -100 }).success, false);
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, amount: Number.NaN }).success, false);
    assert.equal(
      validatePaymentInput({ ...VALID_PAYMENT, amount: Number.POSITIVE_INFINITY }).success,
      false
    );
  });

  it("rejects non-integer or negative payeeAgeDays", () => {
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, payeeAgeDays: -1 }).success, false);
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, payeeAgeDays: 2.5 }).success, false);
  });

  it("rejects invalid channel types", () => {
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, channel: "CreditCard" }).success, false);
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, channel: "Crypto" }).success, false);
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, channel: "" }).success, false);
  });

  it("rejects non-boolean deviceIsNew", () => {
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, deviceIsNew: "true" }).success, false);
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, deviceIsNew: 1 }).success, false);
  });

  it("rejects invalid transfersIn24h", () => {
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, transfersIn24h: -1 }).success, false);
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, transfersIn24h: 3.2 }).success, false);
  });

  it("rejects hourOfDay outside 0-23 or fractional", () => {
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, hourOfDay: -1 }).success, false);
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, hourOfDay: 24 }).success, false);
    assert.equal(validatePaymentInput({ ...VALID_PAYMENT, hourOfDay: 14.5 }).success, false);
  });

  it("accepts boundary values: hour 0, hour 23, amount 0, payeeAgeDays 0", () => {
    const boundaryPayment = {
      ...VALID_PAYMENT,
      amount: 0,
      payeeAgeDays: 0,
      hourOfDay: 0,
      transfersIn24h: 0,
      memo: "",
    };
    const r0 = validatePaymentInput(boundaryPayment);
    assert.equal(r0.success, true);

    const r23 = validatePaymentInput({ ...boundaryPayment, hourOfDay: 23, channel: "Bank Transfer" });
    assert.equal(r23.success, true);
  });
});

describe("Validation - Create Transaction Input", () => {
  const VALID_CREATE_INPUT = {
    merchant: "Chai Point Retail",
    amount: 15000,
    payeeName: "Amit Verma",
    payeeAgeDays: 0,
    memo: "Urgent vendor payment",
    channel: "UPI",
    deviceIsNew: true,
    transfersIn24h: 2,
    hourOfDay: 23,
    initiatedBy: "Store Ops",
  };

  it("accepts a valid create input and auto-generates a reference ID", () => {
    const result = validateCreateTransactionInput(VALID_CREATE_INPUT);
    assert.equal(result.success, true);
    if (result.success) {
      assert.ok(result.data.id.startsWith("PAY-"));
      assert.equal(result.data.amount, 15000);
      assert.equal(result.data.payeeName, "Amit Verma");
    }
  });

  it("preserves an explicit reference ID if provided", () => {
    const result = validateCreateTransactionInput({
      ...VALID_CREATE_INPUT,
      id: "CUSTOM-999",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.id, "CUSTOM-999");
    }
  });

  it("rejects amount of 0 (amount must be strictly greater than 0)", () => {
    const result = validateCreateTransactionInput({
      ...VALID_CREATE_INPUT,
      amount: 0,
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes("'amount'")));
    }
  });

  it("rejects negative amounts", () => {
    const result = validateCreateTransactionInput({
      ...VALID_CREATE_INPUT,
      amount: -500,
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes("'amount'")));
    }
  });

  it("rejects missing or empty required fields", () => {
    const result = validateCreateTransactionInput({
      amount: 100,
      channel: "UPI",
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes("'merchant'")));
      assert.ok(result.errors.some((e) => e.includes("'payeeName'")));
      assert.ok(result.errors.some((e) => e.includes("'initiatedBy'")));
    }
  });

  it("rejects invalid hour (< 0 or > 23)", () => {
    assert.equal(
      validateCreateTransactionInput({ ...VALID_CREATE_INPUT, hourOfDay: -1 }).success,
      false
    );
    assert.equal(
      validateCreateTransactionInput({ ...VALID_CREATE_INPUT, hourOfDay: 24 }).success,
      false
    );
  });

  it("rejects negative transfersIn24h and negative payeeAgeDays", () => {
    assert.equal(
      validateCreateTransactionInput({ ...VALID_CREATE_INPUT, transfersIn24h: -1 }).success,
      false
    );
    assert.equal(
      validateCreateTransactionInput({ ...VALID_CREATE_INPUT, payeeAgeDays: -5 }).success,
      false
    );
  });
});

describe("Validation - Decision Input", () => {
  it("accepts a valid decision payload and trims strings", () => {
    const result = validateDecisionInput({
      transactionId: "  PAY-1001  ",
      decision: "hold",
      reason: "  Customer confirmation required  ",
      analystId: "  analyst-2  ",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.transactionId, "PAY-1001");
      assert.equal(result.data.decision, "hold");
      assert.equal(result.data.reason, "Customer confirmation required");
      assert.equal(result.data.analystId, "analyst-2");
    }
  });

  it("rejects missing or empty transactionId", () => {
    const result = validateDecisionInput({
      transactionId: "   ",
      decision: "release",
      reason: "Invoice verified",
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes("'transactionId'")));
    }
  });

  it("rejects invalid decision enum values", () => {
    const result = validateDecisionInput({
      transactionId: "PAY-1001",
      decision: "block_forever",
      reason: "Fraud detected",
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.errors.some((e) => e.includes("'decision'")));
    }
  });

  it("rejects missing, empty, or whitespace-only reason", () => {
    const r1 = validateDecisionInput({
      transactionId: "PAY-1001",
      decision: "escalate",
      reason: "",
    });
    assert.equal(r1.success, false);

    const r2 = validateDecisionInput({
      transactionId: "PAY-1001",
      decision: "escalate",
      reason: "   \t \n  ",
    });
    assert.equal(r2.success, false);

    const r3 = validateDecisionInput({
      transactionId: "PAY-1001",
      decision: "escalate",
    });
    assert.equal(r3.success, false);
  });
});


