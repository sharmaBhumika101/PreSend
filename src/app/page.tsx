"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { SEED_PAYMENTS } from "@/lib/seed";
import { scorePayment } from "@/lib/rules";
import { generateTemplateTriage } from "@/lib/template";
import { formatToday } from "@/lib/format";
import type { AuditEntry, Decision, Payment, ScoreResult, TriageResult } from "@/lib/types";
import { PaymentQueue, type QueueItem } from "@/components/PaymentQueue";
import { VerdictCard } from "@/components/VerdictCard";
import { MetricsStrip } from "@/components/MetricsStrip";
import { AuditLog } from "@/components/AuditLog";
import { TrustFooter } from "@/components/TrustFooter";

export default function Home() {
  // Scores are computed once, client-side, by the pure rules engine. This
  // never touches the network and never changes for a given payment.
  const scored = useMemo<Map<string, ScoreResult>>(() => {
    const map = new Map<string, ScoreResult>();
    for (const p of SEED_PAYMENTS) map.set(p.id, scorePayment(p));
    return map;
  }, []);

  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [triageCache, setTriageCache] = useState<Record<string, TriageResult>>({});
  const [triageLoading, setTriageLoading] = useState<Record<string, boolean>>({});
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  const queueItems: QueueItem[] = useMemo(() => {
    return [...SEED_PAYMENTS]
      .map((payment) => ({
        payment,
        score: scored.get(payment.id)!,
        decision: decisions[payment.id] ?? null,
      }))
      .sort((a, b) => b.score.score - a.score.score);
  }, [scored, decisions]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && queueItems.length > 0) {
      setSelectedId(queueItems[0].payment.id);
    }
  }, [queueItems, selectedId]);

  const selected = queueItems.find((q) => q.payment.id === selectedId) ?? null;

  const fetchTriage = useCallback(async (payment: Payment, score: ScoreResult) => {
    setTriageLoading((prev) => ({ ...prev, [payment.id]: true }));
    const context = {
      payment: {
        amount: payment.amount,
        payeeName: payment.payeeName,
        memo: payment.memo,
        channel: payment.channel,
      },
      score,
    };
    let result: TriageResult;
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });
      if (!res.ok) throw new Error(`Triage API returned ${res.status}`);
      result = (await res.json()) as TriageResult;
    } catch {
      // Network failure, offline demo, or the API route itself throwing -
      // fall all the way back to the client-side template so the analyst
      // always sees a brief and call script.
      result = generateTemplateTriage(context);
    }
    setTriageCache((prev) => ({ ...prev, [payment.id]: result }));
    setTriageLoading((prev) => ({ ...prev, [payment.id]: false }));
  }, []);

  useEffect(() => {
    if (selected && !triageCache[selected.payment.id] && !triageLoading[selected.payment.id]) {
      fetchTriage(selected.payment, selected.score);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const handleDecision = useCallback(
    (decision: Decision) => {
      if (!selected) return;
      const { payment, score } = selected;
      const triage = triageCache[payment.id];
      setDecisions((prev) => ({ ...prev, [payment.id]: decision }));
      setAuditLog((prev) => [
        {
          id: `${payment.id}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          paymentId: payment.id,
          payeeName: payment.payeeName,
          decision,
          score: score.score,
          band: score.band,
          source: triage?.source ?? "rules",
          amount: payment.amount,
        },
        ...prev,
      ]);
      // Auto-advance to the next undecided payment in the queue.
      const remaining = queueItems.filter(
        (q) => q.payment.id !== payment.id && !decisions[q.payment.id]
      );
      setSelectedId(remaining[0]?.payment.id ?? null);
    },
    [selected, triageCache, queueItems, decisions]
  );

  const pendingCount = queueItems.filter((q) => !q.decision).length;
  const heldCount = queueItems.filter((q) => q.decision === "hold").length;
  const escalatedCount = queueItems.filter((q) => q.decision === "escalate").length;
  const releasedCount = queueItems.filter((q) => q.decision === "release").length;
  const amountProtected = queueItems
    .filter((q) => q.decision === "hold" || q.decision === "escalate")
    .reduce((sum, q) => sum + q.payment.amount, 0);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-void border-b border-hairline px-5 py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 h-auto lg:h-14">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-tight text-ink">PreSend</h1>
          <span className="text-xs text-ink-faint hidden sm:inline">
            A human decides, the model explains, every payment is logged before it settles.
          </span>
        </div>
        <span className="font-data text-[11px] text-ink-faint uppercase tracking-wide">
          UPI &amp; bank-transfer rules in force &middot; {formatToday()}
        </span>
      </header>

      {/* Mobile: queue as a scrollable strip above the verdict card. */}
      <div className="lg:hidden border-b border-hairline max-h-40 overflow-y-auto">
        <PaymentQueue items={queueItems} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr_320px]">
        <aside className="border-r border-hairline lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] hidden lg:flex lg:flex-col">
          <PaymentQueue items={queueItems} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>

        <section className="lg:h-[calc(100vh-3.5rem)] overflow-hidden">
          {selected ? (
            <VerdictCard
              payment={selected.payment}
              score={selected.score}
              triage={triageCache[selected.payment.id] ?? null}
              triageLoading={!!triageLoading[selected.payment.id]}
              decision={selected.decision}
              onDecision={handleDecision}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-ink-muted text-sm">
              All payments have been actioned.
            </div>
          )}
        </section>

        <aside className="border-l border-hairline lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] hidden lg:flex lg:flex-col">
          <MetricsStrip
            pending={pendingCount}
            held={heldCount}
            escalated={escalatedCount}
            released={releasedCount}
            amountProtected={amountProtected}
          />
          <AuditLog entries={auditLog} />
        </aside>
      </main>

      <div className="lg:hidden border-t border-hairline">
        <MetricsStrip
          pending={pendingCount}
          held={heldCount}
          escalated={escalatedCount}
          released={releasedCount}
          amountProtected={amountProtected}
        />
        <AuditLog entries={auditLog} />
      </div>

      <TrustFooter />
    </div>
  );
}
