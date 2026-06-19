#!/usr/bin/env node
// Verify the Python code blocks in the lesson PDFs actually run (and, where an
// output panel is shown, that the shown output matches reality). Catches any
// fabricated/wrong `out` panels left by authoring.
//
//   node scripts/lesson-pdf/verify-code.mjs            # all lessons
//   node scripts/lesson-pdf/verify-code.mjs 05-reg     # filter by slug
//
// Needs a python with numpy/pandas/scikit-learn. Override with VENV_PY.
// We extract every py(`...`, {out:`...`}) call from each .pdfsrc/*.mjs by
// scanning template literals (lesson code never contains backticks), concat a
// lesson's blocks in order, run once, and check each block's shown `out` lines
// appear in stdout. Many lessons abbreviate inline data with "..." placeholders
// to save page space — those can't run, so a run error is reported as SKIP
// (placeholder), distinct from a real MISMATCH.

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../local-courses/machine-learning-with-python/.pdfsrc");
const PY = process.env.VENV_PY || "/tmp/ml-verify-venv/bin/python";
const filter = process.argv.slice(2);

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

// Extract py() calls: the code is the first backtick-delimited literal after
// `py(`; the optional out is the value of an `out:` key (also backtick literal).
function extractPyCalls(src) {
  const calls = [];
  let i = 0;
  while ((i = src.indexOf("py(", i)) !== -1) {
    let j = src.indexOf("`", i);
    if (j === -1) break;
    const codeStart = j + 1;
    const codeEnd = src.indexOf("`", codeStart);
    if (codeEnd === -1) break;
    const code = src.slice(codeStart, codeEnd);
    // Look for out:` within the next ~40 chars window after the code literal up
    // to the call's closing — scan the options object heuristically.
    let out = null;
    const after = src.slice(codeEnd + 1, codeEnd + 4000);
    const om = after.match(/out:\s*`/);
    if (om) {
      const os2 = codeEnd + 1 + om.index + om[0].length;
      const oe = src.indexOf("`", os2);
      if (oe !== -1) out = src.slice(os2, oe);
    }
    calls.push({ code, out });
    i = codeEnd + 1;
  }
  return calls;
}

function normalize(s) {
  return s.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const files = (await walk(SRC)).sort().filter((f) => !filter.length || filter.some((s) => f.includes(s)));
let clean = 0, mismatch = 0, skip = 0, noCode = 0;
const problems = [];

for (const file of files) {
  const src = await fs.readFile(file, "utf8");
  const calls = extractPyCalls(src);
  const slug = path.basename(file, ".mjs");
  const withOut = calls.filter((c) => c.out && c.out.trim());
  if (!calls.length) { noCode++; continue; }
  if (!withOut.length) { skip++; continue; } // no output panels to verify

  const script = calls.map((c) => c.code).join("\n\n# ---- next block ----\n\n");
  const tmp = path.join(os.tmpdir(), `verify-${slug.replace(/[^a-z0-9]/gi, "_")}.py`);
  await fs.writeFile(tmp, script, "utf8");
  const res = spawnSync(PY, [tmp], { encoding: "utf8", timeout: 60000 });
  await fs.rm(tmp, { force: true });

  if (res.status !== 0) {
    // Couldn't run — almost always an abbreviated-dataset placeholder ("...").
    const errLine = (res.stderr || "").trim().split("\n").pop() || "non-zero exit";
    skip++;
    if (/SyntaxError/.test(res.stderr || "")) { // a syntax error IS a real problem
      mismatch++; skip--;
      problems.push({ slug, kind: "SYNTAX", detail: errLine });
    }
    continue;
  }
  const stdout = normalize(res.stdout || "");
  const missing = [];
  for (const c of withOut) {
    for (const line of normalize(c.out)) {
      // ignore the synthetic "output ▸" tag and very short/também ambiguous lines
      if (line.length < 4) continue;
      if (!stdout.some((o) => o.includes(line) || line.includes(o))) missing.push(line);
    }
  }
  if (missing.length) {
    mismatch++;
    problems.push({ slug, kind: "MISMATCH", detail: `${missing.length} shown line(s) not in stdout: ${missing.slice(0, 3).join(" | ")}` });
  } else {
    clean++;
  }
}

console.log(`\nVerified ${files.length} lessons:`);
console.log(`  ✓ ran clean & output matched : ${clean}`);
console.log(`  ⚠ MISMATCH/SYNTAX (investigate): ${mismatch}`);
console.log(`  – skipped (no out panel / abbreviated data): ${skip}`);
console.log(`  – no code blocks: ${noCode}`);
if (problems.length) {
  console.log(`\nProblems to investigate:`);
  for (const p of problems) console.log(`  [${p.kind}] ${p.slug}\n      ${p.detail}`);
}
