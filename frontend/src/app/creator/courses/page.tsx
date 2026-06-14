"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, BarChart3, Pencil, Loader2, Trash2, AlertCircle } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";
import { formatCompact, formatINR } from "@/lib/utils";

export default function CreatorCoursesPage() {
  const { user } = useApp();
  const qc = useQueryClient();
  const creatorId = user?.user_id || user?.id;
  const [err, setErr] = useState<string | null>(null);
  // Creator's own courses across ALL statuses (draft / under_review / published),
  // fetched server-side — the old api.courses.list() only returned published courses
  // and over-fetched the whole catalog before filtering on the client.
  const { data, isLoading } = useQuery({ queryKey: ["creator-courses", creatorId], queryFn: () => api.courses.mine(), enabled: !!creatorId });
  const own = data || [];

  const del = useMutation({
    mutationFn: (id: string) => api.courses.deleteCourse(id),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ["creator-courses", creatorId] });
      qc.invalidateQueries({ queryKey: ["storage-usage"] });
      qc.invalidateQueries({ queryKey: ["admin-storage-overview"] });
    },
    // Surfaces the server's reason — e.g. "this course has N purchases — unpublish instead".
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not delete the course"),
  });

  return (
    <>
      <Navbar variant="creator" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="heading-2">Your courses</h1>
            <p className="mt-1 text-sm text-fg-dim">{own.length} courses</p>
          </div>
          <Link href="/creator/courses/new" data-tour="new-course" className="btn-primary"><Plus className="h-4 w-4" /> Create new</Link>
        </div>

        {err && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{err}</span>
          </div>
        )}

        {isLoading ? (
          <div className="mt-6 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : own.length === 0 ? (
          <div className="card mt-6 text-center text-fg-dim">
            No courses yet. <Link href="/creator/courses/new" className="text-brand">Create your first →</Link>
          </div>
        ) : (
          <div className="mt-6 card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-widest text-fg-dim">
                <tr><th className="p-3">Course</th><th className="p-3">Status</th><th className="p-3">Students</th><th className="p-3">Price</th><th className="p-3">Rating</th><th className="p-3"></th></tr>
              </thead>
              <tbody>
                {own.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {c.thumbnail_url && <img src={c.thumbnail_url} alt="" className="h-10 w-16 rounded object-cover" />}
                        <span className="font-medium">{c.title}</span>
                      </div>
                    </td>
                    <td className="p-3"><span className={`chip capitalize ${c.status === "published" ? "border-success/30 text-success" : c.status === "under_review" ? "border-warning/30 text-warning" : "border-border"}`}>{c.status?.replace("_", " ")}</span></td>
                    <td className="p-3 tabular-nums">{formatCompact(c.enrollment_count || 0)}</td>
                    <td className="p-3 tabular-nums">{!c.price || c.price === 0 ? "Free" : formatINR(c.discounted_price || c.price)}</td>
                    <td className="p-3">★ {(c.rating_avg || 0).toFixed(1)}</td>
                    <td className="p-3 text-right">
                      <Link href={`/creator/courses/${c.id}/analytics`} className="inline-flex items-center gap-1 text-xs text-brand mr-3"><BarChart3 className="h-3 w-3" /> Analytics</Link>
                      <Link href={`/creator/courses/${c.id}/edit`} className="inline-flex items-center gap-1 text-xs text-fg-dim hover:text-fg"><Pencil className="h-3 w-3" /> Edit</Link>
                      <button
                        onClick={() => { if (confirm(`Delete "${c.title}"? This can't be undone. (Blocked if anyone has purchased it.)`)) del.mutate(c.id); }}
                        disabled={del.isPending}
                        className="ml-3 inline-flex items-center gap-1 text-xs text-fg-dim hover:text-danger disabled:opacity-50"
                      >
                        {del.isPending && del.variables === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
