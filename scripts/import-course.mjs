#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const PDF_MAX_BYTES = 25 * 1024 * 1024;
const STATIC_SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);

function printUsage() {
  console.log(`Usage:
  npm run course:import -- <course-folder> --token <access-token> [options]

Options:
  --api <url>        API base URL. Default: LEARNRIFT_API_URL, NEXT_PUBLIC_API_URL, or http://localhost:4000/api
  --title <title>    Course title override. Default: course.json title or folder name
  --publish          Publish after a successful import
  --dry-run          Print the import plan without creating anything
  --yes              Skip confirmation prompt
  --keep-partial     Do not delete the draft course if import fails

Folder shape:
  course-folder/
    course.json                 optional course metadata
    Module 01/
      Lesson.md                 markdown lesson
      Notes.pdf                 pdf lesson
      Folder/
        Nested Lesson.md
      Static Lesson/            any folder with direct HTML/CSS/JS files
        index.html              or index.js
        style.css
        script.js

Auth:
  Set LEARNRIFT_ACCESS_TOKEN or pass --token. For Google login, copy the app access token from browser localStorage.`);
}

function loadDotenv(file) {
  return fs.readFile(file, "utf8")
    .then((raw) => {
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const idx = trimmed.indexOf("=");
        const key = trimmed.slice(0, idx).trim();
        let value = trimmed.slice(idx + 1).trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (key && process.env[key] === undefined) process.env[key] = value;
      }
    })
    .catch(() => {});
}

function parseArgs(argv) {
  const args = { folder: "", api: "", token: "", title: "", dryRun: false, yes: false, keepPartial: false, publish: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--dry-run") { args.dryRun = true; continue; }
    if (arg === "--yes" || arg === "-y") { args.yes = true; continue; }
    if (arg === "--keep-partial") { args.keepPartial = true; continue; }
    if (arg === "--publish") { args.publish = true; continue; }
    if (arg === "--api") { args.api = argv[++i] || ""; continue; }
    if (arg === "--token") { args.token = argv[++i] || ""; continue; }
    if (arg === "--title") { args.title = argv[++i] || ""; continue; }
    if (!args.folder) { args.folder = arg; continue; }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  return args;
}

function apiBase(raw) {
  const base = raw || process.env.LEARNRIFT_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
  if (base === "/api") return "http://localhost:4000/api";
  return base.replace(/\/$/, "");
}

function titleFromName(name) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/^[\d._ -]+/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Untitled";
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw new Error(`Invalid JSON in ${file}: ${e.message}`);
  }
}

async function statOrNull(file) {
  try { return await fs.stat(file); } catch (e) { if (e?.code === "ENOENT") return null; throw e; }
}

async function listVisible(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith(".") && e.name !== "course.json" && e.name !== "module.json" && e.name !== "folder.json" && e.name !== "site.json")
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

async function findFile(dir, preferredNames, extensions, excluded = new Set()) {
  const entries = await listVisible(dir);
  const files = entries.filter((e) => e.isFile());
  const lowerPreferred = preferredNames.map((name) => name.toLowerCase());
  for (const preferred of lowerPreferred) {
    const match = files.find((file) => file.name.toLowerCase() === preferred);
    if (match && !excluded.has(match.name)) return match.name;
  }
  const match = files.find((file) => extensions.includes(path.extname(file.name).toLowerCase()) && !excluded.has(file.name));
  return match?.name || "";
}

async function findFileDeep(dir, preferredNames, extensions, excluded = new Set(), depth = 0) {
  const direct = await findFile(dir, preferredNames, extensions, excluded);
  if (direct) return direct;
  if (depth >= 4) return "";
  const entries = await listVisible(dir);
  for (const entry of entries) {
    if (!entry.isDirectory() || STATIC_SKIP_DIRS.has(entry.name)) continue;
    const child = path.join(dir, entry.name);
    const found = await findFileDeep(child, preferredNames, extensions, excluded, depth + 1);
    if (found) return path.join(entry.name, found);
  }
  return "";
}

async function readFileIfNamed(dir, name) {
  return name ? fs.readFile(path.join(dir, name), "utf8") : "";
}

