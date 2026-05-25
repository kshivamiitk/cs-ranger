"use client";

import Link from "next/link";
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, Loader2, MessageSquare, RotateCcw, Send } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Avatar } from "@/components/common/Avatar";
import { api, type DoubtInboxItem } from "@/lib/api";
import { useApp } from "@/app/providers";
import { useDebouncedValue } from "@/lib/hooks";
import { avatarUrl, relativeTime, cn } from "@/lib/utils";

type StatusFilter = "open" | "resolved" | "all";

export default function DoubtsInboxPage() {
  const { user } = useApp();
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [courseId, setCourseId] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 350);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageSize = 20;

  const { data: myCourses } = useQuery({ queryKey: ["creator-courses", user?.user_id || user?.id], queryFn: () => api.courses.mine(), enabled: !!user });

  const filters = {
    page,
    pageSize,
    status: status === "all" ? undefined : status,
    courseId: courseId || undefined,
    q: debouncedSearch || undefined,
  };
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["doubts-inbox", user?.user_id || user?.id, filters],
    queryFn: () => api.courses.doubtsInbox(filters),
    enabled: !!user,
    placeholderData: keepPreviousData,
  });

  const items = data?.items || [];
  const selected = items.find((d) => d.id === selectedId) || items[0] || null;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  const invalidateInbox = () => qc.invalidateQueries({ queryKey: ["doubts-inbox"] });

  function setFilter(update: () => void) {
    update();
    setPage(1);
    setSelectedId(null);
  }

  if (!user) return null;

  return (
    <>
      <Navbar variant="creator" />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">
            <MessageSquare className="h-5 w-5" />
          </span>
          <div>
            <h1 className="heading-2">Doubts Inbox</h1>
            <p className="text-sm text-fg-dim">Every learner question across your courses — reply, resolve, and reopen without leaving this page.</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border border-border bg-surface-2 p-0.5 text-xs">
            {([
              { k: "open" as const, label: `Open (${data?.openCount ?? 0})` },
              { k: "resolved" as const, label: `Resolved (${data?.resolvedCount ?? 0})` },
              { k: "all" as const, label: "All" },
            ]).map((t) => (
              <button key={t.k} onClick={() => setFilter(() => setStatus(t.k))}
                className={cn("rounded-full px-3 py-1 transition", status === t.k ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg")}>
                {t.label}
              </button>
            ))}
          </div>
          <select value={courseId} onChange={(e) => setFilter(() => setCourseId(e.target.value))} className="input w-56">
            <option value="">All courses</option>
            {(myCourses || []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <input
            value={search}
            onChange={(e) => setFilter(() => setSearch(e.target.value))}
            placeholder="Search doubts…"
            className="input max-w-xs"
          />
        </div>

        {isLoading ? (
          <div className="mt-8 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : isError ? (
          <div className="mt-6 card text-center text-sm">
            <p className="font-medium text-danger">Could not load your doubts inbox</p>
            <p className="mt-1 text-fg-dim">{error instanceof Error ? error.message : "Unknown error"}</p>
            <button onClick={() => refetch()} className="btn-ghost mx-auto mt-4 text-xs">Retry</button>
          </div>
        ) : items.length === 0 ? (
          <div className="mt-6 card text-center text-fg-dim">
            {debouncedSearch || courseId || status !== "open"
              ? "No doubts match these filters."
              : "Nothing open. Once learners ask a doubt, it lands here within seconds."}
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-5">
            <div className="space-y-2 lg:col-span-2">
              {items.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className={cn(
                    "w-full rounded-2xl border p-4 text-left transition",
                    selected?.id === d.id ? "border-brand bg-surface-2 shadow-glass" : "border-border bg-surface hover:bg-surface-2",
                    !d.is_resolved && selected?.id !== d.id && "border-amber-400/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={d.profiles?.display_name || "Learner"} src={d.profiles?.avatar_url || avatarUrl(d.author_id)} size={24} />
                    <span className="truncate text-sm font-medium">{d.profiles?.display_name || "Learner"}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-fg-dim">{relativeTime(d.created_at)}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm">{d.body}</p>
                  <p className="mt-1.5 truncate text-xs text-fg-dim">{d.course_title} · {d.node_title}</p>
                  <div className="mt-2">
                    {d.is_resolved
                      ? <span className="chip text-success border-success/30">Resolved</span>
                      : <span className="chip border-amber-400/30 text-amber-300">Open</span>}
                  </div>
                </button>
              ))}

              <div className="flex items-center justify-between pt-2 text-xs text-fg-dim">
                <span>Page {page} of {totalPages} · {data?.total ?? 0} doubts</span>
                <span className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost px-2 py-1 disabled:opacity-50"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn-ghost px-2 py-1 disabled:opacity-50"><ChevronRight className="h-3.5 w-3.5" /></button>
                </span>
              </div>
            </div>

            <div className="lg:col-span-3">
              {selected ? (
                <DoubtDetail key={selected.id} doubt={selected} onChanged={invalidateInbox} />
              ) : (
                <div className="card text-center text-sm text-fg-dim">Select a doubt to read and reply.</div>
              )}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function DoubtDetail({ doubt, onChanged }: { doubt: DoubtInboxItem; onChanged: () => void }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const deeplink = `/course/${doubt.course_id}/learn/${doubt.node_id}?focus=${doubt.id}`;

  const { data: repliesData, isLoading: repliesLoading } = useQuery({
    queryKey: ["replies", doubt.id],
    queryFn: () => api.courses.replies(doubt.id, { limit: 100 }),
  });
  const replies = repliesData?.items || [];

  const postReply = useMutation({
    mutationFn: () => api.courses.addComment(doubt.node_id, reply.trim(), "comment", doubt.id),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["replies", doubt.id] });
    },
  });
  const resolve = useMutation({
    mutationFn: () => (doubt.is_resolved ? api.courses.reopenComment(doubt.id) : api.courses.resolveComment(doubt.id)),
    onSuccess: onChanged,
  });

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={doubt.profiles?.display_name || "Learner"} src={doubt.profiles?.avatar_url || avatarUrl(doubt.author_id)} size={40} />
          <div>
            <p className="font-medium">{doubt.profiles?.display_name || "Learner"}</p>
            <p className="text-xs text-fg-dim">{relativeTime(doubt.created_at)} · {doubt.course_title} · {doubt.node_title}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {doubt.is_resolved
            ? <span className="chip text-success border-success/30">Resolved</span>
            : <span className="chip border-amber-400/30 text-amber-300">Open</span>}
          <Link href={deeplink} className="btn-ghost px-3 py-1 text-xs">Open in lesson <ArrowUpRight className="h-3 w-3" /></Link>
        </div>
      </div>

      <p className="mt-4 whitespace-pre-line rounded-2xl border border-border bg-surface-2/60 p-4 text-sm">{doubt.body}</p>

      <div className="mt-5">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-fg-dim">Replies ({replies.length})</h4>
        {repliesLoading ? (
          <div className="mt-3 text-xs text-fg-dim"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading replies…</div>
        ) : replies.length === 0 ? (
          <p className="mt-3 text-sm text-fg-dim">No replies yet — be the first to answer.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {replies.map((r) => (
              <div key={r.id} className="flex items-start gap-3">
                <Avatar name={r.profiles?.display_name || "User"} src={r.profiles?.avatar_url || avatarUrl(r.author_id)} size={28} />
                <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2/50 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-fg-dim">
                    <span className="font-medium text-fg">{r.profiles?.display_name || "User"}</span>
                    <span>{relativeTime(r.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm">{r.body}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-surface-2/60 p-3">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder="Answer this doubt — the learner gets a notification."
          className="input min-h-[72px] resize-y"
        />
        {postReply.isError && <p className="mt-2 text-xs text-danger">{postReply.error instanceof Error ? postReply.error.message : "Could not post the reply"}</p>}
        {resolve.isError && <p className="mt-2 text-xs text-danger">{resolve.error instanceof Error ? resolve.error.message : "Could not update the doubt"}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={() => resolve.mutate()}
            disabled={resolve.isPending}
            className={cn("inline-flex items-center gap-1 text-xs disabled:opacity-50", doubt.is_resolved ? "text-fg-dim hover:text-fg" : "text-success hover:underline")}
          >
            {resolve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : doubt.is_resolved ? <RotateCcw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {doubt.is_resolved ? "Reopen doubt" : "Mark resolved"}
          </button>
          <button
            onClick={() => postReply.mutate()}
            disabled={!reply.trim() || postReply.isPending}
            className="btn-primary px-4 py-1.5 text-xs disabled:opacity-40"
          >
            {postReply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Post reply
          </button>
        </div>
      </div>
    </div>
  );
}
