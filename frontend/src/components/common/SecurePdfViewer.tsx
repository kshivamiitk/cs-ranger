"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Document, Page, pdfjs } from "react-pdf";
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, MoveHorizontal } from "lucide-react";
import { api } from "@/lib/api";

// pdf.js needs a web worker. We resolve it from the cdnjs mirror at runtime so
// it matches whatever version react-pdf bundles — no manual version pin to
// drift, no Next.js bundler quirks.
if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.25;

/** Walk up to the nearest scrollable ancestor — the learn page puts the lesson
 *  inside a height-capped box with its own scroll, so that's the real viewport. */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    const style = window.getComputedStyle(cur);
    if (/(auto|scroll)/.test(style.overflowY)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * PDF lesson viewer. Defenses against casual download (the realistic bar in a
 * browser):
 *  - Bucket is private; URL is a 1-hour Supabase signed link gated by
 *    enrollment, refetched ~5 min before expiry so long reads don't break.
 *  - Renders each page to a <canvas> (text + annotation layers disabled) — no
 *    native browser PDF viewer download button, no selectable text.
 *  - Right-click and drag are blocked, plus user-select: none.
 *  - The signed URL is short-lived: even if exfiltrated via DevTools, it stops
 *    working within the hour.
 * A determined user with DevTools can still capture the bytes; nothing
 * browser-side can stop that. Don't ship anything you'd lose sleep over.
 *
 * If react-pdf / the pdf.js worker fails to load (offline CDN, blocked worker),
 * we fall back to an <iframe> on the same signed URL so the lesson still works.
 */
export function SecurePdfViewer({
  nodeId,
  title,
  onProgress,
}: {
  nodeId: string;
  title?: string;
  /** Called with the percentage of pages viewed (0–100), only when it increases. */
  onProgress?: (percentViewed: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const maxPageSeenRef = useRef(0);
  const [pageWidth, setPageWidth] = useState<number>(800);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [useFallback, setUseFallback] = useState(false);

  // Refetch the signed URL well before its 1h TTL expires so a long session
  // doesn't suddenly break. staleTime kicks the refetch ~5 min before expiry.
  const { data, isLoading, error } = useQuery({
    queryKey: ["pdf-view-url", nodeId],
    queryFn: () => api.courses.pdfViewUrl(nodeId),
    staleTime: 55 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });

  // Render pages at the container's width — looks like a real reading pane.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setPageWidth(Math.max(320, el.clientWidth - 32));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset per-document state when the lesson changes.
  useEffect(() => {
    setNumPages(null);
    setCurrentPage(1);
    setZoom(1);
    setUseFallback(false);
    maxPageSeenRef.current = 0;
    pageRefs.current = [];
  }, [nodeId]);

  const reportSeen = useCallback((page: number, total: number) => {
    if (page <= maxPageSeenRef.current) return;
    maxPageSeenRef.current = page;
    onProgress?.(Math.min(100, Math.round((page / Math.max(1, total)) * 100)));
  }, [onProgress]);

  // Track which page is under the reading line (the scroll box's vertical
  // midpoint) and the furthest page whose top has entered the box — that is
  // the "pages viewed" signal the completion engine consumes.
  const updateCurrentPage = useCallback(() => {
    const total = numPages;
    const container = containerRef.current;
    if (!total || !container) return;
    const scrollParent = findScrollParent(container);
    const parentRect = scrollParent?.getBoundingClientRect();
    const viewTop = parentRect ? parentRect.top : 0;
    const viewBottom = parentRect ? parentRect.bottom : window.innerHeight;
    const mid = (viewTop + viewBottom) / 2;
    let current = 1;
    let deepestSeen = 1;
    pageRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top <= mid) current = i + 1;
      if (r.top < viewBottom) deepestSeen = i + 1;
    });
    setCurrentPage(current);
    reportSeen(deepestSeen, total);
  }, [numPages, reportSeen]);

  // The scroll container is an ancestor (the lesson box), so listen in the
  // capture phase on document — scroll events don't bubble but they do capture.
  useEffect(() => {
    if (!numPages || useFallback) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateCurrentPage);
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    updateCurrentPage();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [numPages, useFallback, zoom, updateCurrentPage]);

  function goToPage(page: number) {
    const total = numPages || 1;
    const target = Math.min(total, Math.max(1, page));
    pageRefs.current[target - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setCurrentPage(target);
    reportSeen(target, total);
  }

  if (isLoading) {
    return (
      <div className="flex h-72 items-center justify-center text-fg-dim">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (error || !data?.signedUrl) {
    const msg = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      || (error instanceof Error ? error.message : "Could not load PDF");
    return (
      <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{msg}</span>
      </div>
    );
  }

  // Fallback: same enrollment-gated signed URL, just rendered by the browser's
  // native viewer. Loses the canvas-only protections but keeps the lesson usable.
  if (useFallback) {
    return (
      <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-border bg-surface-2 p-3 text-xs text-fg-dim">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>The enhanced PDF reader could not start, so we switched to the basic browser viewer.</span>
        </p>
        <iframe
          src={data.signedUrl}
          title={title || "PDF lesson"}
          className="h-[70vh] w-full rounded-xl border border-border bg-white"
        />
        {title && <p className="mt-3 text-center text-xs text-fg-dim">{title}</p>}
      </div>
    );
  }

  const scaledWidth = Math.round(pageWidth * zoom);

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      className="select-none rounded-2xl border border-border bg-surface-2/40 p-4"
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
    >
      {/* Toolbar — sticks to the top of the lesson scroll box while reading. */}
      <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-bg/90 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={!numPages || currentPage <= 1}
            title="Previous page"
            aria-label="Previous page"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-fg-dim transition hover:text-fg disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[88px] text-center text-xs tabular-nums text-fg-dim">
            {numPages ? <>Page <b className="text-fg">{currentPage}</b> / {numPages}</> : "Loading…"}
          </span>
          <button
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={!numPages || currentPage >= (numPages || 1)}
            title="Next page"
            aria-label="Next page"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-fg-dim transition hover:text-fg disabled:opacity-40"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100))}
            disabled={zoom <= ZOOM_MIN}
            title="Zoom out"
            aria-label="Zoom out"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-fg-dim transition hover:text-fg disabled:opacity-40"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[44px] text-center text-xs tabular-nums text-fg-dim">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100))}
            disabled={zoom >= ZOOM_MAX}
            title="Zoom in"
            aria-label="Zoom in"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-fg-dim transition hover:text-fg disabled:opacity-40"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            disabled={zoom === 1}
            title="Fit width"
            className="ml-1 inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-xs text-fg-dim transition hover:text-fg disabled:opacity-40"
          >
            <MoveHorizontal className="h-3.5 w-3.5" /> Fit
          </button>
        </div>
      </div>

      <div className={zoom > 1 ? "overflow-x-auto" : undefined}>
        <Document
          file={data.signedUrl}
          onLoadSuccess={({ numPages }) => { setNumPages(numPages); reportSeen(1, numPages); }}
          onLoadError={() => setUseFallback(true)}
          onSourceError={() => setUseFallback(true)}
          loading={
            <div className="flex h-72 items-center justify-center text-fg-dim">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          }
          error={
            <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>Failed to render PDF</span>
            </div>
          }
        >
          {numPages && Array.from({ length: numPages }, (_, i) => (
            <div
              key={`pdf-page-${i + 1}`}
              ref={(el) => { pageRefs.current[i] = el; }}
              className={`mb-3 last:mb-0 flex ${zoom > 1 ? "justify-start" : "justify-center"}`}
            >
              <Page
                pageNumber={i + 1}
                width={scaledWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                className="overflow-hidden rounded-xl border border-border shadow-glass"
              />
            </div>
          ))}
        </Document>
      </div>
      {title && <p className="mt-3 text-center text-xs text-fg-dim">{title}</p>}
    </div>
  );
}
