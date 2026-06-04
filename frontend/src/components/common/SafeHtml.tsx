"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";

/**
 * Render creator-authored rich HTML (quiz prompts/options/explanations) safely.
 * DOMPurify strips scripts/event handlers; basic formatting + <img> survive.
 * During SSR there's no DOM, so the raw string is emitted and the client pass
 * re-renders it sanitized (same approach as MarkdownView).
 */
export function SafeHtml({ html, className, inline }: { html?: string; className?: string; inline?: boolean }) {
  const clean = useMemo(
    () => (typeof window === "undefined" ? (html || "") : DOMPurify.sanitize(html || "")),
    [html],
  );
  const Tag = inline ? "span" : "div";
  return <Tag className={`rich-html ${className || ""}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}
