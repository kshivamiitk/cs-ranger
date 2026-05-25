"use client";

import { useMemo } from "react";
import { marked, type Tokens } from "marked";
import katex from "katex";
import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";
import "highlight.js/styles/atom-one-dark.css";

// Register math tokenizers once. We use marked's extension API instead of a
// pre-pass regex so code blocks correctly shield their contents — `$x^2$` inside
// triple-backticks stays literal, only real math gets rendered. `throwOnError`
// is off so a typo in a single equation doesn't break the whole lesson.
type MathTokenLike = { type: "blockMath" | "inlineMath"; raw: string; text: string };
let _registered = false;
function ensureExtensions() {
  if (_registered) return;
  _registered = true;
  marked.use({
    gfm: true,
    breaks: false,
    // Syntax highlighting for fenced code blocks via highlight.js (common
    // language pack). Unknown languages fall back to auto-detection.
    renderer: {
      code({ text, lang }: Tokens.Code) {
        const language = lang && hljs.getLanguage(lang) ? lang : undefined;
        const value = language
          ? hljs.highlight(text, { language }).value
          : hljs.highlightAuto(text).value;
        return `<pre><code class="hljs language-${language || "plaintext"}">${value}</code></pre>`;
      },
    },
    extensions: [
      {
        name: "blockMath",
        level: "block",
        start(src: string) { return src.indexOf("$$"); },
        tokenizer(src: string) {
          const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
          if (!m) return undefined;
          return { type: "blockMath", raw: m[0], text: m[1].trim() } as unknown as Tokens.Generic;
        },
        renderer(token: Tokens.Generic) {
          const t = token as unknown as MathTokenLike;
          try { return katex.renderToString(t.text, { displayMode: true, throwOnError: false, output: "html" }); }
          catch { return t.raw; }
        },
      },
      {
        name: "inlineMath",
        level: "inline",
        start(src: string) { return src.indexOf("$"); },
        tokenizer(src: string) {
          // Single-line math, can't open right after a backslash (escape \$).
          const m = /^\$([^\$\n]+?)\$/.exec(src);
          if (!m) return undefined;
          return { type: "inlineMath", raw: m[0], text: m[1] } as unknown as Tokens.Generic;
        },
        renderer(token: Tokens.Generic) {
          const t = token as unknown as MathTokenLike;
          try { return katex.renderToString(t.text, { displayMode: false, throwOnError: false, output: "html" }); }
          catch { return t.raw; }
        },
      },
    ],
  });
}

/**
 * Renders a markdown string with KaTeX math + highlight.js code blocks.
 *  - `$...$` → inline math
 *  - `$$...$$` → display math
 *  - Code blocks (``` … ```) shield their contents and get syntax highlighting.
 *
 * Output is sanitized with DOMPurify in the browser (KaTeX/hljs markup is
 * span/class based and survives the default allow-list), so even if creator
 * content ever carries hostile HTML it cannot execute. During SSR the raw
 * string is rendered (DOMPurify needs a DOM); the client pass re-renders
 * sanitized output.
 */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  ensureExtensions();
  const html = useMemo(() => {
    const raw = marked.parse(source || "", { async: false }) as string;
    if (typeof window === "undefined") return raw;
    return DOMPurify.sanitize(raw);
  }, [source]);
  return <div className={`markdown-view ${className || ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
