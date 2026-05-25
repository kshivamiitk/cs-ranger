"use client";

import { useState } from "react";
import { GoogleIcon } from "./AuthFields";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * "Continue with Google" via Supabase Auth (PKCE browser flow). After Google
 * redirects back to /auth/callback, the Supabase session is exchanged for the
 * platform's own JWT pair (POST /auth/oauth/exchange).
 *
 * When Supabase isn't configured the button renders disabled with a friendly
 * note instead of crashing — no env values are ever shown.
 */
export function GoogleAuthButton({ label = "Continue with Google" }: { label?: string }) {
  const configured = isSupabaseConfigured();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const { error: oauthError } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) {
      setError(oauthError.message || "Google sign-in could not start — is the Google provider enabled in Supabase?");
      setBusy(false);
    }
    // On success the browser navigates away to Google's consent screen.
  }

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={!configured || busy}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 py-2.5 text-sm font-medium transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GoogleIcon /> {busy ? "Redirecting to Google…" : label}
      </button>
      {!configured ? (
        <p className="mt-1 text-center text-[10px] text-fg-dim">Google sign-in isn&apos;t configured on this deployment — use email and password below.</p>
      ) : error ? (
        <p className="mt-1 text-center text-[10px] text-danger">{error}</p>
      ) : null}
    </div>
  );
}
