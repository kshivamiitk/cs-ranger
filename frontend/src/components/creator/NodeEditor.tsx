"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, ListChecks, Play, FileType, Code2, Plus, Trash2, Upload, Loader2, AlertCircle, Paperclip, FileJson, Copy, Check, ChevronDown, ChevronRight, ExternalLink, Folder } from "lucide-react";
import { api, type CourseNode, type VideoChapter, type VideoSubtitle } from "@/lib/api";
import { composeStaticDoc, openStaticLessonInNewTab } from "@/lib/staticLesson";
import { FileUpload } from "@/components/common/FileUpload";
import { MarkdownView } from "@/components/common/MarkdownView";
import { RichTextEditor } from "@/components/common/RichTextEditor";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const TYPE_META: Record<CourseNode["type"], { icon: React.ReactNode; label: string }> = {
  video: { icon: <Play className="h-4 w-4" />, label: "Video" },
  markdown: { icon: <FileText className="h-4 w-4" />, label: "Markdown / Article" },
  quiz: { icon: <ListChecks className="h-4 w-4" />, label: "Quiz" },
  pdf: { icon: <FileType className="h-4 w-4" />, label: "PDF" },
  static_website: { icon: <Code2 className="h-4 w-4" />, label: "Static Website" },
  folder: { icon: <Folder className="h-4 w-4" />, label: "Folder" },
};

export function NodeEditor({ value, onChange }: { value: Partial<CourseNode>; onChange: (next: Partial<CourseNode>) => void }) {
  const type = value.type || "video";
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-fg-dim">Title</label>
        <input value={value.title || ""} onChange={(e) => onChange({ ...value, title: e.target.value })} className="input" />
      </div>
      {/* Lesson type is fixed at creation (chosen via the "+ Add lesson" picker
          in the explorer). Editing only changes content, never the format —
          enforced server-side in PATCH /nodes/:id as well. */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-fg-dim">Lesson type:</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-surface-2 px-3 py-1 text-fg">
          {TYPE_META[type].icon} {TYPE_META[type].label}
          <span className="ml-1 text-[10px] uppercase tracking-widest text-fg-dim">locked</span>
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={!!value.is_free_preview} onChange={(e) => onChange({ ...value, is_free_preview: e.target.checked })} className="accent-[color:var(--brand-primary)]" />
          Free preview
        </label>
        <span className="text-fg-dim">|</span>
        <label className="inline-flex items-center gap-1.5">
          Duration (s): <input type="number" className="input w-24 py-1 text-xs" value={value.duration_seconds || 0} onChange={(e) => onChange({ ...value, duration_seconds: Number(e.target.value) })} />
        </label>
      </div>

      {type === "video" && <VideoEditor value={value} onChange={onChange} />}
      {type === "markdown" && <MarkdownEditor value={value} onChange={onChange} />}
      {type === "pdf" && <PdfEditor value={value} onChange={onChange} />}
      {type === "quiz" && <QuizEditor value={value} onChange={onChange} />}
      {type === "static_website" && <StaticEditor value={value} onChange={onChange} />}
      {type === "folder" && (
        <div className="rounded-xl border border-border bg-surface-2 p-4 text-sm text-fg-dim">
          Folder nodes are structural curriculum groups. Add or import lessons under them with the course import CLI.
        </div>
      )}

      {value.id && type !== "folder" ? (
        <AttachmentsEditor nodeId={value.id} />
      ) : type !== "folder" ? (
        <p className="text-[11px] text-fg-dim">Save the course once to attach downloadable resources to this lesson.</p>
      ) : null}
    </div>
  );
}

