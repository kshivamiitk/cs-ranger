"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2, Users, ArrowUpRight } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Avatar } from "@/components/common/Avatar";
import { api, type CollaborationListItem } from "@/lib/api";
import { useApp } from "@/app/providers";
import { avatarUrl, relativeTime, cn } from "@/lib/utils";

export default function CollaborationsPage() {
  // useSearchParams needs a Suspense boundary for prerendering.
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-dim" /></div>}>
      <CollaborationsContent />
    </Suspense>
  );
}

function CollaborationsContent() {
  const { user } = useApp();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const focusId = sp.get("focus");
  const userId = user?.user_id || user?.id;

  const { data: list, isLoading } = useQuery({
    queryKey: ["collaborations-mine", userId],
    queryFn: () => api.courses.myCollaborations(),
    enabled: !!user,
  });

  const respond = useMutation({
    mutationFn: ({ courseId, accept }: { courseId: string; accept: boolean }) =>
      api.courses.respondToInvite(courseId, accept),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collaborations-mine", userId] }),
  });

  const leave = useMutation({
    mutationFn: (courseId: string) => api.courses.removeCollaborator(courseId, userId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collaborations-mine", userId] }),
  });

  const pending = (list || []).filter((c) => c.status === "pending");
  const accepted = (list || []).filter((c) => c.status === "accepted");

  // Flash-highlight the deeplinked invite (notification took the user here).
  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusId || !list) return;
    const el = document.getElementById(`invite-${focusId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-brand");
    const t = setTimeout(() => el.classList.remove("ring-brand"), 2000);
    return () => clearTimeout(t);
  }, [focusId, list]);

  return (
    <>
      <Navbar variant="creator" />
      <main className="mx-auto max-w-5xl px-4 py-10 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h1 className="heading-2">Collaborations</h1>
            <p className="text-sm text-fg-dim">
              Invitations and courses you co-edit. Only one collaborator edits at a time — the rest see the editor read-only.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-8 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div ref={focusRef}>
            <section className="mt-8">
              <h2 className="heading-3 mb-3">Incoming invites ({pending.length})</h2>
              {pending.length === 0 ? (
                <div className="card text-fg-dim">No invitations right now.</div>
              ) : (
                <ul className="space-y-3">
                  {pending.map((c) => (
                    <li key={c.course_id} id={`invite-${c.course_id}`} className={cn("card transition")}>
                      <InviteCard
                        item={c}
                        onAccept={() => respond.mutate({ courseId: c.course_id, accept: true })}
                        onDecline={() => respond.mutate({ courseId: c.course_id, accept: false })}
                        busy={respond.isPending}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-10">
              <h2 className="heading-3 mb-3">My collaborations ({accepted.length})</h2>
              {accepted.length === 0 ? (
                <div className="card text-fg-dim">No active collaborations yet.</div>
              ) : (
                <ul className="space-y-3">
                  {accepted.map((c) => (
                    <li key={c.course_id} className="card">
                      <ActiveCard
                        item={c}
                        onLeave={() => {
                          if (confirm(`Leave "${c.courses?.title || "this course"}"?`)) leave.mutate(c.course_id);
                        }}
                        busy={leave.isPending}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function InviteCard({ item, onAccept, onDecline, busy }: {
  item: CollaborationListItem;
  onAccept: () => void;
  onDecline: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Avatar name={item.inviter?.display_name || "Creator"} src={avatarUrl(item.invited_by)} size={36} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.inviter?.display_name || "A creator"} invited you</p>
        <p className="text-sm text-fg-dim">
          to co-edit <span className="font-medium text-fg">{item.courses?.title || "a course"}</span> · {relativeTime(item.invited_at)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={onAccept} disabled={busy} className="btn-primary text-xs disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Accept
          </button>
          <button onClick={onDecline} disabled={busy} className="btn-ghost text-xs disabled:opacity-50">
            <X className="h-3.5 w-3.5" /> Decline
          </button>
        </div>
      </div>
    </div>
  );
}

function ActiveCard({ item, onLeave, busy }: {
  item: CollaborationListItem;
  onLeave: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Avatar name={item.courses?.title || "Course"} src={item.courses?.thumbnail_url || undefined} size={36} />
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{item.courses?.title || "Course"}</p>
        <p className="text-xs text-fg-dim">Joined {relativeTime(item.responded_at || item.invited_at)}</p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Link href={`/creator/courses/${item.course_id}/edit`} className="btn-primary text-xs">
          Open editor <ArrowUpRight className="h-3 w-3" />
        </Link>
        <button onClick={onLeave} disabled={busy} className="text-xs text-fg-dim hover:text-danger disabled:opacity-50">
          {busy ? "Leaving…" : "Leave course"}
        </button>
      </div>
    </div>
  );
}
