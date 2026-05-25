"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { api } from "@/lib/api";
import { cn, relativeTime } from "@/lib/utils";

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  // Shares the ["notifications", 1] and ["unread-count"] caches with the navbar bell —
  // navigating here after opening the bell reuses the data instead of refetching.
  const { data, isLoading } = useQuery({ queryKey: ["notifications", 1], queryFn: () => api.notifications.list(1), staleTime: 30_000 });
  const { data: counts } = useQuery({ queryKey: ["unread-count"], queryFn: () => api.notifications.unreadCount(), staleTime: 30_000 });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["unread-count"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  // Scope the invalidation to notification queries instead of nuking the whole app cache.
  const markAll = useMutation({ mutationFn: () => api.notifications.markAllRead(), onSuccess: invalidate });
  const markOne = useMutation({ mutationFn: (id: string) => api.notifications.markRead(id), onSuccess: invalidate });

  const list = (data || []).filter((n) => (filter === "all" ? true : filter === "unread" ? !n.is_read : n.is_read));

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2"><Bell className="h-5 w-5" /></span>
            <div>
              <h1 className="heading-2">Notifications</h1>
              <p className="text-sm text-fg-dim">{counts?.count ?? 0} unread</p>
            </div>
          </div>
          <button onClick={() => markAll.mutate()} disabled={markAll.isPending} className="btn-ghost text-xs disabled:opacity-50">Mark all read</button>
        </div>

        <div className="mb-4 inline-flex rounded-full border border-border bg-surface-2 p-0.5 text-xs">
          {(["all", "unread", "read"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn("rounded-full px-3 py-1 capitalize transition", filter === f ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg")}
            >
              {f}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="card divide-y divide-border p-0">
            {list.length === 0 ? (
              <p className="p-6 text-center text-sm text-fg-dim">
                {filter === "unread" ? "No unread notifications — you're all caught up." : filter === "read" ? "Nothing here yet." : "You're all caught up."}
              </p>
            ) : list.map((n) => (
              <Link
                key={n.id}
                href={n.href || "#"}
                onClick={() => { if (!n.is_read) markOne.mutate(n.id); }}
                className={cn("flex gap-3 p-4 transition hover:bg-surface-2", !n.is_read && "bg-surface-2/40")}
              >
                <span className="mt-1">{!n.is_read && <span className="block h-2 w-2 rounded-full bg-brand-gradient" />}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-sm text-fg-dim">{n.body}</p>
                  <p className="mt-1 text-xs uppercase tracking-widest text-fg-dim">{relativeTime(n.created_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
