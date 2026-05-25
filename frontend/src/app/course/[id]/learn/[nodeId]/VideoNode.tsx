"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Captions, ListVideo } from "lucide-react";
import { api, type CourseNode, type VideoChapter, type VideoSubtitle } from "@/lib/api";

/**
 * Video lesson with real watch tracking.
 *
 * YouTube: uses the IFrame Player API (postMessage) so we get true
 * currentTime/duration, accumulate actual played seconds, support seek (for
 * timestamped notes) and detect "ended" for auto-advance.
 *
 * Google Drive / unknown providers expose no playback API from an embed, so we
 * fall back to a visible-tab dwell-time estimate against the lesson's stored
 * duration; explicit Mark-as-Done always remains available.
 */

export interface VideoController {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
}

export interface VideoProgressSignal {
  watchSeconds: number;
  durationSeconds?: number;
  lastPositionSeconds?: number;
}

interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: {
    videoId: string;
    playerVars?: Record<string, number | string>;
    events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void };
  }) => YTPlayer;
  PlayerState: { PLAYING: number; ENDED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return new Promise(() => undefined);
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

function extractYouTubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([\w-]{6,})/.exec(url);
  return m ? m[1] : null;
}

const REPORT_EVERY_S = 10;

export function VideoNode({
  node, onProgress, onEnded, controllerRef,
}: {
  node: CourseNode;
  onProgress: (signal: VideoProgressSignal) => void;
  onEnded: () => void;
  controllerRef: React.MutableRefObject<VideoController | null>;
}) {
  const url = node.video_url || "";
  const youTubeId = node.video_provider === "gdrive" ? null : extractYouTubeId(url);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const watchSecondsRef = useRef(0);
  const playingRef = useRef(false);
  const lastReportRef = useRef(0);
  const onProgressRef = useRef(onProgress);
  const onEndedRef = useRef(onEnded);
  onProgressRef.current = onProgress;
  onEndedRef.current = onEnded;

  // Resume from the last saved position (only meaningful for YouTube where seek works).
  const { data: savedPosition } = useQuery({
    queryKey: ["watch-position", node.id],
    queryFn: () => api.enrollments.getWatchPosition(node.id),
    staleTime: 60_000,
  });

  function report(final = false) {
    const player = playerRef.current;
    const duration = player ? Math.round(player.getDuration() || 0) : node.duration_seconds || undefined;
    const position = player ? Math.round(player.getCurrentTime() || 0) : undefined;
    if (!final && watchSecondsRef.current - lastReportRef.current < REPORT_EVERY_S) return;
    lastReportRef.current = watchSecondsRef.current;
    onProgressRef.current({
      watchSeconds: watchSecondsRef.current,
      durationSeconds: duration || undefined,
      lastPositionSeconds: position,
    });
  }

  // ── YouTube path ──
  useEffect(() => {
    if (!youTubeId || !containerRef.current) return;
    let cancelled = false;
    let tick: ReturnType<typeof setInterval> | null = null;
    watchSecondsRef.current = 0;
    lastReportRef.current = 0;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return;
      const player = new YT.Player(containerRef.current, {
        videoId: youTubeId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            const resume = savedPosition?.seconds || 0;
            if (resume > 5) player.seekTo(resume, true);
          },
          onStateChange: (e) => {
            playingRef.current = e.data === YT.PlayerState.PLAYING;
            if (e.data === YT.PlayerState.ENDED) {
              const duration = Math.round(player.getDuration() || 0);
              watchSecondsRef.current = Math.max(watchSecondsRef.current, duration);
              report(true);
              onEndedRef.current();
            }
          },
        },
      });
      playerRef.current = player;
      controllerRef.current = {
        seekTo: (s) => player.seekTo(s, true),
        getCurrentTime: () => Math.round(player.getCurrentTime() || 0),
      };
      tick = setInterval(() => {
        if (playingRef.current) {
          watchSecondsRef.current += 1;
          report();
        }
      }, 1000);
    });

    return () => {
      cancelled = true;
      if (tick) clearInterval(tick);
      report(true);
      controllerRef.current = null;
      try { playerRef.current?.destroy(); } catch { /* iframe already gone */ }
      playerRef.current = null;
    };
    // savedPosition intentionally excluded: we only resume on initial mount of this node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youTubeId, node.id]);

  // ── Drive / unknown provider fallback: dwell-time estimate while the tab is visible ──
  useEffect(() => {
    if (youTubeId) return;
    watchSecondsRef.current = 0;
    lastReportRef.current = 0;
    controllerRef.current = null;
    const tick = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        watchSecondsRef.current += 1;
        report();
      }
    }, 1000);
    return () => {
      clearInterval(tick);
      report(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youTubeId, node.id]);

  const chapters = node.video_chapters || [];
  const subtitles = node.video_subtitles || [];

  if (!url) {
    return <div className="mt-4 card flex h-72 items-center justify-center text-fg-dim">No video attached to this lesson yet.</div>;
  }

  if (youTubeId) {
    return (
      <div className="mt-4">
        <div className="aspect-video overflow-hidden rounded-2xl border border-border bg-black">
          <div ref={containerRef} className="h-full w-full" />
        </div>
        <VideoExtras
          chapters={chapters}
          subtitles={subtitles}
          canSeek
          onSeek={(seconds) => playerRef.current?.seekTo(seconds, true)}
        />
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="aspect-video overflow-hidden rounded-2xl border border-border bg-black">
        <iframe src={url} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen className="h-full w-full" />
      </div>
      <p className="mt-2 text-xs text-fg-dim">
        This provider doesn&apos;t expose playback data, so progress is estimated from time spent on the lesson — use “Mark complete” when you&apos;re done.
      </p>
      <VideoExtras chapters={chapters} subtitles={subtitles} canSeek={false} />
    </div>
  );
}

function fmtChapterTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function VideoExtras({
  chapters, subtitles, canSeek, onSeek,
}: {
  chapters: VideoChapter[];
  subtitles: VideoSubtitle[];
  canSeek: boolean;
  onSeek?: (seconds: number) => void;
}) {
  if (chapters.length === 0 && subtitles.length === 0) return null;
  const both = chapters.length > 0 && subtitles.length > 0;
  return (
    <div className={`mt-3 grid gap-3 ${both ? "md:grid-cols-2" : ""}`}>
      {chapters.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface-2/40 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-fg-dim">
            <ListVideo className="h-3.5 w-3.5" /> Chapters
          </p>
          <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
            {chapters.map((c, i) => (
              <button
                key={`${c.seconds}-${i}`}
                type="button"
                onClick={() => canSeek && onSeek?.(c.seconds)}
                disabled={!canSeek}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                  canSeek ? "hover:bg-surface-2" : "cursor-default"
                }`}
              >
                <span className="shrink-0 font-mono text-xs text-brand">{fmtChapterTime(c.seconds)}</span>
                <span className="truncate text-sm">{c.title}</span>
              </button>
            ))}
          </div>
          {!canSeek && (
            <p className="mt-2 text-[11px] text-fg-dim">This provider doesn&apos;t support jumping to a timestamp from outside the player — use these as a reference while watching.</p>
          )}
        </div>
      )}
      {subtitles.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface-2/40 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-fg-dim">
            <Captions className="h-3.5 w-3.5" /> Subtitles
          </p>
          <div className="space-y-0.5">
            {subtitles.map((s, i) => (
              <a
                key={`${s.lang}-${i}`}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                download
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-surface-2"
              >
                <span className="truncate text-sm">{s.label}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] uppercase text-fg-dim">{s.lang} · {s.format}</span>
                <span className="shrink-0 text-xs text-brand">Open</span>
              </a>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-fg-dim">Embedded players can&apos;t load external captions — open or download a track and load it in your own player if needed.</p>
        </div>
      )}
    </div>
  );
}
