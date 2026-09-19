"use client";

import { useState, useId, useEffect } from "react";
import type { Channel, CreateTransactionResponse, Payment } from "@/lib/types";

interface NewTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (response: CreateTransactionResponse) => void;
}

interface FormState {
  merchant: string;
  amount: string;
  payeeName: string;
  payeeAgeDays: string;
  memo: string;
  channel: Channel;
  deviceIsNew: boolean;
  transfersIn24h: string;
  hourOfDay: string;
  initiatedBy: string;
}

const DEFAULT_FORM: FormState = {
  merchant: "Chai Point Retail",
  amount: "45000",
  payeeName: "",
  payeeAgeDays: "0",
  memo: "",
  channel: "UPI",
  deviceIsNew: true,
  transfersIn24h: "2",
  hourOfDay: new Date().getHours().toString(),
  initiatedBy: "Store Ops Account",
};

const PRESETS = [
  {
    name: "Urgent Impersonation Scam",
    badge: "Red Risk",
    badgeColor: "text-risk-red border-risk-red/40 bg-risk-red-dim",
    data: {
      merchant: "Chai Point Retail",
      amount: "82000",
      payeeName: "Suresh Nair (KYC Desk)",
      payeeAgeDays: "0",
      memo: "URGENT: verify your account immediately or KYC will be suspended",
      channel: "UPI" as Channel,
      deviceIsNew: true,
      transfersIn24h: "1",
      hourOfDay: "2",
      initiatedBy: "Store Ops Account",
    },
  },
  {
    name: "Mule Fan-Out Velocity",
    badge: "Amber/Red Risk",
    badgeColor: "text-risk-amber border-risk-amber/40 bg-risk-amber-dim",
    data: {
      merchant: "Kirana Express",
      amount: "48000",
      payeeName: "Fast Mule Wallet 99",
      payeeAgeDays: "1",
      memo: "Advance stock disbursement",
      channel: "UPI" as Channel,
      deviceIsNew: true,
      transfersIn24h: "5",
      hourOfDay: "3",
      initiatedBy: "Shop Owner Account",
    },
  },
  {
    name: "Routine Benign Vendor",
    badge: "Green Risk",
    badgeColor: "text-risk-green border-risk-green/40 bg-risk-green-dim",
    data: {
      merchant: "Bharat EduTech",
      amount: "12500",
      payeeName: "Deepa Content Traders",
      payeeAgeDays: "360",
      memo: "Monthly content review invoice #4088",
      channel: "Bank Transfer" as Channel,
      deviceIsNew: false,
      transfersIn24h: "1",
      hourOfDay: "14",
      initiatedBy: "Finance Desk",
    },
  },
];

const KNOWN_MERCHANTS = [
  "Chai Point Retail",
  "Kirana Express",
  "Bharat EduTech",
  "Namma Logistics",
];

