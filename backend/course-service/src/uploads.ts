import type { Express, NextFunction, Request, Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import multer from "multer";
import {
  ok, fail, requireAuth, requireRole, withDb,
  validateUpload, normalizeStoragePath, storeFile, deleteStoredFile, createStorageSignedUrl, readLocalFile,
} from "@cs-ranger/shared";

/**
 * Course asset uploads (gateway path: /api/courses/uploads/*):
 *   - course thumbnails  → public  `course-assets` bucket
 *   - node attachments   → private `node-attachments` bucket (signed download)
 *
 * Lesson PDFs keep using the existing signed-upload-URL flow (storage quota
 * enforced); certificates keep their own bucket. Uploading here only stores the
 * file + metadata — persisting `thumbnail_url` onto the course still goes
 * through the lock-enforced PATCH /:id, so single-writer semantics hold.
 * Local `.local-uploads/` fallback is used when Supabase Storage is unavailable.
 */

const THUMB_MAX_BYTES = 5 * 1024 * 1024;
const THUMB_MIME = ["image/jpeg", "image/png", "image/webp"];
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
// Inline rich-text images (quiz prompts/options/explanations). Stored in the
// PUBLIC course-assets bucket so the <img src> baked into the saved HTML stays
// valid forever, and counted against the uploader's storage quota like PDFs.
const RICH_IMG_MAX_BYTES = 5 * 1024 * 1024;
const RICH_IMG_MIME = ["image/jpeg", "image/png", "image/webp"]; // match the course-assets bucket allow-list
const STORAGE_FREE_MB = Number(process.env.CREATOR_STORAGE_FREE_MB || 2);
const STORAGE_PRICE_PER_MB_INR = Number(process.env.CREATOR_STORAGE_PRICE_PER_MB_INR || 5);
const BYTES_PER_MB = 1024 * 1024;
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api").replace(/\/$/, "");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } });

function singleFile(field: string) {
  return (req: Request, res: Response, next: NextFunction) =>
    upload.single(field)(req, res, (err: unknown) => {
      if (err) return fail(res, 400, err instanceof Error ? err.message : "Upload failed", "VALIDATION");
      next();
    });
}

interface UploadHelpers {
  courseEditorRole: (db: SupabaseClient, courseId: string, userId: string, isAdmin: boolean) => Promise<"owner" | "collaborator" | "admin" | null>;
  nodeCourseId: (db: SupabaseClient, nodeId: string) => Promise<string | null>;
}

interface AssetRow {
  id: string; owner_id: string; bucket: string; path: string;
  original_filename: string; mime_type: string; size_bytes: number;
  entity_type: string | null; entity_id: string | null; created_at: string;
}

async function assetDownloadUrl(asset: Pick<AssetRow, "bucket" | "path">): Promise<string> {
  const signed = await createStorageSignedUrl(asset.bucket, asset.path, 3600);
  return signed || `${API_BASE}/courses/uploads/local-file?bucket=${encodeURIComponent(asset.bucket)}&path=${encodeURIComponent(asset.path)}`;
}

async function storageQuotaError(db: SupabaseClient, creatorId: string, bytesToAdd: number) {
  const { data: row } = await db.from("creator_storage")
    .select("bytes_used, extra_bytes, extra_until").eq("creator_id", creatorId).maybeSingle();
  const used = Number((row as { bytes_used?: number } | null)?.bytes_used ?? 0);
  const extraBytes = Number((row as { extra_bytes?: number } | null)?.extra_bytes ?? 0);
  const extraUntil = (row as { extra_until?: string | null } | null)?.extra_until ?? null;
  const extraValid = !!extraUntil && new Date(extraUntil).getTime() > Date.now();
  const quota = STORAGE_FREE_MB * BYTES_PER_MB + (extraValid ? extraBytes : 0);
  const projected = used + bytesToAdd;
  if (projected <= quota) return null;
  return {
    status: 402,
    message: "You're over your storage quota. Buy more storage before saving or publishing this course.",
    code: "QUOTA_EXCEEDED",
    meta: { used, quota, needed: projected - quota, priceInrPerMb: STORAGE_PRICE_PER_MB_INR },
  };
}

export function registerCourseUploadRoutes(app: Express, helpers: UploadHelpers) {
  const { courseEditorRole, nodeCourseId } = helpers;

  // ── Course thumbnail ──
  app.post("/uploads/course-thumbnail", requireRole("creator", "admin"), singleFile("file"), async (req, res) => {
    const file = req.file;
    const courseId = String(req.body?.courseId || req.query.courseId || "");
    if (!file) return fail(res, 400, "Attach an image as the multipart 'file' field", "VALIDATION");
    if (!courseId) return fail(res, 400, "courseId is required", "VALIDATION");
    const check = validateUpload({ mimeType: file.mimetype, sizeBytes: file.size, allowedMime: THUMB_MIME, maxBytes: THUMB_MAX_BYTES });
    if (!check.ok) return fail(res, 400, check.message, "VALIDATION");

    const allowed = await withDb(async (db) => courseEditorRole(db, courseId, req.user!.id, req.user!.role === "admin"), "owner" as const);
    if (!allowed) return fail(res, 403, "Not an editor of this course", "NOT_EDITOR");

    const storagePath = normalizeStoragePath(`thumbnails/${courseId}`, file.originalname);
    const stored = await storeFile({ bucket: "course-assets", path: storagePath, buffer: file.buffer, mimeType: file.mimetype, publicBucket: true });
    const url = stored.publicUrl
      || `${API_BASE}/courses/uploads/local-file?bucket=course-assets&path=${encodeURIComponent(storagePath)}`;

    await withDb(async (db) => {
      await db.from("uploaded_assets").insert({
        owner_id: req.user!.id, bucket: "course-assets", path: storagePath,
        original_filename: file.originalname, mime_type: file.mimetype, size_bytes: file.size,
        entity_type: "course_thumbnail", entity_id: courseId,
      });
      return null;
    }, null);

    ok(res, { url, path: storagePath, storage: stored.storage });
  });

  // ── Node attachments ──
  app.post("/uploads/node-attachment", requireRole("creator", "admin"), singleFile("file"), async (req, res) => {
    const file = req.file;
    const nodeId = String(req.body?.nodeId || req.query.nodeId || "");
    if (!file) return fail(res, 400, "Attach a file as the multipart 'file' field", "VALIDATION");
    if (!nodeId) return fail(res, 400, "nodeId is required", "VALIDATION");
    const check = validateUpload({ mimeType: file.mimetype, sizeBytes: file.size, maxBytes: ATTACHMENT_MAX_BYTES });
    if (!check.ok) return fail(res, 400, check.message, "VALIDATION");

    const result = await withDb<{ asset: AssetRow } | { error: { status: number; message: string; code: string; meta?: Record<string, unknown> } }>(async (db) => {
      const courseId = await nodeCourseId(db, nodeId);
      if (!courseId) return { error: { status: 404, message: "Lesson not found", code: "NOT_FOUND" } };
      const role = await courseEditorRole(db, courseId, req.user!.id, req.user!.role === "admin");
      if (!role) return { error: { status: 403, message: "Not an editor of this course", code: "NOT_EDITOR" } };
      const quotaError = await storageQuotaError(db, req.user!.id, file.size);
      if (quotaError) return { error: quotaError };

      const storagePath = normalizeStoragePath(`attachments/${nodeId}`, file.originalname);
      await storeFile({ bucket: "node-attachments", path: storagePath, buffer: file.buffer, mimeType: file.mimetype });
      // Count the bytes toward the creator's storage. The storage.objects trigger
      // is a no-op (migration 0035), so accounting is app-side via commit_storage
      // — same as PDFs and rich-text images. Without this, attachments grew the
      // bucket but never moved the usage counter the UI/quota reads.
      const { error: commitErr } = await db.rpc("commit_storage", { p_creator_id: req.user!.id, p_bytes: file.size });
      if (commitErr) throw commitErr;
      const { data, error } = await db.from("uploaded_assets").insert({
        owner_id: req.user!.id, bucket: "node-attachments", path: storagePath,
        original_filename: file.originalname, mime_type: file.mimetype, size_bytes: file.size,
        entity_type: "node_attachment", entity_id: nodeId,
      }).select("*").single();
      if (error) throw error;
      return { asset: data as AssetRow };
    }, () => ({ error: { status: 503, message: "Attachments need a configured database", code: "DB_REQUIRED" } }));

    if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code, result.error.meta);
    ok(res, { ...result.asset, url: await assetDownloadUrl(result.asset) });
  });

  // ── Inline rich-text images (quiz editor "add image") ──
  // Public bucket → permanent URL embedded in the question/option HTML. Bills the
  // uploader's storage quota (commit_storage; the storage trigger is a no-op).
  app.post("/uploads/rich-image", requireRole("creator", "admin"), singleFile("file"), async (req, res) => {
    const file = req.file;
    if (!file) return fail(res, 400, "Attach an image as the multipart 'file' field", "VALIDATION");
    const check = validateUpload({ mimeType: file.mimetype, sizeBytes: file.size, allowedMime: RICH_IMG_MIME, maxBytes: RICH_IMG_MAX_BYTES });
    if (!check.ok) return fail(res, 400, check.message, "VALIDATION");
    const nodeId = String(req.body?.nodeId || req.query.nodeId || "") || null;
    const creatorId = req.user!.id;

    type RichOk = { url: string; path: string; storage: string };
    type RichErr = { error: { status: number; message: string; code: string; meta?: Record<string, unknown> } };
    const result = await withDb<RichOk | RichErr>(async (db) => {
      // Quota pre-check (bill the uploader, same as PDF lessons).
      const quotaError = await storageQuotaError(db, creatorId, file.size);
      if (quotaError) return { error: quotaError };

      const storagePath = normalizeStoragePath(`rich/${creatorId}`, file.originalname);
      const stored = await storeFile({ bucket: "course-assets", path: storagePath, buffer: file.buffer, mimeType: file.mimetype, publicBucket: true });

      // Count the bytes toward the creator's quota (authoritative app-side accounting).
      const { error: commitErr } = await db.rpc("commit_storage", { p_creator_id: creatorId, p_bytes: file.size });
      if (commitErr) throw commitErr;

      await db.from("uploaded_assets").insert({
        owner_id: creatorId, bucket: "course-assets", path: storagePath,
        original_filename: file.originalname, mime_type: file.mimetype, size_bytes: file.size,
        entity_type: "rich_image", entity_id: nodeId,
      });

      const url = stored.publicUrl || `${API_BASE}/courses/uploads/local-file?bucket=course-assets&path=${encodeURIComponent(storagePath)}`;
      return { url, path: storagePath, storage: stored.storage };
    }, () => ({ error: { status: 503, message: "Image upload needs a configured database", code: "DB_REQUIRED" } }));

    if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code, result.error.meta);
    ok(res, result);
  });

  // List a lesson's attachments — editors and enrolled learners only.
  app.get("/nodes/:nodeId/attachments", requireAuth, async (req, res) => {
    const nodeId = String(req.params.nodeId);
    const result = await withDb<{ items: AssetRow[] } | { error: { status: number; message: string; code: string } }>(async (db) => {
      const courseId = await nodeCourseId(db, nodeId);
      if (!courseId) return { error: { status: 404, message: "Lesson not found", code: "NOT_FOUND" } };
      const role = await courseEditorRole(db, courseId, req.user!.id, req.user!.role === "admin");
      if (!role) {
        const { data: enrollment } = await db.from("enrollments").select("id, access_expires_at").eq("learner_id", req.user!.id).eq("course_id", courseId).maybeSingle();
        const expiresAt = (enrollment as { access_expires_at?: string | null } | null)?.access_expires_at ?? null;
        const active = !!enrollment && (expiresAt === null || new Date(expiresAt).getTime() > Date.now());
        if (!active) return { error: { status: 403, message: "Your access to this course has ended — renew to download attachments", code: "ACCESS_ENDED" } };
      }
      const { data } = await db.from("uploaded_assets")
        .select("*").eq("entity_type", "node_attachment").eq("entity_id", nodeId)
        .order("created_at", { ascending: true });
      return { items: (data as AssetRow[] | null) || [] };
    }, { items: [] });

    if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
    const items = await Promise.all(result.items.map(async (a) => ({
      id: a.id, original_filename: a.original_filename, mime_type: a.mime_type, size_bytes: a.size_bytes,
      created_at: a.created_at, url: await assetDownloadUrl(a),
    })));
    ok(res, items);
  });

  // Delete an uploaded asset — uploader, course editor, or admin.
  app.delete("/uploads/assets/:assetId", requireAuth, async (req, res) => {
    const assetId = String(req.params.assetId);
    const result = await withDb<{ asset: AssetRow } | { error: { status: number; message: string; code: string } }>(async (db) => {
      const { data: asset } = await db.from("uploaded_assets").select("*").eq("id", assetId).maybeSingle();
      if (!asset) return { error: { status: 404, message: "Asset not found", code: "NOT_FOUND" } };
      const a = asset as AssetRow;
      let allowed = a.owner_id === req.user!.id || req.user!.role === "admin";
      if (!allowed && a.entity_type === "node_attachment" && a.entity_id) {
        const courseId = await nodeCourseId(db, a.entity_id);
        allowed = !!courseId && !!(await courseEditorRole(db, courseId, req.user!.id, false));
      }
      if (!allowed && a.entity_type === "course_thumbnail" && a.entity_id) {
        allowed = !!(await courseEditorRole(db, a.entity_id, req.user!.id, false));
      }
      if (!allowed) return { error: { status: 403, message: "You can't delete this file", code: "FORBIDDEN" } };
      await db.from("uploaded_assets").delete().eq("id", assetId);
      // Give the bytes back to the creator's quota for counted asset types
      // (attachments + rich-text images are committed on upload; thumbnails are
      // not counted, so skip them) — otherwise deleting never frees space.
      if (a.entity_type === "node_attachment" || a.entity_type === "rich_image") {
        await db.rpc("release_storage", { p_creator_id: a.owner_id, p_bytes: a.size_bytes });
      }
      return { asset: a };
    }, () => ({ error: { status: 503, message: "Asset deletion needs a configured database", code: "DB_REQUIRED" } }));

    if ("error" in result) return fail(res, result.error.status, result.error.message, result.error.code);
    await deleteStoredFile(result.asset.bucket, result.asset.path);
    ok(res, { deleted: true });
  });

  // Dev-only local fallback serving. Public buckets are served openly (they'd be
  // public CDN URLs on Supabase anyway); private attachment files require auth.
  app.get("/uploads/local-file", async (req, res) => {
    const bucket = String(req.query.bucket || "");
    const storagePath = String(req.query.path || "");
    if (!["course-assets", "node-attachments"].includes(bucket) || !storagePath) return fail(res, 404, "Not found", "NOT_FOUND");
    if (bucket === "node-attachments" && !req.user) return fail(res, 401, "Unauthorized", "UNAUTHORIZED");
    const buffer = await readLocalFile(bucket, storagePath);
    if (!buffer) return fail(res, 404, "Not found", "NOT_FOUND");
    res.setHeader("Cache-Control", bucket === "course-assets" ? "public, max-age=3600" : "private, max-age=300");
    res.type(storagePath.split(".").pop() || "bin").send(buffer);
  });
}
