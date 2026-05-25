"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { SlidersHorizontal, Search, X, Loader2 } from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { CourseCard } from "@/components/common/CourseCard";
import { api } from "@/lib/api";
import { useDebouncedValue } from "@/lib/hooks";

const SORTS = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "popular", label: "Most Popular" },
  { value: "rating", label: "Highest Rated" },
  { value: "price_asc", label: "Price ↑" },
  { value: "price_desc", label: "Price ↓" },
];

const LEVELS = ["Beginner", "Intermediate", "Advanced", "All Levels"];
const LANGUAGES = ["English", "Hindi", "Hinglish"];
const DURATIONS = [
  { value: "" as const, label: "Any length" },
  { value: "short" as const, label: "< 3 hours" },
  { value: "medium" as const, label: "3–10 hours" },
  { value: "long" as const, label: "10+ hours" },
];

const PAGE_SIZE = 24;

type Duration = "" | "short" | "medium" | "long";

export default function CatalogPage() {
  // useSearchParams needs a Suspense boundary for prerendering.
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-dim" /></div>}>
      <CatalogContent />
    </Suspense>
  );
}

function CatalogContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Filters initialise from the URL so refresh / shared links restore the exact view.
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [categoryId, setCategoryId] = useState<string | undefined>(searchParams.get("category") || undefined);
  const [price, setPrice] = useState<"all" | "free" | "paid">((searchParams.get("price") as "free" | "paid" | null) || "all");
  const [rating, setRating] = useState(Number(searchParams.get("minRating")) || 0);
  const [level, setLevel] = useState(searchParams.get("level") || "");
  const [language, setLanguage] = useState(searchParams.get("language") || "");
  const [duration, setDuration] = useState<Duration>((searchParams.get("duration") as Duration) || "");
  const [sort, setSort] = useState(searchParams.get("sort") || "popular");
  const [drawer, setDrawer] = useState(false);

  // Categories are stable — cache them longer so the filter panel doesn't refetch on every visit.
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: () => api.courses.categories(), staleTime: 60 * 60_000 });

  // Debounce the free-text query so typing fires one search per pause rather than
  // one per keystroke; the AbortSignal cancels superseded requests.
  const debouncedQ = useDebouncedValue(q.trim(), 350);
  const filters = {
    q: debouncedQ,
    category: categoryId,
    minRating: rating > 0 ? rating : undefined,
    sort,
    price: price === "all" ? undefined : price,
    level: level || undefined,
    language: language || undefined,
    duration: duration || undefined,
  };

  // Keep the URL in sync with the active filters (replace, no history spam, no scroll jump).
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (categoryId) params.set("category", categoryId);
    if (price !== "all") params.set("price", price);
    if (rating > 0) params.set("minRating", String(rating));
    if (level) params.set("level", level);
    if (language) params.set("language", language);
    if (duration) params.set("duration", duration);
    if (sort !== "popular") params.set("sort", sort);
    const qs = params.toString();
    router.replace(qs ? `/catalog?${qs}` : "/catalog", { scroll: false });
  }, [debouncedQ, categoryId, price, rating, level, language, duration, sort, router]);

  // useInfiniteQuery handles offset-based pagination — pageParam is the next
  // offset, server tells us when to stop via hasMore. Changing any filter
  // creates a new query key, which discards the old pages and starts fresh
  // at offset 0.
  const {
    data, fetchNextPage, hasNextPage, isFetchingNextPage,
    isLoading, isError, error,
  } = useInfiniteQuery({
    queryKey: ["search-courses", filters],
    queryFn: ({ pageParam, signal }) =>
      api.search.courses({ ...filters, duration: filters.duration as Duration | undefined || undefined, offset: pageParam, limit: PAGE_SIZE }, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined,
    placeholderData: (prev) => prev,
  });

  const items = (data?.pages || []).flatMap((p) => p.items);
  const total = data?.pages?.[0]?.total ?? 0;

  // Sentinel-driven "auto load when scrolled near the bottom". One observer,
  // declared once, watching one div — no scroll listeners, browser-native.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  function clearAll() {
    setQ(""); setCategoryId(undefined); setPrice("all"); setRating(0);
    setLevel(""); setLanguage(""); setDuration("");
  }

  // Active filter chips (excluding sort/search which have their own controls).
  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (categoryId) activeChips.push({ key: "category", label: categories?.find((c) => c.id === categoryId)?.name || "Category", clear: () => setCategoryId(undefined) });
  if (price !== "all") activeChips.push({ key: "price", label: price === "free" ? "Free" : "Paid", clear: () => setPrice("all") });
  if (rating > 0) activeChips.push({ key: "rating", label: `${rating}★+`, clear: () => setRating(0) });
  if (level) activeChips.push({ key: "level", label: level, clear: () => setLevel("") });
  if (language) activeChips.push({ key: "language", label: language, clear: () => setLanguage("") });
  if (duration) activeChips.push({ key: "duration", label: DURATIONS.find((d) => d.value === duration)?.label || duration, clear: () => setDuration("") });

  const filterPanelProps = {
    categories: categories || [],
    categoryId, setCategoryId,
    price, setPrice,
    rating, setRating,
    level, setLevel,
    language, setLanguage,
    duration, setDuration,
    clearAll,
  };

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-10 md:px-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="heading-2">Course Catalog</h1>
            <p className="mt-1 text-sm text-fg-dim">
              {total > 0
                ? `${total} matching ${total === 1 ? "course" : "courses"} · showing ${items.length}`
                : "Browse and discover courses"}
            </p>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1 md:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-dim" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses…" className="input pl-9" />
            </div>
            <button onClick={() => setDrawer(true)} className="btn-ghost md:hidden">
              <SlidersHorizontal className="h-4 w-4" /> Filters
            </button>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="input w-auto pr-8">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {activeChips.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {activeChips.map((chip) => (
              <button key={chip.key} onClick={chip.clear} className="chip transition hover:border-danger/50 hover:text-danger">
                {chip.label} <X className="h-3 w-3" />
              </button>
            ))}
            <button onClick={clearAll} className="text-xs text-brand hover:opacity-80">Reset all</button>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          <aside className="hidden md:block">
            <FilterPanel {...filterPanelProps} />
          </aside>

          <section>
            {isLoading ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="card animate-pulse">
                    <div className="aspect-[16/9] rounded-xl bg-surface-2" />
                    <div className="mt-3 h-4 w-3/4 rounded bg-surface-2" />
                    <div className="mt-2 h-3 w-1/2 rounded bg-surface-2" />
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div className="card text-center text-danger">{error instanceof Error ? error.message : "Failed to load courses"}</div>
            ) : items.length === 0 ? (
              <div className="card text-center text-fg-dim">
                <p className="font-medium text-fg">No courses match those filters.</p>
                <p className="mt-1 text-sm">
                  Try removing {activeChips.length > 0 ? `the “${activeChips[0].label}” filter` : "your search terms"}, widening the duration, or browsing every category.
                </p>
                <button onClick={clearAll} className="btn-ghost mx-auto mt-4 text-xs">Reset all filters</button>
              </div>
            ) : (
              <>
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((c) => <CourseCard key={c.id} course={c} />)}
                </div>
                {/* Intersection sentinel auto-fires fetchNextPage when ~400px
                    from the bottom. Manual button remains as a fallback (and
                    for keyboard users who don't scroll). */}
                <div ref={sentinelRef} className="h-px" />
                <div className="mt-8 flex items-center justify-center gap-3">
                  {hasNextPage ? (
                    <button
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                      className="btn-ghost text-xs disabled:opacity-50"
                    >
                      {isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load more"}
                    </button>
                  ) : (
                    <span className="text-xs text-fg-dim">You&apos;ve reached the end.</span>
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        {drawer && (
          <div className="fixed inset-0 z-50 md:hidden" onClick={() => setDrawer(false)}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl glass-strong p-6" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold">Filters</h3>
                <button onClick={() => setDrawer(false)}><X className="h-5 w-5" /></button>
              </div>
              <FilterPanel {...filterPanelProps} />
              <button onClick={() => setDrawer(false)} className="btn-primary mt-6 w-full">Apply</button>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function FilterPanel({
  categories, categoryId, setCategoryId, price, setPrice, rating, setRating,
  level, setLevel, language, setLanguage, duration, setDuration, clearAll,
}: {
  categories: { id: string; name: string; icon?: string }[];
  categoryId?: string; setCategoryId: (v?: string) => void;
  price: "all" | "free" | "paid"; setPrice: (p: "all" | "free" | "paid") => void;
  rating: number; setRating: (n: number) => void;
  level: string; setLevel: (v: string) => void;
  language: string; setLanguage: (v: string) => void;
  duration: Duration; setDuration: (v: Duration) => void;
  clearAll: () => void;
}) {
  return (
    <div className="card sticky top-20 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold">Refine</h3>
        <button onClick={clearAll} className="text-xs text-brand hover:opacity-80">Clear all</button>
      </div>

      <FilterSection title="Category">
        <div className="space-y-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="cat" checked={!categoryId} onChange={() => setCategoryId(undefined)} className="accent-[color:var(--brand-primary)]" />
            <span>All categories</span>
          </label>
          {categories.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="cat" checked={categoryId === c.id} onChange={() => setCategoryId(c.id)} className="accent-[color:var(--brand-primary)]" />
              <span>{c.icon} {c.name}</span>
            </label>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Level">
        <div className="flex flex-wrap gap-1.5">
          <PillButton active={!level} onClick={() => setLevel("")}>Any</PillButton>
          {LEVELS.map((l) => (
            <PillButton key={l} active={level === l} onClick={() => setLevel(level === l ? "" : l)}>{l}</PillButton>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Language">
        <div className="flex flex-wrap gap-1.5">
          <PillButton active={!language} onClick={() => setLanguage("")}>Any</PillButton>
          {LANGUAGES.map((l) => (
            <PillButton key={l} active={language === l} onClick={() => setLanguage(language === l ? "" : l)}>{l}</PillButton>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Duration">
        <div className="flex flex-wrap gap-1.5">
          {DURATIONS.map((d) => (
            <PillButton key={d.value || "any"} active={duration === d.value} onClick={() => setDuration(d.value)}>{d.label}</PillButton>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Price">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "free", "paid"] as const).map((p) => (
            <PillButton key={p} active={price === p} onClick={() => setPrice(p)}>
              {p === "all" ? "All" : p.charAt(0).toUpperCase() + p.slice(1)}
            </PillButton>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="Minimum rating">
        <div className="flex flex-wrap gap-1.5">
          {[0, 3, 4, 4.5].map((r) => (
            <PillButton key={r} active={rating === r} onClick={() => setRating(r)}>{r === 0 ? "Any" : `${r}★+`}</PillButton>
          ))}
        </div>
      </FilterSection>
    </div>
  );
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-3 py-1 text-xs transition ${active ? "border-brand bg-surface-2 text-fg" : "border-border text-fg-dim hover:text-fg"}`}>
      {children}
    </button>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-fg-dim">{title}</h4>
      {children}
    </div>
  );
}
