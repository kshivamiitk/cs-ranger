"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Plus, Loader2, AlertCircle, Check } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";
import { relativeTime, formatINR } from "@/lib/utils";

declare global {
  interface Window {
    Razorpay?: new (opts: RazorpayOpts) => { open: () => void };
  }
}
interface RazorpayOpts {
  key: string; amount: number; currency: string; name: string; description: string;
  order_id: string; prefill?: { name?: string; email?: string }; theme?: { color?: string };
  handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
}

let _scriptLoaded = false;
function loadRazorpay(): Promise<boolean> {
  if (_scriptLoaded) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => { _scriptLoaded = true; resolve(true); };
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function CreatorStoragePage() {
  const { user } = useApp();
  const qc = useQueryClient();
  const [mb, setMb] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successFlash, setSuccessFlash] = useState<string | null>(null);

  const { data: usage, isLoading } = useQuery({
    queryKey: ["storage-usage"],
    queryFn: () => api.courses.storageUsage(),
    enabled: !!user,
  });

  useEffect(() => { loadRazorpay(); }, []);

  const startCheckout = useMutation({
    mutationFn: async (mbToBuy: number) => {
      setError(null); setBusy(true);
      const ready = await loadRazorpay();
      if (!ready) throw new Error("Could not load payment gateway");
      const order = await api.courses.storagePurchaseOrder(mbToBuy);
      return new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay!({
          key: order.keyId,
          amount: order.amountPaise,
          currency: order.currency,
          name: "LearnRift Storage",
          description: `${order.mb} MB · valid for ${usage?.pricing.durationDays || 30} days`,
          order_id: order.orderId,
          prefill: { name: user?.displayName || user?.display_name || undefined, email: user?.email || undefined },
          theme: { color: "#7c3aed" },
          handler: async (r) => {
            try {
              const result = await api.courses.storageVerify(r);
              qc.invalidateQueries({ queryKey: ["storage-usage"] });
              setSuccessFlash(result.alreadyApplied
                ? "Payment already applied."
                : `Added ${result.granted_mb} MB — valid until ${result.extra_until ? new Date(result.extra_until).toLocaleDateString() : ""}.`);
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          modal: { ondismiss: () => reject(new Error("Checkout dismissed")) },
        });
        rzp.open();
      });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Purchase failed";
      if (msg.toLowerCase().includes("dismiss")) setError(null); // user closed modal — not a real error
      else setError(msg);
    },
    onSettled: () => setBusy(false),
  });

  const used = usage?.bytesUsed ?? 0;
  const quota = usage?.quotaBytes ?? 0;
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const remaining = usage?.remainingBytes ?? 0;
  const price = usage?.pricing.pricePerMbInr ?? 5;
  const days = usage?.pricing.durationDays ?? 30;

  return (
    <>
      <Navbar variant="creator" />
      <main className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">
            <Database className="h-5 w-5" />
          </span>
          <div>
            <h1 className="heading-2">Storage</h1>
            <p className="text-sm text-fg-dim">PDF uploads count against your quota. Free baseline + any purchased extra MB.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-8 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            {/* Usage card */}
            <div className="card mt-8">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  <span className={pct >= 90 ? "font-semibold text-amber-300" : "font-semibold"}>{formatBytes(used)}</span>
                  <span className="text-fg-dim"> of {formatBytes(quota)} used</span>
                </p>
                <p className="text-xs text-fg-dim">{formatBytes(remaining)} remaining</p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full transition-all ${pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-amber-400" : "bg-brand-gradient"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-fg-dim">
                <div>
                  <p className="text-[10px] uppercase tracking-widest">Free tier</p>
                  <p className="mt-0.5 text-sm text-fg">{usage?.freeMb} MB</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest">Purchased</p>
                  <p className="mt-0.5 text-sm text-fg">
                    {usage && usage.extraBytes > 0
                      ? <>{(usage.extraBytes / 1024 / 1024).toFixed(0)} MB{usage.extraUntil ? <span className="ml-1 text-fg-dim">(expires {relativeTime(usage.extraUntil)})</span> : null}</>
                      : <span className="text-fg-dim">None</span>}
                  </p>
                </div>
              </div>
            </div>

            {/* Buy more card */}
            <div className="card mt-6">
              <h2 className="heading-3 mb-1">Buy more storage</h2>
              <p className="text-xs text-fg-dim">
                ₹{price} per MB · valid for {days} days from purchase. Buying again extends the window for any unused MB.
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-fg-dim">MB to buy</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={mb}
                    onChange={(e) => setMb(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                    className="input w-32"
                  />
                </label>
                <div className="text-sm">
                  <p className="text-fg-dim">Total</p>
                  <p className="text-2xl font-display font-bold">{formatINR(mb * price)}</p>
                </div>
                <button
                  onClick={() => startCheckout.mutate(mb)}
                  disabled={busy || mb < 1}
                  className="btn-primary disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {busy ? "Opening checkout…" : `Buy ${mb} MB`}
                </button>
              </div>
              {error && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{error}</span>
                </div>
              )}
              {successFlash && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-2.5 text-xs text-success">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{successFlash}</span>
                </div>
              )}
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
