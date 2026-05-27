"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ReceiptText, Loader2, BookOpen, Database, Download, Undo2, X } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api, type UserTransaction } from "@/lib/api";
import { formatINR, relativeTime, cn } from "@/lib/utils";

// Download the user's transactions as CSV. The Excel-friendly export covers
// the P3 "invoice / receipt" requirement at the basic level — full PDF
// invoicing with GSTIN is a regulatory enhancement for later.
function downloadCsv(rows: UserTransaction[]): void {
  const header = ["Date", "Kind", "Description", "Amount (INR)", "Status", "Razorpay Payment ID", "Razorpay Order ID"];
  const csv = [header.join(",")];
  for (const r of rows) {
    const cells = [
      new Date(r.created_at).toISOString(),
      r.kind,
      `"${(r.description || "").replace(/"/g, '""')}"`,
      (r.amount_paise / 100).toFixed(2),
      r.status,
      r.razorpay_payment_id || "",
      r.razorpay_order_id || "",
    ];
    csv.push(cells.join(","));
  }
  const blob = new Blob([csv.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

type Kind = "all" | "course" | "storage";

export default function TransactionsPage() {
  const [kind, setKind] = useState<Kind>("all");
  const [refundTarget, setRefundTarget] = useState<UserTransaction | null>(null);
  const [refundRequested, setRefundRequested] = useState<string | null>(null);
  // Backend reads from the user_transactions SQL view — one query, all kinds.
  // The kind filter is server-side so we don't ship rows the page won't show.
  const { data, isLoading } = useQuery({
    queryKey: ["my-transactions", kind],
    queryFn: () => api.payments.transactions(kind === "all" ? undefined : kind),
  });

  const total = (data || [])
    .filter((t) => t.status === "success")
    .reduce((sum, t) => sum + t.amount_paise, 0);
  const courseCount = (data || []).filter((t) => t.kind === "course" && t.status === "success").length;
  const storageCount = (data || []).filter((t) => t.kind === "storage" && t.status === "success").length;

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-10 md:px-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">
            <ReceiptText className="h-5 w-5" />
          </span>
          <div>
            <h1 className="heading-2">Transactions</h1>
            <p className="text-sm text-fg-dim">
              Course purchases and storage top-ups for your account. {total > 0 && <>Lifetime spend: <span className="font-medium text-fg">{formatINR(total / 100)}</span>.</>}
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full border border-border bg-surface-2 p-0.5 text-xs">
            {([
              { k: "all" as const, label: `All (${data?.length || 0})` },
              { k: "course" as const, label: `Courses (${courseCount})` },
              { k: "storage" as const, label: `Storage (${storageCount})` },
            ]).map((t) => (
              <button
                key={t.k}
                onClick={() => setKind(t.k)}
                className={cn(
                  "rounded-full px-3 py-1 transition",
                  kind === t.k ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {data && data.length > 0 && (
            <button onClick={() => downloadCsv(data)} className="btn-ghost text-xs">
              <Download className="h-3.5 w-3.5" /> Download CSV
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !data || data.length === 0 ? (
          <div className="card text-center text-fg-dim">
            No transactions yet. Course purchases and creator-storage top-ups will appear here.
          </div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface-2/60 text-left text-xs uppercase tracking-widest text-fg-dim">
                <tr>
                  <th className="p-3">Kind</th>
                  <th className="p-3">Description</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Razorpay ID</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={`${t.kind}-${t.id}`} className="border-t border-border">
                    <td className="p-3">
                      <span className="inline-flex items-center gap-1.5 text-xs text-fg-dim">
                        {t.kind === "course" ? <BookOpen className="h-3.5 w-3.5" /> : <Database className="h-3.5 w-3.5" />}
                        <span className="uppercase tracking-widest">{t.kind}</span>
                      </span>
                    </td>
                    <td className="p-3">
                      {t.kind === "course" && t.reference_id ? (
                        <Link href={`/course/${t.reference_id}`} className="hover:text-brand transition">{t.description}</Link>
                      ) : (
                        <span>{t.description}</span>
                      )}
                    </td>
                    <td className="p-3 tabular-nums font-medium">{formatINR(t.amount_paise / 100)}</td>
                    <td className="p-3">
                      <span
                        className={cn(
                          "chip",
                          t.status === "success" ? "border-success/30 text-success"
                          : t.status === "refunded" ? "border-amber-400/30 text-amber-300"
                          : t.status === "pending" ? "border-border text-fg-dim"
                          : "border-danger/30 text-danger",
                        )}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="p-3 text-fg-dim">
                      <span title={new Date(t.created_at).toLocaleString()}>{relativeTime(t.created_at)}</span>
                    </td>
                    <td className="p-3 font-mono text-[11px] text-fg-dim">
                      {t.razorpay_payment_id || t.razorpay_order_id || "—"}
                    </td>
                    <td className="p-3 text-right">
                      {t.kind === "course" && t.status === "success" && (
                        refundRequested === t.id ? (
                          <span className="text-xs text-success">Refund requested</span>
                        ) : (
                          <button onClick={() => setRefundTarget(t)} className="inline-flex items-center gap-1 text-xs text-fg-dim transition hover:text-brand">
                            <Undo2 className="h-3 w-3" /> Request refund
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* GST disclaimer — formal invoice generation (PDF + GSTIN) is the
            next compliance step; CSV export covers the basic record-keeping
            requirement today. */}
        <p className="mt-4 text-xs text-fg-dim">
          All prices are in INR and inclusive of applicable taxes. A formal GST invoice can be requested at support@learnrift.site.
        </p>

        {refundTarget && (
          <RefundRequestModal
            transaction={refundTarget}
            onClose={() => setRefundTarget(null)}
            onSubmitted={(paymentId) => { setRefundRequested(paymentId); setRefundTarget(null); }}
          />
        )}
      </main>
      <Footer />
    </>
  );
}

function RefundRequestModal({ transaction, onClose, onSubmitted }: { transaction: UserTransaction; onClose: () => void; onSubmitted: (paymentId: string) => void }) {
  const [reason, setReason] = useState("");

  const submit = useMutation({
    mutationFn: () => api.support.create({
      subject: `Refund request: ${transaction.description}`,
      body: reason.trim(),
      category: "Payment",
      relatedPaymentId: transaction.id,
    }),
    onSuccess: () => onSubmitted(transaction.id),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-2xl glass-strong p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h3 className="heading-3">Request a refund</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-fg-dim hover:bg-surface-2 hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-2 text-sm text-fg-dim">
          {transaction.description} · {formatINR(transaction.amount_paise / 100)} · paid {relativeTime(transaction.created_at)}.
          A support ticket is created and reviewed by the team — refunds inside the platform window are usually approved within 48 hours, and course access is revoked once refunded.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Tell us briefly why you'd like a refund…"
          className="input mt-4 min-h-[80px]"
        />
        {submit.isError && <p className="mt-2 text-xs text-danger">{submit.error instanceof Error ? submit.error.message : "Could not submit the request"}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="btn-ghost flex-1" disabled={submit.isPending}>Cancel</button>
          <button onClick={() => submit.mutate()} disabled={reason.trim().length < 5 || submit.isPending} className="btn-primary flex-1 disabled:opacity-50">
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}
