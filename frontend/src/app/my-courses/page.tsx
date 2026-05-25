"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Progress } from "@/components/common/Progress";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";
import { durationFromSeconds, relativeTime } from "@/lib/utils";

export default function MyCoursesPage() {
  const { user } = useApp();
  const userId = user?.user_id || user?.id;
  const [tab, setTab] = useState<"progress" | "completed">("progress");
  // Same cache key as the home dashboard's "Continue learning" — one fetch shared across both.
  const { data: enrollments, isLoading } = useQuery({ queryKey: ["my-enrollments", userId], queryFn: () => api.enrollments.list(), enabled: !!user });
  if (!user) return null;

  const inProgress = (enrollments || []).filter((e) => !e.completed_at);
  const completed = (enrollments || []).filter((e) => e.completed_at);
  const list = tab === "progress" ? inProgress : completed;

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <h1 className="heading-2">My Courses</h1>
        <p className="mt-1 text-sm text-fg-dim">Pick up where you left off.</p>

        <div className="mt-6 inline-flex rounded-full border border-border bg-surface-2 p-0.5">
          {[
            { k: "progress", label: `In Progress (${inProgress.length})` },
            { k: "completed", label: `Completed (${completed.length})` },
          ].map((t) => (
            <button key={t.k} onClick={() => setTab(t.k as "progress" | "completed")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${tab === t.k ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="mt-8 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="mt-6 space-y-3">
            {list.length === 0 ? (
              <div className="card text-center text-fg-dim">
                {tab === "progress" ? "No courses in progress. Browse the catalog to get started." : "No completed courses yet."}
              </div>
            ) : (
              list.map((e) => {
                const c = e.courses;
                if (!c) return null;
                return (
                  <div key={e.id} className="card flex flex-col gap-4 md:flex-row md:items-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.thumbnail_url && <img src={c.thumbnail_url} alt="" className="h-32 w-full rounded-xl object-cover md:h-20 md:w-32" />}
                    <div className="flex-1 min-w-0">
                      <p className="line-clamp-1 font-display font-semibold">{c.title}</p>
                      {c.duration_seconds ? <p className="text-xs text-fg-dim">{durationFromSeconds(c.duration_seconds)}</p> : null}
                      <div className="mt-3">
                        <Progress value={e.progress_percent} />
                        <div className="mt-1 flex items-center justify-between text-xs text-fg-dim">
                          <span>{e.progress_percent}% complete</span>
                          <span>Enrolled {relativeTime(e.enrolled_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {/* Without last_node_id we don't know a valid nodeId here (the
                          list endpoint doesn't fetch modules to stay fast). Route to
                          the course page, which resolves the first lesson and routes
                          on. Resolves the /learn/ 404 from empty nodeId segments. */}
                      <Link
                        href={e.last_node_id ? `/course/${c.id}/learn/${e.last_node_id}` : `/course/${c.id}`}
                        className={tab === "progress" ? "btn-primary text-sm" : "btn-ghost text-sm"}
                      >
                        {tab === "progress" ? "Continue" : "Review"}
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