function AttachmentsEditor({ nodeId }: { nodeId: string }) {
  const qc = useQueryClient();
  const { data: attachments, isLoading } = useQuery({
    queryKey: ["node-attachments", nodeId],
    queryFn: () => api.courses.nodeAttachments(nodeId),
  });
  const remove = useMutation({
    mutationFn: (assetId: string) => api.courses.deleteUploadedAsset(assetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["node-attachments", nodeId] }),
  });

  return (
    <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-dim">
        <Paperclip className="h-3.5 w-3.5" /> Attachments
      </p>
      <FileUpload
        compact
        maxBytes={25 * 1024 * 1024}
        hint="Any file up to 25 MB — learners see these under the lesson's Resources tab."
        onUpload={async (file, onProgress) => {
          await api.courses.uploadNodeAttachment(nodeId, file, onProgress);
          qc.invalidateQueries({ queryKey: ["node-attachments", nodeId] });
        }}
      />
      <div className="mt-3 space-y-1.5">
        {isLoading ? (
          <p className="text-xs text-fg-dim"><Loader2 className="inline h-3 w-3 animate-spin" /> Loading attachments…</p>
        ) : (attachments?.length ?? 0) === 0 ? (
          <p className="text-xs text-fg-dim">No attachments yet.</p>
        ) : (
          attachments!.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs">
              <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-brand">{a.original_filename}</a>
              <span className="shrink-0 text-fg-dim">{(a.size_bytes / 1_048_576).toFixed(1)} MB</span>
              <button
                type="button"
                onClick={() => remove.mutate(a.id)}
                disabled={remove.isPending}
                aria-label={`Remove ${a.original_filename}`}
                className="shrink-0 text-fg-dim transition hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function VideoEditor({ value, onChange }: { value: Partial<CourseNode>; onChange: (n: Partial<CourseNode>) => void }) {
  function setUrl(url: string) {
    // Extract id from YouTube or Drive URLs
    let provider: "youtube" | "gdrive" | undefined;
    let cleanUrl = url;
    const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
    const gd = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
    if (yt) { provider = "youtube"; cleanUrl = `https://www.youtube.com/embed/${yt[1]}`; }
    else if (gd) { provider = "gdrive"; cleanUrl = `https://drive.google.com/file/d/${gd[1]}/preview`; }
    onChange({ ...value, video_url: cleanUrl, video_provider: provider });
  }
  return (
    <div className="card space-y-3">
      <p className="text-xs text-fg-dim">Paste a YouTube or Google Drive URL. Drive videos must be set to "Anyone with the link".</p>
      <input value={value.video_url || ""} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/… or https://drive.google.com/file/d/…" className="input" />
      {value.video_url && (
        <div className="aspect-video overflow-hidden rounded-xl border border-border bg-black">
          <iframe src={value.video_url} allow="accelerometer; autoplay; encrypted-media" allowFullScreen className="h-full w-full" />
        </div>
      )}
      <ChaptersEditor
        chapters={value.video_chapters || []}
        onChange={(chapters) => onChange({ ...value, video_chapters: chapters })}
      />
      <SubtitlesEditor
        subtitles={value.video_subtitles || []}
        onChange={(subtitles) => onChange({ ...value, video_subtitles: subtitles })}
      />
    </div>
  );
}

function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function parseTimestamp(input: string): number | null {
  const parts = input.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (parts.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (parts.length === 2) return nums[0] * 60 + nums[1];
  return nums[0];
}

function ChaptersEditor({ chapters, onChange }: { chapters: VideoChapter[]; onChange: (chapters: VideoChapter[]) => void }) {
  // Timestamps are edited as "m:ss" text and committed on blur — keeps typing
  // intermediate values like "1:" from clobbering the stored seconds.
  const [timeDrafts, setTimeDrafts] = useState<Record<number, string>>({});

  function update(i: number, next: Partial<VideoChapter>) {
    onChange(chapters.map((c, idx) => (idx === i ? { ...c, ...next } : c)));
  }
  function commitTime(i: number) {
    const draft = timeDrafts[i];
    if (draft !== undefined) {
      const seconds = parseTimestamp(draft);
      if (seconds !== null) update(i, { seconds });
    }
    setTimeDrafts((d) => { const copy = { ...d }; delete copy[i]; return copy; });
  }
  const outOfOrder = chapters.some((c, i) => i > 0 && c.seconds <= chapters[i - 1].seconds);

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-fg-dim">Chapters</p>
      <div className="space-y-1.5">
        {chapters.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={timeDrafts[i] ?? formatTimestamp(c.seconds)}
              onChange={(e) => setTimeDrafts((d) => ({ ...d, [i]: e.target.value }))}
              onBlur={() => commitTime(i)}
              placeholder="0:00"
              aria-label={`Chapter ${i + 1} start time`}
              className="input w-24 py-1 text-center font-mono text-xs"
            />
            <input
              value={c.title}
              onChange={(e) => update(i, { title: e.target.value })}
              placeholder={`Chapter ${i + 1} title`}
              className="input flex-1 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => onChange(chapters.filter((_, idx) => idx !== i))}
              aria-label={`Remove chapter ${i + 1}`}
              className="shrink-0 text-fg-dim transition hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      {outOfOrder && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-danger">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> Chapter timestamps must be in increasing order — the save will be rejected until they are.
        </p>
      )}
      <button
        type="button"
        onClick={() => onChange([...chapters, { title: "", seconds: chapters.length ? chapters[chapters.length - 1].seconds + 60 : 0 }])}
        className="btn-ghost mt-2 w-full text-xs"
      >
        <Plus className="h-3.5 w-3.5" /> Add chapter
      </button>
      <p className="mt-1 text-[11px] text-fg-dim">Learners see chapters under the player and can jump to a timestamp (YouTube videos).</p>
    </div>
  );
}

function SubtitlesEditor({ subtitles, onChange }: { subtitles: VideoSubtitle[]; onChange: (subtitles: VideoSubtitle[]) => void }) {
  function update(i: number, next: Partial<VideoSubtitle>) {
    onChange(subtitles.map((s, idx) => (idx === i ? { ...s, ...next } : s)));
  }
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-fg-dim">Subtitles</p>
      <div className="space-y-1.5">
        {subtitles.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              value={s.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Label (e.g. English)"
              className="input w-36 py-1 text-sm"
            />
            <input
              value={s.lang}
              onChange={(e) => update(i, { lang: e.target.value })}
              placeholder="Lang (en)"
              aria-label={`Subtitle ${i + 1} language code`}
              className="input w-20 py-1 text-center text-xs"
            />
            <input
              value={s.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://… link to the .vtt / .srt file"
              className="input min-w-[160px] flex-1 py-1 text-xs"
            />
            <select
              value={s.format}
              onChange={(e) => update(i, { format: e.target.value as VideoSubtitle["format"] })}
              aria-label={`Subtitle ${i + 1} format`}
              className="input w-20 py-1 text-xs"
            >
              <option value="vtt">vtt</option>
              <option value="srt">srt</option>
            </select>
            <button
              type="button"
              onClick={() => onChange(subtitles.filter((_, idx) => idx !== i))}
              aria-label={`Remove subtitle ${i + 1}`}
              className="shrink-0 text-fg-dim transition hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...subtitles, { label: "", lang: "en", url: "", format: "vtt" }])}
        className="btn-ghost mt-2 w-full text-xs"
      >
        <Plus className="h-3.5 w-3.5" /> Add subtitle track
      </button>
      <p className="mt-1 text-[11px] text-fg-dim">Embedded YouTube/Drive players can't load external captions, so learners get these as open/download links next to the video.</p>
    </div>
  );
}

function MarkdownEditor({ value, onChange }: { value: Partial<CourseNode>; onChange: (n: Partial<CourseNode>) => void }) {
  return (
    <div className="card">
      <p className="mb-2 text-xs text-fg-dim">Markdown + LaTeX supported. Headings, lists, code blocks, math: $E=mc^2$ inline or $$\\int$$ block.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="overflow-hidden rounded-xl border border-border" style={{ height: 380 }}>
          <Monaco
            language="markdown"
            theme="vs-dark"
            value={value.markdown || ""}
            onChange={(v) => onChange({ ...value, markdown: v || "" })}
            options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: "on", scrollBeyondLastLine: false, lineNumbers: "on" }}
          />
        </div>
        <div className="overflow-auto rounded-xl border border-border bg-surface-2 p-4 text-sm" style={{ height: 380 }}>
          <p className="mb-2 text-[10px] uppercase tracking-widest text-fg-dim">Preview</p>
          {value.markdown
            ? <MarkdownView source={value.markdown} />
            : <p className="text-fg-dim">Start writing markdown…</p>}
        </div>
      </div>
    </div>
  );
}

function PdfEditor({ value, onChange }: { value: Partial<CourseNode>; onChange: (n: Partial<CourseNode>) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Short-lived signed URL just for the creator's own preview. The lesson's
  // pdf_url stores the bare storage path now — the bucket is private, so the
  // path alone isn't enough to view, and a leaked DB row gives nothing away.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function refreshPreview(path: string) {
    setPreviewLoading(true);
    try {
      const { signedUrl } = await api.courses.pdfPreviewUrl(path);
      setPreviewUrl(signedUrl);
    } catch { setPreviewUrl(null); }
    finally { setPreviewLoading(false); }
  }

  // Whenever the stored path changes (initial load, upload, replace), grab a
  // fresh preview link.
  useEffect(() => {
    if (value.pdf_url) refreshPreview(value.pdf_url);
    else setPreviewUrl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.pdf_url]);

  async function handleFile(file: File) {
    setError(null);
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("That's not a PDF.");
      return;
    }
    if (file.size > 26_214_400) {
      setError("PDF too large (max 25MB).");
      return;
    }
    setUploading(true);
    try {
      // 1. Ask the backend for a one-time signed upload URL. Backend mints it
      // with its service-role key; the file never touches our servers.
      const { signedUrl, path } = await api.courses.pdfUploadUrl({
        filename: file.name, sizeBytes: file.size,
      });
      // 2. PUT the file directly to Supabase Storage.
      const r = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf", "x-upsert": "true" },
        body: file,
      });
      if (!r.ok) throw new Error(`Upload failed (${r.status})`);
      // 3. Tell the backend the upload landed so its size counts toward the
      //    storage quota — the bytes went straight to Supabase, so the server
      //    only learns the size here. Best-effort: the file is uploaded either
      //    way, so a hiccup in accounting must not fail the lesson edit.
      try {
        await api.courses.pdfConfirm({ path, sizeBytes: file.size });
      } catch (e) {
        console.warn("storage usage confirm failed", e);
      }
      // 4. Save the storage path on the lesson (NOT a public URL — bucket is
      //    private). The learner-side viewer signs it via /pdf-view-url.
      onChange({ ...value, pdf_url: path });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="card space-y-3">
      <p className="text-xs text-fg-dim">Upload a PDF (max 25 MB). Stored in a private Supabase Storage bucket and served to enrolled learners via short-lived signed URLs — the file isn't downloadable from the player.</p>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="btn-primary text-xs disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? "Uploading…" : value.pdf_url ? "Replace PDF" : "Upload PDF"}
        </button>
        {value.pdf_url && (
          <button
            type="button"
            onClick={() => { onChange({ ...value, pdf_url: undefined }); setPreviewUrl(null); }}
            className="text-xs text-danger hover:underline"
          >
            Remove
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-2.5 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {error}
            {/* Storage-quota errors include the word "quota". Give the user
                a direct path to fix it instead of just telling them off. */}
            {/quota/i.test(error) && (
              <> <a href="/creator/storage" className="font-medium underline">Manage storage →</a></>
            )}
          </span>
        </div>
      )}

      {value.pdf_url && (previewLoading || previewUrl) && (
        previewUrl
          ? <iframe src={previewUrl} className="h-72 w-full rounded-xl border border-border bg-white" />
          : <div className="flex h-72 items-center justify-center text-fg-dim"><Loader2 className="h-4 w-4 animate-spin" /></div>
      )}
    </div>
  );
}

