"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, ArrowRight, Mail, Lock, User as UserIcon, Check, AlertCircle, Mail as MailIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Field } from "@/components/auth/AuthFields";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";

export default function SignupPage() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [intent, setIntent] = useState<"learner" | "creator" | "both">("learner");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  // Whether the backend actually sent a verification email (EMAIL_VERIFICATION=TRUE)
  // vs auto-activated the account (the default for local/testing).
  const [verificationSent, setVerificationSent] = useState(true);

  function next(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    if (!/[A-Z]/.test(form.password) || !/[a-z]/.test(form.password) || !/[0-9]/.test(form.password))
      return setError("Password needs at least one uppercase, lowercase, and digit.");
    setError(null);
    setStep(2);
  }

  async function finish() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.auth.register({ ...form, intent });
      setVerificationSent(res.status === "verification_email_sent");
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-8 animate-slide-up">
      {step === 1 && (
        <>
          <h1 className="heading-2">Create your account</h1>
          <p className="mt-1 text-sm text-fg-dim">Free to start. No credit card required.</p>

          <GoogleAuthButton label="Sign up with Google" />
          <div className="my-6 flex items-center gap-3 text-xs text-fg-dim">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}

          <form onSubmit={next} className="space-y-4">
            <Field icon={<UserIcon className="h-4 w-4" />} label="Full name">
              <input required minLength={2} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="input pl-9" placeholder="Arjun Mehta" />
            </Field>
            <Field icon={<Mail className="h-4 w-4" />} label="Email">
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input pl-9" placeholder="you@example.com" />
            </Field>
            <Field icon={<Lock className="h-4 w-4" />} label="Password">
              <input required type={show ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input pl-9 pr-10" placeholder="Min 8 chars, 1 upper, 1 digit" />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </Field>
            <button type="submit" className="btn-primary w-full">Continue <ArrowRight className="h-4 w-4" /></button>
            <p className="text-center text-xs text-fg-dim">
              By signing up you agree to our <Link href="/terms" className="text-brand">Terms</Link> and <Link href="/privacy" className="text-brand">Privacy Policy</Link>.
            </p>
          </form>

          <p className="mt-6 text-center text-sm text-fg-dim">
            Already have an account? <Link href="/login" className="font-medium text-brand">Log in</Link>
          </p>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="heading-2">What brings you here?</h1>
          <p className="mt-1 text-sm text-fg-dim">Choose one — you can change it later in settings.</p>
          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}
          <div className="mt-6 space-y-3">
            {([
              { key: "learner", title: "I want to learn", body: "Explore curated courses across CS, math, and engineering." },
              { key: "creator", title: "I want to create and sell courses", body: "Build courses, earn from enrollments, get paid via Razorpay." },
              { key: "both", title: "Both", body: "Learn during the week, teach on weekends." },
            ] as const).map((o) => (
              <button
                key={o.key}
                onClick={() => setIntent(o.key)}
                className={`w-full rounded-2xl border p-4 text-left transition ${intent === o.key ? "border-brand bg-surface-2 shadow-glow" : "border-border bg-surface hover:bg-surface-2"}`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium">{o.title}</p>
                  {intent === o.key && <Check className="h-5 w-5 text-brand" />}
                </div>
                <p className="mt-1 text-sm text-fg-dim">{o.body}</p>
              </button>
            ))}
          </div>
          <button onClick={finish} disabled={loading} className="btn-primary mt-6 w-full disabled:opacity-50">
            {loading ? "Creating account…" : (<>Continue <ArrowRight className="h-4 w-4" /></>)}
          </button>
        </>
      )}

      {step === 3 && verificationSent && (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient">
            <MailIcon className="h-7 w-7 text-white" />
          </div>
          <h1 className="mt-4 heading-2 text-center">Check your inbox</h1>
          <p className="mt-2 text-center text-sm text-fg-dim">
            We've sent a verification email to <b>{form.email}</b>. Click the link in it to activate your account. Link expires in 24 hours.
          </p>
          <p className="mt-4 text-center text-xs text-fg-dim">Didn't get it? Check spam, or contact support after a few minutes.</p>
          <Link href="/login" className="btn-ghost mt-6 w-full justify-center">Back to log in</Link>
        </>
      )}

      {step === 3 && !verificationSent && (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient">
            <Check className="h-7 w-7 text-white" />
          </div>
          <h1 className="mt-4 heading-2 text-center">You&apos;re all set</h1>
          <p className="mt-2 text-center text-sm text-fg-dim">
            Your account <b>{form.email}</b> is active. Log in to get started.
          </p>
          <Link href="/login" className="btn-primary mt-6 w-full justify-center">Log in</Link>
        </>
      )}

      <button onClick={() => router.push("/")} className="mt-4 w-full text-center text-xs text-fg-dim hover:text-fg">← Back to home</button>
    </div>
  );
}