async function isStaticSiteDir(dir) {
  const html = await findFile(dir, ["index.html", "index.htm"], [".html", ".htm"]);
  const css = await findFile(dir, ["style.css", "styles.css"], [".css"]);
  const js = await findFile(dir, ["script.js", "main.js", "app.js", "index.js"], [".js", ".mjs"]);
  const indexJs = await findFile(dir, ["index.js"], [".js", ".mjs"]);
  if (html && (css || js)) return true;
  if (!html && indexJs && (css || js)) return true;
  if (html) {
    const deepCss = await findFileDeep(dir, ["style.css", "styles.css"], [".css"]);
    const deepJs = await findFileDeep(dir, ["script.js", "main.js", "app.js", "index.js"], [".js", ".mjs"]);
    return !!(deepCss || deepJs);
  }
  return false;
}

function lessonTitleFromMarkdown(markdown, fallback) {
  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return h1 || fallback;
}

async function lessonFromFile(file, warnings) {
  const ext = path.extname(file).toLowerCase();
  const fallbackTitle = titleFromName(path.basename(file));
  if (TEXT_EXTENSIONS.has(ext)) {
    const markdown = await fs.readFile(file, "utf8");
    return { kind: "lesson", type: "markdown", title: lessonTitleFromMarkdown(markdown, fallbackTitle), markdown };
  }
  if (ext === ".pdf") {
    const stat = await fs.stat(file);
    if (stat.size > PDF_MAX_BYTES) throw new Error(`${file} is larger than 25MB`);
    return { kind: "lesson", type: "pdf", title: fallbackTitle, file, sizeBytes: stat.size };
  }
  warnings.push(`Skipped unsupported file: ${file}`);
  return null;
}

async function lessonFromStaticDir(dir) {
  const meta = await readJsonIfExists(path.join(dir, "site.json"));
  const htmlFile = await findFile(dir, ["index.html", "index.htm"], [".html", ".htm"]);
  const cssFile = await findFileDeep(dir, ["style.css", "styles.css"], [".css"]);
  const jsFile = await findFileDeep(dir, ["script.js", "main.js", "app.js", "index.js"], [".js", ".mjs"], new Set([htmlFile].filter(Boolean)));
  const htmlFallback = htmlFile || await findFile(dir, ["index.js"], [".js", ".mjs"], new Set([jsFile].filter(Boolean)));
  const html = await readFileIfNamed(dir, htmlFallback);
  const css = await readFileIfNamed(dir, cssFile);
  const js = await readFileIfNamed(dir, jsFile);
  if (!html && !css && !js) throw new Error(`Static site folder has no index/style/script files: ${dir}`);
  return {
    kind: "lesson",
    type: "static_website",
    title: meta?.title || titleFromName(path.basename(dir)),
    static_website: { html, css, js },
  };
}

async function collectItems(dir, warnings) {
  const entries = await listVisible(dir);
  const items = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile()) {
      const lesson = await lessonFromFile(full, warnings);
      if (lesson) items.push(lesson);
      continue;
    }
    if (entry.isDirectory()) {
      if (await isStaticSiteDir(full)) {
        items.push(await lessonFromStaticDir(full));
      } else {
        const meta = await readJsonIfExists(path.join(full, "folder.json"));
        const children = await collectItems(full, warnings);
        if (children.length === 0) {
          warnings.push(`Skipped empty folder: ${full}`);
          continue;
        }
        items.push({ kind: "folder", title: meta?.title || titleFromName(entry.name), items: children });
      }
    }
  }
  return items;
}

async function collectModule(dir, warnings) {
  const moduleMeta = await readJsonIfExists(path.join(dir, "module.json"));
  if (await isStaticSiteDir(dir)) {
    return { title: moduleMeta?.title || titleFromName(path.basename(dir)), items: [await lessonFromStaticDir(dir)] };
  }
  return { title: moduleMeta?.title || titleFromName(path.basename(dir)), items: await collectItems(dir, warnings) };
}

