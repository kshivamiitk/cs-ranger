"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Flame, Sparkles, TrendingUp, Clock, Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { SiteTour, SiteTourButton } from "@/components/common/SiteTour";
import { CourseCard } from "@/components/common/CourseCard";
import { Heatmap } from "@/components/common/Heatmap";
import { Progress } from "@/components/common/Progress";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";
import { durationFromSeconds } from "@/lib/utils";

export default function LearnerHome() {
  const { user, loadingUser } = useApp();
  // Profiles are keyed on user_id (not id) — use it consistently so the dashboard
  // widgets actually fire and share the same cache as other pages.
  const userId = user?.user_id || user?.id;

  const { data: enrollments, isLoading: enrollmentsLoading } = useQuery({ queryKey: ["my-enrollments", userId], queryFn: () => api.enrollments.list(), enabled: !!user });
  // One aggregated call replaces the previous three (streak + heatmap + badges).
  const { data: summary } = useQuery({ queryKey: ["achievements-summary", userId], queryFn: () => api.achievements.summary(userId!), enabled: !!userId });
  const { data: recommendedPage, isLoading: recommendedLoading } = useQuery({ queryKey: ["recommended"], queryFn: () => api.search.courses({ sort: "popular", limit: 8 }) });
  const recommended = recommendedPage?.items;

  const streak = summary?.streak;
  const heatmap = summary?.heatmap;

  if (loadingUser) return <FullScreenLoader />;
  if (!user) {
    return (
      <>
        <Navbar variant="public" />
        <div className="mx-auto max-w-md px-6 py-24 text-center">
          <p className="text-fg-dim">Please log in to view your dashboard.</p>
          <Link href="/login" className="btn-primary mt-4">Log in</Link>
        </div>
      </>
    );
  }

  const inProgress = (enrollments || []).filter((e) => !e.completed_at);
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();
  const firstName = (user.display_name || user.displayName || "there").split(" ")[0];

  return (
    <>
      <Navbar />
      {/* Auto-starts the first-login walkthrough once for new users. */}
      <SiteTour />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <section className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="heading-1">{greeting}, <span className="gradient-text">{firstName}</span>.</h1>
            <p className="mt-2 text-fg-dim">
              {streak?.current_streak ? `You're on a ${streak.current_streak}-day streak. Keep it going.` : "Start a learning streak today."}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <SiteTourButton className="btn-ghost text-xs" />
            <div className="flex gap-3">
              <Stat icon={<Flame className="h-5 w-5 text-orange-400" />} value={String(streak?.current_streak ?? 0)} label="Day streak" />
              <Stat icon={<TrendingUp className="h-5 w-5 text-success" />} value={String(inProgress.length)} label="In progress" />
              <Stat icon={<Sparkles className="h-5 w-5 text-brand" />} value={String(summary?.badges.earned ?? 0)} label="Badges" />
            </div>
          </div>
        </section>

        {enrollmentsLoading && (
          <section className="mb-12">
            <h2 className="heading-3 mb-4">Continue learning</h2>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card flex gap-3">
                  <div className="h-20 w-32 shrink-0 animate-pulse rounded-lg bg-surface-2" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-surface-2" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
                    <div className="mt-4 h-1.5 w-full animate-pulse rounded bg-surface-2" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!enrollmentsLoading && inProgress.length > 0 && (
          <section className="mb-12">
            <h2 className="heading-3 mb-4">Continue learning</h2>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {inProgress.map((e) => {
                const c = e.courses;
                if (!c) return null;
                return (
                  <Link key={e.id} href={e.last_node_id ? `/course/${c.id}/learn/${e.last_node_id}` : `/course/${c.id}`} className="card group transition hover:-translate-y-0.5 hover:shadow-glow">
                    <div className="flex gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {c.thumbnail_url && <img src={c.thumbnail_url} alt="" className="h-20 w-32 rounded-lg object-cover" />}
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 font-display font-semibold group-hover:text-brand transition">{c.title}</p>
                        {c.duration_seconds ? <p className="mt-0.5 text-xs text-fg-dim flex items-center gap-1"><Clock className="h-3 w-3" /> {durationFromSeconds(c.duration_seconds)}</p> : null}
                        <div className="mt-3">
                          <Progress value={e.progress_percent} />
                          <div className="mt-1 flex items-center justify-between text-xs text-fg-dim">
                            <span>{e.progress_percent}% complete</span>
                            <span className="font-medium text-brand inline-flex items-center gap-0.5">Resume <ArrowRight className="h-3 w-3" /></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {heatmap && Object.keys(heatmap).length > 0 && (
          <section className="mb-12">
            <Heatmap data={heatmap} />
          </section>
        )}

        {(recommendedLoading || (recommended && recommended.length > 0)) && (
          <section className="mb-12">
            <div className="mb-4 flex items-end justify-between">
              <h2 className="heading-3">Recommended for you</h2>
              <Link href="/catalog" className="text-sm text-brand hover:opacity-80">View all →</Link>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {recommendedLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="card animate-pulse">
                      <div className="aspect-[16/9] rounded-xl bg-surface-2" />
                      <div className="mt-3 h-4 w-3/4 rounded bg-surface-2" />
                      <div className="mt-2 h-3 w-1/2 rounded bg-surface-2" />
                    </div>
                  ))
                : (recommended || []).slice(0, 4).map((c) => <CourseCard key={c.id} course={c} />)}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}

function FullScreenLoader() {
  return (
    <div className="flex h-screen items-center justify-center text-fg-dim">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2">{icon}</span>
      <div>
        <p className="font-display text-lg font-bold leading-none">{value}</p>
        <p className="text-xs text-fg-dim">{label}</p>
      </div>
    </div>
  );
}
