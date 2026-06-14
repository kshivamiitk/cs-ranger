"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/app/providers";
import {
  ArrowLeft, ArrowRight, Award, Bookmark, BookmarkCheck, CheckCircle2, ChevronDown, ChevronRight,
  ExternalLink, FileText, ListChecks, Maximize2, MessageSquare, Minimize2, Paperclip, Play, Sparkles, Loader2,
  StickyNote, Timer, X, Folder,
} from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Avatar } from "@/components/common/Avatar";
import { Progress } from "@/components/common/Progress";
import { MarkdownView } from "@/components/common/MarkdownView";
import { SecurePdfViewer } from "@/components/common/SecurePdfViewer";
import { composeStaticDoc, openStaticLessonInNewTab } from "@/lib/staticLesson";
import { VideoNode, type VideoController, type VideoProgressSignal } from "./VideoNode";
import { QuizPanel } from "./QuizPanel";
import { NotesTab } from "./NotesTab";
import { CourseCompletionModal } from "./CourseCompletionModal";
import { api, type Course, type CourseNode, type Comment, type LessonBookmark, type NodeProgressResult } from "@/lib/api";
import { buildNodeTree, flattenCourseNodes, nodeTreeContains } from "@/lib/courseTree";
import { cn, durationFromSeconds, relativeTime, avatarUrl } from "@/lib/utils";

