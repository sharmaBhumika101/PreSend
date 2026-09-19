import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterQueueItems, sortQueueByRisk } from "./queue";
import type { QueueItem } from "./types";

const MOCK_QUEUE_ITEMS: QueueItem[] = [
  {
    payment: {
      id: "PAY-1001",
      merchant: "Chai Point Indiranagar",
      amount: 15000,
      payeeName: "Deepak Sharma",
      payeeAgeDays: 1,
      memo: "URGENT invoice clearance",
      channel: "UPI",
      deviceIsNew: true,
      transfersIn24h: 3,
      hourOfDay: 23,
      initiatedBy: "Store Account",
    },
    score: {
      score: 85,
      band: "red",
      typology: "impersonation scam",
      firedRules: [],
      recommendedDecision: "hold",
    },
    decision: null,
    status: "pending",
  },
  {
    payment: {
      id: "PAY-1002",
      merchant: "Blue Tokai Coffee",
      amount: 50000,
      payeeName: "Ananya Patel",
      payeeAgeDays: 150,
      memo: "Roast bean supplier settlement",
      channel: "Bank Transfer",
      deviceIsNew: false,
      transfersIn24h: 1,
      hourOfDay: 14,
      initiatedBy: "Finance Desk",
    },
    score: {
      score: 15,
      band: "green",
      typology: "benign",
      firedRules: [],
      recommendedDecision: "release",
    },
    decision: "release",
    status: "released",
    decisionReason: "Verified vendor",
  },
  {
    payment: {
      id: "PAY-1003",
      merchant: "Third Wave Roasters",
      amount: 42000,
      payeeName: "Manoj Verma",
      payeeAgeDays: 10,
      memo: "Equipment repair deposit",
      channel: "UPI",
      deviceIsNew: true,
      transfersIn24h: 2,
      hourOfDay: 18,
      initiatedBy: "Store Manager",
    },
    score: {
      score: 45,
      band: "amber",
      typology: "unclear",
      firedRules: [],
      recommendedDecision: "hold",
    },
    decision: "hold",
    status: "held",
    decisionReason: "Pending manager phone confirmation",
  },
  {
    payment: {
      id: "PAY-1004",
      merchant: "Swiggy Corporate",
      amount: 95000,
      payeeName: "Quick Payout Mule",
      payeeAgeDays: 0,
      memo: "Immediate transfer needed",
      channel: "UPI",
      deviceIsNew: true,
      transfersIn24h: 5,
      hourOfDay: 1,
      initiatedBy: "Night Ops",
    },
    score: {
      score: 95,
      band: "red",
      typology: "mule pattern",
      firedRules: [],
      recommendedDecision: "hold",
    },
    decision: "escalate",
    status: "escalated",
    decisionReason: "High-risk mule cluster detected",
  },
];

describe("Queue Behavior - Risk Sorting", () => {
  it("risk sorting remains correct (descending by score)", () => {
    const sorted = sortQueueByRisk(MOCK_QUEUE_ITEMS);

    assert.equal(sorted.length, 4);
    assert.equal(sorted[0].payment.id, "PAY-1004"); // score 95
    assert.equal(sorted[1].payment.id, "PAY-1001"); // score 85
    assert.equal(sorted[2].payment.id, "PAY-1003"); // score 45
    assert.equal(sorted[3].payment.id, "PAY-1002"); // score 15

    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i - 1].score.score >= sorted[i].score.score);
    }
  });
});

describe("Queue Behavior - Search", () => {
  it("search by merchant works (case-insensitive substring)", () => {
    const results = filterQueueItems(MOCK_QUEUE_ITEMS, { search: "tokai" });
    assert.equal(results.length, 1);
    assert.equal(results[0].payment.merchant, "Blue Tokai Coffee");

    const multi = filterQueueItems(MOCK_QUEUE_ITEMS, { search: "Roasters" });
    assert.equal(multi.length, 1);
    assert.equal(multi[0].payment.merchant, "Third Wave Roasters");
  });

  it("search by payee works (case-insensitive substring)", () => {
    const results = filterQueueItems(MOCK_QUEUE_ITEMS, { search: "ananya" });
    assert.equal(results.length, 1);
    assert.equal(results[0].payment.payeeName, "Ananya Patel");

    const partial = filterQueueItems(MOCK_QUEUE_ITEMS, { search: "mule" });
    assert.equal(partial.length, 1);
    assert.equal(results[0].payment.id, "PAY-1002");
  });

  it("search by transaction ID works", () => {
    const results = filterQueueItems(MOCK_QUEUE_ITEMS, { search: "PAY-1003" });
    assert.equal(results.length, 1);
    assert.equal(results[0].payment.id, "PAY-1003");

    const lowercase = filterQueueItems(MOCK_QUEUE_ITEMS, { search: "pay-1001" });
    assert.equal(lowercase.length, 1);
    assert.equal(lowercase[0].payment.id, "PAY-1001");
  });
});

