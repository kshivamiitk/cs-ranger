"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserMinus, UserPlus } from "lucide-react";
import { api, type FollowedCreator } from "@/lib/api";
import { useApp } from "@/app/providers";
import { cn } from "@/lib/utils";

/**
 * Subscribe / Unsubscribe to a creator. Optimistic toggle against the shared
 * ["my-subscriptions"] cache with rollback on error, so every surface (creator
 * directory, public profile, course page, /feed) stays in sync.
 */
export function FollowButton({ creatorId, compact, className }: { creatorId: string; compact?: boolean; className?: string }) {
  const qc = useQueryClient();
  const { user } = useApp();
  const myId = user?.user_id || user?.id;

  const { data: subscriptions } = useQuery({
    queryKey: ["my-subscriptions"],
    queryFn: () => api.users.mySubscriptions(),
    enabled: !!user,
    staleTime: 60_000,
  });
  const isFollowing = !!subscriptions?.some((s) => s.creator_id === creatorId);

  const toggle = useMutation({
    mutationFn: () => (isFollowing ? api.users.unsubscribe(creatorId) : api.users.subscribe(creatorId)),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["my-subscriptions"] });
      const previous = qc.getQueryData<FollowedCreator[]>(["my-subscriptions"]);
      qc.setQueryData<FollowedCreator[]>(["my-subscriptions"], (old = []) =>
        isFollowing
          ? old.filter((s) => s.creator_id !== creatorId)
          : [{ creator_id: creatorId, followed_at: new Date().toISOString(), profile: null }, ...old],
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.previous) qc.setQueryData(["my-subscriptions"], ctx.previous); },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["my-subscriptions"] });
      qc.invalidateQueries({ queryKey: ["subscriber-count", creatorId] });
      qc.invalidateQueries({ queryKey: ["my-feed"] });
    },
  });

  // Creators can't follow themselves; logged-out visitors don't get a dead button.
  if (!user || myId === creatorId) return null;

  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle.mutate(); }}
      disabled={toggle.isPending}
      className={cn(
        isFollowing
          ? "inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-surface-2 font-medium text-fg-dim transition hover:border-danger/50 hover:text-danger"
          : "inline-flex items-center justify-center gap-1.5 rounded-full border border-brand/40 bg-surface-2 font-medium text-brand transition hover:bg-surface",
        compact ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
        "disabled:opacity-60",
        className,
      )}
    >
      {toggle.isPending ? (
        <Loader2 className={compact ? "h-3 w-3 animate-spin" : "h-3.5 w-3.5 animate-spin"} />
      ) : isFollowing ? (
        <UserMinus className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      ) : (
        <UserPlus className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      )}
      {isFollowing ? "Following" : "Follow"}
    </button>
  );
}
