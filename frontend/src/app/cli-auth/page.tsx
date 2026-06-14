"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Loader2, Terminal } from "lucide-react";
import { setPostAuthRedirect } from "@/lib/authRedirect";

function isSafeCliCallback(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      Boolean(url.port) &&
      url.pathname === "/callback"
    );
  } catch {
    return false;
  }
}

function CliAuthInner() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const callback = useMemo(() => searchParams.get("callback") || "", [searchParams]);
  const state = useMemo(() => searchParams.get("state") || "", [searchParams]);

  useEffect(() => {
    if (!callback || !state) {
      setError("The CLI login link is missing required parameters.");
      return;
    }
    if (!isSafeCliCallback(callback)) {
      setError("The CLI login callback must be a localhost URL created by the LearnRift importer.");
      return;
    }

    const accessToken = localStorage.getItem("access_token") || "";
    const refreshToken = localStorage.getItem("refresh_token") || "";
    if (!accessToken || !refreshToken) {
      setPostAuthRedirect(window.location.href);
      window.location.replace("/login");
      return;
    }

    const redirect = new URL(callback);
    redirect.searchParams.set("state", state);
    redirect.searchParams.set("access_token", accessToken);
    redirect.searchParams.set("refresh_token", refreshToken);
    window.location.replace(redirect.toString());
  }, [callback, state]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md p-8 text-center">
        {error ? (
          <>
            <AlertCircle className="mx-auto h-8 w-8 text-danger" />
            <h1 className="mt-3 heading-3">CLI login failed</h1>
            <p className="mt-2 text-sm text-fg-dim">{error}</p>
            <Link href="/home" className="btn-primary mt-6 inline-flex">Go home</Link>
          </>
        ) : (
          <>
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-surface-2 text-brand">
              <Terminal className="h-5 w-5" />
            </div>
            <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-brand" />
            <h1 className="mt-3 heading-3">Connecting CLI</h1>
            <p className="mt-2 text-sm text-fg-dim">Completing LearnRift command-line login in your terminal.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function CliAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="card w-full max-w-md p-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand" />
            <h1 className="mt-3 heading-3">Connecting CLI</h1>
          </div>
        </div>
      }
    >
      <CliAuthInner />
    </Suspense>
  );
}
