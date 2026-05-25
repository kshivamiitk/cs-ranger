"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Lock } from "lucide-react";
import { Field } from "@/components/auth/AuthFields";

export default function ResetPasswordPage() {
  const [done, setDone] = useState(false);
  return (
    <div className="card p-8 animate-slide-up">
      {!done ? (
        <>
          <h1 className="heading-2">Set a new password</h1>
          <p className="mt-1 text-sm text-fg-dim">Pick something you'll remember, but no one can guess.</p>
          <form onSubmit={(e) => { e.preventDefault(); setDone(true); }} className="mt-6 space-y-4">
            <Field icon={<Lock className="h-4 w-4" />} label="New password">
              <input required type="password" minLength={8} className="input pl-9" />
            </Field>
            <Field icon={<Lock className="h-4 w-4" />} label="Confirm password">
              <input required type="password" minLength={8} className="input pl-9" />
            </Field>
            <button className="btn-primary w-full">Update password <ArrowRight className="h-4 w-4" /></button>
          </form>
        </>
      ) : (
        <>
          <h1 className="heading-2">Password updated</h1>
          <p className="mt-2 text-sm text-fg-dim">All your sessions have been logged out for security. Log in again with your new password.</p>
          <Link href="/login" className="btn-primary mt-6 w-full">Log in</Link>
        </>
      )}
    </div>
  );
}
