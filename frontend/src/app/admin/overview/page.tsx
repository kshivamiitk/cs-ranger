"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, BookOpen, Wallet, Activity, Check, X, Loader2 } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { formatINR } from "@/lib/utils";
import { usePublicSettings } from "@/hooks/usePublicSettings";

export default function AdminOverviewPage() {
  const qc = useQueryClient();
  const { data: kpis } = useQuery({ queryKey: ["admin-overview"], queryFn: () => api.analytics.adminOverview() });
  const { data: revenue } = useQuery({ queryKey: ["admin-revenue"], queryFn: () => api.analytics.adminRevenue() });
  const { data: reviewQueue } = useQuery({ queryKey: ["admin-review-queue"], queryFn: () => api.courses.adminList({ status: "under_review" }) });
  const platform = usePublicSettings();

  const approve = useMutation({ mutationFn: (id: string) => api.courses.approve(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-review-queue"] }) });
  const reject = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.courses.reject(id, reason), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-review-queue"] }) });

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <h1 className="heading-2">Admin Overview</h1>
        <p className="mt-1 text-sm text-fg-dim">Platform-level KPIs and queues.</p>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPI icon={<Users className="h-5 w-5 text-success" />} label="Total users" value={String(kpis?.totalUsers ?? 0)} delta={`+${kpis?.newSignupsWeek ?? 0} this week`} />
          <KPI icon={<BookOpen className="h-5 w-5 text-brand-accent" />} label="Active courses" value={String(kpis?.totalCourses ?? 0)} delta={`${kpis?.coursesUnderReview ?? 0} under review`} />
          <KPI icon={<Wallet className="h-5 w-5 text-brand" />} label="Revenue (30d)" value={formatINR((kpis?.totalRevenue30d ?? 0) / 100)} delta="paise → ₹" />
          <KPI icon={<Activity className="h-5 w-5 text-amber-400" />} label="Commission earned" value={formatINR((kpis?.commissionEarned ?? 0) / 100)} delta={`Commission: ${platform.commissionPercent}%`} />
        </section>

        <section className="mt-8 card">
          <h3 className="font-display text-sm font-semibold">Monthly revenue (12 mo)</h3>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(revenue || []).map((r) => ({ m: r.month, v: r.revenue / 100 }))}>
                <XAxis dataKey="m" fontSize={10} tickLine={false} axisLine={false} stroke="currentColor" strokeOpacity={0.4} />
                <YAxis fontSize={10} tickLine={false} axisLine={false} stroke="currentColor" strokeOpacity={0.4} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [formatINR(v), "Revenue"]} />
                <Bar dataKey="v" radius={[6, 6, 0, 0]} fill="url(#br)" />
                <defs><linearGradient id="br" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--brand-primary)" /><stop offset="1" stopColor="var(--brand-accent)" /></linearGradient></defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="heading-3">Course review queue ({(reviewQueue || []).length})</h2>
            <Link href="/admin/courses" className="text-xs text-brand">All courses →</Link>
          </div>
          <div className="card divide-y divide-border p-0">
            {(reviewQueue || []).length === 0 ? (
              <p className="p-6 text-center text-sm text-fg-dim">No courses awaiting review. 🎉</p>
            ) : (reviewQueue || []).map((c) => (
              <div key={c.id} className="flex items-center gap-4 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.thumbnail_url && <img src={c.thumbnail_url} alt="" className="h-14 w-24 rounded-lg object-cover" />}
                <div className="flex-1 min-w-0">
                  <p className="line-clamp-1 font-medium">{c.title}</p>
                  <p className="text-xs text-fg-dim">{c.level || "All Levels"} · {!c.price || c.price === 0 ? "Free" : formatINR(c.discounted_price || c.price)}</p>
                </div>
                <Link href={`/course/${c.id}`} className="text-xs text-brand">Preview</Link>
                <button onClick={() => approve.mutate(c.id)} disabled={approve.isPending} className="inline-flex items-center gap-1 rounded-full border border-success/40 px-3 py-1 text-xs text-success hover:bg-success/10 disabled:opacity-50">
                  {approve.isPending && approve.variables === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve
                </button>
                <button onClick={() => {
                  const reason = window.prompt("Reason for rejection (min 20 characters):");
                  if (reason && reason.length >= 20) reject.mutate({ id: c.id, reason });
                  else if (reason) alert("Reason must be at least 20 characters.");
                }} className="inline-flex items-center gap-1 rounded-full border border-danger/40 px-3 py-1 text-xs text-danger hover:bg-danger/10">
                  <X className="h-3 w-3" /> Reject
                </button>
              </div>
            ))}
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