describe("Queue Behavior - Status Filters", () => {
  it("status filters work for 'pending'", () => {
    const pending = filterQueueItems(MOCK_QUEUE_ITEMS, { filter: "pending" });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].payment.id, "PAY-1001");
  });

  it("status filters work for 'released'", () => {
    const released = filterQueueItems(MOCK_QUEUE_ITEMS, { filter: "released" });
    assert.equal(released.length, 1);
    assert.equal(released[0].payment.id, "PAY-1002");
  });

  it("status filters work for 'held'", () => {
    const held = filterQueueItems(MOCK_QUEUE_ITEMS, { filter: "held" });
    assert.equal(held.length, 1);
    assert.equal(held[0].payment.id, "PAY-1003");
  });

  it("status filters work for 'escalated'", () => {
    const escalated = filterQueueItems(MOCK_QUEUE_ITEMS, { filter: "escalated" });
    assert.equal(escalated.length, 1);
    assert.equal(escalated[0].payment.id, "PAY-1004");
  });

  it("status filters work for 'all'", () => {
    const all = filterQueueItems(MOCK_QUEUE_ITEMS, { filter: "all" });
    assert.equal(all.length, 4);
  });
});

describe("Queue Behavior - Risk-Band Filters", () => {
  it("risk-band filters work for 'red'", () => {
    const red = filterQueueItems(MOCK_QUEUE_ITEMS, { filter: "red" });
    assert.equal(red.length, 2);
    assert.ok(red.every((item) => item.score.band === "red"));
  });

  it("risk-band filters work for 'amber'", () => {
    const amber = filterQueueItems(MOCK_QUEUE_ITEMS, { filter: "amber" });
    assert.equal(amber.length, 1);
    assert.equal(amber[0].payment.id, "PAY-1003");
  });

  it("risk-band filters work for 'green'", () => {
    const green = filterQueueItems(MOCK_QUEUE_ITEMS, { filter: "green" });
    assert.equal(green.length, 1);
    assert.equal(green[0].payment.id, "PAY-1002");
  });
});

describe("Queue Behavior - Combined Search + Filter", () => {
  it("combined search + filter works (search + status)", () => {
    // Search "point" matches PAY-1001. Filter "pending" matches PAY-1001 -> 1 match
    const match = filterQueueItems(MOCK_QUEUE_ITEMS, {
      search: "point",
      filter: "pending",
    });
    assert.equal(match.length, 1);
    assert.equal(match[0].payment.id, "PAY-1001");

    // Search "point" with filter "held" -> 0 matches
    const noMatch = filterQueueItems(MOCK_QUEUE_ITEMS, {
      search: "point",
      filter: "held",
    });
    assert.equal(noMatch.length, 0);
  });

  it("combined search + filter works (search + risk-band)", () => {
    // Search "mule" matches PAY-1004. Filter "red" matches PAY-1004 -> 1 match
    const match = filterQueueItems(MOCK_QUEUE_ITEMS, {
      search: "mule",
      filter: "red",
    });
    assert.equal(match.length, 1);
    assert.equal(match[0].payment.id, "PAY-1004");

    // Search "mule" with filter "green" -> 0 matches
    const noMatch = filterQueueItems(MOCK_QUEUE_ITEMS, {
      search: "mule",
      filter: "green",
    });
    assert.equal(noMatch.length, 0);
  });

  it("combined granular search + status + risk-band works", () => {
    // All red items
    const reds = filterQueueItems(MOCK_QUEUE_ITEMS, {
      status: "escalated",
      riskBand: "red",
    });
    assert.equal(reds.length, 1);
    assert.equal(reds[0].payment.id, "PAY-1004");
  });
});
