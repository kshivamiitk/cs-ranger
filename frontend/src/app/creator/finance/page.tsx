"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, Building2, ShieldCheck, AlertCircle, Loader2, FileText, Download } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";
import { formatINR, saveBlob } from "@/lib/utils";
import { usePublicSettings } from "@/hooks/usePublicSettings";

export default function CreatorFinancePage() {
  const { user } = useApp();
  const qc = useQueryClient();
  const creatorId = user?.user_id || user?.id;
  const platform = usePublicSettings();

  const { data: balance } = useQuery({ queryKey: ["balance", creatorId], queryFn: () => api.wallet.balance(creatorId!), enabled: !!creatorId });
  const { data: ledger } = useQuery({ queryKey: ["ledger", creatorId], queryFn: () => api.wallet.ledger(creatorId!), enabled: !!creatorId });
  const { data: kyc } = useQuery({ queryKey: ["kyc", creatorId], queryFn: () => api.payouts.kycStatus(creatorId!).catch(() => null), enabled: !!creatorId });
  const { data: payouts } = useQuery({ queryKey: ["payouts", creatorId], queryFn: () => api.payouts.list(creatorId), enabled: !!creatorId });
  const { data: termsStatus } = useQuery({ queryKey: ["creator-terms-status"], queryFn: () => api.users.creatorTermsStatus(), enabled: !!creatorId });

  const [showKyc, setShowKyc] = useState(false);
  const [kycType, setKycType] = useState<"bank" | "upi">("bank");
  const [form, setForm] = useState({ accountHolderName: "", email: user?.email || "", contactNumber: "", accountNumber: "", ifsc: "", upiId: "" });
  const [err, setErr] = useState<string | null>(null);

  const saveKyc = useMutation({
    mutationFn: () => api.payouts.kyc(creatorId!, { type: kycType, accountHolderName: form.accountHolderName, email: form.email, contactNumber: form.contactNumber, accountNumber: form.accountNumber, ifsc: form.ifsc, upiId: form.upiId }),
    onSuccess: () => { setShowKyc(false); qc.invalidateQueries({ queryKey: ["kyc", creatorId] }); },
    onError: (e) => setErr(e instanceof Error ? e.message : "KYC save failed"),
  });

  if (!user) return null;

  return (
    <>
      <Navbar variant="creator" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><Wallet className="h-5 w-5" /></span>
          <div>
            <h1 className="heading-2">Finance</h1>
            <p className="text-sm text-fg-dim">Earnings, payouts, and tax documents.</p>
          </div>
          {termsStatus && (
            <span className={`chip ml-auto ${termsStatus.accepted ? "border-success/30 text-success" : "border-warning/30 text-warning"}`}>
              {termsStatus.accepted
                ? `Creator terms ${termsStatus.currentVersion} accepted`
                : `Action needed: accept creator terms ${termsStatus.currentVersion}`}
            </span>
          )}
        </div>

        <section className="mt-6 grid gap-4 sm:grid-cols-4">
          <Stat label="Pending balance" value={formatINR((balance?.pending ?? 0) / 100)} highlight />
          <Stat label="Lifetime earnings" value={formatINR((balance?.total_earned ?? 0) / 100)} />
          <Stat label={`Platform fee (${platform.commissionPercent}%)`} value={formatINR((balance?.total_commission ?? 0) / 100)} muted />
          <Stat label="Lifetime payouts" value={formatINR((balance?.total_paid_out ?? 0) / 100)} muted />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="card lg:col-span-2">
            <h3 className="font-display text-sm font-semibold">Ledger</h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-widest text-fg-dim">
                  <tr><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2 text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {(ledger || []).length === 0 ? (
                    <tr><td colSpan={3} className="p-4 text-center text-fg-dim">No transactions yet.</td></tr>
                  ) : (ledger || []).map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="p-2 text-fg-dim">{new Date(l.created_at).toLocaleDateString()}</td>
                      <td className="p-2 capitalize">{l.type.replace(/_/g, " ")}</td>
                      <td className={`p-2 text-right tabular-nums ${l.amount > 0 ? "text-success" : "text-fg-dim"}`}>
                        {l.amount > 0 ? "+" : ""}{formatINR(l.amount / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card">
              <h3 className="font-display text-sm font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" /> Bank / UPI</h3>
              {kyc ? (
                <div className="mt-3 space-y-1 text-sm">
                  {kyc.bank_name && <p>{kyc.bank_name}</p>}
                  {kyc.account_number_last4 && <p className="font-mono text-xs text-fg-dim">XXXX XXXX {kyc.account_number_last4}</p>}
                  {kyc.upi_id && <p className="font-mono text-xs text-fg-dim">{kyc.upi_id}</p>}
                  <span className={`chip mt-2 inline-flex ${kyc.kyc_status === "approved" ? "border-success/30 text-success" : "border-warning/30 text-warning"}`}>
                    <ShieldCheck className="h-3 w-3" /> KYC {kyc.kyc_status}
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-xs text-fg-dim">No payout method on file. Add one to receive earnings.</p>
              )}
              <button onClick={() => setShowKyc(true)} className="btn-ghost mt-4 w-full text-xs">{kyc ? "Update details" : "Add bank / UPI"}</button>
            </div>

            <div className="card">
              <h3 className="font-display text-sm font-semibold">Payout history</h3>
              <div className="mt-3 space-y-2">
                {(payouts || []).length === 0 ? (
                  <p className="text-xs text-fg-dim">No payouts yet.</p>
                ) : (payouts || []).slice(0, 5).map((p) => {
                  const x = p as { id: string; amount: number; status: string; created_at: string };
                  return (
                    <div key={x.id} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium tabular-nums">{formatINR(x.amount / 100)}</p>
                        <p className="text-xs text-fg-dim">{new Date(x.created_at).toLocaleDateString()}</p>
                      </div>
                      <span className={`chip ${x.status === "processed" ? "border-success/30 text-success" : x.status === "processing" ? "border-warning/30 text-warning" : "border-danger/30 text-danger"}`}>{x.status}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {creatorId && <AnnualStatementSection creatorId={creatorId} />}

        {showKyc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowKyc(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative w-full max-w-md rounded-2xl glass-strong p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="heading-3">Add payout method</h3>
              <p className="mt-1 text-xs text-fg-dim">Razorpay will verify your account. KYC takes 24-48 hours.</p>

              <div className="mt-4 flex gap-2">
                {(["bank", "upi"] as const).map((t) => (
                  <button key={t} onClick={() => setKycType(t)} className={`flex-1 rounded-full border px-3 py-1.5 text-xs ${kycType === t ? "border-brand bg-surface-2" : "border-border text-fg-dim"}`}>
                    {t === "bank" ? "Bank Account" : "UPI ID"}
                  </button>
                ))}
              </div>

              {err && <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger"><AlertCircle className="mt-0.5 h-3.5 w-3.5" />{err}</div>}

              <div className="mt-4 space-y-3 text-sm">
                <input placeholder="Account holder name" value={form.accountHolderName} onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })} className="input" />
                <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" />
                <input placeholder="Contact number" value={form.contactNumber} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} className="input" />
                {kycType === "bank" ? (
                  <>
                    <input placeholder="Account number" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} className="input" />
                    <input placeholder="IFSC (e.g. HDFC0000123)" value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} className="input font-mono" />
                  </>
                ) : (
                  <input placeholder="UPI ID (e.g. you@upi)" value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} className="input" />
                )}
              </div>

              <div className="mt-5 flex gap-2">
                <button onClick={() => setShowKyc(false)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={() => saveKyc.mutate()} disabled={saveKyc.isPending} className="btn-primary flex-1">
                  {saveKyc.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function financialYearOptions(): string[] {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return [0, 1, 2].map((offset) => {
    const y = startYear - offset;
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  });
}

function AnnualStatementSection({ creatorId }: { creatorId: string }) {
  const years = financialYearOptions();
  const [fy, setFy] = useState(years[0]);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data: statement, isLoading, isError, error } = useQuery({
    queryKey: ["annual-statement", creatorId, fy],
    queryFn: () => api.payouts.annualStatement(fy),
  });

  const download = useMutation({
    mutationFn: async (format: "pdf" | "csv") => {
      const blob = await api.payouts.downloadAnnualStatement(fy, format);
      saveBlob(blob, `learnrift-statement-${fy}.${format}`);
    },
    onError: (e) => setDownloadError(e instanceof Error ? e.message : "Download failed"),
  });

  const rows: [string, number][] = statement ? [
    ["Gross revenue", statement.grossPaise],
    ["Platform commission", statement.commissionPaise],
    ["Refunds", statement.refundsPaise],
    ["TDS deducted", statement.tdsPaise],
    ["Net earnings", statement.netPaise],
    ["Payouts made", statement.payoutsPaise],
    ["Pending balance", statement.pendingPaise],
  ] : [];

  return (
    <section className="mt-8 card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> Annual statement (TDS)</h3>
          <p className="mt-1 text-xs text-fg-dim">Financial-year summary built from your live ledger and payouts. Download for your tax filing.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={fy} onChange={(e) => setFy(e.target.value)} className="input w-36">
            {years.map((y) => <option key={y} value={y}>FY {y}</option>)}
          </select>
          <button onClick={() => { setDownloadError(null); download.mutate("pdf"); }} disabled={download.isPending || isLoading} className="btn-primary px-4 py-2 text-xs disabled:opacity-50">
            {download.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PDF
          </button>
          <button onClick={() => { setDownloadError(null); download.mutate("csv"); }} disabled={download.isPending || isLoading} className="btn-ghost px-4 py-2 text-xs disabled:opacity-50">
            CSV
          </button>
        </div>
      </div>

      {downloadError && <p className="mt-3 text-xs text-danger">{downloadError}</p>}

      {isLoading ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-border bg-surface-2 p-4">
              <div className="h-3 w-24 rounded bg-surface" />
              <div className="mt-2 h-5 w-20 rounded bg-surface" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <p className="mt-4 text-sm text-danger">{error instanceof Error ? error.message : "Could not load the statement"}</p>
      ) : statement ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {rows.map(([label, paise]) => (
              <div key={label} className="rounded-xl border border-border bg-surface-2/60 p-4">
                <p className="text-xs uppercase tracking-widest text-fg-dim">{label}</p>
                <p className="mt-1 font-display text-lg font-bold tabular-nums">{formatINR(paise / 100)}</p>
              </div>
            ))}
          </div>
          {statement.isEstimate && (
            <p className="mt-3 text-xs text-warning">Figures shown are dev/estimated values — connect the database for exact ledger numbers.</p>
          )}
        </>
      ) : null}
    </section>
  );
}

function Stat({ label, value, highlight, muted }: { label: string; value: string; highlight?: boolean; muted?: boolean }) {
  return (
    <div className={`card ${highlight ? "border-brand/40 shadow-glow" : ""}`}>
      <p className="text-xs uppercase tracking-widest text-fg-dim">{label}</p>
      <p className={`mt-2 font-display text-2xl font-bold ${muted ? "text-fg-dim" : highlight ? "gradient-text" : ""}`}>{value}</p>
    </div>
  );
}
