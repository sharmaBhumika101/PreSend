import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isDatabaseConfigured,
  getServiceSupabaseClient,
  resetClientCache,
} from "./client";
import {
  paymentToDbInsert,
  dbTransactionToPayment,
  scoreResultToDbInsert,
  dbRiskAssessmentToScoreResult,
  type DbTransaction,
  type DbRiskAssessment,
} from "./types";
import { scorePayment } from "../rules";
import type { Payment, ScoreResult } from "../types";

const SAMPLE_PAYMENT: Payment = {
  id: "PAY-TEST-001",
  merchant: "Bangalore Chai Co",
  amount: 62000,
  payeeName: "Deepak Kumar",
  payeeAgeDays: 0,
  memo: "URGENT: verify your account now or KYC blocked",
  channel: "UPI",
  deviceIsNew: true,
  transfersIn24h: 4,
  hourOfDay: 2,
  initiatedBy: "Finance Desk",
};

describe("Database Foundation - Domain Mappers", () => {
  it("converts Payment to InsertTransaction matching schema requirements", () => {
    const insert = paymentToDbInsert(SAMPLE_PAYMENT, "pending");

    assert.equal(insert.reference_id, "PAY-TEST-001");
    assert.equal(insert.merchant, "Bangalore Chai Co");
    assert.equal(insert.amount, 62000);
    assert.equal(insert.currency, "INR");
    assert.equal(insert.payee_name, "Deepak Kumar");
    assert.equal(insert.payee_age_days, 0);
    assert.equal(insert.memo, "URGENT: verify your account now or KYC blocked");
    assert.equal(insert.channel, "UPI");
    assert.equal(insert.device_is_new, true);
    assert.equal(insert.transfers_in_24h, 4);
    assert.equal(insert.hour_of_day, 2);
    assert.equal(insert.initiated_by, "Finance Desk");
    assert.equal(insert.status, "pending");
  });

  it("converts DbTransaction back to Payment domain entity accurately", () => {
    const dbRow: DbTransaction = {
      id: "c8e2b7a0-4b21-4d37-88f5-938b816c1a01",
      reference_id: "PAY-TEST-001",
      merchant: "Bangalore Chai Co",
      amount: 62000,
      currency: "INR",
      payee_name: "Deepak Kumar",
      payee_age_days: 0,
      memo: "URGENT: verify your account now or KYC blocked",
      channel: "UPI",
      device_is_new: true,
      transfers_in_24h: 4,
      hour_of_day: 2,
      initiated_by: "Finance Desk",
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const payment = dbTransactionToPayment(dbRow);
    assert.equal(payment.id, "PAY-TEST-001");
    assert.equal(payment.merchant, "Bangalore Chai Co");
    assert.equal(payment.amount, 62000);
    assert.equal(payment.payeeName, "Deepak Kumar");
    assert.equal(payment.payeeAgeDays, 0);
    assert.equal(payment.channel, "UPI");
    assert.equal(payment.deviceIsNew, true);
    assert.equal(payment.transfersIn24h, 4);
    assert.equal(payment.hourOfDay, 2);
    assert.equal(payment.initiatedBy, "Finance Desk");
  });

  it("converts ScoreResult to InsertRiskAssessment with structured JSONB rules", () => {
    const scoreResult: ScoreResult = scorePayment(SAMPLE_PAYMENT);
    const txId = "c8e2b7a0-4b21-4d37-88f5-938b816c1a01";

    const insert = scoreResultToDbInsert(txId, scoreResult);

    assert.equal(insert.transaction_id, txId);
    assert.equal(insert.score, scoreResult.score);
    assert.equal(insert.risk_band, scoreResult.band);
    assert.equal(insert.typology, scoreResult.typology);
    assert.equal(insert.recommendation, scoreResult.recommendedDecision);
    assert.ok(Array.isArray(insert.fired_rules));
    assert.ok(insert.fired_rules.length > 0);
  });

  it("converts DbRiskAssessment back to ScoreResult accurately", () => {
    const dbAssessment: DbRiskAssessment = {
      id: "fa4b6118-e215-4673-9a4c-123456789abc",
      transaction_id: "c8e2b7a0-4b21-4d37-88f5-938b816c1a01",
      score: 90,
      risk_band: "red",
      typology: "impersonation scam",
      fired_rules: [
        {
          id: "new_payee",
          label: "New payee",
          points: 30,
          detail: "Payee first seen 0 day(s) ago",
        },
      ],
      recommendation: "hold",
      created_at: new Date().toISOString(),
    };

    const score = dbRiskAssessmentToScoreResult(dbAssessment);
    assert.equal(score.score, 90);
    assert.equal(score.band, "red");
    assert.equal(score.typology, "impersonation scam");
    assert.equal(score.recommendedDecision, "hold");
    assert.equal(score.firedRules.length, 1);
    assert.equal(score.firedRules[0].id, "new_payee");
  });
});

describe("Database Foundation - Client & Environment Safety", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetClientCache();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    resetClientCache();
    process.env = { ...originalEnv };
  });

  it("isDatabaseConfigured() returns false when credentials are not present", () => {
    assert.equal(isDatabaseConfigured(), false);
  });

  it("isDatabaseConfigured() returns true when both URL and service key are provided", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    assert.equal(isDatabaseConfigured(), true);
  });

  it("getServiceSupabaseClient() throws a clear descriptive error when unconfigured", () => {
    assert.throws(
      () => getServiceSupabaseClient(),
      /\[PreSend DB\] Supabase is not configured/
    );
  });

  it("getServiceSupabaseClient() initializes successfully when environment is valid", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role-key-for-testing";

    const client = getServiceSupabaseClient();
    assert.ok(client);
    assert.equal(typeof client.from, "function");
  });

  it("getServiceSupabaseClient() strictly blocks execution if simulated in a browser", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-service-role-key-for-testing";

    // Simulate browser window object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {};

    try {
      assert.throws(
        () => getServiceSupabaseClient(),
        /SUPABASE_SERVICE_ROLE_KEY must never be accessed in the browser/
      );
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window;
    }
  });

  it("SECURITY: server-only Supabase service role key is strictly absent from domain entity mappings", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "super-secret-service-role-key-never-leak";

    const dbRow: DbTransaction = {
      id: "c8e2b7a0-4b21-4d37-88f5-938b816c1a01",
      reference_id: "PAY-TEST-001",
      merchant: "Bangalore Chai Co",
      amount: 62000,
      currency: "INR",
      payee_name: "Deepak Kumar",
      payee_age_days: 0,
      memo: "Test memo",
      channel: "UPI",
      device_is_new: true,
      transfers_in_24h: 4,
      hour_of_day: 2,
      initiated_by: "Finance Desk",
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const payment = dbTransactionToPayment(dbRow);
    const serialized = JSON.stringify(payment);

    assert.equal(serialized.includes("super-secret-service-role-key-never-leak"), false);
    assert.equal("service_role" in payment, false);
  });
});
