"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";

export default function ReportCardsPage() {
  const { user } = useApp();
  const userId = user?.user_id || user?.id;
  const { data, isLoading } = useQuery({ queryKey: ["report-card", userId], queryFn: () => api.analytics.learnerReportCard(userId!), enabled: !!userId });

  if (!user) return null;
  const t = data?.totals || { coursesEnrolled: 0, completed: 0, hoursWatched: 0, quizPassRate: 0 };

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="heading-2">Report Cards</h1>
            <p className="mt-1 text-sm text-fg-dim">Your learning analytics across all courses.</p>
          </div>
          <button className="btn-ghost text-xs"><Download className="h-3.5 w-3.5" /> Export PDF</button>
        </div>

        {isLoading ? (
          <div className="flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            <section className="mb-8 grid gap-4 sm:grid-cols-4">
              <Stat label="Courses enrolled" value={String(t.coursesEnrolled)} />
              <Stat label="Completed" value={String(t.completed)} />
              <Stat label="Quizzes attempted" value={String((t as Record<string, number>).quizzesAttempted ?? 0)} />
              <Stat label="Quiz pass rate" value={`${Math.round((t.quizPassRate || 0) * 100)}%`} />
            </section>

            <section>
              <h3 className="font-display text-lg font-semibold mb-3">Per-course breakdown</h3>
              <div className="card overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-left text-xs uppercase tracking-widest text-fg-dim">
                    <tr><th className="p-3">Course</th><th className="p-3">Progress</th><th className="p-3">Status</th></tr>
                  </thead>
                  <tbody>
                    {(data?.enrollments || []).length === 0 ? (
                      <tr><td colSpan={3} className="p-6 text-center text-fg-dim">No enrollments yet.</td></tr>
                    ) : (data?.enrollments || []).map((e) => (
                      <tr key={e.id || e.course_id} className="border-t border-border">
                        <td className="p-3 font-medium">{e.courses?.title || e.course_id}</td>
                        <td className="p-3">{e.progress_percent}%</td>
                        <td className="p-3 text-fg-dim">{e.completed_at ? "Completed" : "In progress"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card text-center">
      <p className="font-display text-3xl font-bold gradient-text">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-widest text-fg-dim">{label}</p>
    </div>
  );
}
