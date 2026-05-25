import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSupabaseConfigured, supabaseAdmin } from "./supabase.js";

/**
 * Storage helper for the upload pipeline (avatars, course thumbnails, node
 * attachments). Uses Supabase Storage when configured; otherwise falls back to
 * a local `.local-uploads/` directory inside the calling service's workspace
 * (never outside the repo) so uploads keep working in dev. Callers expose the
 * local files through their own authenticated GET route.
 */

export interface UploadValidation {
  mimeType: string;
  sizeBytes: number;
  allowedMime?: string[];          // e.g. ["image/png", "image/jpeg"]; undefined = any
  maxBytes: number;
}

export function validateUpload(v: UploadValidation): { ok: true } | { ok: false; message: string } {
  if (!v.sizeBytes || v.sizeBytes <= 0) return { ok: false, message: "Empty file" };
  if (v.sizeBytes > v.maxBytes) {
    return { ok: false, message: `File is too large — the limit is ${(v.maxBytes / 1_048_576).toFixed(0)} MB` };
  }
  if (v.allowedMime && !v.allowedMime.includes(v.mimeType)) {
    return { ok: false, message: `Unsupported file type ${v.mimeType || "unknown"} — allowed: ${v.allowedMime.join(", ")}` };
  }
  return { ok: true };
}

/** Build a collision-free, traversal-safe storage path: `<prefix>/<uuid>-<safe-name>`. */
export function normalizeStoragePath(prefix: string, originalFilename: string): string {
  const base = path.basename(originalFilename || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9/_-]/g, "").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  return `${cleanPrefix}/${randomUUID()}-${base}`;
}

const LOCAL_ROOT = path.resolve(process.cwd(), ".local-uploads");

function localPathFor(bucket: string, storagePath: string): string {
  const resolved = path.resolve(LOCAL_ROOT, bucket, storagePath);
  // Defence in depth: never allow a path that escapes the local uploads root.
  if (!resolved.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Invalid storage path");
  return resolved;
}

export interface StoreFileResult {
  storage: "supabase" | "local";
  bucket: string;
  path: string;
  /** Public CDN URL (public Supabase buckets only); callers build their own URL for local/private files. */
  publicUrl: string | null;
}

export async function storeFile(opts: { bucket: string; path: string; buffer: Buffer; mimeType: string; publicBucket?: boolean }): Promise<StoreFileResult> {
  if (isSupabaseConfigured()) {
    try {
      const db = supabaseAdmin();
      const { error } = await db.storage.from(opts.bucket).upload(opts.path, opts.buffer, { contentType: opts.mimeType, upsert: true });
      if (error) throw error;
      let publicUrl: string | null = null;
      if (opts.publicBucket) {
        const { data } = db.storage.from(opts.bucket).getPublicUrl(opts.path);
        publicUrl = data?.publicUrl || null;
      }
      return { storage: "supabase", bucket: opts.bucket, path: opts.path, publicUrl };
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", msg: "supabase storage upload failed — falling back to local", err: err instanceof Error ? err.message : String(err) }));
    }
  }
  const target = localPathFor(opts.bucket, opts.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, opts.buffer);
  return { storage: "local", bucket: opts.bucket, path: opts.path, publicUrl: null };
}

export async function deleteStoredFile(bucket: string, storagePath: string): Promise<void> {
  if (isSupabaseConfigured()) {
    try {
      await supabaseAdmin().storage.from(bucket).remove([storagePath]);
      return;
    } catch { /* fall through to local cleanup */ }
  }
  try { await unlink(localPathFor(bucket, storagePath)); } catch { /* already gone */ }
}

export async function createStorageSignedUrl(bucket: string, storagePath: string, ttlSeconds = 3600): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await supabaseAdmin().storage.from(bucket).createSignedUrl(storagePath, ttlSeconds);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}

/** Read a file persisted by the local fallback (for the dev-only authenticated serving route). */
export async function readLocalFile(bucket: string, storagePath: string): Promise<Buffer | null> {
  try { return await readFile(localPathFor(bucket, storagePath)); } catch { return null; }
}
