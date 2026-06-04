"use client";

import Link from "next/link";
import { memo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Star, Users, Clock } from "lucide-react";
import { api, type Course } from "@/lib/api";
import { formatINR, durationFromSeconds, formatCompact, avatarUrl } from "@/lib/utils";

function CourseCardImpl({ course, href }: { course: Course; href?: string }) {
  const qc = useQueryClient();
  const link = href ?? `/course/${course.id}`;
  const creatorName = course.profiles?.display_name || "Creator";
  const creatorAvatar = course.profiles?.avatar_url || avatarUrl(course.creator_id || course.id);

  // Warm the course-detail cache the moment the cursor lands on a card. By the
  // time the click registers and the route transition fires, the detail data
  // is already in cache → instant-feeling navigation. The QueryClient dedupes
  // re-fires so hovering a hot card repeatedly is cheap.
  const prefetch = useCallback(() => {
    qc.prefetchQuery({
      queryKey: ["course-detail", course.id],
      queryFn: () => api.courses.detail(course.id),
      staleTime: 60_000,
    });
  }, [qc, course.id]);

  return (
    <Link
      href={link}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      className="group relative block overflow-hidden rounded-2xl glass transition hover:-translate-y-0.5 hover:shadow-glow"
    >
      <div className="relative aspect-[16/9] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={course.thumbnail_url}
          alt={course.title}
          loading="lazy"
          decoding="async"
          width={640}
          height={360}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          {course.category_id && <span className="chip bg-black/40 text-white backdrop-blur-md border-white/10">Course</span>}
          {course.price === 0 && (
            <span className="chip bg-brand-gradient text-white border-0">FREE</span>
          )}
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
          <div className="flex items-center gap-2 text-xs text-white/90">
            {course.duration_seconds ? <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{durationFromSeconds(course.duration_seconds)}</span> : null}
            {course.enrollment_count != null && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{formatCompact(course.enrollment_count)}</span>}
          </div>
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-display text-base font-semibold leading-tight tracking-tight line-clamp-2 group-hover:text-brand transition">
          {course.title}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-fg-dim">{course.subtitle}</p>
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={creatorAvatar}
              alt=""
              loading="lazy"
              decoding="async"
              width={24}
              height={24}
              className="h-6 w-6 rounded-full ring-1 ring-border"
            />
            <span className="text-fg-dim">{creatorName}</span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            <span className="font-medium">{(course.rating_avg ?? 0).toFixed(1)}</span>
            <span className="text-fg-dim">({formatCompact(course.rating_count ?? 0)})</span>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <div className="font-display text-lg font-bold">
            {!course.price || course.price === 0 ? (
              <span className="gradient-text">Free</span>
            ) : (
              <>
                {formatINR(course.discounted_price || course.price)}<span className="text-xs font-normal text-fg-dim"> /mo</span>
                {course.discounted_price && (
                  <span className="ml-2 text-xs font-normal text-fg-dim line-through">{formatINR(course.price)}</span>
                )}
              </>
            )}
          </div>
          <span className="text-xs font-medium text-brand">View →</span>
        </div>
      </div>
    </Link>
  );
}

/**
 * Memoized — when the catalog fetches the next page, all the already-rendered
 * cards from previous pages keep the same `course` reference and skip their
 * render cycle entirely. The custom equality covers the few fields that
 * realistically change between snapshots (rating, enrollment_count, etc.).
 */
export const CourseCard = memo(CourseCardImpl, (a, b) => {
  if (a.href !== b.href) return false;
  const x = a.course, y = b.course;
  return (
    x.id === y.id &&
    x.title === y.title &&
    x.thumbnail_url === y.thumbnail_url &&
    x.price === y.price &&
    x.discounted_price === y.discounted_price &&
    x.rating_avg === y.rating_avg &&
    x.rating_count === y.rating_count &&
    x.enrollment_count === y.enrollment_count &&
    x.duration_seconds === y.duration_seconds &&
    x.profiles?.display_name === y.profiles?.display_name &&
    x.profiles?.avatar_url === y.profiles?.avatar_url
  );
});