interface QuizQ { id: string; prompt: string; options: string[]; correctIndex: number; explanation?: string }

interface ImportedPayload { timerSeconds?: number; passingPercent?: number; questions: QuizQ[] }

// Parse JSON that's either a bare question array or a full quiz_payload wrapper.
// Returns { ok: true, data } on success or { ok: false, error } with a human message.
function parseQuizJson(raw: string): { ok: true; data: ImportedPayload } | { ok: false; error: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { ok: false, error: `Not valid JSON: ${(e as Error).message}` }; }

  // Normalize: bare array OR { questions: [...] }.
  let questionsRaw: unknown;
  let timerSeconds: number | undefined;
  let passingPercent: number | undefined;
  if (Array.isArray(parsed)) {
    questionsRaw = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown }).questions)) {
    const obj = parsed as { questions: unknown; timerSeconds?: unknown; passingPercent?: unknown };
    questionsRaw = obj.questions;
    if (typeof obj.timerSeconds === "number") timerSeconds = obj.timerSeconds;
    if (typeof obj.passingPercent === "number") passingPercent = obj.passingPercent;
  } else {
    return { ok: false, error: "Top level must be an array of questions or { questions: [...] }." };
  }

  const arr = questionsRaw as unknown[];
  if (arr.length === 0) return { ok: false, error: "No questions found." };

  const out: QuizQ[] = [];
  for (let i = 0; i < arr.length; i++) {
    const q = arr[i];
    if (!q || typeof q !== "object") return { ok: false, error: `Question ${i + 1} is not an object.` };
    const o = q as Record<string, unknown>;
    if (typeof o.prompt !== "string" || !o.prompt.trim()) return { ok: false, error: `Question ${i + 1}: missing "prompt".` };
    if (!Array.isArray(o.options) || o.options.length < 2) return { ok: false, error: `Question ${i + 1}: "options" must be an array of at least 2 strings.` };
    if (!o.options.every((x) => typeof x === "string")) return { ok: false, error: `Question ${i + 1}: every option must be a string.` };
    if (typeof o.correctIndex !== "number" || !Number.isInteger(o.correctIndex) || o.correctIndex < 0 || o.correctIndex >= o.options.length) {
      return { ok: false, error: `Question ${i + 1}: "correctIndex" must be an integer in [0, ${o.options.length - 1}].` };
    }
    if (o.explanation !== undefined && typeof o.explanation !== "string") {
      return { ok: false, error: `Question ${i + 1}: "explanation" must be a string when present.` };
    }
    out.push({
      id: typeof o.id === "string" && o.id ? o.id : `q-${Date.now()}-${i}`,
      prompt: o.prompt,
      options: o.options as string[],
      correctIndex: o.correctIndex,
      ...(typeof o.explanation === "string" ? { explanation: o.explanation } : {}),
    });
  }
  return { ok: true, data: { timerSeconds, passingPercent, questions: out } };
}

