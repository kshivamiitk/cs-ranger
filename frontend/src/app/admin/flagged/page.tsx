"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, ChevronLeft, ChevronRight, Flag, Loader2, RefreshCw, X } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api, type ContentReport } from "@/lib/api";
import { cn, relativeTime } from "@/lib/utils";

type Confirming = { report: ContentReport; action: "dismiss" | "review" | "suspend" } | null;

export default function AdminFlaggedPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"open" | "dismissed" | "actioned" | "">("open");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const pageSize = 20;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-reports", { status, type, page }],
    queryFn: () => api.admin.reports({ page, pageSize, status: status || undefined, type: type || undefined }),
    placeholderData: keepPreviousData,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  const act = useMutation({
    mutationFn: async ({ report, action }: NonNullable<Confirming>) => {
      if (action === "dismiss") return api.admin.dismissReport(report.id);
      if (action === "review") return api.admin.reviewReport(report.id);
      return api.admin.suspendReportedCourse(report.id);
    },
    onSuccess: () => {
      setConfirming(null);
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
    },
  });

  return (
    <>
      <Navbar variant="admin" />
      <main className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><Flag className="h-5 w-5" /></span>
          <div>
            <h1 className="heading-2">Flagged content</h1>
            <p className="mt-1 text-sm text-fg-dim">Reports from learners and creators. Suspending a course pulls it from the catalog and notifies the creator.</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border border-border bg-surface-2 p-0.5 text-xs">
            {([["open", "Open"], ["actioned", "Actioned"], ["dismissed", "Dismissed"], ["", "All"]] as const).map(([k, label]) => (
              <button key={k || "all"} onClick={() => { setStatus(k); setPage(1); }}
                className={cn("rounded-full px-3 py-1 transition", status === k ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg")}>
                {label}
              </button>
            ))}
          </div>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="input w-44">
            <option value="">All types</option>
            <option value="course">Courses</option>
            <option value="node">Lessons</option>
            <option value="comment">Comments</option>
          </select>
          <span className="ml-auto text-xs text-fg-dim">{data ? `${data.total} reports` : ""}</span>
        </div>

        <div className="mt-4 space-y-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-3 w-40 rounded bg-surface-2" />
                <div className="mt-3 h-3 w-3/4 rounded bg-surface-2" />
              </div>
            ))
          ) : isError ? (
            <div className="card text-center text-sm">
              <p className="font-medium text-danger">Could not load reports</p>
              <p className="mt-1 text-fg-dim">{error instanceof Error ? error.message : "Unknown error"}</p>
              <button onClick={() => refetch()} className="btn-ghost mx-auto mt-4 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
            </div>
          ) : (data?.items.length ?? 0) === 0 ? (
            <div className="card text-center text-fg-dim">
              {status === "open" ? "No open reports — the queue is clear. 🎉" : "No reports match these filters."}
            </div>
          ) : (
            data!.items.map((r) => (
              <div key={r.id} className="card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip capitalize">{r.target_type}</span>
                  <StatusChip status={r.status} />
                  <span className="text-xs text-fg-dim">Reported {relativeTime(r.created_at)} by {r.reporter?.display_name || "a user"}</span>
                </div>

                <div className="mt-3 rounded-xl border border-border bg-surface-2/60 p-3 text-sm">
                  {r.target_type === "course" && r.course && (
                    <p>
                      Course: <Link href={`/course/${r.course.id}`} className="font-medium hover:text-brand">{r.course.title}</Link>
                      <span className="ml-2 chip capitalize">{r.course.status.replace("_", " ")}</span>
                    </p>
                  )}
                  {r.target_type === "node" && r.node && <p>Lesson: <span className="font-medium">{r.node.title}</span></p>}
                  {r.target_type === "comment" && r.comment && <p className="line-clamp-3">Comment: “{r.comment.body}”</p>}
                  <p className="mt-2 text-fg-dim">Reason: {r.reason}</p>
                </div>

                {r.status === "open" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => setConfirming({ report: r, action: "dismiss" })} className="btn-ghost px-3 py-1.5 text-xs">
                      <X className="h-3.5 w-3.5" /> Dismiss
                    </button>
                    <button onClick={() => setConfirming({ report: r, action: "review" })} className="btn-ghost px-3 py-1.5 text-xs">
                      <Check className="h-3.5 w-3.5" /> Mark reviewed
                    </button>
                    {(r.course || r.node || r.comment) && (
                      <button onClick={() => setConfirming({ report: r, action: "suspend" })}
                        className="inline-flex items-center gap-1 rounded-full border border-danger/40 px-3 py-1.5 text-xs text-danger transition hover:bg-danger/10">
                        <Ban className="h-3.5 w-3.5" /> Suspend course
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-xs text-fg-dim">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"><ChevronLeft className="h-3.5 w-3.5" /> Previous</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50">Next <ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        {confirming && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setConfirming(null)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative w-full max-w-md rounded-2xl glass-strong p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="heading-3">
                {confirming.action === "dismiss" ? "Dismiss this report?" : confirming.action === "review" ? "Mark as reviewed?" : "Suspend the reported course?"}
              </h3>
              <p className="mt-2 text-sm text-fg-dim">
                {confirming.action === "suspend"
                  ? "The course is removed from the catalog immediately, new enrollments stop, and the creator is notified. Existing learners keep access. This is recorded in the audit log."
                  : confirming.action === "dismiss"
                    ? "The report is closed without further action. This is recorded in the audit log."
                    : "Use this when you've handled the issue another way (edited content, contacted the creator, etc.). Recorded in the audit log."}
              </p>
              {act.isError && <p className="mt-3 text-xs text-danger">{act.error instanceof Error ? act.error.message : "Action failed"}</p>}
              <div className="mt-5 flex gap-2">
                <button onClick={() => setConfirming(null)} className="btn-ghost flex-1" disabled={act.isPending}>Cancel</button>
                <button
                  onClick={() => act.mutate(confirming)}
                  disabled={act.isPending}
                  className={cn("flex-1", confirming.action === "suspend"
                    ? "inline-flex items-center justify-center gap-2 rounded-full border border-danger/40 px-5 py-2.5 font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50"
                    : "btn-primary disabled:opacity-50")}
                >
                  {act.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === "open") return <span className="chip border-warning/30 text-warning">Open</span>;
  if (status === "actioned") return <span className="chip border-success/30 text-success">Actioned</span>;
  return <span className="chip text-fg-dim">Dismissed</span>;
}
