// ─────────────────────────────────────────────────────────────────────────
// Lesson-PDF kit — shared theme, Python highlighter, page template, renderer.
//
// We author the "Machine Learning with Python" visual lessons (Concept / Solved
// / intuition) as small ESM files that build an HTML body with these helpers,
// then render them to PDF via headless Chrome (print-to-pdf). The PDF nodes are
// imported into LearnRift by scripts/import-course.mjs (type "pdf").
//
//   import { page, py, fig, mistakes, checklist, note, callouts, dataTable,
//            renderToPdf } from "../scripts/lesson-pdf/kit.mjs";
//   const html = page(meta, `${ ...body... }`);
//   await renderToPdf(html, "/abs/path/to/Lesson.pdf");
// ─────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const CHROME = process.env.CHROME_BIN
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Brand theme (light, editorial, violet→cyan accents) ──────────────────
export const THEME = `
  :root{
    --violet:#7c3aed; --violet-2:#a78bfa; --cyan:#06b6d4; --cyan-2:#22d3ee;
    --ink:#0f1222; --body:#2b2f45; --muted:#6b7194; --line:#e7e8f2;
    --bg:#ffffff; --soft:#f6f5ff; --soft-cyan:#ecfdff;
    --rose:#be123c; --rose-bg:#fff1f3; --rose-line:#fecdd3;
    --green:#047857; --green-bg:#ecfdf5; --green-line:#a7f3d0;
    --amber:#b45309; --amber-bg:#fffbeb; --amber-line:#fde68a;
    --code-bg:#0f1430; --code-fg:#e6e9ff;
  }
  @page{ size:A4; margin:14mm 0 16mm; }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{ font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;
    color:var(--body); background:var(--bg); font-size:10.6pt; line-height:1.5;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .wrap{ padding:0 16mm; }
  h2,h3{ color:var(--ink); letter-spacing:-.01em; }
  h2{ font-size:15.5pt; margin:18px 0 8px; break-after:avoid; }
  h3{ font-size:12pt; margin:14px 0 6px; break-after:avoid; }
  p{ margin:7px 0; } strong{ color:var(--ink); } em{ font-style:italic; }
  a{ color:var(--violet); }
  code{ font-family:"SF Mono",Menlo,Consolas,monospace; font-size:.9em;
    background:var(--soft); border:1px solid #e4ddff; border-radius:5px; padding:.04em .3em; color:#4c2db5; }
  .lead{ font-size:11.3pt; }
  .hl{ color:var(--violet); font-weight:700; } .hlc{ color:#0e7490; font-weight:700; }

  /* Masthead */
  .hero{ background:linear-gradient(115deg,var(--violet) 0%,#6d3be0 42%,var(--cyan) 100%);
    color:#fff; padding:22px 16mm 24px; position:relative; overflow:hidden; }
  .hero::after{ content:""; position:absolute; right:-60px; top:-60px; width:240px; height:240px;
    background:radial-gradient(circle,rgba(255,255,255,.22),transparent 70%); }
  .brandrow{ display:flex; align-items:center; gap:9px; font-weight:700; font-size:9.5pt;
    letter-spacing:.16em; text-transform:uppercase; opacity:.95; }
  .logo{ width:18px;height:18px;border-radius:6px;background:#fff;
    display:inline-grid;place-items:center;color:var(--violet);font-weight:900;font-size:11px; }
  .crumbs{ font-size:9pt; opacity:.9; letter-spacing:.04em; margin-top:14px; }
  .hero h1{ font-size:24pt; margin:9px 0 6px; letter-spacing:-.02em; line-height:1.06; }
  .hero .hook{ font-size:11pt; margin-top:9px; max-width:64ch; opacity:.97; }
  .pill{ display:inline-block; background:rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.35);
    padding:3px 10px; border-radius:999px; font-size:8.5pt; font-weight:600; margin:10px 6px 0 0; }

  /* Cards / callouts */
  .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .grid3{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
  .card{ border:1px solid var(--line); border-radius:12px; padding:13px 15px; background:#fff; break-inside:avoid; }
  .tint{ background:var(--soft); border-color:#e4ddff; }
  .tintc{ background:var(--soft-cyan); border-color:#cdf3fb; }
  .eyebrow{ font-size:8pt; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--violet); margin:0 0 4px; }
  .eyebrow.c{ color:var(--cyan); }
  .formula{ font-family:"SF Mono",Menlo,Consolas,monospace; background:var(--code-bg); color:#fff;
    display:inline-block; padding:6px 12px; border-radius:8px; font-size:11pt; margin:4px 0; }
  .formula .v{ color:var(--cyan-2); } .formula .o{ color:var(--violet-2); }

  /* Figure */
  figure{ margin:14px 0; border:1px solid var(--line); border-radius:14px; padding:12px 14px 8px; background:#fff; break-inside:avoid; }
  figcaption{ font-size:8.8pt; color:var(--muted); margin-top:4px; text-align:center; }
  .figtitle{ font-size:9pt; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--cyan); margin:0 0 6px; }

  /* Table */
  table{ width:100%; border-collapse:collapse; margin:8px 0; font-size:10pt; }
  th,td{ padding:6px 10px; border-bottom:1px solid var(--line); text-align:right; }
  th:first-child,td:first-child{ text-align:left; }
  thead th{ background:var(--soft); color:var(--ink); font-weight:700; border-bottom:2px solid #e4ddff; }
  tbody tr:nth-child(even){ background:#fafaff; }

  /* Code */
  .code{ border-radius:12px; overflow:hidden; margin:10px 0; border:1px solid #20264d; break-inside:avoid; }
  .code .bar{ background:#1a1f44; color:#aab1e6; font:600 8.5pt "SF Mono",Menlo,monospace;
    padding:7px 13px; display:flex; align-items:center; gap:7px; letter-spacing:.04em; }
  .dot{ width:9px;height:9px;border-radius:50%; display:inline-block; }
  pre{ margin:0; background:var(--code-bg); color:var(--code-fg); padding:12px 14px;
    font-family:"SF Mono",Menlo,Consolas,monospace; font-size:8.9pt; line-height:1.55; white-space:pre; overflow:auto; }
  .k{ color:#c4b5fd; } .s{ color:#6ee7b7; } .c{ color:#7b85b8; font-style:italic; }
  .n{ color:#67e8f9; } .f{ color:#fcd34d; } .fn{ color:#fcd34d; } .o2{ color:#f0abfc; }
  .out{ background:#0a1020; color:#9fb0d8; border-top:1px dashed #2a3160; padding:10px 14px;
    font-family:"SF Mono",Menlo,monospace; font-size:8.6pt; white-space:pre; overflow:auto; }
  .out .tag{ color:#34d399; font-weight:700; }

  /* Notes / strips */
  .note{ border-left:4px solid var(--cyan); background:var(--soft-cyan); padding:9px 13px; border-radius:0 10px 10px 0; margin:9px 0; break-inside:avoid; }
  .note.v{ border-left-color:var(--violet); background:var(--soft); }
  .mistake{ border:1px solid var(--rose-line); background:var(--rose-bg); border-radius:10px; padding:9px 12px; margin:7px 0; font-size:9.7pt; break-inside:avoid; }
  .mistake b{ color:var(--rose); }
  .checklist{ background:var(--green-bg); border:1px solid var(--green-line); border-radius:12px; padding:12px 15px; break-inside:avoid; }
  .checklist .eyebrow{ color:var(--green); }
  .checklist ul{ list-style:none; margin:6px 0 0; padding:0; }
  .checklist li{ padding:3px 0 3px 26px; position:relative; }
  .checklist li::before{ content:"✓"; position:absolute; left:0; top:2px; width:17px;height:17px;border-radius:5px;
    background:var(--green); color:#fff; font-size:10px; font-weight:900; display:grid; place-items:center; }
  ul.bullets{ margin:7px 0; padding-left:0; list-style:none; }
  ul.bullets li{ padding:3px 0 3px 18px; position:relative; }
  ul.bullets li::before{ content:""; position:absolute; left:2px; top:9px; width:7px;height:7px;border-radius:50%;
    background:linear-gradient(135deg,var(--violet),var(--cyan)); }
  .steps{ counter-reset:s; margin:8px 0; padding:0; list-style:none; }
  .steps li{ position:relative; padding:4px 0 8px 34px; }
  .steps li::before{ counter-increment:s; content:counter(s); position:absolute; left:0; top:2px;
    width:22px;height:22px;border-radius:50%; background:linear-gradient(135deg,var(--violet),var(--cyan));
    color:#fff; font-weight:800; font-size:10px; display:grid; place-items:center; }
  .avoid{ break-inside:avoid; }
  .footer{ text-align:center; color:var(--muted); font-size:8pt; margin-top:18px; padding-top:8px; border-top:1px solid var(--line); }
`;

