"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";

declare global {
  interface Window {
    Razorpay?: new (opts: RazorpayOptions) => { open: () => void };
  }
}

interface RazorpayOptions {
  key: string; amount: number; currency: string; name: string; description: string;
  order_id: string; prefill?: { name?: string; email?: string };
  theme?: { color?: string }; handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type VerifyResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

// The money is ALREADY captured by the time Razorpay invokes our handler, so a
// single failed /verify must never strand the learner without access. We retry
// /verify a few times (it can time out under high server↔DB latency even though
// it succeeded), then fall back to server-side reconciliation, which asks
// Razorpay directly and grants access if the payment really was captured.
async function verifyWithRecovery(response: VerifyResponse): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const v = await api.payments.verify(response);
      if (v.verified) return v.courseId;
      lastErr = new Error("Payment verification failed");
    } catch (e) {
      lastErr = e;
    }
    await sleep(800 * (attempt + 1));
  }
  // /verify kept failing — reconcile against the gateway (source of truth).
  try {
    const r = await api.payments.reconcile(response.razorpay_order_id);
    if (r.enrolled) return r.courseId || "";
  } catch { /* fall through to the original error */ }
  throw lastErr instanceof Error ? lastErr : new Error("Verification failed");
}

let scriptLoaded = false;
function loadScript(): Promise<boolean> {
  if (scriptLoaded) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => { scriptLoaded = true; resolve(true); };
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function useRazorpayCheckout(opts: { onSuccess?: (courseId: string) => void; onError?: (e: string) => void }) {
  const { user } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout(courseId: string, courseTitle?: string) {
    setBusy(true);
    setError(null);
    try {
      const ok = await loadScript();
      if (!ok) throw new Error("Failed to load Razorpay");
      const order = await api.payments.createOrder(courseId);
      const rzpKey = order.keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "";
      if (!rzpKey || rzpKey.includes("YOUR_KEY_ID")) throw new Error("Razorpay not configured. Set NEXT_PUBLIC_RAZORPAY_KEY_ID in .env.local.");
      if (!window.Razorpay) throw new Error("Razorpay SDK unavailable");

      const r = new window.Razorpay({
        key: rzpKey,
        amount: order.amount,
        currency: order.currency,
        name: "LearnRift",
        description: courseTitle || order.courseTitle || "Course enrollment",
        order_id: order.orderId,
        prefill: { name: user?.display_name || user?.displayName, email: user?.email },
        theme: { color: "#7c3aed" },
        modal: { ondismiss: () => setBusy(false) },
        handler: async (response) => {
          try {
            const courseId = await verifyWithRecovery(response);
            opts.onSuccess?.(courseId);
          } catch (e) {
            // Money was taken but we still couldn't confirm access. Surface a
            // recovery-aware message — the webhook + reconciler will keep trying
            // server-side, so access usually appears shortly after a refresh.
            const msg = e instanceof Error ? e.message : "Verification failed";
            setError(msg);
            opts.onError?.(msg);
          } finally {
            setBusy(false);
          }
        },
      });
      r.open();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Checkout failed";
      setError(msg);
      opts.onError?.(msg);
      setBusy(false);
    }
  }

  return { checkout, busy, error };
}
