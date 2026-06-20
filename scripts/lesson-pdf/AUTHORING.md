# Authoring visual lesson PDFs (Machine Learning with Python)

We convert the **Concept / Solved / intuition** markdown lessons into rich, colorful
PDFs. Checkpoints, Labs, and the Capstone stay as markdown. Quizzes are handled
separately (the importer formats their code).

## The pipeline

- Each lesson is an ESM file at
  `local-courses/machine-learning-with-python/.pdfsrc/<module-slug>/<lesson-slug>.mjs`
- It imports helpers from `scripts/lesson-pdf/kit.mjs` and exports:
  - `out` — the PDF path **relative to the course root**, e.g.
    `"05 Regression/05 Solved — Predicting Exam Scores with Linear Regression.pdf"`
    (must be the SAME number + name as the source `.md`, with `.pdf` extension, so
    it keeps its order in the module).
  - `html` — the full document, built with `page(meta, body)`.
- Build + render:  `node scripts/build-ml-pdfs.mjs <slug-substring>`
  (omit the arg to build all). Always run this for your lesson and confirm it
  prints `✓ ... (NNN KB)` with no error.

## Reference

- **Read the kit first:** `scripts/lesson-pdf/kit.mjs` (the available helpers + CSS classes).
- **Copy the structure of the worked exemplar:**
  `local-courses/machine-learning-with-python/.pdfsrc/05-regression/01-concept-regression.mjs`

## Helpers (import from the kit)

```js
import { page, py, fig, mistakes, checklist, note, steps, dataTable } from "../../../../scripts/lesson-pdf/kit.mjs";
```

- `page({module, crumb, title, hook, pills:[], footerNext}, body)` → full HTML. `hook`
  may contain inline HTML (`<em>`, `<code>`). `module` like `"Module 05 · Regression"`,
  `crumb` like `"Lesson 05 · Solved"`.
  - **Escaping gotcha:** `title`, `module`, `crumb`, `pills`, and `footerNext` are HTML-escaped
    by `page()` — pass RAW text (`"Pandas & EDA"`, not `"Pandas &amp; EDA"`, or it shows as
    `&amp;`). Only `hook` (and the `body` you build) accept raw HTML. `fig()` titles/captions
    are raw HTML too, so `&amp;`/`&#8730;` are correct there.
- `py(code, {file, out})` → syntax-highlighted Python block. `code` is **raw Python**
  in a template literal (auto-highlighted — do NOT add spans yourself). `file` shows a
  filename bar; `out` shows an output panel. Avoid backticks and `${` inside `code`.
- `fig({title, svg, caption})` → framed figure. `svg` is a raw inline `<svg viewBox=... width="100%">`.
- `mistakes([{t:"Bold lead.", d:"explanation"}, ...])` → red common-mistake cards.
- `checklist(["item", ...])` → green "Before you continue" card.
- `steps(["<strong>Step.</strong> text", ...])` → numbered gradient steps.
- `note("html", "v")` → cyan callout strip (`"v"` = violet variant).
- `dataTable(["Col","Col"], [["a","b"], ...])` → styled table (cells may contain HTML).

### Useful CSS classes (write plain HTML in `body`)
`.grid2` / `.grid3` (column layouts) · `.card`, `.card.tint` (violet), `.card.tintc` (cyan)
· `.eyebrow` / `.eyebrow.c` (section kicker) · `.formula` (dark formula chip; inner
`<span class="v">`/`<span class="o">` for cyan/violet tokens) · `.hl` (violet emphasis),
`.hlc` (cyan) · `ul.bullets` (gradient bullets) · `<h2>`, `<h3>`, `<code>`.

## Diagrams (SVG)

Author **1–3 simple, correct** inline SVGs per lesson — they are the point. Keep them
clean and on-brand:
- Palette: violet `#7c3aed` / `#a78bfa`, cyan `#06b6d4` / `#22d3ee`, ink `#0f1222`,
  rose `#f43f5e` (errors), muted `#6b7194`, gridlines `#eef0f8`.
- Use `viewBox="0 0 720 H"` and `width="100%"`; gradient defs `id` must be unique per file.
- Patterns to reuse: scatter + fitted line + dashed residuals; left→right decision flow
  with rounded nodes; before/after panels; bar/curve comparisons; labeled arrows.
- Put each SVG text label on its OWN `<text>` element (don't rely on `dy` for multi-line).

## Content rules ("re-style + deepen")

- Preserve the source lesson's correct content and examples, but **deepen** it: add a
  clear mental-model diagram, an extra worked step or two, and tighten weak spots.
- Keep code runnable and faithful to scikit-learn / NumPy / Pandas.
- **Never fabricate output.** numpy/sklearn are NOT installed here, so you cannot execute the
  code — do not guess what it prints. Options, in order of preference: (1) reuse the source
  lesson's existing code AND its already-stated expected output verbatim (the author verified
  it); (2) if you write a fresh example, make the numbers exactly hand-computable (e.g. points
  that lie on a clean line so the fit is whole numbers) and double-check the arithmetic; (3) if
  you can't be certain of the output, omit the `out` panel rather than invent one. A wrong
  `out` (or a bogus "rounding" hand-wave to explain a mismatch) is worse than no `out`.
- Every lesson ends with `mistakes([...])` (3–5) and a `checklist([...])` (4–5).
- Target 2–4 A4 pages. Use `.avoid` / the components already avoid awkward page breaks.

## Done =
`node scripts/build-ml-pdfs.mjs <slug>` renders with no error, the PDF lands at `out`,
and a rasterized page looks clean (no overflow, readable code, on-brand diagrams).
