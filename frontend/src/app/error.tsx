"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <p className="font-display text-7xl font-bold gradient-text">500</p>
      <h1 className="mt-2 heading-2">Something broke on our end</h1>
      <p className="mt-3 max-w-sm text-fg-dim">We've been notified. Try again, or head home.</p>
      <div className="mt-6 flex gap-3">
        <button onClick={reset} className="btn-primary">Try again</button>
        <Link href="/" className="btn-ghost">Home</Link>
        <Link href="/support" className="btn-ghost">File a ticket</Link>
      </div>
    </div>
  );
}
