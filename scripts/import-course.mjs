#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const PDF_MAX_BYTES = 25 * 1024 * 1024;
const STATIC_SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);

function printUsage() {
  console.log(`Usage:
  npm run course:import -- <course-folder> [options]
  npm run course:login -- --api https://learnrift.site/api

Options:
  --api <url>        API base URL. Default: LEARNRIFT_API_URL, NEXT_PUBLIC_API_URL, or http://localhost:4000/api
  --site <url>       LearnRift web URL for browser login. Default: derived from --api
  --login            Open browser login even if a cached token exists
  --login-only       Open browser login, cache the token, and exit
  --no-browser-login Do not open a browser when no token/cache is available
  --title <title>    Course title override. Default: course.json title or folder name
  --token <token>    Access token override. Usually not needed after browser login
  --token-file <p>   Token cache file. Default: ~/.learnrift/credentials.json
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
      Quiz — Topic.quiz.json    real quiz node (JSON: bare array or { questions, timerSeconds, passingPercent })
      Folder/
        Nested Lesson.md
      Static Lesson/            any folder with direct HTML/CSS/JS files
        index.html              or index.js
        style.css
        script.js

Auth:
  If no token is provided, the importer opens LearnRift in your browser, completes login,
  and caches the app token for later runs. You can still set LEARNRIFT_ACCESS_TOKEN
  or pass --token for automation.`);
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
  const args = {
    folder: "",
    api: "",
    site: "",
    token: "",
    tokenFile: "",
    title: "",
    dryRun: false,
    yes: false,
    keepPartial: false,
    publish: false,
    login: false,
    loginOnly: false,
    noBrowserLogin: false,
  };
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
    if (arg === "--login" || arg === "--browser-login") { args.login = true; continue; }
    if (arg === "--login-only") { args.loginOnly = true; args.login = true; continue; }
    if (arg === "--no-browser-login") { args.noBrowserLogin = true; continue; }
    if (arg === "--api") { args.api = argv[++i] || ""; continue; }
    if (arg === "--site") { args.site = argv[++i] || ""; continue; }
    if (arg === "--token") { args.token = argv[++i] || ""; continue; }
    if (arg === "--token-file") { args.tokenFile = argv[++i] || ""; continue; }
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

function siteBase(raw, apiUrl) {
  const explicit = raw || process.env.LEARNRIFT_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  if (explicit) return explicit.replace(/\/$/, "");
  try {
    const url = new URL(apiUrl);
    if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "4000") {
      return `${url.protocol}//${url.hostname}:3000`;
    }
    if (url.pathname.endsWith("/api")) url.pathname = url.pathname.slice(0, -4) || "/";
    else url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:3000";
  }
}

function tokenCachePath(raw) {
  return path.resolve(raw || process.env.LEARNRIFT_TOKEN_FILE || path.join(os.homedir(), ".learnrift", "credentials.json"));
}

function tokenExpiry(token) {
  try {
    const payload = token.split(".")[1] || "";
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return typeof parsed?.exp === "number" ? parsed.exp : 0;
  } catch {
    return 0;
  }
}

function isTokenFresh(token, skewSeconds = 60) {
  const exp = tokenExpiry(token);
  return exp > 0 && exp - Math.floor(Date.now() / 1000) > skewSeconds;
}

async function readCredentialStore(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    if (parsed && typeof parsed === "object") return parsed;
  } catch (e) {
    if (e?.code !== "ENOENT") console.warn(`Warning: Could not read token cache ${file}: ${e.message}`);
  }
  return { version: 1, profiles: {} };
}

