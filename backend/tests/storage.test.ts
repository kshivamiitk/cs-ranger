import { describe, expect, it } from "vitest";
import { normalizeStoragePath, validateUpload } from "../shared/storage";

describe("validateUpload", () => {
  it("rejects empty files", () => {
    const result = validateUpload({ mimeType: "image/png", sizeBytes: 0, maxBytes: 1024 });
    expect(result.ok).toBe(false);
  });

  it("rejects files over the size limit with a friendly MB message", () => {
    const result = validateUpload({ mimeType: "image/png", sizeBytes: 3 * 1024 * 1024, maxBytes: 2 * 1024 * 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("2 MB");
  });

  it("rejects disallowed MIME types and lists what is allowed", () => {
    const result = validateUpload({
      mimeType: "application/x-msdownload",
      sizeBytes: 100,
      maxBytes: 1024,
      allowedMime: ["image/png", "image/jpeg"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("image/png");
  });

  it("accepts a file within limits and allowed types", () => {
    const result = validateUpload({ mimeType: "image/png", sizeBytes: 512, maxBytes: 1024, allowedMime: ["image/png"] });
    expect(result.ok).toBe(true);
  });

  it("accepts any MIME type when no allow-list is given", () => {
    const result = validateUpload({ mimeType: "application/zip", sizeBytes: 512, maxBytes: 1024 });
    expect(result.ok).toBe(true);
  });
});

describe("normalizeStoragePath", () => {
  it("keeps the prefix and the file extension", () => {
    const path = normalizeStoragePath("thumbnails/abc", "My Thumbnail.PNG");
    expect(path.startsWith("thumbnails/abc/")).toBe(true);
    expect(path.endsWith(".PNG")).toBe(true);
  });

  it("strips directory traversal and unsafe characters from the filename", () => {
    const path = normalizeStoragePath("u/123", "../../etc/passwd");
    expect(path).not.toContain("..");
    expect(path.startsWith("u/123/")).toBe(true);
  });

  it("sanitises unsafe characters in the prefix", () => {
    const path = normalizeStoragePath("u/../../secret", "a.png");
    expect(path).not.toContain("..");
  });

  it("generates unique paths for the same filename", () => {
    const a = normalizeStoragePath("attachments/n1", "notes.pdf");
    const b = normalizeStoragePath("attachments/n1", "notes.pdf");
    expect(a).not.toEqual(b);
  });
});
