"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, RefreshCw, Sparkles } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api, type CreatorDashboard } from "@/lib/api";
import { useApp } from "@/app/providers";
import { cn, formatCompact, formatINR, relativeTime } from "@/lib/utils";

const TOOLTIP_STYLE = { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 } as const;
const RANGES: { value: CreatorDashboard["range"]; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All time" },
];

export default function CreatorAnalyticsPage() {
  const { user } = useApp();
  const creatorId = user?.user_id || user?.id;
  const [range, setRange] = useState<CreatorDashboard["range"]>("30d");

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["creator-dashboard", creatorId, range],
    queryFn: () => api.analytics.creatorDashboard(creatorId!, range),
    enabled: !!creatorId,
  });

  if (!user) return null;
  const hasCourses = (data?.courses.length ?? 0) > 0;

  return (
    <>
      <Navbar variant="creator" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><BarChart3 className="h-5 w-5" /></span>
            <div>
              <h1 className="heading-2">Analytics</h1>
              <p className="text-sm text-fg-dim">Real revenue, enrollment and engagement data across your courses.</p>
            </div>
          </div>
          <div className="inline-flex rounded-full border border-border bg-surface-2 p-0.5 text-xs">
            {RANGES.map((r) => (
              <button key={r.value} onClick={() => setRange(r.value)}
                className={cn("rounded-full px-3 py-1.5 transition", range === r.value ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg")}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <DashboardSkeleton />
        ) : isError ? (
          <div className="mt-8 card text-center text-sm">
            <p className="font-medium text-danger">Could not load analytics</p>
            <p className="mt-1 text-fg-dim">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button onClick={() => refetch()} className="btn-ghost mx-auto mt-4 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
          </div>
        ) : !hasCourses ? (
          <div className="mt-8 card text-center text-fg-dim">
            <Sparkles className="mx-auto mb-2 h-8 w-8" />
            <p className="font-medium text-fg">No analytics yet</p>
            <p className="mt-1 text-sm">Publish your first course and the dashboard will light up as learners enroll.</p>
            <Link href="/creator/courses/new" className="btn-primary mx-auto mt-4 text-sm">Create a course</Link>
          </div>
        ) : data ? (
          <>
            <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KPI label={`Revenue (${rangeLabel(range)})`} value={formatINR(data.kpis.revenuePaise / 100)} sub="successful payments" />
              <KPI label={`Enrollments (${rangeLabel(range)})`} value={formatCompact(data.kpis.enrollments)} sub={`${formatCompact(data.kpis.totalStudents)} students all-time`} />
              <KPI label="Completion rate" value={`${data.kpis.completionRate}%`} sub="of enrollments in range" />
              <KPI label="Quiz pass rate" value={`${data.kpis.quizPassRate}%`} sub={`avg rating ${data.kpis.avgRating ? `★ ${data.kpis.avgRating.toFixed(1)}` : "—"}`} />
            </section>

            <section className="mt-8 grid gap-6 lg:grid-cols-2">
              <div className="card">
                <h3 className="font-display text-sm font-semibold">Revenue</h3>
                {data.revenueTrend.length === 0 ? (
                  <EmptyChart label="No revenue in this period yet." />
                ) : (
                  <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.revenueTrend.map((r) => ({ b: shortBucket(r.bucket), v: r.revenuePaise / 100 }))}>
                        <CartesianGrid strokeOpacity={0.06} vertical={false} />
                        <XAxis dataKey="b" fontSize={10} tickLine={false} axisLine={false} stroke="currentColor" strokeOpacity={0.4} interval="preserveStartEnd" />
                        <YAxis fontSize={10} tickLine={false} axisLine={false} stroke="currentColor" strokeOpacity={0.4} tickFormatter={(v) => `₹${formatCompact(Number(v))}`} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatINR(v), "Revenue"]} />
                        <Bar dataKey="v" radius={[6, 6, 0, 0]} fill="url(#rev)" />
                        <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--brand-primary)" /><stop offset="1" stopColor="var(--brand-accent)" /></linearGradient></defs>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              <div className="card">
                <h3 className="font-display text-sm font-semibold">Enrollments</h3>
                {data.enrollmentTrend.length === 0 ? (
                  <EmptyChart label="No enrollments in this period yet." />
                ) : (
                  <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.enrollmentTrend.map((r) => ({ b: shortBucket(r.bucket), v: r.enrollments }))}>
                        <CartesianGrid strokeOpacity={0.06} vertical={false} />
                        <XAxis dataKey="b" fontSize={10} tickLine={false} axisLine={false} stroke="currentColor" strokeOpacity={0.4} interval="preserveStartEnd" />
                        <YAxis allowDecimals={false} fontSize={10} tickLine={false} axisLine={false} stroke="currentColor" strokeOpacity={0.4} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, "Enrollments"]} />
                        <Line type="monotone" dataKey="v" stroke="var(--brand-primary)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </section>

            <section className="mt-8 grid gap-6 lg:grid-cols-3">
              <div className="card overflow-x-auto p-0 lg:col-span-2">
                <h3 className="px-5 pt-5 font-display text-sm font-semibold">Courses{isFetching ? " · refreshing…" : ""}</h3>
                <table className="mt-3 w-full text-sm">
                  <thead className="bg-surface-2 text-left text-xs uppercase tracking-widest text-fg-dim">
                    <tr>
                      <th className="p-3">Course</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Students</th>
                      <th className="p-3 text-right">New ({rangeLabel(range)})</th>
                      <th className="p-3 text-right">Revenue ({rangeLabel(range)})</th>
                      <th className="p-3 text-right">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.courses.map((c) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="p-3">
                          <Link href={`/creator/courses/${c.id}/analytics`} className="line-clamp-1 font-medium hover:text-brand">{c.title}</Link>
                        </td>
                        <td className="p-3"><span className="chip capitalize">{c.status.replace("_", " ")}</span></td>
                        <td className="p-3 text-right tabular-nums">{formatCompact(c.enrollment_count)}</td>
                        <td className="p-3 text-right tabular-nums">{c.enrollmentsInRange}</td>
                        <td className="p-3 text-right tabular-nums">{formatINR(c.revenuePaise / 100)}</td>
                        <td className="p-3 text-right tabular-nums">{c.rating_avg ? `★ ${c.rating_avg.toFixed(1)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card">
                <h3 className="font-display text-sm font-semibold">Recent learner activity</h3>
                {data.recentActivity.length === 0 ? (
                  <p className="mt-4 text-sm text-fg-dim">No learner activity yet.</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {data.recentActivity.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className={cn("mt-1.5 block h-2 w-2 shrink-0 rounded-full", a.kind === "completion" ? "bg-success" : "bg-brand")} />
                        <div className="min-w-0">
                          <p className="line-clamp-2">
                            <span className="font-medium">{a.learnerName}</span> {a.kind === "completion" ? "completed" : "enrolled in"} <span className="text-fg-dim">{a.courseTitle}</span>
                          </p>
                          <p className="text-[11px] uppercase tracking-wider text-fg-dim">{relativeTime(a.at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        ) : null}
      </main>
      <Footer />
    </>
  );
}

function rangeLabel(range: CreatorDashboard["range"]) {
  return range === "all" ? "all time" : range;
}

function shortBucket(bucket: string) {
  // "2026-05-12" → "05-12", "2026-05" → "May 26"
  if (bucket.length === 7) {
    const d = new Date(`${bucket}-01T00:00:00Z`);
    return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  }
  return bucket.slice(5);
}

function KPI({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-widest text-fg-dim">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-fg-dim">{sub}</p>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return <div className="mt-4 flex h-56 items-center justify-center text-sm text-fg-dim">{label}</div>;
}

function DashboardSkeleton() {
  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-3 w-24 rounded bg-surface-2" />
            <div className="mt-3 h-7 w-32 rounded bg-surface-2" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-3 w-28 rounded bg-surface-2" />
            <div className="mt-4 h-56 rounded-xl bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
