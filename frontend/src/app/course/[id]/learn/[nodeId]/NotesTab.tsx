"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2, StickyNote } from "lucide-react";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/utils";

function formatTimestamp(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Per-lesson notes. For video lessons the note can be anchored to the current
 * playback time; clicking a timestamped note seeks the video when the provider
 * supports it (YouTube), otherwise the timestamp is shown as plain context.
 */
export function NotesTab({
  nodeId, isVideo, getCurrentTime, onSeek,
}: {
  nodeId: string;
  isVideo: boolean;
  getCurrentTime: () => number | null;
  onSeek: (seconds: number) => boolean;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [attachTime, setAttachTime] = useState(true);

  const { data: notes, isLoading } = useQuery({ queryKey: ["notes", nodeId], queryFn: () => api.enrollments.notes(nodeId) });

  const add = useMutation({
    mutationFn: () => {
      const ts = isVideo && attachTime ? getCurrentTime() : null;
      return api.enrollments.addNote(nodeId, draft.trim(), ts ?? undefined);
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["notes", nodeId] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="card">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Write a note for this lesson — only you can see it."
          className="input min-h-[80px] resize-y"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {isVideo ? (
            <label className="flex items-center gap-2 text-xs text-fg-dim">
              <input type="checkbox" checked={attachTime} onChange={(e) => setAttachTime(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--brand-primary)]" />
              Attach current video time{getCurrentTime() != null ? ` (${formatTimestamp(getCurrentTime()!)})` : ""}
            </label>
          ) : <span />}
          <button
            onClick={() => add.mutate()}
            disabled={!draft.trim() || add.isPending}
            className="btn-primary px-4 py-1.5 text-xs disabled:opacity-40"
          >
            {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save note"}
          </button>
        </div>
        {add.isError && <p className="mt-2 text-xs text-danger">{add.error instanceof Error ? add.error.message : "Could not save the note"}</p>}
      </div>

      {isLoading ? (
        <div className="flex justify-center p-6 text-fg-dim"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (notes?.length ?? 0) === 0 ? (
        <div className="card text-center text-sm text-fg-dim">
          <StickyNote className="mx-auto mb-2 h-6 w-6" />
          No notes yet for this lesson.
        </div>
      ) : (
        <div className="space-y-2">
          {notes!.map((n) => (
            <div key={n.id} className="card flex items-start gap-3">
              {n.timestamp_s != null ? (
                <button
                  onClick={() => onSeek(n.timestamp_s)}
                  title={isVideo ? "Jump to this moment" : "Timestamp"}
                  className="chip shrink-0 border-brand/30 text-brand hover:bg-surface-2"
                >
                  <Clock className="h-3 w-3" /> {formatTimestamp(n.timestamp_s)}
                </button>
              ) : (
                <span className="chip shrink-0 text-fg-dim"><StickyNote className="h-3 w-3" /> Note</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line text-sm">{n.body}</p>
                {"created_at" in n && typeof (n as { created_at?: string }).created_at === "string" && (
                  <p className="mt-1 text-[11px] uppercase tracking-wider text-fg-dim">{relativeTime((n as { created_at: string }).created_at)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
