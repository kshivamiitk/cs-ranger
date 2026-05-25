"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { CourseCard } from "@/components/common/CourseCard";
import { Avatar } from "@/components/common/Avatar";
import { api } from "@/lib/api";

function Results() {
  const sp = useSearchParams();
  const q = sp.get("q") || "";
  const { data: coursesPage, isLoading: l1 } = useQuery({ queryKey: ["search-courses-page", q], queryFn: () => api.search.courses({ q, limit: 24 }) });
  const courses = coursesPage?.items;
  const { data: creators, isLoading: l2 } = useQuery({ queryKey: ["search-creators-page", q], queryFn: () => api.search.creators({ q }) });
  const loading = l1 || l2;
  return (
    <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
      <h1 className="heading-2">Search results</h1>
      <p className="mt-1 text-sm text-fg-dim">for &ldquo;<b>{q}</b>&rdquo;</p>

      {loading ? (
        <div className="mt-8 flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          {(creators?.length ?? 0) > 0 && (
            <section className="mt-8">
              <h2 className="heading-3 mb-4">Creators</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(creators || []).map((u) => (
                  <Link key={u.user_id} href={`/u/${u.username}`} className="card flex items-center gap-3 transition hover:shadow-glow">
                    <Avatar name={u.display_name || ""} src={u.avatar_url || undefined} size={40} />
                    <div>
                      <p className="font-medium">{u.display_name}</p>
                      <p className="text-xs text-fg-dim">@{u.username}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="mt-10">
            <h2 className="heading-3 mb-4">Courses</h2>
            {!courses || courses.length === 0 ? (
              <div className="card text-center text-fg-dim">No course matches. Try broader terms.</div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {courses.map((c) => <CourseCard key={c.id} course={c} />)}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <>
      <Navbar />
      <Suspense fallback={<div className="mx-auto max-w-7xl px-6 py-10 text-fg-dim">Loading…</div>}>
        <Results />
      </Suspense>
      <Footer />
    </>
  );
}
