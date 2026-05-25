"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, AlertTriangle, Loader2, Check, RefreshCw, X, CalendarClock } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { formatINR } from "@/lib/utils";

const SCHEDULE_LABEL: Record<string, string> = {
  manual: "Manual",
  monthly_1st: "Automatic · 1st of month",
  monthly_1st_15th: "Automatic · 1st & 15th",
};

type EligibleRow = { creator_id: string; pending: number; kyc_details: { account_number_last4?: string; upi_id?: string; kyc_status: string; razorpay_fund_account_id?: string } };

export default function AdminPayoutsPage() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [manualTarget, setManualTarget] = useState<EligibleRow | null>(null);
  const [result, setResult] = useState<{ ok: number; failed: number; total: number; runId?: string } | null>(null);
  const [manualResult, setManualResult] = useState<{ amount: number; creatorId: string } | null>(null);
  const [runDueMessage, setRunDueMessage] = useState<string | null>(null);

  const { data: settingsData } = useQuery({ queryKey: ["platform-settings"], queryFn: () => api.admin.platformSettings() });
  const { data: eligible, refetch } = useQuery({ queryKey: ["eligible-payout"], queryFn: () => api.wallet.eligibleForPayout() });
  const { data: runs } = useQuery({ queryKey: ["payout-runs"], queryFn: () => api.payouts.runs() });
  const { data: scheduler } = useQuery({ queryKey: ["payout-scheduler"], queryFn: () => api.payouts.schedulerStatus() });
  const { data: failedPayouts, isLoading: failedLoading, isError: failedError, refetch: refetchFailed } = useQuery({
    queryKey: ["failed-payouts"],
    queryFn: () => api.payouts.failed(),
  });

  const settings = settingsData?.settings;

  const initiate = useMutation({
    mutationFn: () => api.payouts.bulk(),
    onSuccess: (r) => {
      const ok = r.results.filter((x) => x.status === "processing" || x.status === "processed").length;
      const failed = r.results.filter((x) => x.status === "failed").length;
      const total = r.results.reduce((s, x) => s + x.amount, 0);
      setResult({ ok, failed, total, runId: r.runId });
      setConfirm(false);
      refetch();
      qc.invalidateQueries({ queryKey: ["payout-runs"] });
      qc.invalidateQueries({ queryKey: ["failed-payouts"] });
    },
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.payouts.retry(id),
    onSuccess: () => {
      refetchFailed();
      qc.invalidateQueries({ queryKey: ["payout-runs"] });
    },
  });

  const runDue = useMutation({
    mutationFn: () => api.payouts.runDuePayouts(),
    onSuccess: (r) => {
      if (r.status === "completed" && r.run) {
        setRunDueMessage(`Scheduled run completed for window ${r.windowKey}: ${formatINR(r.run.totalAmount / 100)} across ${r.run.count} creator${r.run.count === 1 ? "" : "s"}.`);
      } else {
        const reason = r.reason === "already_processed" ? "this window has already been processed"
          : r.reason === "no_eligible" ? "no creators are currently eligible"
          : "the payout schedule is set to manual";
        setRunDueMessage(`Nothing disbursed — ${reason}.`);
      }
      refetch();
      qc.invalidateQueries({ queryKey: ["payout-scheduler"] });
      qc.invalidateQueries({ queryKey: ["payout-runs"] });
      qc.invalidateQueries({ queryKey: ["failed-payouts"] });
    },
  });

  const totalEligible = (eligible || []).reduce((s, e) => s + e.pending, 0);

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><Wallet className="h-5 w-5" /></span>
          <div>
            <h1 className="heading-2">Payouts</h1>
            <p className="text-sm text-fg-dim">Commission settings and bulk payout management.</p>
          </div>
        </div>

        {result && (
          <div className="mb-6 flex items-start gap-2 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
            <Check className="mt-0.5 h-5 w-5 text-success" />
            <div>
              <p className="font-medium">Payout run initiated</p>
              <p className="text-xs text-fg-dim">{result.ok} processing / {result.failed} failed · {formatINR(result.total / 100)} disbursed · run {result.runId}</p>
            </div>
          </div>
        )}
        {manualResult && (
          <div className="mb-6 flex items-start gap-2 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
            <Check className="mt-0.5 h-5 w-5 text-success" />
            <div>
              <p className="font-medium">Manual payout dispatched</p>
              <p className="text-xs text-fg-dim">{formatINR(manualResult.amount / 100)} to creator {manualResult.creatorId.slice(0, 8)}… · logged in the audit log</p>
            </div>
          </div>
        )}

        <section className="mb-8 grid gap-6 lg:grid-cols-3">
          <div className="card">
            <div className="flex items-start justify-between">
              <h3 className="font-display text-sm font-semibold">Payout settings</h3>
              <Link href="/admin/settings" className="text-xs text-brand">Edit →</Link>
            </div>
            <p className="mt-1 text-xs text-fg-dim">Stored in platform settings — applied to every run.</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-fg-dim">Commission</dt>
                <dd className="font-display text-xl font-bold gradient-text">{settings ? `${Math.round(settings.commission_rate * 10000) / 100}%` : "—"}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-fg-dim">Minimum payout</dt>
                <dd className="font-medium tabular-nums">{settings ? formatINR(settings.min_payout_inr) : "—"}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-fg-dim">Schedule</dt>
                <dd className="font-medium">{settings ? SCHEDULE_LABEL[settings.payout_schedule] || settings.payout_schedule : "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="card lg:col-span-2">
            <h3 className="font-display text-sm font-semibold">Initiate bulk payout</h3>
            <p className="mt-1 text-xs text-fg-dim">{(eligible || []).length} creators eligible · total {formatINR(totalEligible / 100)}</p>

            <div className="mt-4 max-h-64 overflow-y-auto divide-y divide-border rounded-xl border border-border">
              {(eligible || []).length === 0 ? (
                <p className="p-4 text-center text-sm text-fg-dim">No creators currently eligible for payout.</p>
              ) : (eligible || []).map((e) => (
                <div key={e.creator_id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="font-mono text-xs text-fg-dim">{e.creator_id.slice(0, 8)}…</div>
                  <p className="tabular-nums font-medium">{formatINR(e.pending / 100)}</p>
                  <span className={`chip ${e.kyc_details?.kyc_status === "approved" ? "border-success/30 text-success" : "border-warning/30 text-warning"}`}>KYC {e.kyc_details?.kyc_status || "missing"}</span>
                  <button onClick={() => { setManualTarget(e); setManualResult(null); }} className="text-xs text-brand">Manual payout</button>
                </div>
              ))}
            </div>

            <button onClick={() => setConfirm(true)} disabled={!(eligible || []).length} className="btn-primary mt-4 disabled:opacity-50">
              Initiate bulk payout ({formatINR(totalEligible / 100)})
            </button>
          </div>
        </section>

        <section className="mb-8">
          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><CalendarClock className="h-4 w-4" /> Scheduled payouts</h3>
                <p className="mt-1 text-xs text-fg-dim">
                  {!scheduler
                    ? "Loading schedule…"
                    : scheduler.schedule === "manual"
                      ? "Automatic payouts are off — payouts only run when an admin initiates them. Change the schedule in Settings to enable scheduled runs."
                      : `${SCHEDULE_LABEL[scheduler.schedule]} · current window opened ${scheduler.currentWindow ? new Date(scheduler.currentWindow.opensAt).toLocaleDateString() : "—"} · next window ${scheduler.nextWindowOpensAt ? new Date(scheduler.nextWindowOpensAt).toLocaleDateString() : "—"}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {scheduler?.currentWindow && (
                  <span className={`chip ${scheduler.currentWindow.alreadyProcessed ? "border-success/30 text-success" : "border-warning/30 text-warning"}`}>
                    {scheduler.currentWindow.alreadyProcessed ? "This window: processed" : "This window: due"}
                  </span>
                )}
                <button
                  onClick={() => runDue.mutate()}
                  disabled={!scheduler || scheduler.schedule === "manual" || scheduler.currentWindow?.alreadyProcessed || runDue.isPending}
                  className="btn-primary px-4 py-1.5 text-xs disabled:opacity-50"
                >
                  {runDue.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Run due payouts now"}
                </button>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-fg-dim">Last scheduled run</dt>
                <dd className="mt-0.5 font-medium">
                  {scheduler?.lastScheduledRun
                    ? `${new Date(scheduler.lastScheduledRun.initiated_at).toLocaleString()} · ${formatINR(scheduler.lastScheduledRun.total_amount / 100)} to ${scheduler.lastScheduledRun.creator_count} creator${scheduler.lastScheduledRun.creator_count === 1 ? "" : "s"}`
                    : "Never"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-dim">Cron worker</dt>
                <dd className="mt-0.5 font-mono text-xs">npm run payout:run-due <span className="font-sans text-fg-dim">(backend, run daily)</span></dd>
              </div>
              <div>
                <dt className="text-xs text-fg-dim">Idempotency</dt>
                <dd className="mt-0.5 text-xs text-fg-dim">One disbursement per window — re-running inside the same window is a no-op.</dd>
              </div>
            </dl>
            {scheduler?.mockMode && (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                RazorpayX is not configured — runs use the mock branch: payouts settle instantly in the wallet ledger and no real money moves.
              </p>
            )}
            {runDueMessage && <p className="mt-3 text-xs text-fg-dim">{runDueMessage}</p>}
            {runDue.isError && (
              <p className="mt-3 text-xs text-danger">{runDue.error instanceof Error ? runDue.error.message : "Scheduled run failed"}</p>
            )}
          </div>
        </section>

        <section className="mb-8">
          <h3 className="mb-3 heading-3">Payout history</h3>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-widest text-fg-dim">
                <tr>
                  <th className="p-3">Date</th><th className="p-3">Creators</th><th className="p-3">Total disbursed</th><th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {((runs as { id: string; initiated_at: string; creator_count: number; total_amount: number; payout_items?: { status: string }[] }[]) || []).length === 0 ? (
                  <tr><td colSpan={4} className="p-4 text-center text-fg-dim">No payout runs yet.</td></tr>
                ) : ((runs as { id: string; initiated_at: string; creator_count: number; total_amount: number; payout_items?: { status: string }[] }[]) || []).map((r) => {
                  const failed = r.payout_items?.filter((p) => p.status === "failed").length || 0;
                  return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="p-3 text-fg-dim">{new Date(r.initiated_at).toLocaleDateString()}</td>
                      <td className="p-3">{r.creator_count}</td>
                      <td className="p-3 tabular-nums">{formatINR(r.total_amount / 100)}</td>
                      <td className="p-3"><span className={`chip ${failed > 0 ? "border-warning/30 text-warning" : "border-success/30 text-success"}`}>{failed > 0 ? `${failed} failed` : "Completed"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-3 heading-3 flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-400" /> Failed payouts</h3>
          <div className="card overflow-x-auto p-0">
            {failedLoading ? (
              <div className="flex justify-center p-6 text-fg-dim"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : failedError ? (
              <div className="p-6 text-center text-sm">
                <p className="text-danger">Could not load failed payouts.</p>
                <button onClick={() => refetchFailed()} className="btn-ghost mx-auto mt-3 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
              </div>
            ) : (failedPayouts?.items.length ?? 0) === 0 ? (
              <p className="p-6 text-center text-sm text-fg-dim">No failed payouts. 🎉</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs uppercase tracking-widest text-fg-dim">
                  <tr>
                    <th className="p-3">Creator</th><th className="p-3">Amount</th><th className="p-3">Run date</th><th className="p-3">Failure reason</th><th className="p-3">Retries</th><th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {failedPayouts!.items.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="p-3">
                        <p className="font-medium">{item.creator?.profiles?.display_name || item.creator?.email || `${item.creator_id.slice(0, 8)}…`}</p>
                        {item.creator?.email && <p className="text-xs text-fg-dim">{item.creator.email}</p>}
                      </td>
                      <td className="p-3 tabular-nums">{formatINR(item.amount / 100)}</td>
                      <td className="p-3 text-fg-dim">{new Date(item.payout_runs?.initiated_at || item.created_at).toLocaleDateString()}</td>
                      <td className="p-3 text-fg-dim">{item.failure_reason || "Unknown"}</td>
                      <td className="p-3 text-fg-dim">{item.retry_count}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => retry.mutate(item.id)}
                          disabled={retry.isPending && retry.variables === item.id}
                          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs hover:border-brand disabled:opacity-50"
                        >
                          {retry.isPending && retry.variables === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Retry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {retry.isError && (
            <p className="mt-2 text-xs text-danger">Retry failed: {retry.error instanceof Error ? retry.error.message : "Unknown error"}</p>
          )}
        </section>

        {confirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setConfirm(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative w-full max-w-md rounded-2xl glass-strong p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="heading-3">Confirm bulk payout</h3>
              <p className="mt-2 text-sm text-fg-dim">
                You're about to disburse <b className="text-fg">{formatINR(totalEligible / 100)}</b> to <b className="text-fg">{(eligible || []).length}</b> creators via Razorpay Payouts.
              </p>
              <p className="mt-2 text-xs text-fg-dim">This action is logged in the audit log. Only KYC-approved creators are included.</p>
              {initiate.isError && (
                <p className="mt-3 text-xs text-danger">{initiate.error instanceof Error ? initiate.error.message : "Bulk payout failed"}</p>
              )}
              <div className="mt-5 flex gap-2">
                <button onClick={() => setConfirm(false)} className="btn-ghost flex-1">Cancel</button>
                <button onClick={() => initiate.mutate()} disabled={initiate.isPending} className="btn-primary flex-1">
                  {initiate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & Disburse"}
                </button>
              </div>
            </div>
          </div>
        )}

        {manualTarget && (
          <ManualPayoutModal
            target={manualTarget}
            onClose={() => setManualTarget(null)}
            onSuccess={(amountPaise) => {
              setManualResult({ amount: amountPaise, creatorId: manualTarget.creator_id });
              setManualTarget(null);
              refetch();
              qc.invalidateQueries({ queryKey: ["payout-runs"] });
              qc.invalidateQueries({ queryKey: ["failed-payouts"] });
            }}
          />
        )}
      </main>
      <Footer />
    </>
  );
}

function ManualPayoutModal({ target, onClose, onSuccess }: { target: EligibleRow; onClose: () => void; onSuccess: (amountPaise: number) => void }) {
  const [amount, setAmount] = useState(String(Math.floor(target.pending / 100)));
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);

  const pay = useMutation({
    mutationFn: () => api.payouts.manual({ creatorId: target.creator_id, amountInr: Number(amount), reason, override }),
    onSuccess: (r) => onSuccess(r.amount),
  });

  const amountInr = Number(amount);
  const exceedsPending = Number.isFinite(amountInr) && amountInr * 100 > target.pending;
  const invalid = !Number.isFinite(amountInr) || amountInr <= 0 || reason.trim().length < 10 || (exceedsPending && !override);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl glass-strong p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h3 className="heading-3">Manual payout</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-fg-dim hover:bg-surface-2 hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-2 text-sm text-fg-dim">
          Off-cycle payout to creator <span className="font-mono text-xs">{target.creator_id.slice(0, 8)}…</span> ·
          pending balance <b className="text-fg">{formatINR(target.pending / 100)}</b> ·
          KYC <span className={target.kyc_details?.kyc_status === "approved" ? "text-success" : "text-warning"}>{target.kyc_details?.kyc_status || "missing"}</span>
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-fg-dim">Amount (INR)</span>
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="input tabular-nums" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-medium text-fg-dim">Reason (min 10 characters, recorded in the audit log)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="input min-h-[72px]" placeholder="e.g. Dispute resolution for refund reversal in April" />
        </label>
        {exceedsPending && (
          <label className="mt-3 flex items-start gap-2 text-xs text-warning">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[var(--brand-primary)]" />
            Amount exceeds the creator&apos;s pending balance — tick to override the balance check.
          </label>
        )}
        {pay.isError && (
          <p className="mt-3 text-xs text-danger">{pay.error instanceof Error ? pay.error.message : "Payout failed"}</p>
        )}
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1" disabled={pay.isPending}>Cancel</button>
          <button onClick={() => pay.mutate()} disabled={invalid || pay.isPending} className="btn-primary flex-1 disabled:opacity-50">
            {pay.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Pay ${Number.isFinite(amountInr) && amountInr > 0 ? formatINR(amountInr) : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
