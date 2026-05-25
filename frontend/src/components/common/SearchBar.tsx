"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDebouncedValue } from "@/lib/hooks";
import { Avatar } from "./Avatar";

export function SearchBar() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Debounce keystrokes so we fire one autocomplete request per pause, and pass
  // React Query's AbortSignal so an in-flight request is cancelled when the term
  // changes — no request-per-keystroke waterfall.
  const debouncedQ = useDebouncedValue(q.trim(), 250);
  const { data } = useQuery({
    queryKey: ["autocomplete", debouncedQ],
    queryFn: ({ signal }) => api.search.autocomplete(debouncedQ, signal),
    enabled: debouncedQ.length > 1,
    staleTime: 30_000,
  });

  return (
    <div className="relative hidden flex-1 max-w-md md:block">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-dim" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search courses, creators…"
          className="input pl-9 pr-12"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] font-mono text-fg-dim md:inline">
          /
        </kbd>
      </div>
      {open && q && data && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-50 mt-2 origin-top overflow-hidden rounded-2xl glass-strong shadow-glow-lg">
            {data.courses.length === 0 && data.creators.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-fg-dim">No matches.</div>
            ) : (
              <div className="max-h-96 overflow-y-auto py-1">
                {data.courses.length > 0 && (
                  <div className="px-2 py-1">
                    <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-fg-dim">Courses</div>
                    {data.courses.map((c) => (
                      <Link key={c.id} href={`/course/${c.id}`} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.thumbnail_url} alt="" className="h-9 w-14 rounded object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{c.title}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                {data.creators.length > 0 && (
                  <div className="border-t border-border px-2 py-1">
                    <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-fg-dim">Creators</div>
                    {data.creators.map((u) => (
                      <Link key={u.user_id} href={`/u/${u.username}`} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2">
                        <Avatar name={u.display_name} src={u.avatar_url} size={32} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{u.display_name}</p>
                          <p className="truncate text-xs text-fg-dim">@{u.username}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                <Link href={`/search?q=${encodeURIComponent(q)}`} className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-brand hover:opacity-80" onClick={() => setOpen(false)}>
                  View all results for &ldquo;{q}&rdquo;
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
