// One-off, user-authorized: grant the platform owner's creator account enough
// storage to host the rebuilt ML course (93 PDFs, ~65 MB) which exceeds the
// 2 MB free quota. Reads prod Supabase service creds from backend/.env, finds
// the creator id from the cached CLI token's `sub`, prints the current
// creator_storage state, and (when RUN=apply) grants extra_bytes. Prints no secrets.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

async function loadEnv(file) {
  const out = {};
  try {
    const raw = await fs.readFile(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[t.slice(0, i).trim()] = v;
    }
  } catch {}
  return out;
}

const here = path.dirname(new URL(import.meta.url).pathname);
const env = { ...(await loadEnv(path.join(here, "../.env"))), ...(await loadEnv(path.join(here, ".env"))) };
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEY || env.SUPABASE_KEY;
if (!url || !key) { console.error("Missing SUPABASE_URL / service key in backend env (found url:", !!url, "key:", !!key, ")"); process.exit(2); }

// creator id from the cached prod CLI token's sub claim
const store = JSON.parse(await fs.readFile(path.join(os.homedir(), ".learnrift", "credentials.json"), "utf8"));
const prof = store.profiles?.["https://learnrift.site/api"];
const tok = prof?.accessToken || "";
const payload = JSON.parse(Buffer.from((tok.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil((tok.split(".")[1] || "").length / 4) * 4, "="), "base64").toString("utf8"));
const creatorId = payload.sub;
console.log("creator id (token sub):", creatorId, "| token email:", payload.email || "(n/a)");

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: before, error: e1 } = await db.from("creator_storage")
  .select("creator_id, bytes_used, extra_bytes, extra_until").eq("creator_id", creatorId).maybeSingle();
if (e1) { console.error("read error:", e1.message); process.exit(3); }
const MB = 1024 * 1024;
const show = (r) => r ? `bytes_used=${(r.bytes_used/MB).toFixed(2)}MB extra_bytes=${(r.extra_bytes/MB).toFixed(2)}MB extra_until=${r.extra_until}` : "(no row)";
console.log("BEFORE:", show(before));

if (process.env.RUN === "apply") {
  const freeMB = Number(env.CREATOR_STORAGE_FREE_MB || 2);
  const TARGET_TOTAL_MB = Number(process.env.TARGET_TOTAL_MB || 40); // total quota (free + extra)
  const usedMB = (before?.bytes_used || 0) / MB;
  if (usedMB > TARGET_TOTAL_MB) {
    console.error(`REFUSING: bytes_used ${usedMB.toFixed(2)}MB > target quota ${TARGET_TOTAL_MB}MB — would put the account over quota and block publishing/edits. Re-run with TARGET_TOTAL_MB higher than ${Math.ceil(usedMB)}.`);
    process.exit(5);
  }
  const GRANT = Math.max(0, Math.round(TARGET_TOTAL_MB - freeMB)) * MB; // extra_bytes
  const until = "2030-01-01T00:00:00Z";
  const { error: e2 } = await db.from("creator_storage")
    .upsert({ creator_id: creatorId, extra_bytes: GRANT, extra_until: until }, { onConflict: "creator_id" });
  if (e2) { console.error("upsert error:", e2.message); process.exit(4); }
  const { data: after } = await db.from("creator_storage")
    .select("creator_id, bytes_used, extra_bytes, extra_until").eq("creator_id", creatorId).maybeSingle();
  console.log("AFTER: ", show(after));
  const remMB = (freeMB * MB + GRANT - after.bytes_used) / MB;
  console.log(`quota now = ${freeMB} free + ${(GRANT/MB)} extra = ${(freeMB + GRANT/MB)} MB total | used ${(after.bytes_used/MB).toFixed(2)} MB | remaining ${remMB.toFixed(2)} MB`);
} else {
  console.log("(dry run — set RUN=apply to grant 250MB extra_bytes)");
}
