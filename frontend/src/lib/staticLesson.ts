// Helpers for "Static Site" lessons (the static_website node type).
//
// LearnRift composes a static lesson from three fields — html / css / js — the
// same way both in the player and the creator editor. Centralised here so the
// composition (and the "open as a full, independent page" behaviour) stay
// consistent.

export interface StaticSite {
  html?: string;
  css?: string;
  js?: string;
}

/** Compose the three fields into one standalone HTML document. */
export function composeStaticDoc(sw: StaticSite | null | undefined): string {
  const s = sw || {};
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<style>${s.css || ""}</style></head><body>${s.html || ""}` +
    `<script>${s.js || ""}<\/script></body></html>`
  );
}

/**
 * Open the lesson as a full-viewport page in a new browser tab, so it feels
 * like an independent website.
 *
 * Security: the lesson runs inside a SANDBOXED iframe (`allow-scripts`, no
 * `allow-same-origin`) that fills the tab. The blob wrapper page is same-origin,
 * but it contains only that iframe — so a creator's JS executes in an opaque
 * origin and can never read the viewer's LearnRift token / cookies.
 */
export function openStaticLessonInNewTab(sw: StaticSite | null | undefined, title?: string): Window | null {
  if (typeof window === "undefined") return null;
  const inner = composeStaticDoc(sw);
  const escAttr = (x: string) => x.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const safeTitle = (title || "Lesson").replace(/[<>&]/g, "").slice(0, 80);
  const wrapper =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${safeTitle}</title>` +
    "<style>html,body{margin:0;height:100%;background:#0b0d14}" +
    "iframe{border:0;width:100vw;height:100vh;display:block}</style></head>" +
    `<body><iframe sandbox="allow-scripts" srcdoc="${escAttr(inner)}"></iframe></body></html>`;
  const url = URL.createObjectURL(new Blob([wrapper], { type: "text/html" }));
  const win = window.open(url, "_blank");
  // Revoke once the new tab has had time to load the document.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return win;
}
