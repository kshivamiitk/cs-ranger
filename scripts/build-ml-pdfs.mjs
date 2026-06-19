#!/usr/bin/env node
// Build the "Machine Learning with Python" visual lesson PDFs.
//
//   node scripts/build-ml-pdfs.mjs                 # build every lesson under .pdfsrc/
//   node scripts/build-ml-pdfs.mjs 05-regression   # build one module's lessons
//
// Each lesson source is an ESM file under
//   local-courses/machine-learning-with-python/.pdfsrc/<module>/<lesson>.mjs
// exporting `out` (PDF path relative to the course root) and `html` (full doc).
// The rendered PDF lands beside the other lesson nodes so import-course.mjs
// picks it up as a `pdf` node.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderToPdf } from "./lesson-pdf/kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COURSE = path.resolve(HERE, "../local-courses/machine-learning-with-python");
const SRC = path.join(COURSE, ".pdfsrc");

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const filter = process.argv.slice(2);
const all = (await walk(SRC)).sort();
const files = filter.length ? all.filter((f) => filter.some((s) => f.includes(s))) : all;

if (!files.length) { console.error("No lesson sources matched."); process.exit(1); }

let ok = 0;
for (const file of files) {
  const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
  if (!mod.out || !mod.html) { console.warn(`skip (no out/html): ${path.basename(file)}`); continue; }
  const target = path.join(COURSE, mod.out);
  await renderToPdf(mod.html, target);
  const { size } = await fs.stat(target);
  console.log(`✓ ${mod.out}  (${(size / 1024).toFixed(0)} KB)`);
  ok++;
}
console.log(`\nBuilt ${ok}/${files.length} lesson PDFs.`);
