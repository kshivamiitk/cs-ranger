"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { Field } from "@/components/auth/AuthFields";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  return (
    <div className="card p-8 animate-slide-up">
      {!sent ? (
        <>
          <h1 className="heading-2">Reset your password</h1>
          <p className="mt-1 text-sm text-fg-dim">We'll email you a secure link to set a new one.</p>
          <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} className="mt-6 space-y-4">
            <Field icon={<Mail className="h-4 w-4" />} label="Email">
              <input required type="email" className="input pl-9" placeholder="you@example.com" />
            </Field>
            <button className="btn-primary w-full">Send reset link <ArrowRight className="h-4 w-4" /></button>
          </form>
        </>
      ) : (
        <>
          <h1 className="heading-2">Check your inbox</h1>
          <p className="mt-2 text-sm text-fg-dim">If that email is registered, you'll receive a reset link within a few minutes. The link expires in 1 hour.</p>
          <Link href="/login" className="btn-ghost mt-6 w-full">Back to log in</Link>
        </>
      )}
    </div>
  );
}
