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
        name: "CS-Ranger",
        description: courseTitle || order.courseTitle || "Course enrollment",
        order_id: order.orderId,
        prefill: { name: user?.display_name || user?.displayName, email: user?.email },
        theme: { color: "#7c3aed" },
        modal: { ondismiss: () => setBusy(false) },
        handler: async (response) => {
          try {
            const v = await api.payments.verify(response);
            if (v.verified) {
              opts.onSuccess?.(v.courseId);
            } else {
              setError("Payment verification failed");
              opts.onError?.("Payment verification failed");
            }
          } catch (e) {
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