async function buildPlan(folder, titleOverride) {
  const root = path.resolve(folder);
  const rootStat = await statOrNull(root);
  if (!rootStat?.isDirectory()) throw new Error(`Course folder not found: ${root}`);

  const courseMeta = await readJsonIfExists(path.join(root, "course.json"));
  const course = {
    title: titleOverride || courseMeta?.title || titleFromName(path.basename(root)),
    subtitle: courseMeta?.subtitle,
    description: courseMeta?.description,
    category_id: courseMeta?.category_id,
    language: courseMeta?.language || "English",
    level: courseMeta?.level || "All Levels",
    tags: Array.isArray(courseMeta?.tags) ? courseMeta.tags : [],
    thumbnail_url: courseMeta?.thumbnail_url,
    promo_video_url: courseMeta?.promo_video_url,
    price: Number.isInteger(courseMeta?.price) ? courseMeta.price : 0,
    discounted_price: Number.isInteger(courseMeta?.discounted_price) ? courseMeta.discounted_price : undefined,
    certificate_enabled: courseMeta?.certificate_enabled ?? true,
    certificate_min_progress: Number.isInteger(courseMeta?.certificate_min_progress) ? courseMeta.certificate_min_progress : 100,
    certificate_require_quiz_pass: courseMeta?.certificate_require_quiz_pass ?? false,
    certificate_template: courseMeta?.certificate_template,
  };

  const entries = await listVisible(root);
  const modules = [];
  const rootFiles = [];
  const warnings = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const mod = await collectModule(full, warnings);
      if (mod.items.length > 0) modules.push(mod);
    } else if (entry.isFile()) {
      const lesson = await lessonFromFile(full, warnings);
      if (lesson) rootFiles.push(lesson);
    }
  }
  if (rootFiles.length > 0) modules.unshift({ title: courseMeta?.rootModuleTitle || "Module 1", items: rootFiles });
  if (modules.length === 0) throw new Error("No modules or lessons found.");
  return { root, course, modules, warnings };
}

function summarize(plan) {
  let markdown = 0, pdf = 0, staticSites = 0, folders = 0;
  const visit = (item) => {
    if (item.kind === "folder") {
      folders++;
      for (const child of item.items) visit(child);
      return;
    }
    if (item.type === "markdown") markdown++;
    if (item.type === "pdf") pdf++;
    if (item.type === "static_website") staticSites++;
  };
  for (const mod of plan.modules) {
    for (const item of mod.items) visit(item);
  }
  return { modules: plan.modules.length, folders, lessons: markdown + pdf + staticSites, markdown, pdf, staticSites };
}

async function confirm(question) {
  process.stdout.write(`${question} [y/N] `);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      resolve(/^y(es)?$/i.test(String(data).trim()));
    });
  });
}

class ApiClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async request(method, route, body) {
    const res = await fetch(`${this.baseUrl}${route}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok || json?.success === false) {
      const message = json?.error?.message || text || `${method} ${route} failed with ${res.status}`;
      const code = json?.error?.code ? ` (${json.error.code})` : "";
      throw new Error(`${message}${code}`);
    }
    return json?.data;
  }

  post(route, body) { return this.request("POST", route, body); }
  delete(route) { return this.request("DELETE", route); }
}

async function uploadPdf(api, lesson) {
  const { signedUrl, path: storagePath } = await api.post("/courses/uploads/pdf-url", {
    filename: path.basename(lesson.file),
    sizeBytes: lesson.sizeBytes,
  });
  const bytes = await fs.readFile(lesson.file);
  const uploaded = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf", "x-upsert": "true" },
    body: bytes,
  });
  if (!uploaded.ok) throw new Error(`PDF upload failed for ${lesson.file} (${uploaded.status})`);
  try {
    await api.post("/courses/uploads/pdf-confirm", { path: storagePath, sizeBytes: lesson.sizeBytes });
  } catch (e) {
    console.warn(`Warning: PDF uploaded but storage accounting confirmation failed for ${lesson.file}: ${e.message}`);
  }
  return storagePath;
}

async function createItem(api, moduleId, item, parentNodeId, depth) {
  if (item.kind === "folder") {
    const folder = await api.post("/courses/nodes", {
      moduleId,
      parent_node_id: parentNodeId,
      type: "folder",
      title: item.title,
    });
    console.log(`${" ".repeat(depth * 2)}folder: ${folder.title}`);
    for (const child of item.items) await createItem(api, moduleId, child, folder.id, depth + 1);
    return;
  }

  let payload;
  if (item.type === "pdf") {
    const pdf_url = await uploadPdf(api, item);
    payload = { moduleId, parent_node_id: parentNodeId, type: "pdf", title: item.title, pdf_url };
  } else if (item.type === "markdown") {
    payload = { moduleId, parent_node_id: parentNodeId, type: "markdown", title: item.title, markdown: item.markdown };
  } else {
    payload = { moduleId, parent_node_id: parentNodeId, type: "static_website", title: item.title, static_website: item.static_website };
  }
  const node = await api.post("/courses/nodes", payload);
  console.log(`${" ".repeat(depth * 2)}${node.type}: ${node.title}`);
}

async function importCourse(plan, api, opts) {
  let course = null;
  try {
    course = await api.post("/courses/", plan.course);
    console.log(`Created course: ${course.title} (${course.id})`);

    for (const mod of plan.modules) {
      const createdModule = await api.post(`/courses/${course.id}/modules`, { title: mod.title });
      console.log(`  Module: ${createdModule.title}`);
      for (const item of mod.items) await createItem(api, createdModule.id, item, null, 2);
    }
    if (opts.publish) {
      const published = await api.post(`/courses/${course.id}/publish`, {});
      console.log(`Published course: ${published.status}`);
    }
    return course;
  } catch (e) {
    if (course?.id && !opts.keepPartial) {
      console.warn(`Import failed. Rolling back draft course ${course.id}...`);
      try {
        await api.delete(`/courses/${course.id}`);
        console.warn("Rollback complete.");
      } catch (cleanupError) {
        console.warn(`Rollback failed: ${cleanupError.message}`);
      }
    }
    throw e;
  }
}

function printItems(items, depth = 2) {
  for (const item of items) {
    const prefix = " ".repeat(depth * 2);
    if (item.kind === "folder") {
      console.log(`${prefix}- ${item.title}/`);
      printItems(item.items, depth + 1);
    } else {
      console.log(`${prefix}- ${item.title} [${item.type}]`);
    }
  }
}

async function main() {
  await loadDotenv(path.resolve(".env"));
  await loadDotenv(path.resolve("backend/.env"));
  const args = parseArgs(process.argv.slice(2));
  if (!args.folder) {
    printUsage();
    process.exit(1);
  }
  const token = args.token || process.env.LEARNRIFT_ACCESS_TOKEN || process.env.ACCESS_TOKEN || "";
  if (!args.dryRun && !token) {
    throw new Error("Missing access token. Pass --token or set LEARNRIFT_ACCESS_TOKEN.");
  }
  const plan = await buildPlan(args.folder, args.title);
  const counts = summarize(plan);

  console.log(`Course: ${plan.course.title}`);
  console.log(`Path: ${plan.root}`);
  console.log(`Import plan: ${counts.modules} modules, ${counts.folders} folders, ${counts.lessons} lessons (${counts.markdown} markdown, ${counts.pdf} pdf, ${counts.staticSites} static sites)`);
  for (const warning of plan.warnings) console.warn(`Warning: ${warning}`);
  for (const mod of plan.modules) {
    console.log(`  - ${mod.title}`);
    printItems(mod.items);
  }

  if (args.dryRun) return;
  if (!args.yes && !(await confirm(args.publish ? "Create and publish this course now?" : "Create this course now?"))) {
    console.log("Cancelled.");
    return;
  }

  const api = new ApiClient(apiBase(args.api), token);
  const course = await importCourse(plan, api, { keepPartial: args.keepPartial, publish: args.publish });
  console.log(`Done. ${args.publish ? "Course URL" : "Draft course URL"}: /creator/courses/${course.id}/edit`);
}

main().catch((e) => {
  console.error(`Import failed: ${e.message}`);
  process.exit(1);
});
