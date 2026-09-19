"use client";

import { useEffect, useState, useCallback } from "react";
import { generateTemplateTriage } from "@/lib/template";
import { formatToday } from "@/lib/format";
import { sortQueueByRisk } from "@/lib/queue";
import type {
  AuditEntry,
  CreateTransactionResponse,
  Decision,
  GetTransactionsResponse,
  Payment,
  QueueItem,
  ScoreResult,
  TriageResponse,
  TriageResult,
} from "@/lib/types";
import { PaymentQueue } from "@/components/PaymentQueue";
import { VerdictCard } from "@/components/VerdictCard";
import { MetricsStrip } from "@/components/MetricsStrip";
import { AuditLog } from "@/components/AuditLog";
import { TrustFooter } from "@/components/TrustFooter";
import { NewTransactionModal } from "@/components/NewTransactionModal";

export default function Home() {
  // Dynamic modal state for new transaction creation
  const [isNewTxModalOpen, setIsNewTxModalOpen] = useState(false);

  // Persistent Queue state
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"database" | "seed" | undefined>(undefined);

  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [triageCache, setTriageCache] = useState<Record<string, TriageResult>>({});
  const [triageLoading, setTriageLoading] = useState<Record<string, boolean>>({});
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load transactions from server (Supabase or demo fallback)
  // ---------------------------------------------------------------------------
  const fetchTransactions = useCallback(async (isInitial = false) => {
    if (isInitial) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setFetchError(null);

    try {
      const res = await fetch("/api/transactions");
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.details || `Server returned status ${res.status}`);
      }

      const data: GetTransactionsResponse = await res.json();
      setQueueItems(data.transactions);
      setDataSource(data.source);

      // Pre-populate decisions, authoritative scores, and audit log from persisted data
      const initialDecisions: Record<string, Decision> = {};
      const initialScores: Record<string, ScoreResult> = {};
      const initialAudit: AuditEntry[] = [];

      for (const item of data.transactions) {
        initialScores[item.payment.id] = item.score;

        const effectiveDecision: Decision | null =
          item.decision ??
          (item.status === "held"
            ? "hold"
            : item.status === "released"
            ? "release"
            : item.status === "escalated"
            ? "escalate"
            : null);

        if (effectiveDecision) {
          initialDecisions[item.payment.id] = effectiveDecision;
          initialAudit.push({
            id: `audit-init-${item.payment.id}`,
            timestamp: item.createdAt ?? new Date().toISOString(),
            paymentId: item.payment.id,
            payeeName: item.payment.payeeName,
            decision: effectiveDecision,
            score: item.score.score,
            band: item.score.band,
            source: "rules",
            amount: item.payment.amount,
            reason: item.decisionReason ?? undefined,
          });
        }
      }

      setDecisions((prev) => ({ ...initialDecisions, ...prev }));

      // Merge audit logs without duplicating
      setAuditLog((prev) => {
        const existingIds = new Set(prev.map((e) => e.paymentId));
        const missing = initialAudit.filter((e) => !existingIds.has(e.paymentId));
        return [...prev, ...missing];
      });

      // Maintain selection or select first pending transaction
      setSelectedId((current) => {
        if (current && data.transactions.some((t) => t.payment.id === current)) {
          return current;
        }
        const firstPending = data.transactions.find(
          (t) =>
            !t.decision &&
            t.status !== "held" &&
            t.status !== "released" &&
            t.status !== "escalated"
        );
        return firstPending ? firstPending.payment.id : data.transactions[0]?.payment.id ?? null;
      });
    } catch (err) {
      console.error("[dashboard] Failed to load transactions:", err);
      setFetchError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions(true);
  }, [fetchTransactions]);

  // Selected payment item
  const selected = queueItems.find((q) => q.payment.id === selectedId) ?? null;

  // ---------------------------------------------------------------------------
  // AI Triage explanation fetch
  // ---------------------------------------------------------------------------
  const fetchTriage = useCallback(async (payment: Payment, fallbackScore: ScoreResult) => {
    setTriageLoading((prev) => ({ ...prev, [payment.id]: true }));
    let triageResult: TriageResult;
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment }),
      });
      if (!res.ok) throw new Error(`Triage API returned ${res.status}`);
      const data = (await res.json()) as TriageResponse;
      triageResult = data;
      if (data.score) {
        setQueueItems((prev) =>
          prev.map((item) =>
            item.payment.id === payment.id ? { ...item, score: data.score } : item
          )
        );
      }
    } catch {
      triageResult = generateTemplateTriage({
        payment: {
          amount: payment.amount,
          payeeName: payment.payeeName,
          memo: payment.memo,
          channel: payment.channel,
        },
        score: fallbackScore,
      });
    }
    setTriageCache((prev) => ({ ...prev, [payment.id]: triageResult }));
    setTriageLoading((prev) => ({ ...prev, [payment.id]: false }));
  }, []);

  useEffect(() => {
    if (selected && !triageCache[selected.payment.id] && !triageLoading[selected.payment.id]) {
      fetchTriage(selected.payment, selected.score);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // ---------------------------------------------------------------------------
  // Analyst decision handler: records to /api/decisions and syncs queue
  // ---------------------------------------------------------------------------
  const handleDecision = useCallback(
    async (decision: Decision, reason: string) => {
      if (!selected) return;
      const { payment, score } = selected;
      const triage = triageCache[payment.id];

      try {
        const res = await fetch("/api/decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId: payment.id,
            decision,
            reason,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server returned ${res.status}`);
        }

        const data = await res.json();
        const effectiveStatus =
          decision === "hold" ? "held" : decision === "release" ? "released" : "escalated";

        setDecisions((prev) => ({ ...prev, [payment.id]: decision }));

        // Update the item in the queue so it immediately reflects the decision
        setQueueItems((prev) =>
          prev.map((item) =>
            item.payment.id === payment.id
              ? {
                  ...item,
                  decision,
                  status: effectiveStatus,
                  decisionReason: reason,
                }
              : item
          )
        );

        setAuditLog((prev) => [
          {
            id: data.auditLogId ?? `${payment.id}-${Date.now()}`,
            timestamp: data.timestamp ?? new Date().toISOString(),
            paymentId: payment.id,
            payeeName: payment.payeeName,
            decision,
            score: data.score ?? score.score,
            band: data.band ?? score.band,
            source: triage?.source ?? "rules",
            amount: payment.amount,
            reason: data.reason ?? reason,
          },
          ...prev,
        ]);

        // Auto-advance to next undecided payment in the queue
        const remaining = queueItems.filter(
          (q) =>
            q.payment.id !== payment.id &&
            !decisions[q.payment.id] &&
            q.status !== "held" &&
            q.status !== "released" &&
            q.status !== "escalated"
        );
        setSelectedId(remaining[0]?.payment.id ?? null);
      } catch (err) {
        console.error("[decision] Failed to record analyst decision:", err);
        throw err;
      }
    },
    [selected, triageCache, queueItems, decisions]
  );

  // ---------------------------------------------------------------------------
  // Metrics calculation based on loaded queue
  // ---------------------------------------------------------------------------
  const pendingCount = queueItems.filter(
    (q) => !q.decision && q.status !== "held" && q.status !== "released" && q.status !== "escalated"
  ).length;
  const heldCount = queueItems.filter((q) => q.decision === "hold" || q.status === "held").length;
  const escalatedCount = queueItems.filter(
    (q) => q.decision === "escalate" || q.status === "escalated"
  ).length;
  const releasedCount = queueItems.filter(
    (q) => q.decision === "release" || q.status === "released"
  ).length;
  const amountProtected = queueItems
    .filter(
      (q) =>
        q.decision === "hold" ||
        q.status === "held" ||
        q.decision === "escalate" ||
        q.status === "escalated"
    )
    .reduce((sum, q) => sum + q.payment.amount, 0);

  // ---------------------------------------------------------------------------
  // Handler for newly created transactions from Phase 3 modal
  // ---------------------------------------------------------------------------
  const handleTransactionCreated = useCallback(
    (response: CreateTransactionResponse) => {
      const newTx = response.transaction;
      const newItem: QueueItem = {
        payment: newTx,
        score: response.score,
        decision: null,
        status: "pending",
        dbId: response.dbTransactionId,
        createdAt: new Date().toISOString(),
      };

      setQueueItems((prev) =>
        sortQueueByRisk([newItem, ...prev.filter((i) => i.payment.id !== newTx.id)])
      );
      setTriageCache((prev) => ({ ...prev, [newTx.id]: response.triage }));
      setSelectedId(newTx.id);
    },
    []
  );

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-void border-b border-hairline px-5 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 h-auto lg:h-14">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold tracking-tight text-ink">PreSend</h1>
          <span className="text-xs text-ink-faint hidden sm:inline">
            A human decides, the model explains, every payment is logged before it settles.
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-data text-[11px] text-ink-faint uppercase tracking-wide hidden md:inline">
            UPI &amp; bank-transfer rules in force &middot; {formatToday()}
          </span>
          <button
            type="button"
            onClick={() => setIsNewTxModalOpen(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-void hover:brightness-110 transition flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span>+ New Transaction</span>
          </button>
        </div>
      </header>

      {/* Mobile: queue as a scrollable strip above the verdict card. */}
      <div className="lg:hidden border-b border-hairline max-h-56 overflow-y-auto">
        <PaymentQueue
          items={queueItems}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNewTransaction={() => setIsNewTxModalOpen(true)}
          onRefresh={() => fetchTransactions(false)}
          isRefreshing={isRefreshing}
          isLoading={isLoading}
          error={fetchError}
          onRetry={() => fetchTransactions(true)}
          dataSource={dataSource}
        />
      </div>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr_320px]">
        <aside className="border-r border-hairline lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] hidden lg:flex lg:flex-col">
          <PaymentQueue
            items={queueItems}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNewTransaction={() => setIsNewTxModalOpen(true)}
            onRefresh={() => fetchTransactions(false)}
            isRefreshing={isRefreshing}
            isLoading={isLoading}
            error={fetchError}
            onRetry={() => fetchTransactions(true)}
            dataSource={dataSource}
          />
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
              {isLoading ? "Loading transactions..." : "All payments have been actioned."}
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

      <NewTransactionModal
        isOpen={isNewTxModalOpen}
        onClose={() => setIsNewTxModalOpen(false)}
        onCreated={handleTransactionCreated}
      />
    </div>
  );
}
