"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { LayoutDashboard, BookOpen, Plus, Wallet, HardDrive, PartyPopper, X, ArrowLeft, ArrowRight, Check } from "lucide-react";

// Bump the version suffix when the tour content changes — that re-shows it
// for every creator (one-time, until they dismiss again).
const TOUR_STORAGE_KEY = "cs-ranger-creator-tour-v1";

export function hasSeenCreatorTour(): boolean {
  if (typeof window === "undefined") return true; // SSR: assume seen, only client shows it
  return window.localStorage.getItem(TOUR_STORAGE_KEY) === "done";
}

function markCreatorTourDone() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOUR_STORAGE_KEY, "done");
}

export function resetCreatorTour() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOUR_STORAGE_KEY);
}

interface Step {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  hint?: React.ReactNode;
  cta?: { label: string; href: string };
}

const STEPS: Step[] = [
  {
    icon: <LayoutDashboard className="h-8 w-8 text-brand" />,
    title: "Welcome to your creator dashboard",
    body: (
      <p>
        This overview is your home base — wallet balance, recent sales, course performance, and
        pending learner doubts all show up here at a glance.
      </p>
    ),
    hint: <>Stats refresh every few minutes. Big numbers = good.</>,
  },
  {
    icon: <BookOpen className="h-8 w-8 text-brand" />,
    title: "Your courses",
    body: (
      <p>
        Every course you publish lives in <strong>Courses</strong>. Each course is a tree —
        modules contain lessons, and a lesson can be a <strong>video</strong>, a{" "}
        <strong>markdown article</strong>, a <strong>quiz</strong>, a <strong>PDF</strong>, or even
        a live <strong>HTML/CSS/JS sandbox</strong>.
      </p>
    ),
    cta: { label: "Open Courses", href: "/creator/courses" },
  },
  {
    icon: <Plus className="h-8 w-8 text-brand" />,
    title: "Ship your first course",
    body: (
      <p>
        Click <strong>New course</strong>, fill in the title and pricing, then start adding modules
        and lessons. You can save a draft anytime — only published courses are visible to learners,
        and each goes through a quick review before going live.
      </p>
    ),
    hint: <>You don&rsquo;t have to finish in one sitting — every change autosaves.</>,
    cta: { label: "Create a course", href: "/creator/courses/new" },
  },
  {
    icon: <Wallet className="h-8 w-8 text-brand" />,
    title: "Finance & payouts",
    body: (
      <p>
        Every sale shows up under <strong>Finance</strong>. The platform takes a flat commission
        (currently 20%); the rest lands in your wallet. Withdraw to your bank account after
        you&rsquo;ve completed KYC there once — payouts are batched weekly.
      </p>
    ),
    hint: <>Refunds within the 7-day window are automatically deducted from your wallet.</>,
    cta: { label: "Open Finance", href: "/creator/finance" },
  },
  {
    icon: <HardDrive className="h-8 w-8 text-brand" />,
    title: "Storage quota",
    body: (
      <p>
        PDFs and other attachments count against your storage quota. You start with{" "}
        <strong>1 MB free</strong> and can buy extra in chunks. Video lessons live on our CDN
        separately and don&rsquo;t use your quota.
      </p>
    ),
    cta: { label: "Check storage", href: "/creator/storage" },
  },
  {
    icon: <PartyPopper className="h-8 w-8 text-brand" />,
    title: "You&rsquo;re set",
    body: (
      <p>
        That&rsquo;s the core flow. Analytics, Collaborations, and Doubts are linked in the top
        nav whenever you want to explore them. Hit <strong>Take the tour</strong> on this page any
        time to replay this walkthrough.
      </p>
    ),
    hint: (
      <>
        Stuck? Email{" "}
        <a href="mailto:support@cs-ranger.in" className="underline">
          support@cs-ranger.in
        </a>
        .
      </>
    ),
  },
];

export function CreatorTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);

  const close = useCallback(() => {
    markCreatorTourDone();
    setStep(0);
    onClose();
  }, [onClose]);

  // Esc closes; arrow keys navigate
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setStep((s) => Math.min(s + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(s - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="creator-tour-title"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="card relative w-full max-w-md p-6 md:p-8 animate-slide-up">
        <button
          type="button"
          onClick={close}
          aria-label="Close tour"
          className="absolute right-3 top-3 rounded-full p-1.5 text-fg-dim transition hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10">
            {current.icon}
          </span>
          <p className="text-xs font-semibold uppercase tracking-widest text-fg-dim">
            Step {step + 1} of {STEPS.length}
          </p>
        </div>

        <h2 id="creator-tour-title" className="heading-3 mt-4">
          {current.title}
        </h2>
        <div className="mt-3 text-sm text-fg-dim leading-relaxed">{current.body}</div>
        {current.hint && (
          <p className="mt-3 rounded-lg border border-border bg-surface-2 p-3 text-xs text-fg-dim">
            💡 {current.hint}
          </p>
        )}

        {current.cta && (
          <Link
            href={current.cta.href}
            onClick={close}
            className="btn-ghost mt-4 w-full text-sm"
          >
            {current.cta.label} <ArrowRight className="h-4 w-4" />
          </Link>
        )}

        {/* Step dots */}
        <div className="mt-6 flex items-center justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-brand" : "w-1.5 bg-border hover:bg-fg-dim"
              }`}
            />
          ))}
        </div>

        {/* Bottom nav */}
        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={close}
            className="text-xs text-fg-dim hover:text-fg"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="btn-ghost text-sm"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            )}
            {!isLast ? (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="btn-primary text-sm"
              >
                Next <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={close}
                className="btn-primary text-sm"
              >
                <Check className="h-4 w-4" /> Finish
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
