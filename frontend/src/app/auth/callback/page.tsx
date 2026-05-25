"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useApp } from "@/app/providers";

/**
 * OAuth landing page. Supabase Auth completes the PKCE code exchange on load;
 * we then swap the Supabase session for platform JWTs, hydrate the app user
 * (including onboarding state), and route to the right dashboard. Incomplete
 * users are bounced to /onboarding by the global guard in <Providers>.
 */
export default function OAuthCallbackPage() {
  const router = useRouter();
  const { setUser, setRoleView } = useApp();
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    const sb = supabase();
    if (!sb) {
      setError("Google sign-in isn't configured on this deployment.");
      return;
    }

    async function complete(session: Session) {
      if (handledRef.current) return;
      handledRef.current = true;
      try {
        const { accessToken, refreshToken, user } = await api.auth.oauthExchange(session.access_token);
        localStorage.setItem("access_token", accessToken);
        localStorage.setItem("refresh_token", refreshToken);
        // Pull the full profile (including has_completed_onboarding) so the
        // global onboarding redirect can do its job for brand-new accounts.
        const me = await api.users.me().catch(() => null);
        if (me) setUser(me);
        else setUser({ id: user.id, displayName: user.displayName, username: user.username, roles: user.roles, avatar_url: user.avatarUrl || undefined });
        const role = user.roles.includes("admin") ? "admin" : user.roles.includes("creator") ? "creator" : "learner";
        setRoleView(role);
        router.replace(role === "admin" ? "/admin/overview" : role === "creator" ? "/creator/overview" : "/home");
      } catch (e) {
        handledRef.current = false;
        setError(e instanceof Error ? e.message : "Google sign-in failed");
      }
    }

    sb.auth.getSession().then(({ data }) => {
      if (data.session) complete(data.session);
    });
    const { data: subscription } = sb.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) complete(session);
    });
    const timeout = setTimeout(() => {
      if (!handledRef.current) setError("Could not complete Google sign-in — the session never arrived. Please try again.");
    }, 10_000);

    return () => {
      subscription.subscription.unsubscribe();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-8 text-center">
        {error ? (
          <>
            <AlertCircle className="mx-auto h-8 w-8 text-danger" />
            <h1 className="mt-3 heading-3">Sign-in didn&apos;t complete</h1>
            <p className="mt-2 text-sm text-fg-dim">{error}</p>
            <Link href="/login" className="btn-primary mt-6 inline-flex">Back to login</Link>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand" />
            <h1 className="mt-3 heading-3">Finishing Google sign-in…</h1>
            <p className="mt-2 text-sm text-fg-dim">Hang tight — verifying your account and setting up your session.</p>
          </>
        )}
      </div>
    </div>
  );
}
