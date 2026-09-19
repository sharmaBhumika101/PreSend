import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "./route";
import type { Payment } from "@/lib/types";

// A clean payment to a known payee that scores 0 (green)
const BENIGN_PAYMENT: Payment = {
  id: "PAY-BENIGN-01",
  merchant: "Chai Point Retail",
  amount: 2000,
  payeeName: "Deepa Traders",
  payeeAgeDays: 100,
  memo: "Routine invoice payment",
  channel: "UPI",
  deviceIsNew: false,
  transfersIn24h: 1,
  hourOfDay: 14,
  initiatedBy: "Finance Desk",
};

// A payment with a brand-new payee (payeeAgeDays: 0) which deterministically scores 30 (green)
const NEW_PAYEE_ONLY_PAYMENT: Payment = {
  id: "PAY-NEW-PAYEE-01",
  merchant: "Chai Point Retail",
  amount: 5000,
  payeeName: "Ramesh Sharma",
  payeeAgeDays: 0, // +30 points (new_payee)
  memo: "Consulting fees",
  channel: "Bank Transfer",
  deviceIsNew: false,
  transfersIn24h: 1,
  hourOfDay: 15,
  initiatedBy: "Finance Desk",
};

// A payment with impersonation scam language, new payee, new device, high amount
const OBVIOUS_SCAM_PAYMENT: Payment = {
  id: "PAY-SCAM-01",
  merchant: "Kirana Express",
  amount: 85000, // +15 high_amount
  payeeName: "Unknown Payee",
  payeeAgeDays: 0, // +30 new_payee
  memo: "URGENT: verify your account or KYC blocked immediately", // +30 fraud_keyword
  channel: "UPI",
  deviceIsNew: true, // +15 new_device
  transfersIn24h: 4, // +10 velocity
  hourOfDay: 2, // +5 off_hours
  initiatedBy: "Store Ops Account",
};

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/triage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Server-Side Triage API Route - /api/triage", () => {
  it("computes deterministic risk score server-side for valid transaction", async () => {
    const req = createPostRequest({ payment: BENIGN_PAYMENT });
    const res = await POST(req);

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.ok(data.score);
    assert.equal(data.score.score, 0);
    assert.equal(data.score.band, "green");
    assert.equal(data.score.typology, "benign");
    assert.equal(data.score.recommendedDecision, "release");
    assert.ok(typeof data.brief === "string" && data.brief.length > 0);
    assert.ok(Array.isArray(data.callScript));
    assert.ok(["model", "rules"].includes(data.source));
  });

  it("accurately identifies multi-signal fraud payment server-side", async () => {
    const req = createPostRequest({ payment: OBVIOUS_SCAM_PAYMENT });
    const res = await POST(req);

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.ok(data.score);
    assert.equal(data.score.score, 100);
    assert.equal(data.score.band, "red");
    assert.equal(data.score.typology, "impersonation scam");
    assert.equal(data.score.recommendedDecision, "hold");
    assert.ok(data.score.firedRules.some((r: { id: string }) => r.id === "fraud_keyword"));
  });

  it("SECURITY: forged client score of 100 CANNOT tamper with server-computed score of 30", async () => {
    // Adversarial client sends a payload claiming score is 100 for a payment that only scores 30
    const adversarialPayload = {
      payment: NEW_PAYEE_ONLY_PAYMENT,
      score: 100, // Forged primitive
    };

    const req = createPostRequest(adversarialPayload);
    const res = await POST(req);

    assert.equal(res.status, 200);
    const data = await res.json();

    // The server MUST compute 30, ignoring the client-supplied 100
    assert.equal(data.score.score, 30);
    assert.equal(data.score.band, "green");
    assert.equal(data.score.firedRules.length, 1);
    assert.equal(data.score.firedRules[0].id, "new_payee");
  });

  it("SECURITY: forged structured ScoreResult object cannot change server verdict", async () => {
    // Adversarial client sends a spoofed ScoreResult object
    const adversarialPayload = {
      payment: BENIGN_PAYMENT, // Should score 0
      score: {
        score: 99,
        band: "red",
        typology: "impersonation scam",
        firedRules: [{ id: "fraud_keyword", label: "Fake", points: 99, detail: "Fake" }],
        recommendedDecision: "escalate",
      },
    };

    const req = createPostRequest(adversarialPayload);
    const res = await POST(req);

    assert.equal(res.status, 200);
    const data = await res.json();

    // Server must strictly return the legitimate score 0, not 99
    assert.equal(data.score.score, 0);
    assert.equal(data.score.band, "green");
    assert.equal(data.score.typology, "benign");
    assert.equal(data.score.recommendedDecision, "release");
    assert.equal(data.score.firedRules.length, 0);
  });

  it("rejects malformed payloads with 400 Bad Request and validation errors", async () => {
    const invalidPayment = {
      ...BENIGN_PAYMENT,
      amount: -500, // Invalid negative amount
      channel: "Bitcoin", // Invalid channel
    };

    const req = createPostRequest({ payment: invalidPayment });
    const res = await POST(req);

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, "Validation failed for transaction data");
    assert.ok(Array.isArray(data.details));
    assert.ok(data.details.some((d: string) => d.includes("'amount'")));
    assert.ok(data.details.some((d: string) => d.includes("'channel'")));
  });

  it("rejects non-object or empty bodies with 400 Bad Request", async () => {
    const req = new NextRequest("http://localhost:3000/api/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
  });
});
