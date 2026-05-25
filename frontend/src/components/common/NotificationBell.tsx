"use client";

import { Bell } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/utils";
import { useRealtimeNotifications } from "@/lib/hooks";
import { useApp } from "@/app/providers";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { user } = useApp();
  // Live updates when Supabase Realtime is configured; no-op otherwise.
  useRealtimeNotifications(user?.user_id || user?.id);
  // Poll the lightweight count on an interval, but treat it as fresh for 30s so a
  // window-focus or route change inside that window reuses the cache instead of refetching.
  // This polling stays in place as the realtime fallback.
  const { data: countData } = useQuery({ queryKey: ["unread-count"], queryFn: () => api.notifications.unreadCount(), refetchInterval: 60000, refetchOnWindowFocus: true, staleTime: 30_000 });
  // The recent list only loads when the dropdown opens, and stays fresh for 30s so
  // reopening doesn't refire it. Same ["notifications", 1] key as the full /notifications
  // page, so the two share one fetch instead of duplicating list(1).
  const { data: list } = useQuery({ queryKey: ["notifications", 1], queryFn: () => api.notifications.list(1), enabled: open, staleTime: 30_000 });
  // Only invalidate the notification queries (not the entire cache) on "mark all read".
  const markAll = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const unread = countData?.count ?? 0;

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label="Notifications"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 text-fg-dim transition hover:text-fg hover:border-brand">
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-gradient px-1 text-[10px] font-bold text-white shadow-[0_0_0_2px_var(--color-bg)]">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 origin-top-right animate-slide-up overflow-hidden rounded-2xl glass-strong shadow-glow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="font-display text-sm font-semibold">Notifications</span>
              <button onClick={() => markAll.mutate()} className="text-xs text-fg-dim hover:text-fg">Mark all read</button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {(list || []).length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-fg-dim">No notifications yet.</div>
              ) : (
                (list || []).slice(0, 6).map((n) => (
                  <Link key={n.id} href={n.href || "#"}
                    className="flex gap-3 border-b border-border/60 px-4 py-3 transition hover:bg-surface-2 last:border-0"
                    onClick={() => { if (!n.is_read) markOne.mutate(n.id); setOpen(false); }}>
                    <div className="mt-1">{!n.is_read && <span className="block h-2 w-2 rounded-full bg-brand-gradient" />}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{n.title}</p>
                      <p className="truncate text-xs text-fg-dim">{n.body}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-fg-dim">{relativeTime(n.created_at)}</p>
                    </div>
                  </Link>
                ))
              )}
            </div>
            <Link href="/notifications" className="block border-t border-border px-4 py-3 text-center text-xs font-medium text-brand hover:opacity-80" onClick={() => setOpen(false)}>
              See all notifications
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