// ── Python syntax highlighter (build-time, no deps) ──────────────────────
const PY_KW = new Set(["def","class","return","if","elif","else","for","while","in","not","and","or",
  "is","None","True","False","import","from","as","with","try","except","finally","raise","lambda",
  "yield","global","nonlocal","pass","break","continue","assert","del","await","async","while"]);
const PY_BUILTIN = new Set(["print","len","range","zip","map","filter","sum","min","max","abs","round",
  "sorted","list","dict","set","tuple","int","float","str","bool","enumerate","open","type","isinstance",
  "super","format","reversed","any","all","input","repr"]);

function highlightPython(src) {
  const re = /(#[^\n]*)|((?:[rbfRBF]{0,2})"""[\s\S]*?"""|(?:[rbfRBF]{0,2})'''[\s\S]*?'''|(?:[rbfRBF]{0,2})"(?:\\.|[^"\\])*"|(?:[rbfRBF]{0,2})'(?:\\.|[^'\\])*')|(\b\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?\b)|([A-Za-z_]\w*)/g;
  let out = "", last = 0, m;
  while ((m = re.exec(src))) {
    out += escapeHtml(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) out += `<span class="c">${escapeHtml(m[1])}</span>`;
    else if (m[2]) out += `<span class="s">${escapeHtml(m[2])}</span>`;
    else if (m[3]) out += `<span class="n">${escapeHtml(m[3])}</span>`;
    else {
      const w = m[4];
      if (PY_KW.has(w)) out += `<span class="k">${w}</span>`;
      else if (PY_BUILTIN.has(w)) out += `<span class="f">${w}</span>`;
      else if (/^\s*\(/.test(src.slice(re.lastIndex))) out += `<span class="fn">${escapeHtml(w)}</span>`;
      else out += escapeHtml(w);
    }
  }
  out += escapeHtml(src.slice(last));
  return out;
}

// A code block with optional title bar + output panel. `code` is raw Python.
export function py(code, { file, out, lang = "python" } = {}) {
  const body = highlightPython(String(code).replace(/^\n/, "").replace(/\s+$/, ""));
  const bar = file
    ? `<div class="bar"><span class="dot" style="background:#ff5f56"></span><span class="dot" style="background:#ffbd2e"></span><span class="dot" style="background:#27c93f"></span> &nbsp;${escapeHtml(file)}${lang ? ` · ${escapeHtml(lang === "python" ? "Python" : lang)}` : ""}</div>`
    : "";
  const output = out
    ? `<div class="out"><span class="tag">output ▸</span>\n${escapeHtml(String(out).replace(/^\n/, "").replace(/\s+$/, ""))}</div>`
    : "";
  return `<div class="code avoid">${bar}<pre>${body}</pre>${output}</div>`;
}

// ── Component helpers ────────────────────────────────────────────────────
export function fig({ title, svg, caption }) {
  return `<figure>${title ? `<p class="figtitle">${title}</p>` : ""}${svg}${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
}
export function mistakes(items) {
  return items.map((it) => `<div class="mistake"><b>${it.t}</b> ${it.d}</div>`).join("");
}
export function checklist(items, title = "Before you continue") {
  return `<div class="checklist"><p class="eyebrow">${title}</p><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`;
}
export function note(html, kind = "") {
  return `<div class="note ${kind}">${html}</div>`;
}
export function steps(items) {
  return `<ol class="steps">${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
}
export function dataTable(headers, rows) {
  const th = headers.map((h) => `<th>${h}</th>`).join("");
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

// ── Full-page template ───────────────────────────────────────────────────
export function page({ module, crumb, title, hook, pills = [], footerNext }, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${THEME}</style></head><body>
<div class="hero">
  <div class="brandrow"><span class="logo">L</span> LearnRift · Machine Learning with Python</div>
  <div class="crumbs">${escapeHtml(module)}${crumb ? ` &nbsp;›&nbsp; ${escapeHtml(crumb)}` : ""}</div>
  <h1>${escapeHtml(title)}</h1>
  ${hook ? `<div class="hook">${hook}</div>` : ""}
  ${pills.length ? `<div>${pills.map((p) => `<span class="pill">${escapeHtml(p)}</span>`).join("")}</div>` : ""}
</div>
<div class="wrap">
${body}
<div class="footer">LearnRift · Machine Learning with Python${footerNext ? ` &nbsp;·&nbsp; ${escapeHtml(footerNext)}` : ""}</div>
</div></body></html>`;
}

// ── Render HTML → PDF via headless Chrome ────────────────────────────────
export async function renderToPdf(html, outPath) {
  const tmp = path.join(os.tmpdir(), `lesson-${crypto.randomBytes(6).toString("hex")}.html`);
  await fs.writeFile(tmp, html, "utf8");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(CHROME, [
      "--headless=new", "--no-sandbox", "--no-pdf-header-footer",
      "--disable-gpu", `--print-to-pdf=${outPath}`, `file://${tmp}`,
    ], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Chrome exited ${code}`))));
  });
  await fs.rm(tmp, { force: true });
  return outPath;
}
