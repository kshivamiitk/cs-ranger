"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Newspaper, RefreshCw, Sparkles, Users } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Avatar } from "@/components/common/Avatar";
import { FollowButton } from "@/components/common/FollowButton";
import { api } from "@/lib/api";
import { useApp } from "@/app/providers";
import { avatarUrl, formatINR, relativeTime } from "@/lib/utils";

const PAGE_SIZE = 20;

export default function FeedPage() {
  const { user } = useApp();
  const [page, setPage] = useState(1);

  const { data: subscriptions } = useQuery({
    queryKey: ["my-subscriptions"],
    queryFn: () => api.users.mySubscriptions(),
    enabled: !!user,
  });
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["my-feed", page],
    queryFn: () => api.users.feed({ page, pageSize: PAGE_SIZE }),
    enabled: !!user,
    placeholderData: keepPreviousData,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const followingCount = subscriptions?.length ?? 0;

  if (!user) return null;

  return (
    <>
      <Navbar variant="learner" />
      <main className="mx-auto max-w-4xl px-4 py-10 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><Newspaper className="h-5 w-5" /></span>
            <div>
              <h1 className="heading-2">Your feed</h1>
              <p className="mt-1 text-sm text-fg-dim">New courses from the {followingCount} creator{followingCount === 1 ? "" : "s"} you follow.</p>
            </div>
          </div>
          <Link href="/creators" className="btn-ghost text-xs"><Users className="h-3.5 w-3.5" /> Find creators</Link>
        </div>

        <div className="mt-6 space-y-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card flex animate-pulse items-center gap-4">
                <div className="h-16 w-28 rounded-xl bg-surface-2" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-surface-2" />
                  <div className="h-3 w-1/3 rounded bg-surface-2" />
                </div>
              </div>
            ))
          ) : isError ? (
            <div className="card text-center text-sm">
              <p className="font-medium text-danger">Could not load your feed</p>
              <p className="mt-1 text-fg-dim">{error instanceof Error ? error.message : "Unknown error"}</p>
              <button onClick={() => refetch()} className="btn-ghost mx-auto mt-4 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
            </div>
          ) : (data?.items.length ?? 0) === 0 ? (
            <div className="card text-center text-fg-dim">
              <Sparkles className="mx-auto mb-2 h-8 w-8" />
              <p className="font-medium text-fg">{followingCount === 0 ? "Your feed is empty because you don't follow anyone yet." : "Nothing new from your creators yet."}</p>
              <p className="mt-1 text-sm">
                {followingCount === 0
                  ? "Follow a few creators and their new courses will land here the moment they publish."
                  : "When a creator you follow publishes a course, it shows up here (and in your notifications)."}
              </p>
              <Link href="/creators" className="btn-primary mx-auto mt-4 text-sm">Browse creators</Link>
            </div>
          ) : (
            data!.items.map((item) => (
              <Link
                key={`${item.course.id}-${item.at}`}
                href={`/course/${item.course.id}`}
                className="card flex flex-col gap-4 transition hover:-translate-y-0.5 hover:shadow-glow sm:flex-row sm:items-center"
              >
                {item.course.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.course.thumbnail_url} alt="" className="h-20 w-full rounded-xl object-cover sm:w-32" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-fg-dim">
                    <Avatar name={item.creator?.display_name || "Creator"} src={item.creator?.avatar_url || avatarUrl(item.creator?.username || "creator")} size={20} />
                    <span className="truncate">{item.creator?.display_name || "A creator you follow"} published a course</span>
                    <span className="shrink-0">· {relativeTime(item.at)}</span>
                  </div>
                  <p className="mt-1 line-clamp-1 font-medium">{item.course.title}</p>
                  {item.course.subtitle && <p className="line-clamp-1 text-sm text-fg-dim">{item.course.subtitle}</p>}
                  <p className="mt-1 text-xs text-fg-dim">
                    {!item.course.price ? "Free" : formatINR(item.course.discounted_price || item.course.price)} · ★ {(item.course.rating_avg || 0).toFixed(1)}
                  </p>
                </div>
                <FollowButton creatorId={item.course.creator_id || ""} compact className="self-start sm:self-center" />
              </Link>
            ))
          )}
        </div>

        {(data?.total ?? 0) > PAGE_SIZE && (
          <div className="mt-6 flex items-center justify-between text-sm">
            <span className="text-xs text-fg-dim">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"><ChevronLeft className="h-3.5 w-3.5" /> Previous</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50">Next <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        )}

        {isLoading === false && (data?.items.length ?? 0) > 0 && (
          <div className="mt-6 flex justify-center">
            {page >= totalPages && <span className="text-xs text-fg-dim"><Loader2 className="hidden" />You&apos;re all caught up.</span>}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
