const STATS = [
  {
    value: "228B+",
    label: "UPI transactions moved roughly \u20b9300 lakh crore across India in 2025 alone.",
  },
  {
    value: "10.64L",
    label:
      "UPI fraud cases (\u20b9805 crore) were reported in the first eight months of FY2025-26, per NPCI-linked reporting.",
  },
  {
    value: "seconds",
    label: "is how long it takes a UPI payment to become irrevocable once it settles.",
  },
];

const PRINCIPLES = [
  {
    title: "Human accountable",
    body: "The model never releases, holds, or escalates a payment. An analyst clicks, and their name goes on the audit entry.",
  },
  {
    title: "Least privilege",
    body: "The triage agent only ever sees a payment after the rules engine has scored it. It has no access to move funds or touch a ledger.",
  },
  {
    title: "Logged activity",
    body: "Every score, brief source, and decision is written to an append-only audit trail before a payment is actioned.",
  },
];

export function TrustFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {STATS.map((s) => (
            <div key={s.value}>
              <p className="font-data text-3xl font-semibold text-ink">{s.value}</p>
              <p className="text-xs text-ink-muted mt-1.5 leading-relaxed">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="rounded-lg border border-hairline bg-panel px-4 py-4">
              <p className="text-sm font-medium text-ink">{p.title}</p>
              <p className="text-xs text-ink-muted mt-1.5 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-ink-faint leading-relaxed max-w-3xl">
          Designed with RBI&rsquo;s FREE-AI framework (Framework for Responsible and Ethical
          Enablement of Artificial Intelligence, released 13 August 2025) in mind for AI use at
          regulated payments platforms. All merchants, payees, and payments on this page are
          synthetic demo data \u2014 no real accounts, institutions, or individuals are represented.
        </p>
      </div>
    </footer>
  );
}
