"use client";

import { useMemo } from "react";
import DOMPurify from "dompurify";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderFencedCode(value: string) {
  if (!value.includes("```")) return value;

  // Existing rich-editor HTML should remain HTML. For legacy imported quiz
  // payloads, fences can be trapped inside <code>; hide those markers so
  // learners do not see ```cpp / ``` in the runner.
  if (/<[a-z][\s\S]*>/i.test(value)) {
    return value.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, (_m, attrs: string, body: string) => {
      const cleaned = body
        .replace(/(^|\n)```[A-Za-z0-9_+-]*\n?/g, "$1")
        .replace(/\n?```(?=\n|$)/g, "");
      return `<code${attrs}>${cleaned}</code>`;
    });
  }

  const fence = /```([A-Za-z0-9_+-]*)?[^\n]*\n([\s\S]*?)```/g;
  let out = "";
  let last = 0;
  let matched = false;
  const prose = (text: string) => text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");

  for (const match of value.matchAll(fence)) {
    matched = true;
    out += prose(value.slice(last, match.index));
    const lang = match[1] ? ` class="language-${escapeHtml(match[1])}"` : "";
    out += `<pre><code${lang}>${escapeHtml(match[2].replace(/\s+$/, ""))}</code></pre>`;
    last = (match.index || 0) + match[0].length;
  }
  out += prose(value.slice(last));
  return matched ? out : value;
}

/**
 * Render creator-authored rich HTML (quiz prompts/options/explanations) safely.
 * DOMPurify strips scripts/event handlers; basic formatting + <img> survive.
 * During SSR there's no DOM, so the raw string is emitted and the client pass
 * re-renders it sanitized (same approach as MarkdownView).
 */
export function SafeHtml({ html, className, inline }: { html?: string; className?: string; inline?: boolean }) {
  const clean = useMemo(
    () => {
      const rendered = renderFencedCode(html || "");
      return typeof window === "undefined" ? rendered : DOMPurify.sanitize(rendered);
    },
    [html],
  );
  const Tag = inline ? "span" : "div";
  return <Tag className={`rich-html ${className || ""}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}
