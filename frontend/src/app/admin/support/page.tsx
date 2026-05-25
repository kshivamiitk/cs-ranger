"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LifeBuoy, Loader2, ReceiptText, X } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api, type RefundContext } from "@/lib/api";
import { useApp } from "@/app/providers";
import { formatINR, relativeTime } from "@/lib/utils";

export default function AdminSupportPage() {
  const qc = useQueryClient();
  const { user } = useApp();
  const { data: tickets, isLoading } = useQuery({ queryKey: ["admin-tickets"], queryFn: () => api.support.list() });
  const [activeId, setActiveId] = useState<string | null>(null);
  // Full detail (messages + refund context) comes from the detail endpoint —
  // the list payload only carries summaries.
  const { data: detail } = useQuery({
    queryKey: ["admin-ticket", activeId],
    queryFn: () => api.support.get(activeId!),
    enabled: !!activeId,
  });
  const active = detail || (tickets || []).find((t) => t.id === activeId);
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);

  const invalidateTicket = () => {
    qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    qc.invalidateQueries({ queryKey: ["admin-ticket", activeId] });
  };

  const reply = useMutation({
    mutationFn: () => api.support.reply(activeId!, body, isInternal),
    onSuccess: () => { setBody(""); invalidateTicket(); },
  });

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><LifeBuoy className="h-5 w-5" /></span>
          <div>
            <h1 className="heading-2">Support Inbox</h1>
            <p className="text-sm text-fg-dim">All tickets from learners and creators.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !tickets || tickets.length === 0 ? (
          <div className="card text-center text-fg-dim">No support tickets yet.</div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[340px_1fr]">
            <div className="card max-h-[70vh] overflow-y-auto p-0">
              {tickets.map((t) => (
                <button key={t.id} onClick={() => setActiveId(t.id)}
                  className={`flex w-full flex-col items-start gap-1 border-b border-border p-3 text-left transition hover:bg-surface-2 last:border-0 ${activeId === t.id ? "bg-surface-2" : ""}`}>
                  <div className="flex w-full items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{t.subject}</p>
                    <span className={`chip ${t.status === "resolved" ? "border-success/30 text-success" : t.status === "in_progress" ? "border-warning/30 text-warning" : "border-brand/30 text-brand"}`}>{t.status.replace("_", " ")}</span>
                  </div>
                  <p className="text-[10px] uppercase tracking-widest text-fg-dim">{relativeTime(t.updated_at)}</p>
                </button>
              ))}
            </div>

            {active ? (
              <div className="card">
                <h2 className="heading-3">{active.subject}</h2>
                {detail?.refund_context && activeId && (
                  <RefundPanel
                    ticketId={activeId}
                    ticketStatus={detail.status}
                    refund={detail.refund_context}
                    onChanged={invalidateTicket}
                  />
                )}
                <div className="mt-4 space-y-3">
                  {(active.messages || []).map((m) => (
                    <div key={m.id} className={`rounded-2xl p-3 text-sm ${m.author_id === user?.id ? "ml-12 bg-brand-gradient text-white" : "mr-12 bg-surface-2"}`}>
                      {m.is_internal_note && <span className="mr-1 chip">internal</span>}
                      {m.body}
                      <p className={`mt-1 text-[10px] opacity-70`}>{relativeTime(m.created_at)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Reply…" className="input min-h-[80px]" />
                  <div className="mt-2 flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs text-fg-dim">
                      <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} className="accent-[color:var(--brand-primary)]" /> Internal note
                    </label>
                    <button onClick={() => reply.mutate()} disabled={!body || reply.isPending} className="btn-primary px-3 py-1.5 text-xs">
                      {reply.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send reply"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="card text-center text-fg-dim">Select a ticket to reply.</div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function RefundPanel({ ticketId, ticketStatus, refund, onChanged }: { ticketId: string; ticketStatus: string; refund: RefundContext; onChanged: () => void }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const alreadyRefunded = refund.status === "refunded";
  const terminal = alreadyRefunded || ticketStatus === "resolved";

  const approve = useMutation({
    mutationFn: async () => {
      // Money movement first (idempotent server-side), then record the decision on the ticket.
      await api.payments.refund(refund.payment_id);
      await api.support.refundDecision(ticketId, true);
    },
    onSuccess: onChanged,
    onError: (e) => setError(e instanceof Error ? e.message : "Refund failed"),
  });
  const reject = useMutation({
    mutationFn: () => api.support.refundDecision(ticketId, false, reason.trim()),
    onSuccess: () => { setRejectOpen(false); setReason(""); onChanged(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not record the rejection"),
  });

  return (
    <div className="mt-4 rounded-2xl border border-warning/40 bg-warning/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><ReceiptText className="h-4 w-4 text-warning" /> Refund request</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-xs uppercase tracking-widest text-fg-dim">Course</dt><dd className="mt-0.5 line-clamp-1">{refund.course_title}</dd></div>
        <div><dt className="text-xs uppercase tracking-widest text-fg-dim">Amount</dt><dd className="mt-0.5 tabular-nums">{formatINR(refund.amount / 100)}</dd></div>
        <div><dt className="text-xs uppercase tracking-widest text-fg-dim">Paid</dt><dd className="mt-0.5">{new Date(refund.paid_at).toLocaleDateString()}</dd></div>
        <div><dt className="text-xs uppercase tracking-widest text-fg-dim">Payment</dt><dd className="mt-0.5 font-mono text-xs">{refund.payment_id.slice(0, 8)}…</dd></div>
        <div><dt className="text-xs uppercase tracking-widest text-fg-dim">Status</dt><dd className="mt-0.5 capitalize">{refund.status}</dd></div>
        <div>
          <dt className="text-xs uppercase tracking-widest text-fg-dim">Eligibility</dt>
          <dd className="mt-0.5">
            {refund.within_window
              ? <span className="chip border-success/30 text-success">Within {refund.refund_window_days}-day window</span>
              : <span className="chip border-danger/30 text-danger">Outside {refund.refund_window_days}-day window</span>}
          </dd>
        </div>
      </dl>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      {terminal ? (
        <p className="mt-3 text-xs text-fg-dim">
          {alreadyRefunded ? "This payment has already been refunded." : "This ticket is resolved — no further refund action available."}
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setError(null); if (confirm(`Refund ${formatINR(refund.amount / 100)} and revoke course access?`)) approve.mutate(); }}
              disabled={approve.isPending || reject.isPending}
              className="btn-primary px-4 py-1.5 text-xs disabled:opacity-50"
            >
              {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve refund
            </button>
            <button
              onClick={() => { setError(null); setRejectOpen((v) => !v); }}
              disabled={approve.isPending || reject.isPending}
              className="inline-flex items-center gap-1 rounded-full border border-danger/40 px-4 py-1.5 text-xs text-danger transition hover:bg-danger/10 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
          {rejectOpen && (
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason shared with the learner (required)…" className="input min-h-[56px] text-sm" />
              <div className="mt-2 flex justify-end">
                <button onClick={() => reject.mutate()} disabled={reason.trim().length < 5 || reject.isPending} className="btn-ghost px-3 py-1 text-xs disabled:opacity-50">
                  {reject.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm rejection"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