async function saveCredentials(file, apiUrl, webUrl, credentials) {
  const store = await readCredentialStore(file);
  store.version = 1;
  store.profiles = store.profiles && typeof store.profiles === "object" ? store.profiles : {};
  store.profiles[apiUrl] = {
    apiBase: apiUrl,
    siteBase: webUrl,
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    accessTokenExpiresAt: tokenExpiry(credentials.accessToken) || null,
    savedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

async function cachedCredentials(file, apiUrl) {
  const store = await readCredentialStore(file);
  return store.profiles?.[apiUrl] || null;
}

async function refreshCachedCredentials(apiUrl, file, webUrl, credentials) {
  if (!credentials?.refreshToken) return null;
  const res = await fetch(`${apiUrl}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: credentials.refreshToken }),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok || json?.success === false) {
    const message = json?.error?.message || text || `Token refresh failed with ${res.status}`;
    throw new Error(message);
  }
  const refreshed = {
    accessToken: json?.data?.accessToken,
    refreshToken: json?.data?.refreshToken,
  };
  if (!refreshed.accessToken || !refreshed.refreshToken) throw new Error("Token refresh response was incomplete.");
  await saveCredentials(file, apiUrl, webUrl, refreshed);
  return refreshed;
}

function openBrowser(url) {
  const platform = os.platform();
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlResponse(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09090f; color: #f5f5f7; font: 16px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(92vw, 440px); border: 1px solid #262633; border-radius: 16px; background: #14141d; padding: 28px; box-shadow: 0 20px 80px rgba(0,0,0,.35); }
    h1 { margin: 0 0 10px; font-size: 22px; }
    p { margin: 0; color: #a9a9b6; line-height: 1.5; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function waitForBrowserLogin(webUrl) {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(24).toString("hex");
    let settled = false;
    let timer = null;
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const receivedState = requestUrl.searchParams.get("state") || "";
      const accessToken = requestUrl.searchParams.get("access_token") || "";
      const refreshToken = requestUrl.searchParams.get("refresh_token") || "";
      const error = requestUrl.searchParams.get("error") || "";

      const finish = (err, credentials) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        if (err) reject(err);
        else resolve(credentials);
      };

      if (receivedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(htmlResponse("LearnRift CLI login failed", "<h1>Login failed</h1><p>The login state did not match. Close this tab and retry the command.</p>"));
        finish(new Error("Browser login state did not match."));
        return;
      }
      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(htmlResponse("LearnRift CLI login failed", `<h1>Login failed</h1><p>${escapeHtml(error)}</p>`));
        finish(new Error(error));
        return;
      }
      if (!accessToken || !refreshToken) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(htmlResponse("LearnRift CLI login failed", "<h1>Login failed</h1><p>The browser did not return a complete LearnRift session.</p>"));
        finish(new Error("Browser login did not return a complete LearnRift session."));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(htmlResponse(
        "LearnRift CLI login complete",
        `<script>history.replaceState(null, "", "/"); setTimeout(() => window.close(), 500);</script><h1>CLI login complete</h1><p>You can return to the terminal. This tab can be closed.</p>`,
      ));
      finish(null, { accessToken, refreshToken });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const callback = `http://127.0.0.1:${port}/callback`;
      const authUrl = `${webUrl}/cli-auth?callback=${encodeURIComponent(callback)}&state=${encodeURIComponent(state)}`;
      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close();
          reject(new Error("Timed out waiting for browser login."));
        }
      }, 180_000);
      console.log("Opening LearnRift in your browser for CLI login...");
      try {
        await openBrowser(authUrl);
      } catch (e) {
        console.warn(`Warning: Could not open the browser automatically: ${e.message}`);
      }
      console.log(`If the browser did not open, visit:\n${authUrl}`);
    });
  });
}

async function resolveAccessToken(args, apiUrl, webUrl) {
  if (args.token) return args.token;

  const file = tokenCachePath(args.tokenFile);
  if (!args.login) {
    const cached = await cachedCredentials(file, apiUrl);
    if (cached?.refreshToken) {
      try {
        const refreshed = await refreshCachedCredentials(apiUrl, file, webUrl, cached);
        console.log("Refreshed cached LearnRift CLI session.");
        return refreshed.accessToken;
      } catch (e) {
        console.warn(`Warning: Cached LearnRift session could not be refreshed: ${e.message}`);
      }
    }
    if (cached?.accessToken && isTokenFresh(cached.accessToken)) {
      return cached.accessToken;
    }
  }

  const envToken = process.env.LEARNRIFT_ACCESS_TOKEN || process.env.ACCESS_TOKEN || "";
  if (!args.login && envToken) return envToken;

  if (args.noBrowserLogin) {
    throw new Error("Missing access token. Run with --login, remove --no-browser-login, or set LEARNRIFT_ACCESS_TOKEN.");
  }

  const credentials = await waitForBrowserLogin(webUrl);
  await saveCredentials(file, apiUrl, webUrl, credentials);
  console.log(`Saved LearnRift CLI session to ${file}`);
  const refreshed = await refreshCachedCredentials(apiUrl, file, webUrl, credentials);
  console.log("Verified LearnRift CLI session with the API.");
  return refreshed.accessToken;
}

