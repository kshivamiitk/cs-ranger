"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, MessageCircle, Search, Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/utils";

const FAQS = [
  ["How do I get a refund?", "Refunds are available within 7 days of enrollment, no questions asked. Visit Transactions and click 'Refund' on the eligible payment."],
  ["I can't access a paid course after payment", "Sometimes there's a 60-second delay for the webhook. If it persists, open a ticket with your Razorpay transaction ID."],
  ["How do I change my password?", "Settings → Account → Change Password. You'll need to enter the current one for security."],
  ["Where do I report inappropriate content?", "Every comment and course page has a 'Report' option in its overflow menu."],
];

export default function SupportPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const { data: tickets } = useQuery({ queryKey: ["my-tickets"], queryFn: () => api.support.list() });
  const create = useMutation({
    mutationFn: () => api.support.create({ subject, body }),
    onSuccess: () => { setSubject(""); setBody(""); qc.invalidateQueries({ queryKey: ["my-tickets"] }); },
  });

  const filtered = q ? FAQS.filter(([a, b]) => (a + b).toLowerCase().includes(q.toLowerCase())) : FAQS;

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-10 md:px-6">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><LifeBuoy className="h-5 w-5" /></span>
          <div>
            <h1 className="heading-2">Support</h1>
            <p className="text-sm text-fg-dim">We're here to help. Most answers are below — if not, open a ticket.</p>
          </div>
        </div>

        <div className="card mb-8">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the FAQ…" className="input pl-9" />
          </div>
          <div className="mt-4 space-y-2">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-dim">No matching FAQs. Open a ticket below.</p>
            ) : (
              filtered.map(([q, a], i) => (
                <details key={i} className="group rounded-xl border border-border bg-surface-2 p-4 open:bg-surface">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
                    {q}
                    <span className="text-brand transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-2 text-sm text-fg-dim">{a}</p>
                </details>
              ))
            )}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="card">
            <h3 className="font-display text-lg font-semibold flex items-center gap-2"><MessageCircle className="h-4 w-4 text-brand" /> Open a ticket</h3>
            <p className="mt-1 text-sm text-fg-dim">We reply within 24 hours.</p>
            <div className="mt-4 space-y-3">
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="input" />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="What's going on?" className="input min-h-[120px] resize-y" />
              <button onClick={() => create.mutate()} disabled={!subject || !body || create.isPending} className="btn-primary w-full">
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit ticket"}
              </button>
            </div>
          </div>

          <div>
            <h3 className="mb-3 font-display text-lg font-semibold">Your tickets</h3>
            {!tickets || tickets.length === 0 ? (
              <div className="card text-center text-fg-dim">No tickets yet.</div>
            ) : (
              <div className="space-y-2">
                {tickets.map((t) => (
                  <div key={t.id} className="card">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{t.subject}</p>
                      <span className={`chip ${t.status === "resolved" ? "border-success/30 text-success" : t.status === "in_progress" ? "border-warning/30 text-warning" : "border-brand/30 text-brand"}`}>
                        {t.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-fg-dim">Updated {relativeTime(t.updated_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
