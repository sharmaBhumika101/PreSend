import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST, GET } from "./route";
import { repositoryTestingOverrides } from "@/lib/db/repository";

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_TRANSACTION_PAYLOAD = {
  merchant: "Chai Point Retail",
  amount: 25000,
  payeeName: "Deepa Traders",
  payeeAgeDays: 120,
  memo: "Supply invoice settlement",
  channel: "UPI",
  deviceIsNew: false,
  transfersIn24h: 1,
  hourOfDay: 11,
  initiatedBy: "Finance Desk",
};

const OBVIOUS_FRAUD_PAYLOAD = {
  merchant: "Kirana Express",
  amount: 85000, // +15 high_amount
  payeeName: "Quick Cash Mule",
  payeeAgeDays: 0, // +30 new_payee
  memo: "URGENT: verify your account immediately or KYC will be suspended", // +30 fraud_keyword
  channel: "UPI",
  deviceIsNew: true, // +15 new_device
  transfersIn24h: 4, // +10 velocity
  hourOfDay: 2, // +5 off_hours
  initiatedBy: "Store Ops Account",
};

describe("POST /api/transactions - New Transaction API", () => {
  it("creates a new transaction with server-calculated risk score and AI triage", async () => {
    const req = createPostRequest(VALID_TRANSACTION_PAYLOAD);
    const res = await POST(req);

    assert.equal(res.status, 201);
    const data = await res.json();

    assert.ok(data.transaction);
    assert.equal(data.transaction.merchant, "Chai Point Retail");
    assert.equal(data.transaction.amount, 25000);
    assert.ok(data.transaction.id.startsWith("PAY-"));

    // Server-computed score (benign payment = 0)
    assert.ok(data.score);
    assert.equal(data.score.score, 0);
    assert.equal(data.score.band, "green");
    assert.equal(data.score.typology, "benign");
    assert.equal(data.score.recommendedDecision, "release");

    // AI explanation
    assert.ok(data.triage);
    assert.ok(typeof data.triage.brief === "string" && data.triage.brief.length > 0);
    assert.ok(Array.isArray(data.triage.callScript) && data.triage.callScript.length > 0);
  });

  it("accurately scores high-risk synthetic transactions server-side", async () => {
    const req = createPostRequest({ transaction: OBVIOUS_FRAUD_PAYLOAD });
    const res = await POST(req);

    assert.equal(res.status, 201);
    const data = await res.json();

    assert.equal(data.score.score, 100);
    assert.equal(data.score.band, "red");
    assert.equal(data.score.typology, "impersonation scam");
    assert.equal(data.score.recommendedDecision, "hold");
    assert.ok(data.score.firedRules.length >= 4);
  });

  it("SECURITY: forged client score of 0 CANNOT override a high-risk fraud score", async () => {
    const tamperedPayload = {
      ...OBVIOUS_FRAUD_PAYLOAD,
      score: 0, // Malicious attempt to spoof a benign score
      band: "green",
      recommendation: "release",
    };

    const req = createPostRequest(tamperedPayload);
    const res = await POST(req);

    assert.equal(res.status, 201);
    const data = await res.json();

    // Server score MUST be calculated server-side as 100 red
    assert.equal(data.score.score, 100);
    assert.equal(data.score.band, "red");
    assert.equal(data.score.typology, "impersonation scam");
  });

  it("SECURITY: forged client score of 100 cannot turn a benign payment into red", async () => {
    const tamperedPayload = {
      ...VALID_TRANSACTION_PAYLOAD,
      score: { score: 100, band: "red" },
    };

    const req = createPostRequest(tamperedPayload);
    const res = await POST(req);

    assert.equal(res.status, 201);
    const data = await res.json();

    assert.equal(data.score.score, 0);
    assert.equal(data.score.band, "green");
    assert.equal(data.score.typology, "benign");
  });

  it("rejects non-object or invalid JSON bodies with 400 Bad Request", async () => {
    const req = createPostRequest("invalid-json{");
    const res = await POST(req);
    assert.equal(res.status, 400);

    const data = await res.json();
    assert.equal(data.error, "Invalid JSON body");
  });

  it("rejects missing required fields with 400 Bad Request and validation details", async () => {
    const incompletePayload = {
      amount: 1000,
      channel: "UPI",
    };

    const req = createPostRequest(incompletePayload);
    const res = await POST(req);

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, "Validation failed for transaction data");
    assert.ok(Array.isArray(data.details));
    assert.ok(data.details.some((d: string) => d.includes("'merchant'")));
    assert.ok(data.details.some((d: string) => d.includes("'payeeName'")));
    assert.ok(data.details.some((d: string) => d.includes("'initiatedBy'")));
  });

  it("rejects negative amount with 400 Bad Request", async () => {
    const req = createPostRequest({
      ...VALID_TRANSACTION_PAYLOAD,
      amount: -1500,
    });
    const res = await POST(req);

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.details.some((d: string) => d.includes("'amount'")));
  });

  it("rejects amount of 0 with 400 Bad Request (amount must be strictly positive)", async () => {
    const req = createPostRequest({
      ...VALID_TRANSACTION_PAYLOAD,
      amount: 0,
    });
    const res = await POST(req);

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.details.some((d: string) => d.includes("'amount'")));
  });

  it("rejects invalid hourOfDay (< 0 or > 23) with 400 Bad Request", async () => {
    const reqLow = createPostRequest({
      ...VALID_TRANSACTION_PAYLOAD,
      hourOfDay: -1,
    });
    const resLow = await POST(reqLow);
    assert.equal(resLow.status, 400);

    const reqHigh = createPostRequest({
      ...VALID_TRANSACTION_PAYLOAD,
      hourOfDay: 24,
    });
    const resHigh = await POST(reqHigh);
    assert.equal(resHigh.status, 400);
  });

  it("AI failure fallback: transaction creation succeeds even without external AI keys", async () => {
    // Save previous keys
    const prevAnthropic = process.env.ANTHROPIC_API_KEY;
    const prevGemini = process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const req = createPostRequest(VALID_TRANSACTION_PAYLOAD);
      const res = await POST(req);

      assert.equal(res.status, 201);
      const data = await res.json();

      assert.equal(data.triage.source, "rules");
      assert.ok(data.triage.brief.length > 0);
      assert.ok(data.triage.callScript.length > 0);
    } finally {
      if (prevAnthropic) process.env.ANTHROPIC_API_KEY = prevAnthropic;
      if (prevGemini) process.env.GEMINI_API_KEY = prevGemini;
    }
  });
});

