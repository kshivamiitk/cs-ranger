"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wallet, Users, BookOpen, Star, ArrowRight, FileCheck2, Sparkles } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { CreatorTermsModal } from "@/components/creator/CreatorTermsModal";
import { shouldAutoStartCreatorTour, startCreatorTour } from "@/components/creator/CreatorTour";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";
import { formatCompact, formatINR } from "@/lib/utils";

export default function CreatorOverviewPage() {
  const { user } = useApp();
  const creatorId = user?.user_id || user?.id;
  const [showTerms, setShowTerms] = useState(false);

  // Auto-start the spotlight tour the FIRST time a creator ever sees this page.
  // shouldAutoStartCreatorTour() returns true only for never-seen-it users;
  // if a tour is already in progress (mid-flight, navigating between pages),
  // we don't re-trigger it — the boot component in /creator/layout.tsx handles
  // resume. Without this, returning to /creator/overview mid-tour would reset
  // the step counter back to 0.
  useEffect(() => {
    if (!user) return;
    if (shouldAutoStartCreatorTour()) {
      const t = setTimeout(() => startCreatorTour(), 600);
      return () => clearTimeout(t);
    }
  }, [user]);
  const { data: stats } = useQuery({ queryKey: ["creator-overview", creatorId], queryFn: () => api.analytics.creatorOverview(creatorId!), enabled: !!creatorId });
  const { data: balance } = useQuery({ queryKey: ["balance", creatorId], queryFn: () => api.wallet.balance(creatorId!), enabled: !!creatorId });
  const { data: termsStatus } = useQuery({ queryKey: ["creator-terms-status"], queryFn: () => api.users.creatorTermsStatus(), enabled: !!creatorId });
  // Server-scoped to this creator (all statuses) — no catalog over-fetch or client-side filtering.
  const { data: own } = useQuery({ queryKey: ["creator-courses", creatorId], queryFn: () => api.courses.mine(), enabled: !!creatorId });

  if (!user) return null;
  const ownCourses = own || [];

  return (
    <>
      <Navbar variant="creator" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="heading-2">Creator Overview</h1>
            <p className="mt-1 text-sm text-fg-dim">Your studio at a glance.</p>
          </div>
          <button
            type="button"
            onClick={() => startCreatorTour()}
            data-tour="replay-tour"
            className="btn-ghost text-sm"
            aria-label="Replay creator tour"
          >
            <Sparkles className="h-4 w-4" /> Take the tour
          </button>
        </div>

        {termsStatus && !termsStatus.accepted && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <span className="flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-warning" />
              The creator terms were updated to version {termsStatus.currentVersion}. Accept them to publish or submit courses.
            </span>
            <button onClick={() => setShowTerms(true)} className="btn-primary px-4 py-1.5 text-xs">Review &amp; accept</button>
          </div>
        )}
        {showTerms && termsStatus && (
          <CreatorTermsModal status={termsStatus} onAccepted={() => setShowTerms(false)} onClose={() => setShowTerms(false)} />
        )}

        <Link
          href="/creator/guide"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/40 bg-brand/10 p-4 transition hover:border-brand hover:shadow-glow"
        >
          <span className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-brand" />
            <span><strong>New to creating?</strong> Read the Creator Guide — how to build a course and what matters most.</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand">Open guide <ArrowRight className="h-4 w-4" /></span>
        </Link>

        <section data-tour="kpi-strip" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPI icon={<Wallet className="h-5 w-5 text-brand" />} label="Total earnings" value={formatINR((stats?.totalRevenue ?? 0) / 100)} delta="all-time" />
          <KPI icon={<Users className="h-5 w-5 text-success" />} label="Total students" value={formatCompact(stats?.totalStudents ?? 0)} delta="across all courses" />
          <KPI icon={<BookOpen className="h-5 w-5 text-brand-accent" />} label="Published courses" value={String(stats?.courseCount ?? 0)} delta="excluding drafts" />
          <KPI icon={<Star className="h-5 w-5 text-amber-400" />} label="Avg rating" value={(stats?.avgRating ?? 0) === 0 ? "—" : `★ ${stats?.avgRating?.toFixed(1)}`} delta="weighted" />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="card lg:col-span-2">
            <h3 className="font-display text-sm font-semibold">Your published courses</h3>
            <div className="mt-4 space-y-3">
              {ownCourses.length === 0 ? (
                <div className="text-center text-fg-dim text-sm py-8">
                  No courses yet. <Link href="/creator/courses/new" className="text-brand">Create your first →</Link>
                </div>
              ) : ownCourses.map((c) => (
                <Link key={c.id} href={`/creator/courses/${c.id}/analytics`} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3 hover:bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.thumbnail_url && <img src={c.thumbnail_url} alt="" className="h-12 w-20 rounded-lg object-cover" />}
                  <div className="flex-1 min-w-0">
                    <p className="line-clamp-1 font-medium">{c.title}</p>
                    <p className="text-xs text-fg-dim">{formatCompact(c.enrollment_count || 0)} students · ★ {(c.rating_avg || 0).toFixed(1)}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-fg-dim" />
                </Link>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="font-display text-sm font-semibold">Payout status</h3>
            <p className="mt-4 font-display text-4xl font-bold gradient-text">{formatINR((balance?.pending ?? 0) / 100)}</p>
            <p className="text-xs text-fg-dim">Pending balance</p>
            <div className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
              <Row label="Lifetime earned" value={formatINR((balance?.total_earned ?? 0) / 100)} />
              <Row label="Lifetime paid out" value={formatINR((balance?.total_paid_out ?? 0) / 100)} muted />
              <Row label="Platform fee paid" value={formatINR((balance?.total_commission ?? 0) / 100)} muted />
            </div>
            <Link href="/creator/finance" className="btn-ghost mt-4 w-full text-sm">View Finance →</Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function KPI({ icon, label, value, delta }: { icon: React.ReactNode; label: string; value: string; delta: string }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2">{icon}</span>
        <span className="text-xs text-fg-dim">{delta}</span>
      </div>
      <p className="mt-4 font-display text-2xl font-bold">{value}</p>
      <p className="text-xs uppercase tracking-widest text-fg-dim">{label}</p>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-fg-dim" : ""}>{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