export function NewTransactionModal({
  isOpen,
  onClose,
  onCreated,
}: NewTransactionModalProps) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const titleId = useId();

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen && !submitting) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  function handlePreset(presetData: typeof PRESETS[0]["data"]) {
    setForm(presetData);
    setErrors({});
    setApiError(null);
  }

  function validateClient(): boolean {
    const errs: Record<string, string> = {};

    if (!form.merchant.trim()) {
      errs.merchant = "Merchant is required";
    }

    const amt = Number(form.amount);
    if (!form.amount || Number.isNaN(amt) || amt <= 0) {
      errs.amount = "Amount must be a positive number greater than ₹0";
    }

    if (!form.payeeName.trim()) {
      errs.payeeName = "Payee name is required";
    }

    const age = Number(form.payeeAgeDays);
    if (form.payeeAgeDays === "" || Number.isNaN(age) || age < 0 || !Number.isInteger(age)) {
      errs.payeeAgeDays = "Payee age must be 0 or more days";
    }

    const xfers = Number(form.transfersIn24h);
    if (form.transfersIn24h === "" || Number.isNaN(xfers) || xfers < 0 || !Number.isInteger(xfers)) {
      errs.transfersIn24h = "Transfers must be 0 or more";
    }

    const hr = Number(form.hourOfDay);
    if (form.hourOfDay === "" || Number.isNaN(hr) || hr < 0 || hr > 23 || !Number.isInteger(hr)) {
      errs.hourOfDay = "Hour must be an integer between 0 and 23";
    }

    if (!form.initiatedBy.trim()) {
      errs.initiatedBy = "Initiated by field is required";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!validateClient()) return;

    setSubmitting(true);
    setApiError(null);

    try {
      const payload: Omit<Payment, "id"> = {
        merchant: form.merchant.trim(),
        amount: Number(form.amount),
        payeeName: form.payeeName.trim(),
        payeeAgeDays: Number(form.payeeAgeDays),
        memo: form.memo.trim(),
        channel: form.channel,
        deviceIsNew: form.deviceIsNew,
        transfersIn24h: Number(form.transfersIn24h),
        hourOfDay: Number(form.hourOfDay),
        initiatedBy: form.initiatedBy.trim(),
      };

      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: payload }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.details?.join(", ") || `Server returned ${res.status}`);
      }

      const result = (await res.json()) as CreateTransactionResponse;
      onCreated(result);
      onClose();
      // Reset form to default for next open
      setForm(DEFAULT_FORM);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to create transaction");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-void/80 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-xl rounded-xl border border-hairline bg-panel shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline bg-panel-raised">
          <div>
            <div className="flex items-center gap-2">
              <h2 id={titleId} className="text-base font-semibold text-ink">
                New Synthetic Transaction
              </h2>
              <span className="font-data text-[10px] uppercase tracking-wide border border-accent/40 bg-accent-dim text-accent rounded px-1.5 py-0.5">
                Synthetic / Demo
              </span>
            </div>
            <p className="text-xs text-ink-muted mt-0.5">
              Evaluated server-side by the deterministic risk engine and explained by AI.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close modal"
            className="text-ink-faint hover:text-ink transition p-1 rounded-md hover:bg-hairline/60"
          >
            ✕
          </button>
        </div>

        {/* 1-Click Presets */}
        <div className="px-6 py-3 border-b border-hairline bg-void/40">
          <p className="font-data text-[10px] uppercase tracking-wider text-ink-faint mb-2">
            1-Click Demo Presets
          </p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handlePreset(p.data)}
                disabled={submitting}
                className="text-xs text-left px-2.5 py-1.5 rounded-lg border border-hairline bg-panel hover:bg-panel-raised hover:border-hairline/80 transition flex items-center gap-2 disabled:opacity-50"
              >
                <span className="text-ink font-medium">{p.name}</span>
                <span className={`text-[10px] border px-1 rounded ${p.badgeColor}`}>
                  {p.badge}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-sm">
          {apiError && (
            <div className="rounded-lg border border-risk-red/40 bg-risk-red-dim p-3 text-xs text-risk-red leading-relaxed">
              <strong>Error:</strong> {apiError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Merchant */}
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Merchant <span className="text-risk-red">*</span>
              </label>
              <select
                value={form.merchant}
                onChange={(e) => setForm({ ...form, merchant: e.target.value })}
                disabled={submitting}
                className="w-full rounded-lg border border-hairline bg-panel-raised px-3 py-2 text-ink focus:border-accent focus:outline-hidden text-xs"
              >
                {KNOWN_MERCHANTS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {errors.merchant && (
                <p className="text-[11px] text-risk-red mt-1">{errors.merchant}</p>
              )}
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Amount (INR ₹) <span className="text-risk-red">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                disabled={submitting}
                placeholder="e.g. 50000"
                className="w-full rounded-lg border border-hairline bg-panel-raised px-3 py-2 text-ink font-data focus:border-accent focus:outline-hidden text-xs"
              />
              {errors.amount && (
                <p className="text-[11px] text-risk-red mt-1">{errors.amount}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Payee Name */}
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Payee Name <span className="text-risk-red">*</span>
              </label>
              <input
                type="text"
                value={form.payeeName}
                onChange={(e) => setForm({ ...form, payeeName: e.target.value })}
                disabled={submitting}
                placeholder="e.g. Ramesh Kumar"
                className="w-full rounded-lg border border-hairline bg-panel-raised px-3 py-2 text-ink focus:border-accent focus:outline-hidden text-xs"
              />
              {errors.payeeName && (
                <p className="text-[11px] text-risk-red mt-1">{errors.payeeName}</p>
              )}
            </div>

            {/* Payee Age in Days */}
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Payee Age (Days Known)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.payeeAgeDays}
                onChange={(e) => setForm({ ...form, payeeAgeDays: e.target.value })}
                disabled={submitting}
                placeholder="0 = added today"
                className="w-full rounded-lg border border-hairline bg-panel-raised px-3 py-2 text-ink font-data focus:border-accent focus:outline-hidden text-xs"
              />
              <span className="text-[10px] text-ink-faint">0 triggers new_payee rule (+30)</span>
              {errors.payeeAgeDays && (
                <p className="text-[11px] text-risk-red mt-1">{errors.payeeAgeDays}</p>
              )}
            </div>
          </div>

          {/* Memo / Description */}
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">
              Payment Memo / Transfer Note
            </label>
            <input
              type="text"
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
              disabled={submitting}
              placeholder='e.g. "urgent kyc verification" or "monthly supply invoice"'
              className="w-full rounded-lg border border-hairline bg-panel-raised px-3 py-2 text-ink focus:border-accent focus:outline-hidden text-xs"
            />
            <span className="text-[10px] text-ink-faint">
              Urgent/verification keywords trigger fraud_keyword (+30)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Channel */}
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Payment Channel
              </label>
              <select
                value={form.channel}
                onChange={(e) => setForm({ ...form, channel: e.target.value as Channel })}
                disabled={submitting}
                className="w-full rounded-lg border border-hairline bg-panel-raised px-3 py-2 text-ink focus:border-accent focus:outline-hidden text-xs"
              >
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
              </select>
            </div>

            {/* Transfers in 24h */}
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Transfers in 24h
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.transfersIn24h}
                onChange={(e) => setForm({ ...form, transfersIn24h: e.target.value })}
                disabled={submitting}
                className="w-full rounded-lg border border-hairline bg-panel-raised px-3 py-2 text-ink font-data focus:border-accent focus:outline-hidden text-xs"
              />
              <span className="text-[10px] text-ink-faint">&ge; 3 triggers velocity (+10)</span>
              {errors.transfersIn24h && (
                <p className="text-[11px] text-risk-red mt-1">{errors.transfersIn24h}</p>
              )}
            </div>

            {/* Hour of Day */}
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Hour of Day (0–23)
              </label>
              <input
                type="number"
                min="0"
                max="23"
                step="1"
                value={form.hourOfDay}
                onChange={(e) => setForm({ ...form, hourOfDay: e.target.value })}
                disabled={submitting}
                className="w-full rounded-lg border border-hairline bg-panel-raised px-3 py-2 text-ink font-data focus:border-accent focus:outline-hidden text-xs"
              />
              <span className="text-[10px] text-ink-faint">&lt; 7 or &ge; 23 = off-hours (+5)</span>
              {errors.hourOfDay && (
                <p className="text-[11px] text-risk-red mt-1">{errors.hourOfDay}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            {/* Initiated By */}
            <div>
              <label className="block text-xs font-medium text-ink-muted mb-1">
                Initiated By <span className="text-risk-red">*</span>
              </label>
              <input
                type="text"
                value={form.initiatedBy}
                onChange={(e) => setForm({ ...form, initiatedBy: e.target.value })}
                disabled={submitting}
                placeholder="e.g. Store Ops Account"
                className="w-full rounded-lg border border-hairline bg-panel-raised px-3 py-2 text-ink focus:border-accent focus:outline-hidden text-xs"
              />
              {errors.initiatedBy && (
                <p className="text-[11px] text-risk-red mt-1">{errors.initiatedBy}</p>
              )}
            </div>

            {/* Device is New */}
            <div className="pt-2 sm:pt-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.deviceIsNew}
                  onChange={(e) => setForm({ ...form, deviceIsNew: e.target.checked })}
                  disabled={submitting}
                  className="rounded border-hairline bg-panel-raised text-accent focus:ring-accent h-4 w-4"
                />
                <span className="text-xs text-ink">
                  New / Unrecognized device (+15)
                </span>
              </label>
            </div>
          </div>

          {/* Form Actions */}
          <div className="pt-4 border-t border-hairline flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-ink-muted hover:text-ink transition rounded-lg hover:bg-hairline/40 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-accent text-void hover:brightness-110 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <span className="h-3 w-3 border-2 border-void border-t-transparent rounded-full animate-spin" />
                  <span>Evaluating Risk...</span>
                </>
              ) : (
                <span>Evaluate &amp; Create</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