export function titleFromName(name) {
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

// ── Quiz text formatting ──────────────────────────────────────────
// Quiz prompts/options/explanations are rendered as rich HTML in the player
// (SafeHtml → innerHTML), which collapses raw newlines to a single space. So a
// plain-text prompt that embeds a multi-line code snippet renders jammed onto
// one line. This converts such plain-text fields into safe HTML: the source
// `.quiz.json` stays clean (a question sentence, a blank line, then the code
// block), and the importer wraps each blank-line-separated multi-line block in
// <pre><code> (HTML-escaped, newlines preserved) and each prose block in <p>.
// Fields that are already HTML, or single-line, or only prose paragraphs, are
// returned untouched so existing inline markup is preserved.
function formatFencedQuizText(value) {
  const fence = /```([A-Za-z0-9_+-]*)?[^\n]*\n([\s\S]*?)```/g;
  let out = "";
  let last = 0;
  let matched = false;
  const prose = (text) => text
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

export function formatQuizText(value) {
  if (typeof value !== "string" || !value.includes("\n")) return value;
  if (/<(?:pre|code|p|br|ul|ol|li|img|strong|em|b|i)\b/i.test(value)) return value;
  if (value.includes("```")) return formatFencedQuizText(value);
  const blocks = value.split(/\n{2,}/);
  // Only rewrite when at least one block is a true multi-line (code/preformatted)
  // block — otherwise it's ordinary prose and we leave it alone.
  if (!blocks.some((block) => block.includes("\n"))) return value;
  return blocks
    .map((block) => {
      const body = block.replace(/[ \t]+$/gm, "").replace(/\s+$/, "");
      if (block.includes("\n")) return `<pre><code>${escapeHtml(body)}</code></pre>`;
      return `<p>${escapeHtml(block.trim())}</p>`;
    })
    .join("");
}

// ── Quiz import (.quiz.json) ──────────────────────────────────────
// A `<NN> Quiz — Topic.quiz.json` file becomes a real LearnRift quiz node
// (type "quiz"), NOT markdown and NOT a static website. The JSON is either a
// bare question array or a full wrapper { timerSeconds?, passingPercent?,
// title?, questions: [...] }. We validate against the backend quiz_payload
// schema (NodeCreate in course-service): exactly 4 string options, correctIndex
// in 0..3, and require at least 5 questions. Structural problems throw (so they
// surface as import errors to fix); a question with no explanation is a soft
// warning since explanations are strongly recommended but optional.
export function normalizeQuiz(parsed, file, warnings) {
  let questionsRaw;
  let timerSeconds;
  let passingPercent;
  let title;
  if (Array.isArray(parsed)) {
    questionsRaw = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.questions)) {
    questionsRaw = parsed.questions;
    if (typeof parsed.timerSeconds === "number") timerSeconds = Math.trunc(parsed.timerSeconds);
    if (typeof parsed.passingPercent === "number") passingPercent = Math.trunc(parsed.passingPercent);
    if (typeof parsed.title === "string" && parsed.title.trim()) title = parsed.title.trim();
  } else {
    throw new Error(`${file}: quiz JSON must be an array of questions or an object with a "questions" array.`);
  }

  if (questionsRaw.length < 5) {
    throw new Error(`${file}: a quiz needs at least 5 questions (found ${questionsRaw.length}).`);
  }

  const seenIds = new Set();
  const questions = questionsRaw.map((q, i) => {
    const where = `${file} (question ${i + 1})`;
    if (!q || typeof q !== "object") throw new Error(`${where}: each question must be an object.`);
    if (typeof q.id !== "string" || !q.id.trim()) throw new Error(`${where}: missing a non-empty "id".`);
    if (seenIds.has(q.id)) throw new Error(`${where}: duplicate question id "${q.id}".`);
    seenIds.add(q.id);
    if (typeof q.prompt !== "string" || !q.prompt.trim()) throw new Error(`${where}: missing "prompt".`);
    if (!Array.isArray(q.options) || q.options.length !== 4 || !q.options.every((o) => typeof o === "string" && o.trim().length > 0)) {
      throw new Error(`${where}: "options" must be exactly 4 non-empty strings (the backend schema requires length 4).`);
    }
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) {
      throw new Error(`${where}: "correctIndex" must be an integer 0, 1, 2 or 3.`);
    }
    const hasExplanation = typeof q.explanation === "string" && q.explanation.trim().length > 0;
    if (!hasExplanation) warnings.push(`Quiz question has no explanation: ${where} (id "${q.id}")`);
    return {
      id: q.id,
      prompt: formatQuizText(q.prompt),
      options: q.options.map(formatQuizText),
      correctIndex: q.correctIndex,
      ...(hasExplanation ? { explanation: formatQuizText(q.explanation) } : {}),
    };
  });

  const quiz_payload = {
    ...(timerSeconds !== undefined ? { timerSeconds } : {}),
    ...(passingPercent !== undefined ? { passingPercent } : {}),
    questions,
  };
  return { quiz_payload, title };
}

