import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import {
  ok, fail, requireAuth, withDb,
  validateUpload, normalizeStoragePath, storeFile, readLocalFile,
} from "@cs-ranger/shared";

/**
 * Avatar upload pipeline (gateway path: /api/users/uploads/*).
 * Files go to the public `avatars` bucket when Supabase Storage is configured,
 * otherwise to the service-local `.local-uploads/` fallback served by
 * GET /uploads/local-file (dev only).
 */

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api").replace(/\/$/, "");

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });

function singleFile(field: string) {
  return (req: Request, res: Response, next: NextFunction) =>
    avatarUpload.single(field)(req, res, (err: unknown) => {
      if (err) return fail(res, 400, err instanceof Error ? err.message : "Upload failed", "VALIDATION");
      next();
    });
}

export function registerUploadRoutes(app: Express) {
  app.post("/uploads/avatar", requireAuth, singleFile("file"), async (req, res) => {
    const file = req.file;
    if (!file) return fail(res, 400, "Attach an image as the multipart 'file' field", "VALIDATION");
    const check = validateUpload({ mimeType: file.mimetype, sizeBytes: file.size, allowedMime: AVATAR_MIME, maxBytes: AVATAR_MAX_BYTES });
    if (!check.ok) return fail(res, 400, check.message, "VALIDATION");

    const storagePath = normalizeStoragePath(`u/${req.user!.id}`, file.originalname);
    const stored = await storeFile({ bucket: "avatars", path: storagePath, buffer: file.buffer, mimeType: file.mimetype, publicBucket: true });
    const url = stored.publicUrl
      || `${API_BASE}/users/uploads/local-file?bucket=avatars&path=${encodeURIComponent(storagePath)}`;

    await withDb(async (db) => {
      await db.from("uploaded_assets").insert({
        owner_id: req.user!.id, bucket: "avatars", path: storagePath,
        original_filename: file.originalname, mime_type: file.mimetype, size_bytes: file.size,
        entity_type: "avatar", entity_id: req.user!.id,
      });
      await db.from("profiles").update({ avatar_url: url }).eq("user_id", req.user!.id);
      return null;
    }, null);

    ok(res, { url, path: storagePath, storage: stored.storage });
  });

  // Dev-only fallback serving: avatars are public images, so no auth gate.
  app.get("/uploads/local-file", async (req, res) => {
    const bucket = String(req.query.bucket || "");
    const storagePath = String(req.query.path || "");
    if (bucket !== "avatars" || !storagePath) return fail(res, 404, "Not found", "NOT_FOUND");
    const buffer = await readLocalFile(bucket, storagePath);
    if (!buffer) return fail(res, 404, "Not found", "NOT_FOUND");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type(storagePath.split(".").pop() || "bin").send(buffer);
  });
}
