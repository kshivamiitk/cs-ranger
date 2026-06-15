"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Star, Clock, Users, Award, Globe, BarChart3, Bookmark, BookmarkCheck, Lock, Play, FileText, ListChecks, FileType, Loader2, AlertCircle, Pencil, Check, Flag, Folder } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Avatar } from "@/components/common/Avatar";
import { CourseShareButton } from "@/components/common/CourseShareButton";
import { FollowButton } from "@/components/common/FollowButton";
import { useRazorpayCheckout } from "@/components/common/RazorpayCheckout";
import { api } from "@/lib/api";
import type { CourseNode } from "@/lib/api";
import { buildNodeTree, countPlayableNodes, firstPlayableNode } from "@/lib/courseTree";
import { useApp } from "@/app/providers";
import { durationFromSeconds, formatCompact, formatINR, relativeTime, avatarUrl } from "@/lib/utils";

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useApp();
  const id = params.id;
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["course-detail", id],
    queryFn: () => api.courses.detail(id),
    enabled: !!id,
  });

  const { data: enrollment } = useQuery({
    queryKey: ["enroll-check", id, user?.id],
    queryFn: () => api.enrollments.check(id),
    enabled: !!id && !!user,
  });

  // List of bookmarked course ids so the button reflects current state and
  // re-renders elsewhere (My Courses → Bookmarks tab) stay in sync.
  const { data: bookmarks } = useQuery({
    queryKey: ["bookmarks", user?.user_id || user?.id],
    queryFn: () => api.courses.bookmarks(),
    enabled: !!user,
  });
  const isBookmarked = !!bookmarks?.some((b) => b.course_id === id);

  const { checkout, busy: payBusy, error: payError } = useRazorpayCheckout({
    onSuccess: () => router.push(`/my-courses`),
  });

  async function handleEnroll() {
    if (!user) return router.push(`/login?next=/course/${id}`);
    if (!data) return;
    setEnrollError(null);
    if (!data.course.price || data.course.price === 0) {
      setEnrollBusy(true);
      try {
        await api.enrollments.enrollFree(data.course.id);
        await qc.invalidateQueries({ queryKey: ["enroll-check", id, user?.id] });
        router.push(`/my-courses`);
      } catch (e: unknown) {
        // Common case: a stale "Enroll" button on a course you already joined —
        // jump to /my-courses instead of silently failing.
        const err = e as { response?: { data?: { error?: { code?: string; message?: string } } }; message?: string };
        const code = err?.response?.data?.error?.code;
        if (code === "ALREADY_ENROLLED") { router.push("/my-courses"); return; }
        setEnrollError(err?.response?.data?.error?.message || err?.message || "Could not enroll. Please try again.");
      } finally { setEnrollBusy(false); }
    } else {
      checkout(data.course.id, data.course.title);
    }
  }

  async function handleBookmark() {
    if (!user) return router.push(`/login?next=/course/${id}`);
    setBookmarkBusy(true);
    try {
      if (isBookmarked) await api.courses.unbookmark(id);
      else await api.courses.bookmark(id);
      await qc.invalidateQueries({ queryKey: ["bookmarks", user?.user_id || user?.id] });
    } finally { setBookmarkBusy(false); }
  }

  if (isLoading) {
    return (
      <>
        <Navbar />
        <div className="flex h-96 items-center justify-center text-fg-dim">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </>
    );
  }
  if (error || !data) {
    return (
      <>
        <Navbar />
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <p className="text-fg-dim">Course not found.</p>
          <Link href="/catalog" className="btn-ghost mt-4">← Back to catalog</Link>
        </div>
      </>
    );
  }

  const { course, creator, reviews } = data;
  const totalNodes = course.modules?.reduce((s, m) => s + countPlayableNodes(m.nodes || []), 0) || 0;
  const isEnrolled = !!enrollment?.enrolled;
  const isOwner = !!user && course.creator_id === (user.user_id || user.id);
  // First lesson id is needed for both "Continue Learning" (when last_node_id is
  // missing) and the disabled-empty-course state.
  const firstNodeId = firstPlayableNode(course.modules || [])?.id;
  const continueNodeId = enrollment?.last_node_id || firstNodeId;

  return (
    <>
      <Navbar />
      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="absolute inset-0 -z-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {course.thumbnail_url && <img src={course.thumbnail_url} alt="" className="h-full w-full object-cover opacity-20 blur-2xl" />}
            <div className="absolute inset-0 bg-bg/80" />
          </div>
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-[1fr_360px] md:px-6 md:py-16">
            <div>
              <Link href="/catalog" className="text-xs text-fg-dim hover:text-fg">← Back to Catalog</Link>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {course.level && <span className="chip">{course.level}</span>}
                {course.language && <span className="chip">{course.language}</span>}
              </div>
              <h1 className="mt-4 heading-1">{course.title}</h1>
              <p className="mt-4 text-lg text-fg-dim">{course.subtitle}</p>

              <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
                <Link href={`/u/${creator?.username || creator?.user_id}`} className="flex items-center gap-2 hover:text-brand">
                  <Avatar name={creator?.display_name || creator?.displayName || ""} src={creator?.avatar_url || creator?.avatarUrl} size={32} />
                  <span><span className="text-fg-dim">by</span> <b>{creator?.display_name || creator?.displayName}</b></span>
                </Link>
                {(creator?.user_id || course.creator_id) && (
                  <FollowButton creatorId={creator?.user_id || course.creator_id || ""} compact />
                )}
                <span className="flex items-center gap-1"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {(course.rating_avg || 0).toFixed(1)} <span className="text-fg-dim">({formatCompact(course.rating_count || 0)} reviews)</span></span>
                <span className="flex items-center gap-1 text-fg-dim"><Users className="h-4 w-4" /> {formatCompact(course.enrollment_count || 0)} enrolled</span>
                {course.duration_seconds ? <span className="flex items-center gap-1 text-fg-dim"><Clock className="h-4 w-4" /> {durationFromSeconds(course.duration_seconds)}</span> : null}
                {course.updated_at && <span className="text-fg-dim">Updated {relativeTime(course.updated_at)}</span>}
              </div>

              {course.description && (
                <div className="mt-8 card">
                  <h3 className="font-display text-lg font-semibold">About this course</h3>
                  <p className="mt-3 whitespace-pre-line text-sm text-fg-dim">{course.description}</p>
                </div>
              )}
            </div>

            <aside className="md:sticky md:top-20 md:self-start">
              <div className="card overflow-hidden p-0">
                {course.thumbnail_url && (
                  <div className="relative aspect-video">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={course.thumbnail_url} alt="" className="h-full w-full object-cover" />
                    <button className="absolute inset-0 flex items-center justify-center transition hover:bg-black/20">
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-black shadow-glow">
                        <Play className="h-6 w-6 fill-current" />
                      </span>
                    </button>
                  </div>
                )}
                <div className="p-5">
                  <div className="flex items-baseline gap-2">
                    {!course.price || course.price === 0 ? (
                      <span className="font-display text-3xl font-bold gradient-text">Free</span>
                    ) : (
                      <>
                        <span className="font-display text-3xl font-bold">{formatINR(course.discounted_price || course.price)}</span>
                        <span className="text-sm font-normal text-fg-dim">/ month</span>
                        {course.discounted_price && <span className="text-sm text-fg-dim line-through">{formatINR(course.price)}</span>}
                      </>
                    )}
                  </div>
                  {course.discounted_price && course.price && (
                    <p className="mt-1 text-xs text-success">Limited-time price · {Math.round((1 - course.discounted_price / course.price) * 100)}% off</p>
                  )}
                  {isEnrolled && enrollment?.access_expires_at && (
                    <p className="mt-1 text-xs text-fg-dim">Access until {new Date(enrollment.access_expires_at).toLocaleDateString()} · {Math.max(0, Math.ceil((new Date(enrollment.access_expires_at).getTime() - Date.now()) / 86400000))} days left</p>
                  )}
                  {enrollment?.expired && (
                    <p className="mt-1 text-xs text-amber-400">Your access ended — renew for another month to continue.</p>
                  )}
                  {(payError || enrollError) && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{payError || enrollError}</span>
                    </div>
                  )}
                  {isOwner ? (
                    <Link href={`/creator/courses/${course.id}/edit`} className="btn-primary mt-5 w-full">
                      <Pencil className="h-4 w-4" /> Edit course
                    </Link>
                  ) : isEnrolled ? (
                    continueNodeId ? (
                      <Link href={`/course/${course.id}/learn/${continueNodeId}`} className="btn-primary mt-5 w-full">
                        Continue Learning
                      </Link>
                    ) : (
                      <button disabled className="btn-primary mt-5 w-full disabled:opacity-50">No lessons yet</button>
                    )
                  ) : (
                    <button onClick={handleEnroll} disabled={payBusy || enrollBusy} className="btn-primary mt-5 w-full disabled:opacity-50">
                      {payBusy || enrollBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Enrolling…</> : course.price === 0 ? "Enroll Free" : enrollment?.expired ? "Renew · 1 month" : "Enroll Now"}
                    </button>
                  )}
                  {!isOwner && (
                    <button onClick={handleBookmark} disabled={bookmarkBusy} className="btn-ghost mt-2 w-full disabled:opacity-50">
                      {isBookmarked ? <><BookmarkCheck className="h-4 w-4 text-brand" /> Bookmarked</> : <><Bookmark className="h-4 w-4" /> Bookmark</>}
                    </button>
                  )}
                  <CourseShareButton courseId={course.id} label="Copy course link" className="mt-2 w-full" buttonClassName="w-full" />
                  <div className="mt-5 space-y-2 border-t border-border pt-4 text-xs text-fg-dim">
                    <Row icon={<BarChart3 className="h-4 w-4" />} text={`Level: ${course.level || "All Levels"}`} />
                    {course.duration_seconds ? <Row icon={<Clock className="h-4 w-4" />} text={`${durationFromSeconds(course.duration_seconds)} of content`} /> : null}
                    {course.language && <Row icon={<Globe className="h-4 w-4" />} text={course.language} />}
                    <Row icon={<Award className="h-4 w-4" />} text={course.certificate_enabled ? "Certificate on completion" : "No certificate"} />
                  </div>
                  {user && !isOwner && <ReportCourseButton courseId={course.id} />}
                </div>
              </div>
            </aside>
          </div>
        </section>

        {/* Curriculum */}
        <section className="mx-auto max-w-7xl px-4 py-16 md:px-6">
          <h2 className="heading-2">Curriculum</h2>
          <p className="mt-1 text-sm text-fg-dim">{course.modules?.length || 0} modules · {totalNodes} lessons{course.duration_seconds ? ` · ${durationFromSeconds(course.duration_seconds)}` : ""}</p>
          <div className="mt-6 space-y-3">
            {(course.modules || []).map((m, mi) => (
              <details key={m.id} className="card group" open={mi === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between">
                  <div>
                    <p className="font-display font-semibold">{m.title}</p>
                    <p className="text-xs text-fg-dim">{countPlayableNodes(m.nodes || [])} lessons</p>
                  </div>
                  <span className="text-brand transition group-open:rotate-45">+</span>
                </summary>
                <div className="mt-4 divide-y divide-border">
                  <CurriculumRows nodes={buildNodeTree(m.nodes || [])} courseId={course.id} isEnrolled={isEnrolled} isOwner={isOwner} />
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* Rate this course — only when the viewer is enrolled and not the owner. */}
        {isEnrolled && !isOwner && (
          <section className="mx-auto max-w-7xl px-4 md:px-6">
            <RateCourseCard courseId={course.id} userId={user?.user_id || user?.id} />
          </section>
        )}

        {/* Reviews */}
        {reviews && reviews.length > 0 && (
          <section className="mx-auto max-w-7xl px-4 pb-20 md:px-6">
            <h2 className="heading-2">Reviews</h2>
            <div className="mt-6 grid gap-10 md:grid-cols-[280px_1fr]">
              <div className="card">
                <p className="font-display text-5xl font-bold gradient-text">{(course.rating_avg || 0).toFixed(1)}</p>
                <div className="mt-1 flex text-amber-400">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className={`h-4 w-4 ${i < Math.floor(course.rating_avg || 0) ? "fill-amber-400" : "text-fg-dim"}`} />
                  ))}
                </div>
                <p className="mt-1 text-xs text-fg-dim">{formatCompact(course.rating_count || 0)} ratings</p>
              </div>
              <div className="space-y-3">
                {reviews.map((r) => (
                  <div key={r.id} className="card">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.profiles?.display_name || "Learner"} src={r.profiles?.avatar_url || avatarUrl(r.learner_id)} size={36} />
                      <div className="flex-1">
                        <p className="font-medium">{r.profiles?.display_name || "Learner"}</p>
                        <p className="text-xs text-fg-dim">{relativeTime(r.created_at)}</p>
                      </div>
                      <div className="flex text-amber-400">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`h-3.5 w-3.5 ${i < r.rating ? "fill-amber-400" : "text-fg-dim"}`} />
                        ))}
                      </div>
                    </div>
                    {r.body && <p className="mt-3 text-sm">{r.body}</p>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </>
  );
}

