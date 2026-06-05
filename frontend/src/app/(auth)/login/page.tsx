"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, ArrowRight, Mail, Lock, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";
import { Field } from "@/components/auth/AuthFields";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";

export default function LoginPage() {
  const router = useRouter();
  const { setUser, setRoleView } = useApp();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", password: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { user, accessToken, refreshToken } = await api.auth.login(form);
      localStorage.setItem("access_token", accessToken);
      localStorage.setItem("refresh_token", refreshToken);
      // Set roles immediately so the navbar role switcher renders without a
      // flicker, then navigate.
      setUser({ id: user.id, displayName: user.displayName, username: "", roles: user.roles });
      const role = user.roles.includes("admin") ? "admin" : user.roles.includes("creator") ? "creator" : "learner";
      setRoleView(role);
      router.push(role === "admin" ? "/admin/overview" : role === "creator" ? "/creator/overview" : "/home");
      // Reconcile to the authoritative profile in the background (full roles,
      // onboarding state, username, avatar) without delaying the redirect.
      api.users.me().then((me) => setUser(me)).catch(() => { /* keep the login snapshot */ });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-8 animate-slide-up">
      <h1 className="heading-2">Welcome back</h1>
      <p className="mt-1 text-sm text-fg-dim">Log in to continue your learning streak.</p>

      <GoogleAuthButton />
      <div className="my-6 flex items-center gap-3 text-xs text-fg-dim">
        <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Field icon={<Mail className="h-4 w-4" />} label="Email">
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input pl-9" placeholder="you@example.com" />
        </Field>
        <Field icon={<Lock className="h-4 w-4" />} label="Password" action={<Link href="/forgot-password" className="text-xs text-brand hover:opacity-80">Forgot?</Link>}>
          <input type={show ? "text" : "password"} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input pl-9 pr-10" placeholder="••••••••" />
          <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </Field>

        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-50">
          {loading ? "Logging in…" : (<>Log in <ArrowRight className="h-4 w-4" /></>)}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-fg-dim">
        New here? <Link href="/signup" className="font-medium text-brand hover:opacity-80">Create an account</Link>
      </p>
    </div>
  );
}
