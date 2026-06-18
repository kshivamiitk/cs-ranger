"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Mail, Megaphone, RefreshCw, Send, Bell } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api, type BroadcastAudience, type BroadcastResult } from "@/lib/api";
import { relativeTime } from "@/lib/utils";

const AUDIENCES: { value: BroadcastAudience; label: string; hint: string }[] = [
  { value: "all", label: "All users & creators", hint: "Everyone with an active account." },
  { value: "learners", label: "Learners only", hint: "Accounts that hold the learner role." },
  { value: "creators", label: "Creators only", hint: "Accounts that hold the creator role." },
];

const SUBJECT_MAX = 150;
const MESSAGE_MAX = 5000;

export default function AdminBroadcastPage() {
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>("all");
  const [email, setEmail] = useState(true);
  const [inapp, setInapp] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);

  const history = useQuery({ queryKey: ["admin-broadcasts"], queryFn: () => api.admin.broadcastHistory() });
  const reach = useQuery({ queryKey: ["broadcast-audience", audience], queryFn: () => api.admin.broadcastAudience(audience) });

  const send = useMutation({
    mutationFn: () => api.admin.broadcast({ subject: subject.trim(), message: message.trim(), audience, channels: { email, inapp } }),
    onSuccess: (r) => {
      setResult(r);
      setConfirming(false);
      setSubject("");
      setMessage("");
      qc.invalidateQueries({ queryKey: ["admin-broadcasts"] });
    },
  });

  const audienceLabel = AUDIENCES.find((a) => a.value === audience)?.label ?? audience;
  const canSend = subject.trim().length >= 3 && message.trim().length >= 10 && (email || inapp);

  function startSend() {
    setResult(null);
    send.reset();
    setConfirming(true);
  }

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><Megaphone className="h-5 w-5 text-brand-accent" /></span>
          <div>
            <h1 className="heading-2">Broadcast</h1>
            <p className="mt-0.5 text-sm text-fg-dim">Send an announcement to your audience over in-app + email. Every send is audited.</p>
          </div>
        </div>

        <div className="mt-6 card space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-fg-dim">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={SUBJECT_MAX}
              placeholder="e.g. New courses just dropped 🎉"
              className="input"
            />
            <span className="mt-1 block text-right text-[11px] text-fg-dim">{subject.length}/{SUBJECT_MAX}</span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-fg-dim">Message</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MESSAGE_MAX}
              rows={7}
              placeholder="Write your announcement. Line breaks are preserved in the email."
              className="input resize-y"
            />
            <span className="mt-1 block text-right text-[11px] text-fg-dim">{message.length}/{MESSAGE_MAX}</span>
          </label>

          <div className="block">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-fg-dim">Audience</span>
              {reach.data && (
                <span className="text-[11px] text-fg-dim">
                  Reaches <b className="text-fg">{reach.data.recipientCount.toLocaleString()}</b> accounts · {reach.data.emailEligible.toLocaleString()} email-eligible
                </span>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {AUDIENCES.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAudience(a.value)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${
                    audience === a.value ? "border-brand bg-brand/10" : "border-border bg-surface-2 hover:border-brand/40"
                  }`}
                >
                  <span className="block text-sm font-medium">{a.label}</span>
                  <span className="mt-0.5 block text-[11px] text-fg-dim">{a.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="block">
            <span className="mb-1.5 block text-xs font-medium text-fg-dim">Channels</span>
            <div className="grid gap-2 sm:grid-cols-2">
              <Channel icon={<Bell className="h-4 w-4" />} label="In-app notification" description="Shows in the notification bell." checked={inapp} onChange={setInapp} />
              <Channel icon={<Mail className="h-4 w-4" />} label="Email" description="Sent to verified addresses only." checked={email} onChange={setEmail} />
            </div>
            {!email && !inapp && <p className="mt-2 text-xs text-danger">Select at least one channel.</p>}
            {email && <p className="mt-2 text-[11px] text-fg-dim">Email requires <code className="rounded bg-surface-2 px-1">RESEND_API_KEY</code> configured on the server.</p>}
          </div>

          {send.isError && (
            <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm">
              <p className="font-medium text-danger">Broadcast failed</p>
              <p className="mt-1 text-fg-dim">{send.error instanceof Error ? send.error.message : "Unknown error"}</p>
            </div>
          )}

          {result && (
            <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
              <p className="flex items-center gap-2 font-medium text-success"><Check className="h-4 w-4" /> Broadcast sent to {AUDIENCES.find((a) => a.value === result.audience)?.label.toLowerCase()}</p>
              <ul className="mt-2 space-y-0.5 text-fg-dim">
                <li>{result.recipientCount.toLocaleString()} accounts targeted{result.inappCreated > 0 ? ` · ${result.inappCreated.toLocaleString()} in-app notifications` : ""}</li>
                {result.emailTargeted > 0 && (
                  <li>{result.emailSent.toLocaleString()} emails sent{result.emailFailed > 0 ? ` · ${result.emailFailed.toLocaleString()} failed` : ""}</li>
                )}
              </ul>
            </div>
          )}

          {confirming ? (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-300"><AlertTriangle className="h-4 w-4" /> Send to {audienceLabel} via {[inapp && "in-app", email && "email"].filter(Boolean).join(" + ")}?</p>
              <p className="mt-1 text-xs text-fg-dim">
                {reach.data
                  ? `Reaches ${reach.data.recipientCount.toLocaleString()} accounts${email ? ` · ${reach.data.emailEligible.toLocaleString()} will get an email` : ""}. This cannot be undone.`
                  : "This reaches every matching account and cannot be undone."}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => send.mutate()} disabled={send.isPending} className="btn-primary disabled:opacity-50">
                  {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {send.isPending ? "Sending…" : "Yes, send now"}
                </button>
                <button onClick={() => setConfirming(false)} disabled={send.isPending} className="btn-ghost disabled:opacity-50">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <button onClick={startSend} disabled={!canSend} className="btn-primary disabled:opacity-50">
                <Send className="h-4 w-4" /> Review &amp; send
              </button>
            </div>
          )}
        </div>

        {/* History */}
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="heading-3">Recent broadcasts</h2>
            <button onClick={() => history.refetch()} className="btn-ghost text-xs"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
          </div>
          <div className="card divide-y divide-border p-0">
            {history.isLoading ? (
              <p className="p-6 text-center text-sm text-fg-dim">Loading…</p>
            ) : (history.data || []).length === 0 ? (
              <p className="p-6 text-center text-sm text-fg-dim">No broadcasts sent yet.</p>
            ) : (
              (history.data || []).map((b) => {
                const ch = b.metadata.channels || {};
                return (
                  <div key={b.id} className="flex items-start gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 font-medium">{b.metadata.subject || "(no subject)"}</p>
                      <p className="mt-0.5 text-xs text-fg-dim">
                        {AUDIENCES.find((a) => a.value === b.metadata.audience)?.label || b.metadata.audience || "—"} ·{" "}
                        {(b.metadata.recipientCount ?? 0).toLocaleString()} targeted
                        {ch.email ? ` · ${(b.metadata.emailSent ?? 0).toLocaleString()} emails${(b.metadata.emailFailed ?? 0) > 0 ? ` (${b.metadata.emailFailed} failed)` : ""}` : ""}
                        {ch.inapp ? ` · ${(b.metadata.inappCreated ?? 0).toLocaleString()} in-app` : ""}
                      </p>
                      {b.admin?.email && <p className="mt-0.5 text-[11px] text-fg-dim">by {b.admin.profiles?.display_name || b.admin.email}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-fg-dim">{relativeTime(b.created_at)}</span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Channel({ icon, label, description, checked, onChange }: { icon: React.ReactNode; label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
        checked ? "border-brand bg-brand/10" : "border-border bg-surface-2 hover:border-brand/40"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span className={checked ? "text-brand-accent" : "text-fg-dim"}>{icon}</span>
        <span>
          <span className="block text-sm font-medium">{label}</span>
          <span className="mt-0.5 block text-[11px] text-fg-dim">{description}</span>
        </span>
      </span>
      <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${checked ? "bg-brand" : "bg-border"}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}