function ReportCourseButton({ courseId }: { courseId: string }) {
  const [done, setDone] = useState(false);
  const report = useMutation({
    mutationFn: (reason: string) => api.courses.report({ courseId, reason }),
    onSuccess: () => setDone(true),
  });

  if (done) return <p className="mt-3 text-center text-xs text-success">Thanks — our team will review this course.</p>;
  return (
    <button
      onClick={() => {
        const reason = window.prompt("What's wrong with this course? (min 10 characters — policy violation, misleading content, plagiarism, etc.)");
        if (reason && reason.trim().length >= 10) report.mutate(reason.trim());
        else if (reason !== null) alert("Please give at least 10 characters so the team can act on it.");
      }}
      disabled={report.isPending}
      className="mt-3 inline-flex w-full items-center justify-center gap-1 text-xs text-fg-dim transition hover:text-danger disabled:opacity-50"
    >
      {report.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Flag className="h-3 w-3" />} Report this course
    </button>
  );
}

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-fg-dim">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function NodeTypeIcon({ type }: { type: string }) {
  const map: Record<string, React.ReactNode> = {
    video: <Play className="h-3.5 w-3.5" />,
    markdown: <FileText className="h-3.5 w-3.5" />,
    quiz: <ListChecks className="h-3.5 w-3.5" />,
    pdf: <FileType className="h-3.5 w-3.5" />,
    static_website: <FileText className="h-3.5 w-3.5" />,
    folder: <Folder className="h-3.5 w-3.5" />,
  };
  return <span className="text-fg-dim">{map[type] ?? <FileText className="h-3.5 w-3.5" />}</span>;
}

