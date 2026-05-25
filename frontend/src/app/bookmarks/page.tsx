"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, Loader2, Play, FileText, ListChecks, FileType, Code2, ArrowUpRight } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { CourseCard } from "@/components/common/CourseCard";
import { api, type Course, type LessonBookmark } from "@/lib/api";
import { useApp } from "@/app/providers";
import { relativeTime } from "@/lib/utils";

export default function BookmarksPage() {
  const { user } = useApp();
  const userId = user?.user_id || user?.id;
  // Two independent lists. Same cache keys as the bookmark buttons elsewhere
  // (course-detail page, lesson player), so toggling there refreshes here.
  const { data: courseBookmarks, isLoading: l1 } = useQuery({
    queryKey: ["bookmarks", userId],
    queryFn: () => api.courses.bookmarks(),
    enabled: !!user,
  });
  const { data: lessonBookmarks, isLoading: l2 } = useQuery({
    queryKey: ["lesson-bookmarks", userId],
    queryFn: () => api.courses.lessonBookmarks(),
    enabled: !!user,
  });
  const courses: Course[] = (courseBookmarks || []).map((b) => b.courses).filter(Boolean);
  const lessons: LessonBookmark[] = lessonBookmarks || [];
  const isLoading = l1 || l2;

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">
            <Bookmark className="h-5 w-5" />
          </span>
          <div>
            <h1 className="heading-2">Bookmarks</h1>
            <p className="text-sm text-fg-dim">Courses and lessons you've saved.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <>
            {/* Lessons section first — these usually carry resume intent
                ("come back to this exact lesson"), so they belong on top. */}
            <section>
              <h2 className="heading-3 mb-3">Lessons ({lessons.length})</h2>
              {lessons.length === 0 ? (
                <div className="card text-fg-dim">No lessons bookmarked yet. Click the bookmark icon on any lesson to save your spot.</div>
              ) : (
                <ul className="space-y-2">
                  {lessons.map((b) => {
                    const lesson = b.nodes;
                    const c = b.courses;
                    // Deep link straight into the player at that exact node.
                    const href = `/course/${b.course_id}/learn/${b.node_id}`;
                    return (
                      <li key={b.node_id}>
                        <Link
                          href={href}
                          className="card group flex items-center gap-3 transition hover:-translate-y-0.5 hover:shadow-glow"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fg-dim">
                            <LessonTypeIcon type={lesson?.type} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{lesson?.title || "Lesson"}</p>
                            <p className="truncate text-xs text-fg-dim">
                              {c?.title || "Course"} · saved {relativeTime(b.created_at)}
                            </p>
                          </div>
                          <ArrowUpRight className="h-4 w-4 shrink-0 text-fg-dim transition group-hover:text-brand" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Courses section — broader "save for later" intent. */}
            <section className="mt-10">
              <h2 className="heading-3 mb-3">Courses ({courses.length})</h2>
              {courses.length === 0 ? (
                <div className="card text-fg-dim">No courses bookmarked yet. Click the bookmark icon on a course page.</div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {courses.map((c) => <CourseCard key={c.id} course={c} />)}
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}

function LessonTypeIcon({ type }: { type?: string }) {
  switch (type) {
    case "video": return <Play className="h-4 w-4" />;
    case "markdown": return <FileText className="h-4 w-4" />;
    case "quiz": return <ListChecks className="h-4 w-4" />;
    case "pdf": return <FileType className="h-4 w-4" />;
    case "static_website": return <Code2 className="h-4 w-4" />;
    default: return <FileText className="h-4 w-4" />;
  }
}
