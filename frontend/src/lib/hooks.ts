"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms of
 * inactivity. Used to throttle search/autocomplete query keys so React Query
 * fires one request per pause instead of one per keystroke.
 */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * Live notification updates via Supabase Realtime broadcast.
 *
 * The backend sends a broadcast on `user:<id>:notifications` whenever it
 * inserts a notification. We treat the event purely as an invalidation hint and
 * refetch through the normal API — so duplicate broadcast/poll events can never
 * produce duplicate rows, and the existing 60s polling keeps working as the
 * fallback when Supabase isn't configured (the hook is then a no-op).
 * Reconnects are handled by supabase-js channel rejoin.
 */
export function useRealtimeNotifications(userId?: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const sb = supabase();
    if (!sb) return;
    const channel = sb
      .channel(`user:${userId}:notifications`)
      .on("broadcast", { event: "notification" }, () => {
        qc.invalidateQueries({ queryKey: ["unread-count"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [userId, qc]);
}
