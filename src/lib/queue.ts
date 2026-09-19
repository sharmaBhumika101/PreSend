import type { QueueFilter, QueueItem, RiskBand, TransactionStatus } from "@/lib/types";

export interface QueueFilterOptions {
  search?: string;
  filter?: QueueFilter;
  status?: TransactionStatus | "all";
  riskBand?: RiskBand | "all";
}

/**
 * Deterministically sorts queue items by risk score in descending order (highest risk first).
 * If risk scores are identical, falls back to stable secondary criteria (e.g. amount descending or ID).
 */
export function sortQueueByRisk(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => {
    if (b.score.score !== a.score.score) {
      return b.score.score - a.score.score;
    }
    return b.payment.amount - a.payment.amount;
  });
}

/**
 * Pure function to filter queue items using client-side search and status/risk-band filters.
 *
 * Search criteria matches case-insensitively against:
 * 1. Merchant name
 * 2. Payee name
 * 3. Transaction / Reference ID
 *
 * Filter criteria supports:
 * - Status: 'all' | 'pending' | 'released' | 'held' | 'escalated'
 * - Risk Band: 'red' | 'amber' | 'green'
 *
 * Can receive either a unified `filter` ("all" | "pending" | "released" | "held" | "escalated" | "red" | "amber" | "green")
 * or granular `status` and `riskBand` options.
 */
export function filterQueueItems(
  items: QueueItem[],
  options: QueueFilterOptions = {}
): QueueItem[] {
  const { search, filter = "all", status, riskBand } = options;
  const searchNormalized = (search ?? "").trim().toLowerCase();

  return items.filter((item) => {
    // 1. Search matching
    if (searchNormalized.length > 0) {
      const merchant = item.payment.merchant.toLowerCase();
      const payeeName = item.payment.payeeName.toLowerCase();
      const id = item.payment.id.toLowerCase();
      const dbId = (item.dbId ?? "").toLowerCase();

      const matchesSearch =
        merchant.includes(searchNormalized) ||
        payeeName.includes(searchNormalized) ||
        id.includes(searchNormalized) ||
        dbId.includes(searchNormalized);

      if (!matchesSearch) {
        return false;
      }
    }

    // 2. Status matching (from unified filter or explicit status option)
    const effectiveStatusFilter =
      status && status !== "all"
        ? status
        : filter === "pending" || filter === "released" || filter === "held" || filter === "escalated"
        ? filter
        : null;

    if (effectiveStatusFilter) {
      const isPending = !item.decision || item.status === "pending";
      const isReleased = item.decision === "release" || item.status === "released";
      const isHeld = item.decision === "hold" || item.status === "held";
      const isEscalated = item.decision === "escalate" || item.status === "escalated";

      if (effectiveStatusFilter === "pending" && !isPending) return false;
      if (effectiveStatusFilter === "released" && !isReleased) return false;
      if (effectiveStatusFilter === "held" && !isHeld) return false;
      if (effectiveStatusFilter === "escalated" && !isEscalated) return false;
    }

    // 3. Risk-band matching (from unified filter or explicit riskBand option)
    const effectiveBandFilter =
      riskBand && riskBand !== "all"
        ? riskBand
        : filter === "red" || filter === "amber" || filter === "green"
        ? filter
        : null;

    if (effectiveBandFilter) {
      if (item.score.band !== effectiveBandFilter) {
        return false;
      }
    }

    return true;
  });
}