// Render the questions array as a clean markdown block.
function quizToMarkdown(qs: QuizQ[]): string {
  if (!qs.length) return "_(no questions yet)_";
  return qs.map((q, i) => {
    const opts = q.options.map((o, oi) => {
      const letter = String.fromCharCode(65 + oi);
      const mark = oi === q.correctIndex ? " **(correct)**" : "";
      return `- ${letter}. ${o}${mark}`;
    }).join("\n");
    const expl = q.explanation ? `\n\n> _Explanation:_ ${q.explanation}` : "";
    return `**Q${i + 1}.** ${q.prompt}\n\n${opts}${expl}`;
  }).join("\n\n---\n\n");
}

function QuizBulkPanel({
  questions,
  onAppend,
  onReplace,
}: {
  questions: QuizQ[];
  onAppend: (imported: ImportedPayload) => void;
  onReplace: (imported: ImportedPayload) => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ImportedPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const markdown = quizToMarkdown(questions);

  function handleParse(text: string) {
    setRaw(text);
    if (!text.trim()) { setError(null); setParsed(null); return; }
    const r = parseQuizJson(text);
    if (r.ok) { setError(null); setParsed(r.data); }
    else { setError(r.error); setParsed(null); }
  }
  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("Please pick a .json file.");
      return;
    }
    const text = await file.text();
    handleParse(text);
  }
  async function copyMarkdown() {
    try { await navigator.clipboard.writeText(markdown); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setImportOpen((v) => !v)} className="btn-ghost text-sm">
          {importOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <FileJson className="h-4 w-4" /> Import from JSON
        </button>
        <button type="button" onClick={() => setPreviewOpen((v) => !v)} className="btn-ghost text-sm">
          {previewOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <FileText className="h-4 w-4" /> Preview as markdown
        </button>
      </div>

      {importOpen && (
        <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-fg-dim">
              Paste a JSON array of questions, or a <code>{"{ timerSeconds, passingPercent, questions }"}</code> object.
            </p>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-ghost text-xs">
              <Upload className="h-3 w-3" /> Pick .json file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
          </div>
          <textarea
            value={raw}
            onChange={(e) => handleParse(e.target.value)}
            rows={8}
            placeholder={`[\n  {\n    "prompt": "What does HTTP stand for?",\n    "options": ["Hyper Text Transfer Protocol", "Home Tool Transfer Protocol", "Hyper Time Tracking Protocol", "Hard To Type Protocol"],\n    "correctIndex": 0,\n    "explanation": "HTTP is the foundation of data exchange on the Web."\n  }\n]`}
            className="input font-mono text-xs"
            spellCheck={false}
          />
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {parsed && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-success/30 bg-success/10 p-2 text-xs">
              <span className="text-success">
                ✓ Parsed {parsed.questions.length} question{parsed.questions.length === 1 ? "" : "s"}
                {parsed.timerSeconds !== undefined ? ` · timer ${parsed.timerSeconds}s` : ""}
                {parsed.passingPercent !== undefined ? ` · passing ${parsed.passingPercent}%` : ""}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => onAppend(parsed)} className="btn-ghost text-xs">
                  <Plus className="h-3 w-3" /> Append
                </button>
                <button type="button" onClick={() => onReplace(parsed)} className="btn-primary text-xs">
                  <Upload className="h-3 w-3" /> Replace all
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {previewOpen && (
        <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-fg-dim">Rendered markdown of the current quiz.</p>
            <button type="button" onClick={copyMarkdown} className="btn-ghost text-xs">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy markdown"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-2 text-xs"><code>{markdown}</code></pre>
          <details className="text-xs">
            <summary className="cursor-pointer text-fg-dim hover:text-fg">Show rendered preview</summary>
            <div className="mt-2 rounded-lg border border-border bg-surface p-3">
              <MarkdownView source={markdown} />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function QuizEditor({ value, onChange }: { value: Partial<CourseNode>; onChange: (n: Partial<CourseNode>) => void }) {
  const payload = value.quiz_payload || { timerSeconds: 300, passingPercent: 60, questions: [] as QuizQ[] };
  const questions = payload.questions || [];

  function update(next: Partial<typeof payload>) {
    onChange({ ...value, quiz_payload: { ...payload, ...next } });
  }
  function addQuestion() {
    const q: QuizQ = { id: `q-${Date.now()}`, prompt: "New question", options: ["A", "B", "C", "D"], correctIndex: 0 };
    update({ questions: [...questions, q] });
  }
  function updateQ(i: number, next: Partial<QuizQ>) {
    const copy = [...questions]; copy[i] = { ...copy[i], ...next };
    update({ questions: copy });
  }
  function removeQ(i: number) {
    update({ questions: questions.filter((_, idx) => idx !== i) });
  }
  function appendImported(imp: ImportedPayload) {
    update({
      questions: [...questions, ...imp.questions],
      ...(imp.timerSeconds !== undefined ? { timerSeconds: imp.timerSeconds } : {}),
      ...(imp.passingPercent !== undefined ? { passingPercent: imp.passingPercent } : {}),
    });
  }
  function replaceImported(imp: ImportedPayload) {
    update({
      questions: imp.questions,
      ...(imp.timerSeconds !== undefined ? { timerSeconds: imp.timerSeconds } : {}),
      ...(imp.passingPercent !== undefined ? { passingPercent: imp.passingPercent } : {}),
    });
  }

  return (
    <div className="card space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-xs text-fg-dim">Timer (seconds, 0 = none)</span>
          <input type="number" value={payload.timerSeconds || 0} onChange={(e) => update({ timerSeconds: Number(e.target.value) })} className="input" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-fg-dim">Passing %</span>
          <input type="number" value={payload.passingPercent || 60} onChange={(e) => update({ passingPercent: Number(e.target.value) })} className="input" />
        </label>
      </div>
      <QuizBulkPanel questions={questions} onAppend={appendImported} onReplace={replaceImported} />
      {questions.map((q, i) => (
        <div key={q.id} className="rounded-xl border border-border bg-surface-2 p-3">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <span className="mb-1 block text-xs text-fg-dim">Question {i + 1}</span>
              <RichTextEditor value={q.prompt} onChange={(html) => updateQ(i, { prompt: html })} placeholder={`Question ${i + 1}`} nodeId={value.id} minHeight={44} />
            </div>
            <button onClick={() => removeQ(i)} className="mt-6 text-fg-dim hover:text-danger" title="Remove question"><Trash2 className="h-4 w-4" /></button>
          </div>
          <p className="mt-3 text-xs text-fg-dim">Options — select the radio to mark the correct answer. Add images with the image button.</p>
          <div className="mt-1.5 grid gap-2 md:grid-cols-2">
            {q.options.map((opt, oi) => (
              <div key={oi} className={`flex items-start gap-2 rounded-lg border p-2 ${q.correctIndex === oi ? "border-success bg-success/10" : "border-border"}`}>
                <input type="radio" checked={q.correctIndex === oi} onChange={() => updateQ(i, { correctIndex: oi })} className="mt-2.5 accent-success" title="Mark as correct answer" />
                <span className="mt-2 font-mono text-xs">{String.fromCharCode(65 + oi)}.</span>
                <div className="flex-1">
                  <RichTextEditor value={opt} onChange={(html) => {
                    const opts = [...q.options]; opts[oi] = html;
                    updateQ(i, { options: opts });
                  }} placeholder={`Option ${String.fromCharCode(65 + oi)}`} nodeId={value.id} minHeight={30} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <span className="mb-1 block text-xs text-fg-dim">Explanation (shown after answer)</span>
            <RichTextEditor value={q.explanation || ""} onChange={(html) => updateQ(i, { explanation: html })} placeholder="Explain why the correct answer is right…" nodeId={value.id} minHeight={36} />
          </div>
        </div>
      ))}
      <button onClick={addQuestion} className="btn-ghost w-full text-sm"><Plus className="h-4 w-4" /> Add question</button>
    </div>
  );
}

function StaticEditor({ value, onChange }: { value: Partial<CourseNode>; onChange: (n: Partial<CourseNode>) => void }) {
  const [tab, setTab] = useState<"html" | "css" | "js">("html");
  const sw = value.static_website || { html: "<h1>Hello world</h1>", css: "h1 { color: violet; }", js: "" };
  function update(field: "html" | "css" | "js", v: string) {
    onChange({ ...value, static_website: { ...sw, [field]: v } });
  }
  const previewDoc = composeStaticDoc(sw);
  const FILES: Record<"html" | "css" | "js", string> = { html: "index.html", css: "style.css", js: "script.js" };
  return (
    <div className="card space-y-3">
      {/* VS Code-style editor: file-tab strip + Monaco — full width */}
      <div className="overflow-hidden rounded-xl border border-border bg-[#1e1e1e]" style={{ height: 440 }}>
        <div className="flex items-stretch bg-[#252526] text-xs">
          {(["html", "css", "js"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`border-r border-black/40 px-3 py-2 font-mono transition ${tab === t ? "bg-[#1e1e1e] text-white" : "text-white/50 hover:text-white/80"}`}>
              {FILES[t]}
            </button>
          ))}
        </div>
        <div style={{ height: "calc(100% - 35px)" }}>
          <Monaco
            language={tab === "html" ? "html" : tab === "css" ? "css" : "javascript"}
            theme="vs-dark"
            value={sw[tab]}
            onChange={(v) => update(tab, v || "")}
            options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
          />
        </div>
      </div>

      {/* Compact live preview below the editor (not side-by-side) */}
      <div className="rounded-xl border border-border bg-surface-2 p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-dim">
            <span className="h-2 w-2 rounded-full bg-success" /> Live preview
          </span>
          <button type="button" onClick={() => openStaticLessonInNewTab(sw, value.title)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg-dim transition hover:border-brand hover:text-brand">
            Open full preview <ExternalLink className="h-3 w-3" />
          </button>
        </div>
        <iframe sandbox="allow-scripts" srcDoc={previewDoc} title="Lesson preview" className="w-full rounded-lg border border-border bg-white" style={{ height: 300 }} />
      </div>
    </div>
  );
}
