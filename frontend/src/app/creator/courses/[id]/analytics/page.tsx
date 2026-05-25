"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Line, LineChart } from "recharts";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";
import { formatINR, formatCompact } from "@/lib/utils";

const TOOLTIP_STYLE = { background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 } as const;

export default function CourseAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const { user } = useApp();
  const creatorId = user?.user_id || user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["course-analytics", params.id],
    queryFn: () => api.analytics.courseAnalytics(creatorId!, params.id),
    enabled: !!creatorId && !!params.id,
  });

  const enrollmentCount = data?.course?.enrollment_count || 0;
  const new30d = data?.enrollmentTrend?.length || 0;

  // Real daily series: bucket raw enrolled_at timestamps across the last 30 days (zero-filled).
  const enrollTrend = (() => {
    const byDay = new Map<string, number>();
    for (const e of data?.enrollmentTrend || []) {
      const d = (e.enrolled_at || "").slice(0, 10);
      if (d) byDay.set(d, (byDay.get(d) || 0) + 1);
    }
    const out: { day: string; n: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const key = dt.toISOString().slice(0, 10);
      out.push({ day: key.slice(5), n: byDay.get(key) || 0 });
    }
    return out;
  })();

  // Real per-lesson completion funnel (as % of total enrollments).
  const funnel = (data?.funnel || []).map((f) => ({
    lesson: f.title.length > 16 ? f.title.slice(0, 16) + "…" : f.title,
    pct: enrollmentCount > 0 ? Math.round((f.completions / enrollmentCount) * 100) : 0,
    completions: f.completions,
  }));
  const lastCompletions = data?.funnel?.length ? data.funnel[data.funnel.length - 1].completions : 0;
  const completionRate = enrollmentCount > 0 ? Math.round((lastCompletions / enrollmentCount) * 100) : 0;

  return (
    <>
      <Navbar variant="creator" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <h1 className="heading-2">Course Analytics</h1>
        <p className="mt-1 text-sm text-fg-dim">{data?.course?.title || "…"}</p>

        {isLoading ? (
          <div className="mt-16 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-4">
              <KPI label="Total students" value={formatCompact(enrollmentCount)} sub="all-time enrollments" />
              <KPI label="New (30d)" value={formatCompact(new30d)} sub="last 30 days" />
              <KPI label="Completion rate" value={`${completionRate}%`} sub="finished the last lesson" />
              <KPI label="Revenue" value={formatINR((data?.revenue || 0) / 100)} sub={`${data?.refunds || 0} refund${(data?.refunds || 0) === 1 ? "" : "s"}`} />
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <div className="card">
                <h3 className="font-display text-sm font-semibold">Enrollment trend (30d)</h3>
                {new30d === 0 ? (
                  <div className="mt-4 flex h-56 items-center justify-center text-sm text-fg-dim">No enrollments in the last 30 days yet.</div>
                ) : (
                  <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={enrollTrend}>
                        <CartesianGrid strokeOpacity={0.06} vertical={false} />
                        <XAxis dataKey="day" fontSize={10} tickLine={false} axisLine={false} stroke="currentColor" strokeOpacity={0.4} interval={6} />
                        <YAxis allowDecimals={false} fontSize={10} tickLine={false} axisLine={false} stroke="currentColor" strokeOpacity={0.4} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, "Enrollments"]} />
                        <Line type="monotone" dataKey="n" stroke="var(--brand-primary)" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              <div className="card">
                <h3 className="font-display text-sm font-semibold">Completion funnel (by lesson)</h3>
                {funnel.length === 0 ? (
                  <div className="mt-4 flex h-56 items-center justify-center text-sm text-fg-dim">No lessons in this course yet.</div>
                ) : (
                  <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={funnel} layout="vertical">
                        <XAxis type="number" fontSize={10} tickLine={false} axisLine={false} stroke="currentColor" strokeOpacity={0.4} domain={[0, 100]} unit="%" />
                        <YAxis type="category" dataKey="lesson" fontSize={10} tickLine={false} axisLine={false} stroke="currentColor" strokeOpacity={0.4} width={110} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, _n, p) => [`${v}% (${(p?.payload as { completions?: number })?.completions ?? 0} learners)`, "Completed"]} />
                        <Bar dataKey="pct" fill="url(#g)" radius={[0, 8, 8, 0]} />
                        <defs>
                          <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0" stopColor="var(--brand-primary)" />
                            <stop offset="1" stopColor="var(--brand-accent)" />
                          </linearGradient>
                        </defs>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
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
