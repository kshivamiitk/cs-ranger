"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, Users, BookOpen, Star, GraduationCap } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Avatar } from "@/components/common/Avatar";
import { FollowButton } from "@/components/common/FollowButton";
import { api } from "@/lib/api";
import { useDebouncedValue } from "@/lib/hooks";
import { formatCompact, avatarUrl } from "@/lib/utils";

type SortKey = "subscribers" | "courses" | "rating" | "enrollments" | "name";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "subscribers", label: "Most subscribers" },
  { key: "courses",     label: "Most courses" },
  { key: "rating",      label: "Highest rated" },
  { key: "enrollments", label: "Most learners" },
  { key: "name",        label: "Name (A→Z)" },
];

export default function CreatorsDirectoryPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("subscribers");
  const [activeOnly, setActiveOnly] = useState(true);
  // Debounce keystrokes + cancel stale requests instead of one fetch per character.
  const debouncedQ = useDebouncedValue(q.trim(), 300);

  // Server does the sort + aggregation against the creator_stats view, so the
  // wire payload is just the rows already in the right order — no client work.
  const { data, isLoading } = useQuery({
    queryKey: ["creators-directory", debouncedQ, sort, activeOnly],
    queryFn: ({ signal }) => api.search.creators({ q: debouncedQ || undefined, sort, activeOnly }, signal),
    placeholderData: (prev) => prev,
  });

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="heading-2">Creators</h1>
            <p className="mt-1 text-sm text-fg-dim">
              {data?.length ?? 0} {activeOnly ? "active" : ""} creator{(data?.length ?? 0) === 1 ? "" : "s"}
              {activeOnly ? " (with at least one published course)" : ""}.
            </p>
          </div>
          <div className="relative md:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" className="input pl-9" />
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-fg-dim">Sort:</span>
          <div className="inline-flex flex-wrap gap-1">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  sort === s.key ? "border-brand bg-surface-2 text-fg shadow-glow" : "border-border text-fg-dim hover:text-fg"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-fg-dim">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="accent-[color:var(--brand-primary)]" />
            Only with published courses
          </label>
        </div>

        {isLoading ? (
          <div className="flex justify-center text-fg-dim"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !data || data.length === 0 ? (
          <div className="card text-center text-fg-dim">No creators match. Try a different filter.</div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.map((c) => (
              <Link
                key={c.user_id}
                href={`/u/${c.username}`}
                className="card group flex flex-col gap-3 transition hover:-translate-y-0.5 hover:shadow-glow"
              >
                <div className="flex items-center gap-3">
                  <Avatar name={c.display_name} src={c.avatar_url || avatarUrl(c.username)} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display font-semibold">{c.display_name}</p>
                    <p className="truncate text-xs text-fg-dim">@{c.username}{c.college ? ` · ${c.college}` : ""}</p>
                  </div>
                  <FollowButton creatorId={c.user_id} compact className="shrink-0" />
                </div>
                {c.bio && <p className="line-clamp-2 text-sm text-fg-dim">{c.bio}</p>}
                <div className="mt-auto grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                  <Stat icon={<Users className="h-3.5 w-3.5" />} label="Subs" value={formatCompact(c.subscriber_count)} highlight={sort === "subscribers"} />
                  <Stat icon={<BookOpen className="h-3.5 w-3.5" />} label="Courses" value={String(c.course_count)} highlight={sort === "courses"} />
                  <Stat icon={<GraduationCap className="h-3.5 w-3.5" />} label="Learners" value={formatCompact(c.total_enrollments)} highlight={sort === "enrollments"} />
                  <Stat icon={<Star className="h-3.5 w-3.5" />} label="Rating" value={c.avg_rating > 0 ? c.avg_rating.toFixed(1) : "—"} highlight={sort === "rating"} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function Stat({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg px-2 py-1 transition ${highlight ? "bg-brand/10 text-fg" : "text-fg-dim"}`}>
      <span className={highlight ? "text-brand" : ""}>{icon}</span>
      <div className="min-w-0">
        <p className={`truncate font-semibold ${highlight ? "text-fg" : "text-fg"}`}>{value}</p>
        <p className="truncate text-[10px] uppercase tracking-wider">{label}</p>
      </div>
    </div>
  );
}