function CurriculumRows({
  nodes, courseId, isEnrolled, isOwner, depth = 0,
}: {
  nodes: CourseNode[];
  courseId: string;
  isEnrolled: boolean;
  isOwner: boolean;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((n) => {
        if (n.type === "folder") {
          return (
            <div key={n.id}>
              <div className="flex items-center gap-3 py-2.5 text-sm font-medium text-fg-dim" style={{ paddingLeft: depth * 16 }}>
                <NodeTypeIcon type={n.type} />
                <span className="flex-1">{n.title}</span>
              </div>
              {n.children?.length ? (
                <CurriculumRows nodes={n.children} courseId={courseId} isEnrolled={isEnrolled} isOwner={isOwner} depth={depth + 1} />
              ) : null}
            </div>
          );
        }

        // A lesson is openable if it's a free preview, or the viewer is
        // enrolled, or they own the course. Free-preview lessons must be
        // clickable for non-enrolled visitors — otherwise the "Preview"
        // badge is a dead end.
        const canOpen = n.is_free_preview || isEnrolled || isOwner;
        const inner = (
          <>
            <NodeTypeIcon type={n.type} />
            <span className="flex-1">{n.title}</span>
            {n.is_free_preview ? (
              <span className="chip text-success border-success/30">Preview</span>
            ) : !isEnrolled ? (
              <Lock className="h-3.5 w-3.5 text-fg-dim" />
            ) : null}
            <span className="text-xs text-fg-dim">{durationFromSeconds(n.duration_seconds || 0)}</span>
          </>
        );
        return canOpen ? (
          <Link key={n.id} href={`/course/${courseId}/learn/${n.id}`} className="flex items-center gap-3 py-2.5 text-sm transition hover:text-brand" style={{ paddingLeft: depth * 16 }}>
            {inner}
          </Link>
        ) : (
          <div key={n.id} className="flex items-center gap-3 py-2.5 text-sm" style={{ paddingLeft: depth * 16 }}>
            {inner}
          </div>
        );
      })}
    </>
  );
}

