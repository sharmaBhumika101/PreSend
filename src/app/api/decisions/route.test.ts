import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "./route";

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/decisions - Analyst Decisions & Audit Trail", () => {
  it("processes a valid Release decision with required reason", async () => {
    const req = createPostRequest({
      transactionId: "PAY-10232", // Benign seed payment
      decision: "release",
      reason: "Verified regular monthly invoice with merchant founder",
    });
    const res = await POST(req);

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.success, true);
    assert.equal(data.decision, "release");
    assert.equal(data.reason, "Verified regular monthly invoice with merchant founder");
    assert.equal(data.status, "released");
    assert.ok(data.auditLogId);
    assert.equal(data.score, 0); // Server-calculated benign score
    assert.equal(data.band, "green");
  });

  it("processes a valid Hold decision with required reason", async () => {
    const req = createPostRequest({
      transactionId: "PAY-10231", // High-risk impersonation scam payment
      decision: "hold",
      reason: "Urgent KYC memo detected; customer phone verification required",
    });
    const res = await POST(req);

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.success, true);
    assert.equal(data.decision, "hold");
    assert.equal(data.status, "held");
    assert.equal(data.score, 95); // Server ground truth: 15+30+30+15+5 = 95
    assert.equal(data.band, "red");
  });

  it("processes a valid Escalate decision with required reason", async () => {
    const req = createPostRequest({
      transactionId: "PAY-20102",
      decision: "escalate",
      reason: "Suspected mule account matched to high risk cluster",
    });
    const res = await POST(req);

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.success, true);
    assert.equal(data.decision, "escalate");
    assert.equal(data.status, "escalated");
    assert.ok(data.timestamp);
  });

  it("rejects request if reason is missing with 400 Bad Request", async () => {
    const req = createPostRequest({
      transactionId: "PAY-10231",
      decision: "hold",
    });
    const res = await POST(req);

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.details.some((d: string) => d.includes("'reason'")));
  });

  it("rejects request if reason is empty or whitespace-only with 400 Bad Request", async () => {
    const req = createPostRequest({
      transactionId: "PAY-10231",
      decision: "hold",
      reason: "    ",
    });
    const res = await POST(req);

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.details.some((d: string) => d.includes("'reason'")));
  });

  it("rejects invalid decision value with 400 Bad Request", async () => {
    const req = createPostRequest({
      transactionId: "PAY-10231",
      decision: "approve_and_ignore", // Invalid decision
      reason: "Looks ok",
    });
    const res = await POST(req);

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.details.some((d: string) => d.includes("'decision'")));
  });

  it("rejects malformed non-JSON or null payloads with 400 Bad Request", async () => {
    const reqMalformed = createPostRequest("bad-json{");
    const resMalformed = await POST(reqMalformed);
    assert.equal(resMalformed.status, 400);

    const reqNull = createPostRequest(null);
    const resNull = await POST(reqNull);
    assert.equal(resNull.status, 400);
  });

  it("SECURITY: forged score, band, or typology in request CANNOT override server ground truth", async () => {
    // Adversary attempts to record a benign score 0 and band 'green' for a scam payment
    const tamperedPayload = {
      transactionId: "PAY-10231", // Actual score is 100 red
      decision: "release",
      reason: "Adversarial override attempt",
      score: 0, // Spoofed score
      band: "green", // Spoofed band
      typology: "benign", // Spoofed typology
    };

    const req = createPostRequest(tamperedPayload);
    const res = await POST(req);

    assert.equal(res.status, 200);
    const data = await res.json();

    // The server MUST record and return the authentic score of 95, red, impersonation scam
    assert.equal(data.score, 95);
    assert.equal(data.band, "red");
    assert.equal(data.typology, "impersonation scam");
  });

  it("rejects non-existent transaction with 404 Not Found", async () => {
    const req = createPostRequest({
      transactionId: "NON-EXISTENT-TX-99999",
      decision: "hold",
      reason: "Valid reason for missing tx",
    });
    const res = await POST(req);

    assert.equal(res.status, 404);
    const data = await res.json();
    assert.ok(data.error.includes("not found"));
  });
});