function createGetRequest(searchParams?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/transactions");
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), {
    method: "GET",
  });
}

describe("GET /api/transactions - Persistent Transaction List", () => {
  it("returns demo seed transactions when database is not configured", async () => {
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const req = createGetRequest();
      const res = await GET(req);

      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.source, "seed");
      assert.ok(Array.isArray(data.transactions));
      assert.ok(data.transactions.length > 0);
      assert.equal(data.total, data.transactions.length);

      // Verify domain mapping
      const first = data.transactions[0];
      assert.ok(first.payment);
      assert.ok(first.payment.merchant);
      assert.ok(typeof first.payment.amount === "number");
      assert.ok(first.payment.payeeName);
      assert.ok(first.score);
      assert.ok(typeof first.score.score === "number");
      assert.ok(["green", "amber", "red"].includes(first.score.band));

      // Verify risk sorted ordering
      for (let i = 1; i < data.transactions.length; i++) {
        assert.ok(
          data.transactions[i - 1].score.score >= data.transactions[i].score.score,
          `Items should be sorted descending by risk score: ${data.transactions[i - 1].score.score} >= ${data.transactions[i].score.score}`
        );
      }
    } finally {
      if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    }
  });

  it("returns persisted transactions with latest risk assessment and domain mapping", async () => {
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const origList = repositoryTestingOverrides.listTransactionsWithDetails;

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";

    repositoryTestingOverrides.listTransactionsWithDetails = async () => [
      {
        payment: {
          id: "PAY-10231",
          merchant: "Chai Point Retail",
          amount: 82000,
          payeeName: "Suresh Nair",
          payeeAgeDays: 0,
          memo: "URGENT: verify your account",
          channel: "UPI",
          deviceIsNew: true,
          transfersIn24h: 3,
          hourOfDay: 23,
          initiatedBy: "Finance Ops",
        },
        score: {
          score: 95,
          band: "red",
          typology: "impersonation scam",
          firedRules: [
            {
              id: "fraud_keyword",
              label: "Fraud-pattern language",
              points: 30,
              detail: "URGENT keyword detected",
            },
          ],
          recommendedDecision: "hold",
        },
        decision: null,
        status: "pending",
        dbId: "uuid-1234",
        createdAt: new Date().toISOString(),
      },
    ];

    try {
      const req = createGetRequest();
      const res = await GET(req);

      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.source, "database");
      assert.equal(data.transactions.length, 1);
      assert.equal(data.transactions[0].payment.payeeName, "Suresh Nair");
      assert.equal(data.transactions[0].score.score, 95);
      assert.equal(data.transactions[0].score.band, "red");
      assert.equal(data.transactions[0].decision, null);
      assert.equal(data.transactions[0].status, "pending");

      // Domain types check: camelCase, not snake_case
      assert.equal(data.transactions[0].payment.payee_name, undefined);
      assert.equal(data.transactions[0].payment.device_is_new, undefined);
    } finally {
      if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
      else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      repositoryTestingOverrides.listTransactionsWithDetails = origList;
    }
  });

  it("includes analyst decision and status when present on persisted transactions", async () => {
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const origList = repositoryTestingOverrides.listTransactionsWithDetails;

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";

    repositoryTestingOverrides.listTransactionsWithDetails = async () => [
      {
        payment: {
          id: "PAY-10231",
          merchant: "Chai Point Retail",
          amount: 82000,
          payeeName: "Suresh Nair",
          payeeAgeDays: 0,
          memo: "URGENT memo",
          channel: "UPI",
          deviceIsNew: true,
          transfersIn24h: 3,
          hourOfDay: 23,
          initiatedBy: "Finance Ops",
        },
        score: {
          score: 95,
          band: "red",
          typology: "impersonation scam",
          firedRules: [],
          recommendedDecision: "hold",
        },
        decision: "hold",
        status: "held",
        decisionReason: "Suspicious KYC text",
        dbId: "uuid-1234",
        createdAt: new Date().toISOString(),
      },
    ];

    try {
      const req = createGetRequest();
      const res = await GET(req);

      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.transactions.length, 1);
      assert.equal(data.transactions[0].decision, "hold");
      assert.equal(data.transactions[0].status, "held");
      assert.equal(data.transactions[0].decisionReason, "Suspicious KYC text");
    } finally {
      if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
      else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      repositoryTestingOverrides.listTransactionsWithDetails = origList;
    }
  });

  it("handles empty result from database gracefully", async () => {
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const origList = repositoryTestingOverrides.listTransactionsWithDetails;

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";

    repositoryTestingOverrides.listTransactionsWithDetails = async () => [];

    try {
      const req = createGetRequest();
      const res = await GET(req);

      assert.equal(res.status, 200);
      const data = await res.json();

      assert.equal(data.source, "database");
      assert.deepEqual(data.transactions, []);
      assert.equal(data.total, 0);
    } finally {
      if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
      else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      repositoryTestingOverrides.listTransactionsWithDetails = origList;
    }
  });

  it("handles database failure with 500 status and error details", async () => {
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const origList = repositoryTestingOverrides.listTransactionsWithDetails;

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";

    repositoryTestingOverrides.listTransactionsWithDetails = async () => {
      throw new Error("Connection terminated unexpectedly");
    };

    try {
      const req = createGetRequest();
      const res = await GET(req);

      assert.equal(res.status, 500);
      const data = await res.json();

      assert.ok(data.error.includes("Failed to retrieve transactions"));
      assert.ok(data.details.includes("Connection terminated unexpectedly"));
    } finally {
      if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (origKey) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
      else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      repositoryTestingOverrides.listTransactionsWithDetails = origList;
    }
  });

  it("SECURITY: server-only Supabase credentials are never exposed in GET responses", async () => {
    const req = createGetRequest();
    const res = await GET(req);

    const text = await res.text();
    assert.equal(text.includes(process.env.SUPABASE_SERVICE_ROLE_KEY || "NONE"), false);
    assert.equal(text.includes("service_role"), false);
  });
});