/**
 * Rate-this-course card. Posts an upsert on the server keyed by
 * (course_id, learner_id), so resubmitting just updates the existing review
 * rather than creating a duplicate. The course's rating_avg / rating_count
 * are kept in sync by the refresh_course_rating trigger.
 */
function RateCourseCard({ courseId, userId }: { courseId: string; userId?: string }) {
  const qc = useQueryClient();
  const { data: existing, isLoading } = useQuery({
    queryKey: ["my-review", courseId, userId],
    queryFn: () => api.courses.myReview(courseId),
    enabled: !!userId,
  });
  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [body, setBody] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill once the existing review (if any) arrives. Effect runs only on
  // existing-change so editing locally isn't clobbered.
  useEffect(() => {
    if (existing) {
      setRating(existing.rating || 0);
      setBody(existing.body || "");
    }
  }, [existing]);

  const submit = useMutation({
    mutationFn: () => api.courses.addReview(courseId, rating, body.trim() || undefined),
    onSuccess: () => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
      setError(null);
      // Refresh both the user's review and the public reviews/course card so
      // the new rating appears on the page immediately.
      qc.invalidateQueries({ queryKey: ["my-review", courseId, userId] });
      qc.invalidateQueries({ queryKey: ["course-detail", courseId] });
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(err?.response?.data?.error?.message || err?.message || "Could not save rating");
    },
  });

  if (isLoading) return null;
  const shown = hover || rating;
  const hasExisting = !!existing;

  return (
    <div className="card mt-12">
      <h2 className="heading-3">{hasExisting ? "Your review" : "Rate this course"}</h2>
      <p className="mt-1 text-xs text-fg-dim">
        {hasExisting ? "Update your rating any time — the new submission replaces the old one." : "Your rating helps other learners find good courses."}
      </p>

      <div className="mt-4 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            className="rounded-md p-1 transition hover:scale-110"
          >
            <Star className={`h-7 w-7 ${shown >= n ? "fill-amber-400 text-amber-400" : "text-fg-dim"}`} />
          </button>
        ))}
        {rating > 0 && (
          <span className="ml-2 text-sm text-fg-dim">{rating} / 5</span>
        )}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Share what worked — and what didn't. (optional)"
        className="input mt-3 min-h-[80px] resize-y text-sm"
      />

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button
          onClick={() => submit.mutate()}
          disabled={rating === 0 || submit.isPending}
          className="btn-primary text-xs disabled:opacity-50"
        >
          {submit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : savedFlash ? <Check className="h-3.5 w-3.5" />
            : null}
          {submit.isPending ? "Saving…" : savedFlash ? "Saved" : hasExisting ? "Update rating" : "Submit rating"}
        </button>
      </div>
    </div>
  );
}