async function lessonFromQuizFile(file, warnings) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    throw new Error(`Invalid JSON in quiz file ${file}: ${e.message}`);
  }
  const { quiz_payload, title } = normalizeQuiz(parsed, file, warnings);
  const fallbackTitle = titleFromName(path.basename(file).replace(/\.quiz\.json$/i, ""));
  return { kind: "lesson", type: "quiz", title: title || fallbackTitle, quiz_payload };
}

async function lessonFromFile(file, warnings) {
  // A `.quiz.json` file is a real quiz node, not markdown/pdf. Check this before
  // the extension switch (its extname is just ".json").
  if (file.toLowerCase().endsWith(".quiz.json")) {
    return await lessonFromQuizFile(file, warnings);
  }
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
    welcome_message: typeof courseMeta?.welcome_message === "string" ? courseMeta.welcome_message : courseMeta?.welcomeMessage,
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

export function summarize(plan) {
  let markdown = 0, pdf = 0, staticSites = 0, quizzes = 0, folders = 0;
  const visit = (item) => {
    if (item.kind === "folder") {
      folders++;
      for (const child of item.items) visit(child);
      return;
    }
    if (item.type === "markdown") markdown++;
    if (item.type === "pdf") pdf++;
    if (item.type === "static_website") staticSites++;
    if (item.type === "quiz") quizzes++;
  };
  for (const mod of plan.modules) {
    for (const item of mod.items) visit(item);
  }
  return { modules: plan.modules.length, folders, lessons: markdown + pdf + staticSites + quizzes, markdown, pdf, staticSites, quizzes };
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
  } else if (item.type === "quiz") {
    payload = { moduleId, parent_node_id: parentNodeId, type: "quiz", title: item.title, quiz_payload: item.quiz_payload };
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
  const baseUrl = apiBase(args.api);
  const webUrl = siteBase(args.site, baseUrl);

  if (args.loginOnly) {
    await resolveAccessToken(args, baseUrl, webUrl);
    console.log("LearnRift CLI login is ready.");
    return;
  }

  if (!args.folder) {
    printUsage();
    process.exit(1);
  }
  const plan = await buildPlan(args.folder, args.title);
  const counts = summarize(plan);

  console.log(`Course: ${plan.course.title}`);
  console.log(`Path: ${plan.root}`);
  console.log(`Import plan: ${counts.modules} modules, ${counts.folders} folders, ${counts.lessons} lessons (${counts.markdown} markdown, ${counts.pdf} pdf, ${counts.staticSites} static sites, ${counts.quizzes} quizzes)`);
  for (const warning of plan.warnings) console.warn(`Warning: ${warning}`);
  for (const mod of plan.modules) {
    console.log(`  - ${mod.title}`);
    printItems(mod.items);
  }

  if (args.dryRun) return;
  const token = await resolveAccessToken(args, baseUrl, webUrl);
  if (!args.yes && !(await confirm(args.publish ? "Create and publish this course now?" : "Create this course now?"))) {
    console.log("Cancelled.");
    return;
  }

  const api = new ApiClient(baseUrl, token);
  const course = await importCourse(plan, api, { keepPartial: args.keepPartial, publish: args.publish });
  console.log(`Done. Course page URL: ${webUrl}/course/${course.id}`);
  console.log(`Creator edit URL: ${webUrl}/creator/courses/${course.id}/edit`);
}

// Only run the CLI when this file is executed directly (`node scripts/import-course.mjs`),
// not when it is imported (e.g. by the unit tests, which exercise normalizeQuiz/summarize/
// titleFromName as pure functions without triggering an import run).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`Import failed: ${e.message}`);
    process.exit(1);
  });
}