export function Player({ course, initialNodeId }: { course: Course; initialNodeId: string }) {
  const allNodes = useMemo(() => flattenCourseNodes(course), [course]);
  const [activeId, setActiveId] = useState(initialNodeId);
  const [tab, setTab] = useState<"qa" | "notes" | "resources">("qa");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Focus mode = hide curriculum + discussion, give the lesson the entire
  // viewport. The discussion panel is unmounted (not just CSS-hidden) so a
  // viewer who's just reading doesn't pay React's render cost for it at all.
  const [focusMode, setFocusMode] = useState(false);
  const qc = useQueryClient();
  const { user } = useApp();
  const userId = user?.user_id || user?.id;

  const activeIdx = allNodes.findIndex((n) => n.id === activeId);
  const node = allNodes[activeIdx];
  const prev = allNodes[activeIdx - 1];
  const next = allNodes[activeIdx + 1];

  // Lesson-level bookmark — optimistic toggle with rollback; the /bookmarks
  // page reads the same cache key so a toggle here shows up there immediately.
  const { data: lessonBookmarks } = useQuery({
    queryKey: ["lesson-bookmarks", userId],
    queryFn: () => api.courses.lessonBookmarks(),
    enabled: !!user,
  });
  const isBookmarked = !!lessonBookmarks?.some((b) => b.node_id === activeId);
  const toggleBookmark = useMutation({
    mutationFn: () => (isBookmarked ? api.courses.unbookmarkNode(activeId) : api.courses.bookmarkNode(activeId)),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["lesson-bookmarks", userId] });
      const previous = qc.getQueryData<LessonBookmark[]>(["lesson-bookmarks", userId]);
      qc.setQueryData<LessonBookmark[]>(["lesson-bookmarks", userId], (old = []) =>
        isBookmarked
          ? old.filter((b) => b.node_id !== activeId)
          : [{ node_id: activeId, course_id: course.id, created_at: new Date().toISOString(), nodes: { id: activeId, title: node?.title || "", type: node?.type || "video" }, courses: { id: course.id, title: course.title, thumbnail_url: course.thumbnail_url } }, ...old],
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.previous) qc.setQueryData(["lesson-bookmarks", userId], ctx.previous); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["lesson-bookmarks", userId] }),
  });

  const { data: progress } = useQuery({ queryKey: ["course-progress", course.id], queryFn: () => api.enrollments.courseProgress(course.id) });
  const completedSet = useMemo(() => new Set(progress?.completedNodeIds || []), [progress]);
  const completedLessonCount = useMemo(() => allNodes.filter((n) => completedSet.has(n.id)).length, [allNodes, completedSet]);

  // ── Completion engine ──
  const [autoAdvanceUntil, setAutoAdvanceUntil] = useState<number | null>(null);
  const [autoAdvanceLeft, setAutoAdvanceLeft] = useState(5);
  const [showCompletion, setShowCompletion] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const videoControllerRef = useRef<VideoController | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const nextIdRef = useRef<string | undefined>(next?.id);
  nextIdRef.current = next?.id;

  const handleProgressResult = useCallback((result: NodeProgressResult, sourceNodeId: string, opts?: { autoAdvance?: boolean }) => {
    if (result.newlyCompleted) {
      qc.setQueryData<{ enrollment: unknown | null; completedNodeIds: string[] }>(["course-progress", course.id], (old) => {
        const completedNodeIds = new Set(old?.completedNodeIds || []);
        completedNodeIds.add(sourceNodeId);
        const enrollmentPatch: Record<string, unknown> = {};
        if (result.courseProgressPercent != null) enrollmentPatch.progress_percent = result.courseProgressPercent;
        if (result.courseCompleted) enrollmentPatch.completed_at = new Date().toISOString();
        return {
          enrollment: old?.enrollment
            ? { ...(old.enrollment as Record<string, unknown>), ...enrollmentPatch }
            : old?.enrollment ?? null,
          completedNodeIds: Array.from(completedNodeIds),
        };
      });
      if (result.courseJustCompleted) qc.invalidateQueries({ queryKey: ["enrollments"] });
      if (opts?.autoAdvance !== false && sourceNodeId === activeIdRef.current && nextIdRef.current) {
        setAutoAdvanceUntil(Date.now() + 5000);
      }
    }
    if (result.courseJustCompleted) setShowCompletion(true);
  }, [course.id, qc]);

  const updateProgress = useMutation({
    mutationFn: ({ nodeId, signal }: { nodeId: string; signal: Parameters<typeof api.enrollments.updateProgress>[1] }) =>
      api.enrollments.updateProgress(nodeId, signal),
    onSuccess: (result, vars) => handleProgressResult(result, vars.nodeId),
  });
  const { mutate: sendProgress } = updateProgress;
  const reportProgress = useCallback((nodeId: string, signal: Parameters<typeof api.enrollments.updateProgress>[1]) => {
    if (!user) return;
    sendProgress({ nodeId, signal });
  }, [sendProgress, user]);

  const markDone = useMutation({
    mutationFn: (nodeId: string) => api.enrollments.updateProgress(nodeId, { markDone: true }),
    onSuccess: (result, nodeId) => { setProgressError(null); handleProgressResult(result, nodeId, { autoAdvance: false }); },
    onError: (e) => setProgressError(e instanceof Error ? e.message : "Could not update progress"),
  });

  const progressPct = Math.round((completedLessonCount / Math.max(1, allNodes.length)) * 100);
  const certificateMinProgress = course.certificate_min_progress ?? 100;
  const certificateReady = (course.certificate_enabled ?? true) && progressPct >= certificateMinProgress;

  function advance() {
    if (node && node.type !== "quiz" && !completedSet.has(activeId)) markDone.mutate(activeId);
    setAutoAdvanceUntil(null);
    if (next) setActiveId(next.id);
  }

  // Auto-advance countdown (5s, cancellable).
  useEffect(() => {
    if (!autoAdvanceUntil) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((autoAdvanceUntil - Date.now()) / 1000));
      setAutoAdvanceLeft(left);
      if (left <= 0) {
        clearInterval(id);
        setAutoAdvanceUntil(null);
        if (nextIdRef.current) setActiveId(nextIdRef.current);
      }
    }, 250);
    return () => clearInterval(id);
  }, [autoAdvanceUntil]);

  // Reset transient per-lesson state when navigating between lessons.
  useEffect(() => {
    setAutoAdvanceUntil(null);
    setProgressError(null);
    setAutoAdvanceLeft(5);
  }, [activeId]);

  // ── Scroll tracking (markdown / pdf / static_website): 80% read = complete ──
  const lessonBoxRef = useRef<HTMLElement | null>(null);
  const maxScrollRef = useRef(0);
  const lastSentScrollRef = useRef(0);
  const dwellStartRef = useRef(Date.now());
  const isScrollTracked = !!node && (node.type === "markdown" || node.type === "pdf" || node.type === "static_website");

  useEffect(() => {
    maxScrollRef.current = 0;
    lastSentScrollRef.current = 0;
    dwellStartRef.current = Date.now();
  }, [activeId]);

  const handleLessonScroll = useCallback(() => {
    const el = lessonBoxRef.current;
    if (!el || !isScrollTracked) return;
    const pct = el.scrollHeight <= el.clientHeight + 4
      ? 100
      : Math.min(100, Math.round(((el.scrollTop + el.clientHeight) / el.scrollHeight) * 100));
    if (pct > maxScrollRef.current) maxScrollRef.current = pct;
    if (maxScrollRef.current >= 80 && lastSentScrollRef.current < 80 && !completedSet.has(activeId)) {
      lastSentScrollRef.current = maxScrollRef.current;
      reportProgress(activeId, { scrollPercent: maxScrollRef.current });
    }
  }, [activeId, isScrollTracked, completedSet, reportProgress]);

  // Periodic flush + "fits without scrolling" dwell rule (10s on the lesson counts as read).
  useEffect(() => {
    if (!isScrollTracked) return;
    const id = setInterval(() => {
      const el = lessonBoxRef.current;
      if (!el) return;
      const fits = el.scrollHeight <= el.clientHeight + 4;
      if (fits && Date.now() - dwellStartRef.current >= 10_000) maxScrollRef.current = 100;
      if (maxScrollRef.current > lastSentScrollRef.current) {
        lastSentScrollRef.current = maxScrollRef.current;
        reportProgress(activeId, { scrollPercent: maxScrollRef.current });
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [activeId, isScrollTracked, reportProgress]);

  // PDF "pages viewed" feeds the same scroll-percent channel the completion
  // engine already evaluates for pdf nodes (≥80% = complete), so paging with
  // the viewer's next/prev buttons counts the same as scrolling.
  const handlePdfProgress = useCallback((percentViewed: number) => {
    if (percentViewed > maxScrollRef.current) maxScrollRef.current = percentViewed;
    if (maxScrollRef.current >= 80 && lastSentScrollRef.current < 80 && !completedSet.has(activeIdRef.current)) {
      lastSentScrollRef.current = maxScrollRef.current;
      reportProgress(activeIdRef.current, { scrollPercent: maxScrollRef.current });
    }
  }, [completedSet, reportProgress]);

  // ── Video + quiz callbacks ──
  const handleVideoProgress = useCallback((signal: VideoProgressSignal) => {
    reportProgress(activeIdRef.current, signal);
  }, [reportProgress]);
  const handleVideoEnded = useCallback(() => {
    if (nextIdRef.current) setAutoAdvanceUntil(Date.now() + 5000);
  }, []);
  const handleQuizResult = useCallback((r: { passed: boolean; courseProgressPercent?: number; courseCompleted?: boolean; courseJustCompleted?: boolean }) => {
    if (r.passed) {
      qc.invalidateQueries({ queryKey: ["course-progress", course.id] });
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      if (nextIdRef.current) setAutoAdvanceUntil(Date.now() + 5000);
    }
    if (r.courseJustCompleted) setShowCompletion(true);
  }, [course.id, qc]);

  return (
    // YouTube-style: page scrolls naturally. The lesson sits in a height-capped
    // "box" with its own internal scroll for long markdown. When the user
    // reaches the box's scroll boundary the browser's native scroll-chaining
    // bubbles the wheel up to the page, revealing the discussion below — no
    // JS scroll listeners, all GPU-compositor work, scales to any view count.
    <div className="min-h-screen">
      <Navbar variant="learner" />
      <div className="flex">
        {/* Curriculum sidebar — sticky to viewport, scrolls independently.
            Unmounted in focus mode (no React work for it at all). */}
        {!focusMode && (
          <aside className={cn(
            "sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 overflow-y-auto border-r border-border md:block",
            sidebarOpen ? "w-80" : "w-0",
          )}>
            {sidebarOpen && (
              <div className="p-4">
                <Link href={`/course/${course.id}`} className="text-xs text-fg-dim hover:text-fg inline-flex items-center gap-1">
                  <ArrowLeft className="h-3 w-3" /> Course details
                </Link>
                <h2 className="mt-2 font-display text-base font-semibold leading-tight">{course.title}</h2>
                <div className="mt-2">
                  <Progress value={progressPct} />
                  <p className="mt-1 text-xs text-fg-dim">{progressPct}% · {completedLessonCount}/{allNodes.length} lessons</p>
                  {certificateReady && progressPct < 100 && (
                    <button onClick={() => setShowCompletion(true)} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-medium text-success">
                      <Award className="h-3.5 w-3.5" /> Claim certificate
                    </button>
                  )}
                </div>

                <div className="mt-5 space-y-1">
                  {(course.modules || []).map((m) => (
                    <ModuleAccordion key={m.id} title={m.title} open={nodeTreeContains(m.nodes || [], activeId)}>
                      <CurriculumNodes
                        nodes={buildNodeTree(m.nodes || [])}
                        activeId={activeId}
                        completedSet={completedSet}
                        onSelect={setActiveId}
                      />
                    </ModuleAccordion>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-5xl px-4 py-5 md:px-8">
            {/* Top toolbar */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {!focusMode && (
                  <button onClick={() => setSidebarOpen((v) => !v)} className="btn-ghost px-3 py-1.5 text-xs md:inline-flex hidden">
                    {sidebarOpen ? "Hide curriculum" : "Show curriculum"}
                  </button>
                )}
                <button
                  onClick={() => setFocusMode((v) => !v)}
                  title={focusMode ? "Exit focus" : "Focus on lesson"}
                  className="btn-ghost px-3 py-1.5 text-xs"
                >
                  {focusMode ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                  {focusMode ? "Exit focus" : "Focus"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {prev && <button onClick={() => setActiveId(prev.id)} className="btn-ghost px-3 py-1.5 text-xs"><ArrowLeft className="h-3 w-3" /> Previous</button>}
                {completedSet.has(activeId) && (
                  <span className="chip border-success/30 text-success"><CheckCircle2 className="h-3 w-3" /> Completed</span>
                )}
                {next ? (
                  <button onClick={advance} disabled={markDone.isPending} className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
                    {markDone.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    {node?.type === "quiz" || completedSet.has(activeId) ? "Next" : "Mark complete & next"} <ArrowRight className="h-3 w-3" />
                  </button>
                ) : (
                  <button onClick={advance} disabled={markDone.isPending} className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
                    {markDone.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Finish course
                  </button>
                )}
              </div>
            </div>

            {progressError && (
              <p className="mt-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{progressError}</p>
            )}

            {autoAdvanceUntil && next && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-brand/40 bg-surface-2 px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <Timer className="h-4 w-4 text-brand" />
                  Lesson complete — next lesson in <b className="tabular-nums">{autoAdvanceLeft}s</b>: <span className="truncate text-fg-dim">{next.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <button onClick={() => { setAutoAdvanceUntil(null); setActiveId(next.id); }} className="btn-primary px-3 py-1 text-xs">Go now</button>
                  <button onClick={() => setAutoAdvanceUntil(null)} className="btn-ghost px-3 py-1 text-xs"><X className="h-3 w-3" /> Cancel</button>
                </span>
              </div>
            )}

            {/* THE LESSON BOX — height-capped with internal scroll. When the
                box is scrolled to its bottom edge, browser scroll-chaining
                bubbles the wheel up to the page so the user can keep scrolling
                straight into the discussion below. Default cap ~70vh; focus
                mode opens it up to ~85vh so a reader can sit in one view. */}
            <section
              ref={lessonBoxRef}
              onScroll={handleLessonScroll}
              className={cn(
                "mt-4 overflow-y-auto rounded-2xl border border-border bg-surface-2/20",
                focusMode ? "max-h-[calc(100vh-8rem)]" : "max-h-[70vh]",
              )}>
              <div className="p-5 md:p-7">
                <NodeContent
                  node={node}
                  courseId={course.id}
                  videoControllerRef={videoControllerRef}
                  onVideoProgress={handleVideoProgress}
                  onVideoEnded={handleVideoEnded}
                  onQuizResult={handleQuizResult}
                  onPdfProgress={handlePdfProgress}
                />
              </div>
            </section>

            {/* Lesson meta — sits OUTSIDE the box, like the title bar under a
                YouTube video. Part of normal page flow. */}
            <div className="mt-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="heading-3">{node.title}</h1>
                <p className="mt-1 text-sm text-fg-dim">Lesson {activeIdx + 1} of {allNodes.length}</p>
              </div>
              <button
                onClick={() => toggleBookmark.mutate()}
                disabled={toggleBookmark.isPending || !user}
                title={isBookmarked ? "Remove bookmark" : "Bookmark this lesson"}
                className="btn-ghost shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {isBookmarked
                  ? <><BookmarkCheck className="h-3.5 w-3.5 text-brand" /> Bookmarked</>
                  : <><Bookmark className="h-3.5 w-3.5" /> Bookmark</>}
              </button>
            </div>

            {/* Discussion / Resources — natural page flow under the box. In
                focus mode the entire subtree is unmounted: no React renders,
                no /comments fetch, nothing for a reader who's just reading. */}
            {!focusMode && (
              <div className="mt-6 border-t border-border pt-6">
                <div className="inline-flex rounded-full border border-border bg-surface-2 p-0.5">
                  {([
                    { k: "qa" as const, icon: <MessageSquare className="h-3.5 w-3.5" />, label: "Discussion" },
                    { k: "notes" as const, icon: <StickyNote className="h-3.5 w-3.5" />, label: "Notes" },
                    { k: "resources" as const, icon: <Paperclip className="h-3.5 w-3.5" />, label: "Resources" },
                  ]).map((t) => (
                    <button key={t.k} onClick={() => setTab(t.k)}
                      className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition", tab === t.k ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg")}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4">
                  {tab === "qa" && <QATab nodeId={node.id} courseCreatorId={course.creator_id} />}
                  {tab === "notes" && (
                    <NotesTab
                      nodeId={node.id}
                      isVideo={node.type === "video"}
                      getCurrentTime={() => videoControllerRef.current?.getCurrentTime() ?? null}
                      onSeek={(s) => { if (videoControllerRef.current) { videoControllerRef.current.seekTo(s); return true; } return false; }}
                    />
                  )}
                  {tab === "resources" && <ResourcesTab nodeId={node.id} />}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {showCompletion && (
        <CourseCompletionModal
          courseId={course.id}
          courseTitle={course.title}
          certificateEnabled={course.certificate_enabled ?? true}
          completed={progressPct >= 100}
          onClose={() => setShowCompletion(false)}
        />
      )}
    </div>
  );
}

function NodeContent({
  node, courseId, videoControllerRef, onVideoProgress, onVideoEnded, onQuizResult, onPdfProgress,
}: {
  node: CourseNode;
  courseId: string;
  videoControllerRef: React.MutableRefObject<VideoController | null>;
  onVideoProgress: (signal: VideoProgressSignal) => void;
  onVideoEnded: () => void;
  onQuizResult: (r: { passed: boolean; courseProgressPercent?: number; courseCompleted?: boolean; courseJustCompleted?: boolean }) => void;
  onPdfProgress: (percentViewed: number) => void;
}) {
  void courseId;

  if (node.type === "video") {
    return (
      <VideoNode
        key={node.id}
        node={node}
        onProgress={onVideoProgress}
        onEnded={onVideoEnded}
        controllerRef={videoControllerRef}
      />
    );
  }
  if (node.type === "markdown") {
    return (
      <article className="card mt-4">
        {node.markdown
          ? <MarkdownView source={node.markdown} className="text-sm" />
          : <p className="text-sm text-fg-dim">No content yet.</p>}
      </article>
    );
  }
  if (node.type === "quiz" && node.quiz_payload) {
    return <QuizPanel key={node.id} nodeId={node.id} quiz={node.quiz_payload} onResult={onQuizResult} />;
  }
  if (node.type === "pdf") {
    if (!node.pdf_url) {
      return (
        <div className="mt-4 card flex h-72 items-center justify-center text-fg-dim">
          <div className="text-center">
            <FileText className="mx-auto mb-3 h-10 w-10" />
            <p className="font-medium">No PDF uploaded yet.</p>
          </div>
        </div>
      );
    }
    // SecurePdfViewer fetches a signed read URL keyed by node id (auth +
    // enrollment gated) and renders pages on a canvas. No iframe → no native
    // browser download button; text + annotation layers off so the bytes
    // aren't selectable; right-click disabled.
    return (
      <div className="mt-4">
        <SecurePdfViewer nodeId={node.id} title={node.title} onProgress={onPdfProgress} />
      </div>
    );
  }
  if (node.type === "static_website" && node.static_website) {
    const sw = node.static_website;
    const html = composeStaticDoc(sw);
    return (
      <div className="mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-fg-dim">Interactive lesson — open it as a full page for the best experience.</p>
          <button
            type="button"
            onClick={() => openStaticLessonInNewTab(sw, node.title)}
            className="btn-primary inline-flex items-center gap-1.5 text-sm"
          >
            <ExternalLink className="h-4 w-4" /> Open in full page
          </button>
        </div>
        <iframe sandbox="allow-scripts" srcDoc={html} title={node.title} className="h-[560px] w-full rounded-2xl border border-border bg-white" />
      </div>
    );
  }
  return <div className="mt-4 card text-center text-fg-dim">Coming soon.</div>;
}

function ModuleAccordion({ title, children, open: defaultOpen }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || false);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-bold uppercase tracking-widest text-fg-dim hover:bg-surface-2">
        {title}
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && <div className="mt-1 space-y-0.5 pl-1">{children}</div>}
    </div>
  );
}

function CurriculumNodes({
  nodes, activeId, completedSet, onSelect, depth = 0,
}: {
  nodes: CourseNode[];
  activeId: string;
  completedSet: Set<string>;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        node.type === "folder" ? (
          <FolderRow key={node.id} node={node} activeId={activeId} completedSet={completedSet} onSelect={onSelect} depth={depth} />
        ) : (
          <button key={node.id} onClick={() => onSelect(node.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition",
              activeId === node.id ? "bg-surface-2 text-fg shadow-glass" : "text-fg-dim hover:bg-surface-2 hover:text-fg",
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            {completedSet.has(node.id) ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> : <NodeIcon type={node.type} />}
            <span className="flex-1 truncate">{node.title}</span>
            <span className="text-[10px] text-fg-dim">{durationFromSeconds(node.duration_seconds || 0)}</span>
          </button>
        )
      ))}
    </div>
  );
}

function FolderRow({
  node, activeId, completedSet, onSelect, depth,
}: {
  node: CourseNode;
  activeId: string;
  completedSet: Set<string>;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(nodeTreeContains(node.children || [], activeId));
  useEffect(() => {
    if (nodeTreeContains(node.children || [], activeId)) setOpen(true);
  }, [activeId, node.children]);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-fg-dim transition hover:bg-surface-2 hover:text-fg"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Folder className="h-3.5 w-3.5" />
        <span className="min-w-0 flex-1 truncate">{node.title}</span>
      </button>
      {open && node.children?.length ? (
        <CurriculumNodes nodes={node.children} activeId={activeId} completedSet={completedSet} onSelect={onSelect} depth={depth + 1} />
      ) : null}
    </div>
  );
}

function NodeIcon({ type }: { type: CourseNode["type"] }) {
  const map: Record<string, React.ReactNode> = {
    video: <Play className="h-3.5 w-3.5" />,
    markdown: <FileText className="h-3.5 w-3.5" />,
    quiz: <ListChecks className="h-3.5 w-3.5" />,
    pdf: <FileText className="h-3.5 w-3.5" />,
    static_website: <FileText className="h-3.5 w-3.5" />,
    folder: <Folder className="h-3.5 w-3.5" />,
  };
  return <span className="shrink-0">{map[type]}</span>;
}

const PAGE_SIZE = 20;

function QATab({ nodeId, courseCreatorId }: { nodeId: string; courseCreatorId?: string }) {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");
  const { user } = useApp();
  const isOwner = !!user && courseCreatorId === (user.user_id || user.id);

  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<"comment" | "doubt">("comment");
  const [filter, setFilter] = useState<"all" | "comment" | "doubt">("all");

  // Paginated top-level feed. Top-level only — replies are loaded lazily by each
  // CommentThread when expanded, so a lesson with 10k comments still costs 20
  // rows on first paint.
  const {
    data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading,
  } = useInfiniteQuery({
    queryKey: ["comments", nodeId, filter],
    queryFn: ({ pageParam }) => api.courses.comments(nodeId, {
      limit: PAGE_SIZE, offset: pageParam,
      filter: filter === "all" ? undefined : filter,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined,
  });
  const items = (data?.pages || []).flatMap((p) => p.items);
  const totalAll = data?.pages?.[0]?.total ?? 0;

  const post = useMutation({
    mutationFn: () => api.courses.addComment(nodeId, draft, kind),
    onSuccess: () => { setDraft(""); qc.invalidateQueries({ queryKey: ["comments", nodeId] }); },
  });

  // Auto-scroll + flash-highlight the focused thread. We only see the focus
  // target if it appears in the first page; for now that's fine because the
  // notification deeplink always points at a top-level doubt.
  useEffect(() => {
    if (!focusId || items.length === 0) return;
    const el = document.getElementById(`comment-${focusId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-brand");
    const t = setTimeout(() => el.classList.remove("ring-brand"), 2000);
    return () => clearTimeout(t);
  }, [focusId, items.length]);

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-2 inline-flex rounded-full border border-border bg-surface-2 p-0.5 text-xs">
          {(["comment", "doubt"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={cn("rounded-full px-3 py-1 transition", kind === k ? "bg-brand-gradient text-white shadow-glow" : "text-fg-dim hover:text-fg")}>
              {k === "comment" ? "Comment" : "Doubt → Creator"}
            </button>
          ))}
        </div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
          placeholder={kind === "doubt"
            ? "Ask a doubt. The creator gets a notification — be specific so they can answer fast."
            : "Share a thought, tip, or question for fellow learners."}
          className="input min-h-[80px] resize-y" />
        <div className="mt-2 flex justify-end">
          <button disabled={!draft.trim() || post.isPending} onClick={() => post.mutate()} className="btn-primary px-4 py-1.5 text-xs disabled:opacity-40">
            {post.isPending ? "Posting…" : kind === "doubt" ? "Post doubt" : "Post comment"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 text-xs">
        {(["all", "comment", "doubt"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("rounded-full px-3 py-1 transition border",
              filter === f ? "border-brand bg-surface-2 text-fg" : "border-border text-fg-dim hover:text-fg")}>
            {f === "all" ? `All${totalAll && filter === "all" ? ` (${totalAll})` : ""}`
              : f === "comment" ? "Comments" : "Doubts"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center p-6 text-fg-dim"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="card text-center text-sm text-fg-dim">
          {filter === "doubt" ? "No doubts yet." : filter === "comment" ? "No comments yet." : "Nothing here yet. Start the discussion."}
        </div>
      ) : (
        <>
          {items.map((c) => (
            <CommentNode
              key={c.id}
              nodeId={nodeId}
              comment={c}
              depth={0}
              isOwner={isOwner}
              courseCreatorId={courseCreatorId}
              focusId={focusId}
            />
          ))}
          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}
                className="btn-ghost text-xs disabled:opacity-50">
                {isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load more comments"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Past this depth we stop indenting visually but the data tree still grows.
// Keeps deeply nested threads readable on narrow viewports (matches Reddit's
// "continue this thread" behaviour without a separate route).
const MAX_VISUAL_DEPTH = 6;

/**
 * Recursive comment node — one comment + its lazily-loaded children, each of
 * which is also a CommentNode. Supports arbitrary nesting depth (Reddit-style
 * reply-to-reply-to-reply). Children are only fetched when the user expands a
 * branch, so the on-load cost stays bounded no matter how big the tree gets.
 */
function CommentNode({
  nodeId, comment: c, depth, isOwner, courseCreatorId, focusId,
}: {
  nodeId: string;
  comment: Comment;
  depth: number;
  isOwner: boolean;
  courseCreatorId?: string;
  focusId: string | null;
}) {
  const qc = useQueryClient();
  // Reddit-style per-comment collapse: when true, only the compact one-liner
  // header is rendered (body, actions, children all hidden). Focused comments
  // start expanded so notification deeplinks land in a usable state.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(focusId === c.id);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");

  const { data: repliesData, isLoading: repliesLoading } = useQuery({
    queryKey: ["replies", c.id],
    queryFn: () => api.courses.replies(c.id, { limit: 50 }),
    enabled: expanded && !collapsed,
    staleTime: 30_000,
  });
  const replies = repliesData?.items || [];

  const postReply = useMutation({
    mutationFn: () => api.courses.addComment(nodeId, replyDraft, "comment", c.id),
    onSuccess: () => {
      setReplyDraft(""); setReplyOpen(false); setExpanded(true); setCollapsed(false);
      qc.invalidateQueries({ queryKey: ["replies", c.id] });
      qc.invalidateQueries({ queryKey: ["comments", nodeId] });
    },
  });
  const resolve = useMutation({
    mutationFn: () => api.courses.resolveComment(c.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", nodeId] }),
  });
  const [reported, setReported] = useState(false);
  const report = useMutation({
    mutationFn: (reason: string) => api.courses.report({ commentId: c.id, reason }),
    onSuccess: () => setReported(true),
  });

  const isTop = depth === 0;
  const isDoubt = (c.kind || "comment") === "doubt";
  const unresolvedDoubt = isDoubt && !c.is_resolved;
  const replyCount = c.reply_count ?? 0;
  const byCreator = courseCreatorId && c.author_id === courseCreatorId;
  const avatarSize = isTop ? 36 : 28;

  // Compact header that doubles as both the visible header and the
  // "collapsed one-liner" — Reddit shows the same info pattern in both.
  const Header = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? "Expand" : "Collapse thread"}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border text-[11px] font-mono text-fg-dim transition hover:border-brand hover:text-fg"
      >
        {collapsed ? "+" : "−"}
      </button>
      <span className={isTop ? "font-medium" : "text-sm font-medium"}>{c.profiles?.display_name || "User"}</span>
      <span className={isTop ? "text-xs text-fg-dim" : "text-[11px] text-fg-dim"}>{relativeTime(c.created_at)}</span>
      {isTop && (isDoubt
        ? <span className="chip border-amber-400/30 text-amber-300">Doubt</span>
        : <span className="chip border-border text-fg-dim">Comment</span>)}
      {isTop && c.is_resolved && <span className="chip text-success border-success/30">Resolved</span>}
      {!isTop && byCreator && <span className="chip border-brand/30 text-brand text-[10px]">Creator</span>}
      {collapsed && replyCount > 0 && (
        <span className="text-[11px] text-fg-dim">· {replyCount} {replyCount === 1 ? "reply" : "replies"}</span>
      )}
    </div>
  );

  // Collapsed state: just the compact header + a thin one-liner snippet of the
  // body so the user can recognise the thread without expanding it. Matches
  // Reddit's "[+] username · 1h · (N children)" pattern.
  if (collapsed) {
    return (
      <div
        id={`comment-${c.id}`}
        className={cn(isTop && "card", !isTop && "mt-2 pl-3 border-l-2 border-border")}
      >
        {Header}
        <p className="ml-7 mt-0.5 truncate text-[11px] text-fg-dim">{c.body}</p>
      </div>
    );
  }

  return (
    <div
      id={`comment-${c.id}`}
      className={cn(
        isTop && "card transition",
        isTop && unresolvedDoubt && "border-amber-400/40 bg-amber-400/[0.04]",
        !isTop && "mt-3 pl-3 border-l-2 border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={c.profiles?.display_name || "User"} src={c.profiles?.avatar_url || avatarUrl(c.author_id)} size={avatarSize} />
        <div className="min-w-0 flex-1">
          {Header}
          <p className={cn("whitespace-pre-line", isTop ? "mt-1 text-sm" : "mt-0.5 text-sm")}>{c.body}</p>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {replyCount > 0 && (
              <button onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1 text-fg-dim hover:text-fg">
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {expanded ? "Hide" : `View ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
              </button>
            )}
            <button
              onClick={() => { setReplyOpen((v) => !v); setReplyDraft(""); }}
              className="text-fg-dim hover:text-fg"
            >
              {replyOpen ? "Cancel" : "Reply"}
            </button>
            {reported ? (
              <span className="text-success">Reported</span>
            ) : (
              <button
                onClick={() => {
                  const reason = window.prompt("Why are you reporting this comment? (min 10 characters)");
                  if (reason && reason.trim().length >= 10) report.mutate(reason.trim());
                }}
                disabled={report.isPending}
                className="text-fg-dim transition hover:text-danger disabled:opacity-50"
              >
                Report
              </button>
            )}
            {isOwner && isTop && unresolvedDoubt && (
              <button
                onClick={() => resolve.mutate()}
                disabled={resolve.isPending}
                className="inline-flex items-center gap-1 text-success hover:underline disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark resolved
              </button>
            )}
          </div>

          {replyOpen && (
            <div className="mt-3 rounded-xl border border-border bg-surface-2 p-3">
              <textarea value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} rows={2}
                placeholder={isOwner && isTop ? "Answer this doubt…" : "Write a reply…"}
                className="input min-h-[60px] resize-y text-sm" />
              <div className="mt-2 flex justify-end">
                <button disabled={!replyDraft.trim() || postReply.isPending}
                  onClick={() => postReply.mutate()}
                  className="btn-primary px-3 py-1 text-xs disabled:opacity-40">
                  {postReply.isPending ? "Posting…" : "Post reply"}
                </button>
              </div>
            </div>
          )}

          {expanded && (
            // Top-level draws its own thread connector here so the line runs
            // through the children block. Clicking the connector collapses
            // this comment — Reddit's signature gesture. (Nested levels rely
            // on the child node's own left border, so we don't double-draw.)
            <div className={cn(
              "relative mt-3 space-y-3",
              isTop && "pl-3 border-l-2 border-border",
            )}>
              {isTop && (
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  title="Collapse thread"
                  aria-label="Collapse thread"
                  className="absolute -left-1 top-0 h-full w-3 cursor-pointer focus:outline-none"
                />
              )}
              {repliesLoading ? (
                <div className="py-2 text-xs text-fg-dim"><Loader2 className="inline h-3 w-3 animate-spin" /> Loading…</div>
              ) : replies.length === 0 ? (
                <div className="py-1 text-xs text-fg-dim">No replies yet.</div>
              ) : (
                replies.map((r) => (
                  <CommentNode
                    key={r.id}
                    nodeId={nodeId}
                    comment={r}
                    depth={Math.min(depth + 1, MAX_VISUAL_DEPTH)}
                    isOwner={isOwner}
                    courseCreatorId={courseCreatorId}
                    focusId={focusId}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function ResourcesTab({ nodeId }: { nodeId: string }) {
  const { data: attachments, isLoading, isError } = useQuery({
    queryKey: ["node-attachments", nodeId],
    queryFn: () => api.courses.nodeAttachments(nodeId),
  });

  if (isLoading) return <div className="card flex justify-center text-fg-dim"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (isError) return <div className="card text-center text-sm text-fg-dim">Could not load resources for this lesson.</div>;
  if (!attachments || attachments.length === 0) {
    return <div className="card text-center text-fg-dim">No downloadable resources for this lesson.</div>;
  }
  return (
    <div className="card divide-y divide-border p-0">
      {attachments.map((a) => (
        <a
          key={a.id}
          href={a.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 p-4 transition hover:bg-surface-2"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2"><Paperclip className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{a.original_filename}</p>
            <p className="text-xs text-fg-dim">{(a.size_bytes / 1_048_576).toFixed(2)} MB · {a.mime_type || "file"}</p>
          </div>
          <span className="text-xs text-brand">Open</span>
        </a>
      ))}
    </div>
  );
}
