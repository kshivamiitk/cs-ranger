"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Loader2, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Reusable upload control: drag & drop or click-to-pick, client-side size/type
 * validation, progress, success/error states. The caller supplies the actual
 * upload function (which should go through the shared API client).
 */
export function FileUpload({
  label,
  hint,
  accept,
  maxBytes,
  onUpload,
  disabled,
  compact,
}: {
  label?: string;
  hint?: string;
  /** Accept attribute + validation, e.g. "image/png,image/jpeg" or ".pdf" */
  accept?: string;
  maxBytes: number;
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function validate(file: File): string | null {
    if (file.size > maxBytes) return `File is too large — the limit is ${(maxBytes / 1_048_576).toFixed(0)} MB.`;
    if (accept) {
      const allowed = accept.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
      const matches = allowed.some((a) =>
        a.startsWith(".") ? file.name.toLowerCase().endsWith(a) : a.endsWith("/*") ? file.type.startsWith(a.slice(0, -1)) : file.type === a,
      );
      if (!matches) return `That file type isn't allowed here (${file.type || file.name.split(".").pop()}).`;
    }
    return null;
  }

  async function handleFile(file: File | undefined | null) {
    if (!file || busy || disabled) return;
    setError(null);
    setDone(null);
    const invalid = validate(file);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setProgress(0);
    try {
      await onUpload(file, setProgress);
      setDone(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      {label && <span className="mb-1.5 block text-xs font-medium text-fg-dim">{label}</span>}
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed text-center transition",
          compact ? "gap-1 px-4 py-4" : "gap-2 px-6 py-8",
          dragOver ? "border-brand bg-surface-2" : "border-border bg-surface-2/50 hover:border-brand/60",
          (busy || disabled) && "cursor-not-allowed opacity-70",
        )}
      >
        {busy ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-brand" />
            <p className="text-xs text-fg-dim">Uploading… {progress > 0 ? `${progress}%` : ""}</p>
            <div className="h-1 w-40 overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-brand-gradient transition-all" style={{ width: `${progress}%` }} />
            </div>
          </>
        ) : (
          <>
            <UploadCloud className="h-5 w-5 text-fg-dim" />
            <p className="text-sm font-medium">Drop a file here or click to browse</p>
            {hint && <p className="text-xs text-fg-dim">{hint}</p>}
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          disabled={busy || disabled}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {done && !error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Uploaded {done}</p>
      )}
      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}
