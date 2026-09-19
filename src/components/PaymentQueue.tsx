"use client";

import { useMemo, useState } from "react";
import type { Decision, QueueFilter, QueueItem, RiskBand } from "@/lib/types";
import { formatINR, merchantBadge, RISK_BAND_META } from "@/lib/format";
import { filterQueueItems } from "@/lib/queue";

export type { QueueItem, QueueFilter };

interface PaymentQueueProps {
  items: QueueItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewTransaction?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  dataSource?: "database" | "seed";
}

const DECISION_LABEL: Record<Decision, string> = {
  hold: "Held",
  release: "Released",
  escalate: "Escalated",
};

const FILTER_LABELS: Array<{ id: QueueFilter; label: string; bandDot?: RiskBand }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "released", label: "Released" },
  { id: "held", label: "Held" },
  { id: "escalated", label: "Escalated" },
  { id: "red", label: "Red", bandDot: "red" },
  { id: "amber", label: "Amber", bandDot: "amber" },
  { id: "green", label: "Green", bandDot: "green" },
];

export function PaymentQueue({
  items,
  selectedId,
  onSelect,
  onNewTransaction,
  onRefresh,
  isRefreshing = false,
  isLoading = false,
  error = null,
  onRetry,
  dataSource,
}: PaymentQueueProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<QueueFilter>("all");

  // Client-side search and filtering against authoritative items
  const filteredItems = useMemo(() => {
    return filterQueueItems(items, {
      search: searchQuery,
      filter: activeFilter,
    });
  }, [items, searchQuery, activeFilter]);

  const pendingCount = items.filter((i) => !i.decision).length;
  const isFiltered = searchQuery.trim().length > 0 || activeFilter !== "all";

  return (
    <div className="flex h-full flex-col">
      {/* Header section */}
      <div className="px-4 pt-4 pb-2.5 border-b border-hairline/60">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-data text-[11px] uppercase tracking-[0.16em] text-ink-faint">
                Pre-send queue
              </h2>
              {dataSource && (
                <span
                  className={`text-[9px] font-data px-1.5 py-0.2 rounded border uppercase tracking-wider ${
                    dataSource === "database"
                      ? "border-accent/40 text-accent bg-accent-dim"
                      : "border-ink-faint/30 text-ink-faint bg-panel"
                  }`}
                  title={
                    dataSource === "database"
                      ? "Persisted in Supabase PostgreSQL"
                      : "Running in offline synthetic seed demo mode"
                  }
                >
                  {dataSource === "database" ? "Supabase" : "Demo"}
                </span>
              )}
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              {isLoading
                ? "Loading transactions..."
                : isFiltered
                ? `Showing ${filteredItems.length} of ${items.length}`
                : `${pendingCount} awaiting review, sorted by risk`}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing || isLoading}
                title="Refresh transactions"
                aria-label="Refresh transactions"
                className="p-1.5 rounded border border-hairline bg-panel hover:bg-panel-raised text-ink-muted hover:text-ink transition disabled:opacity-40 cursor-pointer"
              >
                <svg
                  className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-accent" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </button>
            )}

            {onNewTransaction && (
              <button
                type="button"
                onClick={onNewTransaction}
                className="text-xs font-medium px-2 py-1 rounded border border-accent/40 bg-accent-dim text-accent hover:bg-accent hover:text-void transition cursor-pointer"
              >
                + New
              </button>
            )}
          </div>
        </div>

        {/* Client-side Search Control */}
        <div className="mt-2.5 relative">
          <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-ink-faint">
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search merchant, payee, ID..."
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-panel border border-hairline rounded-md text-ink placeholder:text-ink-faint focus:border-accent focus:outline-hidden transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute inset-y-0 right-0 pr-2 flex items-center text-xs text-ink-faint hover:text-ink cursor-pointer"
              aria-label="Clear search"
            >
              &times;
            </button>
          )}
        </div>

        {/* Compact Filters */}
        <div className="mt-2 flex flex-wrap gap-1">
          {FILTER_LABELS.map(({ id, label, bandDot }) => {
            const isActive = activeFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveFilter(id)}
                className={`text-[10px] font-data uppercase tracking-wider px-2 py-0.5 rounded transition flex items-center gap-1 cursor-pointer ${
                  isActive
                    ? "bg-accent/20 border border-accent text-accent font-semibold"
                    : "bg-panel/60 border border-hairline text-ink-muted hover:text-ink hover:border-hairline/90"
                }`}
              >
                {bandDot && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      bandDot === "red"
                        ? "bg-risk-red"
                        : bandDot === "amber"
                        ? "bg-risk-amber"
                        : "bg-risk-green"
                    }`}
                  />
                )}
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main queue content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {/* Loading State */}
        {isLoading && (
          <div className="space-y-2 py-2">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="rounded-lg border border-hairline/40 bg-panel/40 p-3 animate-pulse space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="h-3 w-28 bg-hairline/50 rounded" />
                  <div className="h-3 w-8 bg-hairline/50 rounded" />
                </div>
                <div className="h-2.5 w-36 bg-hairline/30 rounded" />
                <div className="flex justify-between pt-1">
                  <div className="h-2 w-16 bg-hairline/30 rounded" />
                  <div className="h-2.5 w-12 bg-hairline/40 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Database / API Error State */}
        {!isLoading && error && (
          <div className="rounded-lg border border-risk-red/40 bg-risk-red-dim/40 p-3.5 my-2 space-y-2 text-left">
            <div className="flex items-center gap-1.5 text-risk-red text-xs font-semibold">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>Failed to load transactions</span>
            </div>
            <p className="text-[11px] text-ink-muted leading-relaxed">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-xs px-2.5 py-1 rounded bg-risk-red text-void font-semibold hover:brightness-110 transition cursor-pointer"
              >
                Retry connection
              </button>
            )}
          </div>
        )}

        {/* Empty State: 0 items total */}
        {!isLoading && !error && items.length === 0 && (
          <div className="py-12 px-4 text-center space-y-3">
            <p className="text-xs text-ink-muted">No transactions found in queue.</p>
            {onNewTransaction && (
              <button
                type="button"
                onClick={onNewTransaction}
                className="text-xs px-3 py-1.5 rounded bg-accent text-void font-semibold hover:brightness-110 transition cursor-pointer"
              >
                + Create New Transaction
              </button>
            )}
          </div>
        )}

        {/* Filtered Empty State: items exist, but none match filter/search */}
        {!isLoading && !error && items.length > 0 && filteredItems.length === 0 && (
          <div className="py-10 px-4 text-center space-y-2">
            <p className="text-xs text-ink-muted">No transactions match your search or filter.</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setActiveFilter("all");
              }}
              className="text-xs text-accent hover:underline cursor-pointer"
            >
              Clear search &amp; filters
            </button>
          </div>
        )}

        {/* Transaction items list */}
        {!isLoading && !error && filteredItems.length > 0 && (
          <ul className="space-y-1">
            {filteredItems.map(({ payment, score, decision, status }) => {
              const meta = RISK_BAND_META[score.band];
              const isSelected = payment.id === selectedId;

              // Effective decision label: from decision or persisted status
              const effectiveDecision: Decision | null =
                decision ??
                (status === "held"
                  ? "hold"
                  : status === "released"
                  ? "release"
                  : status === "escalated"
                  ? "escalate"
                  : null);

              return (
                <li key={payment.id}>
                  <button
                    onClick={() => onSelect(payment.id)}
                    aria-current={isSelected}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${
                      isSelected
                        ? "border-accent bg-accent-dim"
                        : "border-transparent hover:border-hairline hover:bg-panel-raised"
                    } ${effectiveDecision ? "opacity-75" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
                      <span className="font-data text-[10px] text-ink-faint border border-hairline rounded px-1 shrink-0">
                        {merchantBadge(payment.merchant)}
                      </span>
                      <span className="text-sm font-medium text-ink truncate flex-1">
                        {payment.payeeName}
                      </span>
                      <span
                        className={`font-data text-xs tabular-nums shrink-0 font-medium ${
                          score.band === "red"
                            ? "text-risk-red"
                            : score.band === "amber"
                            ? "text-risk-amber"
                            : "text-risk-green"
                        }`}
                      >
                        {score.score}
                      </span>
                    </div>

                    <div className="pl-4 mt-1">
                      <span className="text-[11px] text-ink-faint">
                        {payment.channel} &middot; from {payment.initiatedBy}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-1 pl-4">
                      <span className="font-data text-[11px] text-ink-faint">{payment.id}</span>
                      <span className="font-data text-xs text-ink-muted tabular-nums">
                        {formatINR(payment.amount)}
                      </span>
                    </div>

                    {effectiveDecision && (
                      <div className="pl-4 mt-1.5 flex items-center gap-1.5">
                        <span
                          className={`text-[9px] uppercase tracking-wider font-data font-semibold px-1.5 py-0.5 rounded border ${
                            effectiveDecision === "release"
                              ? "border-risk-green/40 text-risk-green bg-risk-green-dim"
                              : effectiveDecision === "hold"
                              ? "border-risk-amber/40 text-risk-amber bg-risk-amber-dim"
                              : "border-risk-red/40 text-risk-red bg-risk-red-dim"
                          }`}
                        >
                          {DECISION_LABEL[effectiveDecision]}
                        </span>
                        <span className="text-[10px] text-ink-faint truncate">Actioned</span>
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
