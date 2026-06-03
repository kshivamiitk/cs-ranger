"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, BookOpen, ChevronDown, ChevronRight, Code2, FileText, FileType,
  Folder, FolderOpen, Globe, GripVertical, ListChecks, Loader2, Lock, Play, Plus, Save, Search, Trash2,
  Users, UserPlus, AlertCircle, Check,
} from "lucide-react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { Avatar } from "@/components/common/Avatar";
import { FileUpload } from "@/components/common/FileUpload";
import { NodeEditor } from "@/components/creator/NodeEditor";
import { CreatorTermsModal } from "@/components/creator/CreatorTermsModal";
import { api, type Collaborator, type CourseNode, type CreatorListing, type Module } from "@/lib/api";
import { useApp } from "@/app/providers";
import { useDebouncedValue } from "@/lib/hooks";
import { cn, avatarUrl, relativeTime } from "@/lib/utils";

interface DraftCourse {
  id?: string;
  title: string; subtitle: string; description: string;
  category_id?: string; level: "Beginner" | "Intermediate" | "Advanced" | "All Levels";
  language: string; tags: string[];
  thumbnail_url?: string; promo_video_url?: string;
  price: number; discounted_price?: number;
  certificate_enabled: boolean;
}
interface DraftNode extends Partial<CourseNode> { _local?: boolean; _localId: string }
interface DraftModule { id?: string; _localId: string; title: string; nodes: DraftNode[] }

// Stable client id for drag identity (and to follow selection across reorders).
// New rows have no server id yet, so we can't key drag state off `id`.
const localId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

type Selection =
  | { kind: "course" }
  | { kind: "module"; localId: string }
  | { kind: "lesson"; moduleLocalId: string; nodeIndex: number };

const LESSON_TYPES: { type: CourseNode["type"]; label: string; icon: React.ReactNode }[] = [
  { type: "video", label: "Video", icon: <Play className="h-3.5 w-3.5" /> },
  { type: "markdown", label: "Markdown", icon: <FileText className="h-3.5 w-3.5" /> },
  { type: "quiz", label: "Quiz", icon: <ListChecks className="h-3.5 w-3.5" /> },
  { type: "pdf", label: "PDF", icon: <FileType className="h-3.5 w-3.5" /> },
  { type: "static_website", label: "Static Site", icon: <Code2 className="h-3.5 w-3.5" /> },
];

function lessonIcon(t?: CourseNode["type"]) {
  return LESSON_TYPES.find((x) => x.type === t)?.icon ?? <FileText className="h-3.5 w-3.5" />;
}

function nodeBody(n: DraftNode, fallbackTitle: string) {
  return {
    type: (n.type || "video") as CourseNode["type"],
    title: n.title || fallbackTitle,
    duration_seconds: n.duration_seconds,
    is_free_preview: n.is_free_preview,
    video_url: n.video_url, video_provider: n.video_provider,
    video_chapters: n.video_chapters, video_subtitles: n.video_subtitles,
    markdown: n.markdown, pdf_url: n.pdf_url,
    static_website: n.static_website, quiz_payload: n.quiz_payload,
  };
}

/**
 * Course create + edit, VS Code–style. Left pane is a file-explorer tree
 * (course → modules → lessons); right pane edits whatever you select.
 * Modules cannot nest inside modules; lessons live exactly one level deep.
 *
 * Save is idempotent: existing rows are updated (not re-created), and the
 * created server ids are written back into state so re-saving never duplicates.
 */
export function CourseBuilder({ courseId }: { courseId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const editing = !!courseId;
  const { user } = useApp();
  const userId = user?.user_id || user?.id;

  const [course, setCourse] = useState<DraftCourse>({
    title: "", subtitle: "", description: "", level: "All Levels",
    language: "English", tags: [], price: 0, certificate_enabled: true,
  });
  const [modules, setModules] = useState<DraftModule[]>([]);
  const [selected, setSelected] = useState<Selection>({ kind: "course" });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [adderOpenFor, setAdderOpenFor] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  // Publishing is blocked server-side (TERMS_ACCEPTANCE_REQUIRED) until the
  // current creator terms version is accepted — surface the modal up front.
  const { data: termsStatus } = useQuery({ queryKey: ["creator-terms-status"], queryFn: () => api.users.creatorTermsStatus() });
  const [savedFlash, setSavedFlash] = useState(false);
  const [status, setStatus] = useState<"draft" | "under_review" | "published" | "archived">("draft");

  // ── Edit lock ──
  // Single-writer lock. On mount we try to acquire; if held by someone else
  // we drop into read-only mode (Save/Publish/Add/Delete disabled with a
  // banner telling the user who has it). Heartbeat every 60s; release on
  // unmount + beforeunload (via sendBeacon).
  const [lockHeld, setLockHeld] = useState<boolean>(false);
  const [lockHolderName, setLockHolderName] = useState<string | null>(null);
  const [lockExpiresAt, setLockExpiresAt] = useState<string | null>(null);
  const lockHeldRef = useRef(false);
  lockHeldRef.current = lockHeld;

  // Ids of originally-loaded modules/nodes the user removed — deleted on save.
  const removedModuleIds = useRef<string[]>([]);
  const removedNodeIds = useRef<string[]>([]);

  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: () => api.courses.categories(), staleTime: 60 * 60_000 });

  // Drag-to-reorder. PointerSensor has a small activation distance so a plain
  // click on a row still selects it (only a deliberate drag starts a move).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Edit mode: load the existing course (full content) and hydrate state once.
  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["course-content", courseId],
    queryFn: () => api.courses.get(courseId!),
    enabled: editing,
  });
  const [hydrated, setHydrated] = useState(!editing);

  useEffect(() => {
    if (!editing || hydrated || !existing) return;
    setCourse({
      id: existing.id,
      title: existing.title || "", subtitle: existing.subtitle || "", description: existing.description || "",
      category_id: existing.category_id || undefined, level: existing.level || "All Levels", language: existing.language || "English",
      tags: existing.tags || [], thumbnail_url: existing.thumbnail_url || undefined, promo_video_url: existing.promo_video_url || undefined,
      price: existing.price || 0, discounted_price: existing.discounted_price || undefined, certificate_enabled: existing.certificate_enabled ?? true,
    });
    setStatus((existing.status as typeof status) || "draft");
    const loaded: DraftModule[] = (existing.modules || []).map((m) => ({
      id: m.id, _localId: m.id || localId("m"), title: m.title,
      nodes: (m.nodes || []).map((n) => ({ ...n, _localId: n.id || localId("n") })) as DraftNode[],
    }));
    setModules(loaded);
    const exp: Record<string, boolean> = {};
    for (const m of loaded) exp[m._localId] = true;
    setExpanded(exp);
    setHydrated(true);
  }, [editing, hydrated, existing]);

  // Lock lifecycle — explicit acquisition model.
  //
  // On mount we INSPECT the lock (GET /lock) so the UI knows whether someone
  // else holds it. We do NOT silently acquire. The user clicks "Take edit
  // lock" when they want to start editing — this matches the GitHub-style
  // collaboration request (no surprise concurrent edits).
  //
  // Exception: a course the creator just made via POST / has the lock
  // server-pre-granted (see backend course-create handler) — that initial GET
  // here picks it up so the new-course flow lands in the editor already
  // holding the lock without a click. Subsequent visits start read-only.
  //
  // While the lock is held → 60s heartbeat extends it.
  // While the lock is held by other → 30s poll picks up the moment they release.
  // On unmount / tab close → release if held (sendBeacon survives unload).
  useEffect(() => {
    if (!editing || !courseId || !userId) return;
    let alive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      try {
        const { lock } = await api.courses.getLock(courseId!);
        if (!alive) return;
        if (!lock || lock.expired) {
          setLockHeld(false); setLockHolderName(null); setLockExpiresAt(null);
        } else if (lock.heldBy === userId) {
          setLockHeld(true); setLockHolderName(null); setLockExpiresAt(lock.expiresAt);
        } else {
          setLockHeld(false); setLockHolderName(lock.holderName); setLockExpiresAt(lock.expiresAt);
        }
      } catch { /* ignore */ }
    }

    refresh();
    intervalId = setInterval(async () => {
      if (!alive) return;
      try {
        if (lockHeldRef.current) {
          // Hold-alive while editing.
          const hb = await api.courses.heartbeatLock(courseId!);
          if (!hb.held) await refresh();
          else if (hb.expires_at) setLockExpiresAt(hb.expires_at);
        } else {
          // Watch for the other holder releasing.
          await refresh();
        }
      } catch { /* network blip — next tick retries */ }
    }, lockHeldRef.current ? 60_000 : 30_000);

    function onBeforeUnload() {
      if (!lockHeldRef.current) return;
      try {
        const url = `${process.env.NEXT_PUBLIC_API_URL || "/api"}/courses/${courseId}/lock`;
        navigator.sendBeacon?.(url + "?_method=DELETE");
      } catch { /* best effort */ }
    }
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      alive = false;
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (intervalId) clearInterval(intervalId);
      if (lockHeldRef.current) api.courses.releaseLock(courseId!).catch(() => {});
    };
  }, [editing, courseId, userId]);

  // Explicit acquire. Bound to the "Take edit lock" button.
  const [lockBusy, setLockBusy] = useState(false);
  async function takeLock() {
    if (!courseId || !userId) return;
    setError(null); setLockBusy(true);
    try {
      const result = await api.courses.acquireLock(courseId);
      if (result.outcome === "acquired" && result.held_by === userId) {
        setLockHeld(true); setLockHolderName(null); setLockExpiresAt(result.expires_at);
      } else {
        setLockHeld(false);
        setLockHolderName(result.holder_name);
        setLockExpiresAt(result.expires_at);
        setError(`Locked by ${result.holder_name}. Try again when they release.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not take the lock");
    } finally { setLockBusy(false); }
  }
  async function dropLock() {
    if (!courseId) return;
    if (!confirm("Release the edit lock? You'll go back to read-only and any other collaborator can take it.")) return;
    setLockBusy(true);
    try {
      await api.courses.releaseLock(courseId);
      setLockHeld(false); setLockHolderName(null); setLockExpiresAt(null);
    } catch { /* ignore */ } finally { setLockBusy(false); }
  }

  // Brand-new course: start with one expanded module so the tree isn't empty.
  useEffect(() => {
    if (editing || modules.length > 0) return;
    const id = `m-${Date.now()}`;
    setModules([{ _localId: id, title: "Module 1", nodes: [] }]);
    setExpanded({ [id]: true });
  }, [editing, modules.length]);

  // For brand-new courses (no id yet) there's no lock to hold — first save
  // creates the course and the next mount will acquire. For existing courses,
  // a write action is only permitted when this client holds the lock.
  const canEdit = !editing || lockHeld;

  function guardEdit(): boolean {
    if (canEdit) return true;
    setError(lockHolderName
      ? `Locked by ${lockHolderName}. The page becomes editable once they release the lock.`
      : "Waiting on the edit lock — try again in a moment.");
    return false;
  }

  function selectCourse() { setSelected({ kind: "course" }); }
  function selectModule(localId: string) { setSelected({ kind: "module", localId }); }
  function selectLesson(moduleLocalId: string, nodeIndex: number) { setSelected({ kind: "lesson", moduleLocalId, nodeIndex }); }
  function toggleExpand(localId: string) { setExpanded((e) => ({ ...e, [localId]: !e[localId] })); }

  function addModule() {
    if (!guardEdit()) return;
    const id = `m-${Date.now()}`;
    setModules([...modules, { _localId: id, title: `Module ${modules.length + 1}`, nodes: [] }]);
    setExpanded((e) => ({ ...e, [id]: true }));
    setSelected({ kind: "module", localId: id });
  }

  function addLesson(moduleLocalId: string, type: CourseNode["type"]) {
    if (!guardEdit()) return;
    const mi = modules.findIndex((m) => m._localId === moduleLocalId);
    if (mi < 0) return;
    const m = modules[mi];
    const idx = m.nodes.length;
    const next = [...modules];
    next[mi] = { ...m, nodes: [...m.nodes, { type, title: `Lesson ${idx + 1}`, _local: true, _localId: localId("n") }] };
    setModules(next);
    setExpanded((e) => ({ ...e, [moduleLocalId]: true }));
    setSelected({ kind: "lesson", moduleLocalId, nodeIndex: idx });
    setAdderOpenFor(null);
  }

  function removeModule(localId: string) {
    if (!guardEdit()) return;
    if (!confirm("Delete this module and all its lessons?")) return;
    const m = modules.find((x) => x._localId === localId);
    if (!m) return;
    if (m.id) removedModuleIds.current.push(m.id);
    for (const n of m.nodes) if (n.id) removedNodeIds.current.push(n.id);
    setModules(modules.filter((x) => x._localId !== localId));
    if ("localId" in selected && selected.localId === localId) selectCourse();
    if (selected.kind === "lesson" && selected.moduleLocalId === localId) selectCourse();
  }

  function removeLesson(moduleLocalId: string, nodeIndex: number) {
    if (!guardEdit()) return;
    const mi = modules.findIndex((m) => m._localId === moduleLocalId);
    if (mi < 0) return;
    const m = modules[mi];
    const n = m.nodes[nodeIndex];
    if (!confirm(`Delete lesson "${n?.title || "Untitled"}"?`)) return;
    if (n?.id) removedNodeIds.current.push(n.id);
    const next = [...modules]; next[mi] = { ...m, nodes: m.nodes.filter((_, i) => i !== nodeIndex) };
    setModules(next);
    if (selected.kind === "lesson" && selected.moduleLocalId === moduleLocalId) selectModule(moduleLocalId);
  }

  function updateModuleTitle(localId: string, title: string) {
    setModules(modules.map((m) => (m._localId === localId ? { ...m, title } : m)));
  }
  function updateLesson(moduleLocalId: string, nodeIndex: number, next: Partial<CourseNode>) {
    const mi = modules.findIndex((m) => m._localId === moduleLocalId);
    if (mi < 0) return;
    // Merge onto the existing node so the stable _localId (drag identity) is kept
    // even though the editor only emits the editable CourseNode fields.
    const ms = [...modules]; const ns = [...ms[mi].nodes]; ns[nodeIndex] = { ...ns[nodeIndex], ...next }; ms[mi] = { ...ms[mi], nodes: ns };
    setModules(ms);
  }

  // ── Drag reorder ──
  // Reorder is local state; the new positions are persisted by index on the
  // next Save (saveAll writes position = array index). Selection is followed by
  // _localId so the open module/lesson stays selected after a move.
  function onModuleDragEnd(e: DragEndEvent) {
    if (!guardEdit()) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = modules.findIndex((m) => m._localId === active.id);
    const to = modules.findIndex((m) => m._localId === over.id);
    if (from < 0 || to < 0) return;
    setModules((ms) => arrayMove(ms, from, to));
  }

  function onLessonDragEnd(moduleLocalId: string, e: DragEndEvent) {
    if (!guardEdit()) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const mi = modules.findIndex((m) => m._localId === moduleLocalId);
    if (mi < 0) return;
    const nodes = modules[mi].nodes;
    const from = nodes.findIndex((n) => n._localId === active.id);
    const to = nodes.findIndex((n) => n._localId === over.id);
    if (from < 0 || to < 0) return;

    // Remember the selected lesson's stable id so we can follow it to its new index.
    const selectedLocalId =
      selected.kind === "lesson" && selected.moduleLocalId === moduleLocalId
        ? nodes[selected.nodeIndex]?._localId
        : null;

    const reordered = arrayMove(nodes, from, to);
    const next = [...modules];
    next[mi] = { ...modules[mi], nodes: reordered };
    setModules(next);

    if (selectedLocalId) {
      const newIndex = reordered.findIndex((n) => n._localId === selectedLocalId);
      if (newIndex >= 0) setSelected({ kind: "lesson", moduleLocalId, nodeIndex: newIndex });
    }
  }

  // Persist the whole draft. Idempotent: existing rows are updated (not re-created),
  // and the created server ids are written back into state.
  async function saveAll(): Promise<string | null> {
    const basics = {
      title: course.title, subtitle: course.subtitle, description: course.description,
      category_id: course.category_id, level: course.level, language: course.language, tags: course.tags,
      thumbnail_url: course.thumbnail_url, promo_video_url: course.promo_video_url,
      price: course.price, discounted_price: course.discounted_price, certificate_enabled: course.certificate_enabled,
    };
    let cid = course.id;
    if (!cid) { const created = await api.courses.create(basics); cid = created.id; }
    else { await api.courses.update(cid, basics); }

    for (const nid of removedNodeIds.current) { try { await api.courses.deleteNode(nid); } catch { /* already gone */ } }
    for (const mid of removedModuleIds.current) { try { await api.courses.deleteModule(mid); } catch { /* already gone */ } }
    removedNodeIds.current = []; removedModuleIds.current = [];

    const nextModules: DraftModule[] = [];
    for (let mi = 0; mi < modules.length; mi++) {
      const m = modules[mi];
      let mId = m.id;
      if (!mId) { const created = await api.courses.addModule(cid!, m.title); mId = (created as Module).id; }
      else { await api.courses.updateModule(mId, { title: m.title, position: mi }); }

      const nextNodes: DraftNode[] = [];
      for (let ni = 0; ni < m.nodes.length; ni++) {
        const n = m.nodes[ni];
        const body = nodeBody(n, `Lesson ${ni + 1}`);
        if (!n.id) {
          const created = await api.courses.addNode({ moduleId: mId!, ...body });
          // Keep the node's stable _localId so drag identity + selection survive the save.
          nextNodes.push({ ...created, _localId: n._localId });
        } else {
          await api.courses.updateNode(n.id, { ...body, position: ni });
          nextNodes.push({ ...n, ...body });
        }
      }
      // Carry over the local id so currently-selected module/lesson stays selected after save.
      nextModules.push({ id: mId, _localId: m._localId, title: m.title, nodes: nextNodes });
    }

    setCourse((c) => ({ ...c, id: cid }));
    setModules(nextModules);
    qc.invalidateQueries({ queryKey: ["creator-courses"] });
    if (cid) {
      qc.invalidateQueries({ queryKey: ["course-content", cid] });
      qc.invalidateQueries({ queryKey: ["course-detail", cid] });
    }
    return cid || null;
  }

  async function onSave() {
    if (course.title.trim().length < 3) {
      setError("Course title needs at least 3 characters before saving.");
      setSelected({ kind: "course" });
      return;
    }
    setError(null); setBusy(true);
    try {
      const wasNew = !course.id;
      const id = await saveAll();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
      // First save of a new course: switch URL to /edit/<id> so refresh keeps the work.
      if (wasNew && id && !editing) router.replace(`/creator/courses/${id}/edit`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  }

  async function onPublish(skipTermsCheck = false) {
    if (course.title.trim().length < 3) {
      setError("Course title needs at least 3 characters before publishing.");
      setSelected({ kind: "course" });
      return;
    }
    if (modules.every((m) => m.nodes.length === 0)) {
      setError("Add at least one lesson before publishing.");
      return;
    }
    if (!skipTermsCheck && termsStatus && !termsStatus.accepted) {
      setShowTerms(true);
      return;
    }
    setError(null); setPublishing(true);
    try {
      const wasNew = !course.id;
      const id = await saveAll();
      if (!id) throw new Error("Could not save course");
      const out = await api.courses.publish(id);
      setStatus((out.status as typeof status) || "published");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
      if (wasNew && !editing) router.replace(`/creator/courses/${id}/edit`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Publish failed";
      // Server-side gate fallback (e.g. terms version bumped mid-session).
      if (message.toLowerCase().includes("creator terms")) setShowTerms(true);
      setError(message);
    } finally { setPublishing(false); }
  }

  if (editing && loadingExisting && !hydrated) {
    return (<><Navbar variant="creator" /><div className="flex h-96 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-fg-dim" /></div></>);
  }

  const selectedModule =
    selected.kind === "module" ? modules.find((m) => m._localId === selected.localId)
    : selected.kind === "lesson" ? modules.find((m) => m._localId === selected.moduleLocalId)
    : undefined;
  const selectedLesson = selected.kind === "lesson" && selectedModule ? selectedModule.nodes[selected.nodeIndex] : undefined;

  return (
    <>
      <Navbar variant="creator" />
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/creator/courses")} className="btn-ghost">
              <ArrowLeft className="h-4 w-4" /> Courses
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="heading-3">{editing ? "Edit course" : "Create a course"}</h1>
                <StatusPill status={status} />
              </div>
              <p className="text-xs text-fg-dim">Click items in the explorer to edit them. Click + to add a module or lesson.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onSave} disabled={busy || publishing || !canEdit} className="btn-ghost disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : savedFlash && status !== "published" ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {busy ? "Saving…" : savedFlash && status !== "published" ? "Saved" : "Save draft"}
            </button>
            <button onClick={() => onPublish()} disabled={busy || publishing || !canEdit} className="btn-primary disabled:opacity-50">
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : savedFlash && status === "published" ? <Check className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
              {publishing ? "Publishing…" : status === "published" ? "Save & republish" : "Publish"}
            </button>
          </div>
        </div>

        {/* Edit-lock banner — explicit acquisition.
            Brand-new (unsaved) courses don't have a course id to lock against,
            so the banner only appears for existing courses. */}
        {editing && (
          <LockBanner
            lockHeld={lockHeld}
            holderName={lockHolderName}
            expiresAt={lockExpiresAt}
            busy={lockBusy}
            onTake={takeLock}
            onRelease={dropLock}
          />
        )}

        {showTerms && termsStatus && (
          <CreatorTermsModal
            status={termsStatus}
            onAccepted={() => { setShowTerms(false); onPublish(true); }}
            onClose={() => setShowTerms(false)}
          />
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[300px_1fr]">
          {/* Explorer */}
          <aside className="card sticky top-4 self-start p-0">
            <div className="flex items-center justify-between rounded-t-2xl border-b border-border bg-surface-2/60 px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-dim">Explorer</span>
              <button onClick={addModule} title="New module" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg-dim transition hover:bg-surface-2 hover:text-brand">
                <Plus className="h-3.5 w-3.5" /> Module
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto py-1 text-sm">
              {/* Course root */}
              <ExplorerRow
                indent={0}
                selected={selected.kind === "course"}
                onClick={selectCourse}
                icon={<BookOpen className="h-4 w-4 text-brand" />}
                label={course.title || "Untitled course"}
              />
              {/* Modules — drag the grip to reorder. Order is saved on Save. */}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onModuleDragEnd}>
              <SortableContext items={modules.map((m) => m._localId)} strategy={verticalListSortingStrategy}>
              {modules.map((m) => {
                const isOpen = !!expanded[m._localId];
                const moduleSelected = selected.kind === "module" && selected.localId === m._localId;
                const adderOpen = adderOpenFor === m._localId;
                return (
                  <div key={m._localId}>
                    <Sortable id={m._localId} disabled={!canEdit}>
                      {(dragHandle) => (
                      <>
                        <ExplorerRow
                          indent={1}
                          selected={moduleSelected}
                          onClick={() => selectModule(m._localId)}
                          onChevronClick={() => toggleExpand(m._localId)}
                          chevron={isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          icon={isOpen ? <FolderOpen className="h-4 w-4 text-amber-400" /> : <Folder className="h-4 w-4 text-amber-400" />}
                          label={m.title || "Untitled module"}
                          onDelete={() => removeModule(m._localId)}
                          dragHandle={dragHandle}
                        />
                    {isOpen && (
                      <>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onLessonDragEnd(m._localId, e)}>
                        <SortableContext items={m.nodes.map((n) => n._localId)} strategy={verticalListSortingStrategy}>
                        {m.nodes.map((n, ni) => {
                          const lessonSelected =
                            selected.kind === "lesson" && selected.moduleLocalId === m._localId && selected.nodeIndex === ni;
                          return (
                            <Sortable key={n._localId} id={n._localId} disabled={!canEdit}>
                              {(dragHandle) => (
                                <ExplorerRow
                                  indent={2}
                                  selected={lessonSelected}
                                  onClick={() => selectLesson(m._localId, ni)}
                                  icon={lessonIcon(n.type)}
                                  label={n.title || "Untitled lesson"}
                                  onDelete={() => removeLesson(m._localId, ni)}
                                  dragHandle={dragHandle}
                                />
                              )}
                            </Sortable>
                          );
                        })}
                        </SortableContext>
                        </DndContext>
                        {/* Inline lesson-type picker — rendered as a tree row so it
                            never gets clipped by sidebar overflow. */}
                        {!adderOpen ? (
                          <div className="pl-9 pr-3 py-1">
                            <button
                              onClick={() => setAdderOpenFor(m._localId)}
                              className="inline-flex items-center gap-1 text-xs text-fg-dim transition hover:text-brand"
                            >
                              <Plus className="h-3 w-3" /> Add lesson
                            </button>
                          </div>
                        ) : (
                          <div className="mx-2 my-1 ml-9 rounded-lg border border-border bg-surface-2/80 p-2">
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-dim">New lesson</span>
                              <button onClick={() => setAdderOpenFor(null)} className="text-[10px] text-fg-dim hover:text-fg">cancel</button>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {LESSON_TYPES.map((lt) => (
                                <button key={lt.type} onClick={() => addLesson(m._localId, lt.type)}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-fg-dim transition hover:border-brand hover:text-fg">
                                  {lt.icon} {lt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                      </>
                      )}
                    </Sortable>
                  </div>
                );
              })}
              </SortableContext>
              </DndContext>
              {modules.length === 0 && (
                <p className="px-4 py-6 text-xs text-fg-dim">No modules yet. Click <span className="text-brand">+ Module</span> above to create one.</p>
              )}
            </div>
          </aside>

          {/* Editor pane */}
          <section className="min-w-0">
            {selected.kind === "course" && (
              <>
                <CoursePanel course={course} setCourse={setCourse} categories={categories || []} courseId={courseId} canEdit={canEdit} />
                {editing && courseId && userId && (
                  <div className="mt-4">
                    <CollaboratorPanel courseId={courseId} viewerId={userId} ownerId={existing?.creator_id || userId} canEdit={canEdit} />
                  </div>
                )}
              </>
            )}
            {selected.kind === "module" && selectedModule && (
              <ModulePanel
                module={selectedModule}
                onTitleChange={(t) => updateModuleTitle(selectedModule._localId, t)}
                onSelectLesson={(ni) => selectLesson(selectedModule._localId, ni)}
                onAddLesson={(t) => addLesson(selectedModule._localId, t)}
              />
            )}
            {selected.kind === "lesson" && selectedModule && selectedLesson && (
              <LessonPanel
                key={`${selectedModule._localId}-${selected.nodeIndex}`}
                value={selectedLesson}
                onChange={(n) => updateLesson(selectedModule._localId, selected.nodeIndex, n)}
              />
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}

// ──────────────────────────── Explorer row ────────────────────────────

function ExplorerRow({
  indent, selected, onClick, onChevronClick, chevron, icon, label, onDelete, dragHandle,
}: {
  indent: 0 | 1 | 2;
  selected: boolean;
  onClick: () => void;
  onChevronClick?: () => void;
  chevron?: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  onDelete?: () => void;
  dragHandle?: React.ReactNode;
}) {
  const padLeft = indent === 0 ? "pl-3" : indent === 1 ? "pl-3" : "pl-9";
  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 pr-2 py-1 cursor-pointer transition",
        padLeft,
        selected ? "bg-brand/10 text-fg border-l-2 border-brand" : "border-l-2 border-transparent hover:bg-surface-2/60",
      )}
      onClick={onClick}
    >
      {dragHandle}
      {indent === 1 ? (
        <button
          onClick={(e) => { e.stopPropagation(); onChevronClick?.(); }}
          className="flex h-4 w-4 items-center justify-center text-fg-dim hover:text-fg"
        >{chevron}</button>
      ) : indent === 2 && !dragHandle ? <span className="w-4" /> : null}
      <span className="shrink-0">{icon}</span>
      <span className="truncate flex-1">{label}</span>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-fg-dim hover:text-danger transition"
          title="Delete"
        ><Trash2 className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
}

// Sortable wrapper for a tree row. Exposes the drag handle props via render-prop
// so only the grip starts a drag — clicking the row label still selects it.
function Sortable({
  id, disabled, children,
}: {
  id: string;
  disabled?: boolean;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 20 : undefined,
    position: isDragging ? "relative" : undefined,
  };
  const handle = disabled ? null : (
    <button
      {...attributes}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
      className="flex h-4 w-4 shrink-0 cursor-grab items-center justify-center text-fg-dim opacity-40 transition hover:text-fg group-hover:opacity-100 active:cursor-grabbing"
      title="Drag to reorder"
      aria-label="Drag to reorder"
    ><GripVertical className="h-3.5 w-3.5" /></button>
  );
  return <div ref={setNodeRef} style={style}>{children(handle)}</div>;
}

// ──────────────────────────── Course panel ────────────────────────────

function CoursePanel({
  course, setCourse, categories, courseId, canEdit,
}: {
  course: DraftCourse;
  setCourse: React.Dispatch<React.SetStateAction<DraftCourse>>;
  categories: { id: string; name: string }[];
  courseId?: string;
  canEdit?: boolean;
}) {
  return (
    <div className="space-y-4">
      <Section title="Basics">
        <Field label="Title (max 80 chars)">
          <input maxLength={80} value={course.title} onChange={(e) => setCourse({ ...course, title: e.target.value })} className="input" placeholder="Data Structures with TypeScript" />
        </Field>
        <Field label="Subtitle (max 120 chars)">
          <input maxLength={120} value={course.subtitle} onChange={(e) => setCourse({ ...course, subtitle: e.target.value })} className="input" placeholder="One-line hook" />
        </Field>
        <Field label="Description">
          <textarea rows={6} value={course.description} onChange={(e) => setCourse({ ...course, description: e.target.value })} className="input min-h-[140px]" placeholder="What will learners learn?" />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Category">
            <select value={course.category_id || ""} onChange={(e) => setCourse({ ...course, category_id: e.target.value || undefined })} className="input">
              <option value="">Choose…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Level">
            <select value={course.level} onChange={(e) => setCourse({ ...course, level: e.target.value as DraftCourse["level"] })} className="input">
              <option>Beginner</option><option>Intermediate</option><option>Advanced</option><option>All Levels</option>
            </select>
          </Field>
          <Field label="Language"><input value={course.language} onChange={(e) => setCourse({ ...course, language: e.target.value })} className="input" /></Field>
          <Field label="Tags (comma separated)">
            <input value={course.tags.join(", ")} onChange={(e) => setCourse({ ...course, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10) })} className="input" placeholder="typescript, dsa" />
          </Field>
        </div>
      </Section>

      <Section title="Media">
        {course.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.thumbnail_url} alt="Course thumbnail" className="h-36 w-64 rounded-xl border border-border object-cover" />
        )}
        {courseId ? (
          <FileUpload
            label="Course thumbnail"
            compact
            accept="image/jpeg,image/png,image/webp"
            maxBytes={5 * 1024 * 1024}
            hint="JPG / PNG / WEBP · max 5 MB · recommended 1280×720"
            disabled={canEdit === false}
            onUpload={async (file, onProgress) => {
              const result = await api.courses.uploadThumbnail(courseId, file, onProgress);
              setCourse((c) => ({ ...c, thumbnail_url: result.url }));
            }}
          />
        ) : (
          <p className="text-xs text-fg-dim">Save the course once to enable thumbnail upload, or paste an image URL below.</p>
        )}
        <Field label="Course thumbnail URL" hint="Recommended 1280×720. Filled automatically when you upload an image.">
          <input value={course.thumbnail_url || ""} onChange={(e) => setCourse({ ...course, thumbnail_url: e.target.value || undefined })} className="input" placeholder="https://…" />
        </Field>
        <Field label="Promotional video URL (optional)">
          <input value={course.promo_video_url || ""} onChange={(e) => setCourse({ ...course, promo_video_url: e.target.value || undefined })} className="input" placeholder="https://youtu.be/…" />
        </Field>
      </Section>

      <Section title="Pricing">
        <div className="grid gap-3 md:grid-cols-2">
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${course.price > 0 ? "border-brand bg-surface-2" : "border-border bg-surface-2"}`}>
            <input type="radio" checked={course.price > 0} onChange={() => setCourse({ ...course, price: course.price > 0 ? course.price : 999 })} className="mt-1" />
            <div><p className="font-medium">Paid</p><p className="text-xs text-fg-dim">Set a price. Platform keeps 15%.</p></div>
          </label>
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${course.price === 0 ? "border-brand bg-surface-2" : "border-border bg-surface-2"}`}>
            <input type="radio" checked={course.price === 0} onChange={() => setCourse({ ...course, price: 0, discounted_price: undefined })} className="mt-1" />
            <div><p className="font-medium">Free</p><p className="text-xs text-fg-dim">Anyone can enroll instantly.</p></div>
          </label>
        </div>
        {course.price > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Price (INR)"><input type="number" min={49} className="input" value={course.price} onChange={(e) => setCourse({ ...course, price: Number(e.target.value) })} /></Field>
            <Field label="Discounted price (optional)"><input type="number" className="input" value={course.discounted_price ?? ""} onChange={(e) => setCourse({ ...course, discounted_price: e.target.value ? Number(e.target.value) : undefined })} /></Field>
          </div>
        )}
      </Section>

      <Section title="Settings">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={course.certificate_enabled} onChange={(e) => setCourse({ ...course, certificate_enabled: e.target.checked })} className="accent-[color:var(--brand-primary)]" />
          Issue certificate on completion
        </label>
      </Section>
    </div>
  );
}

// ──────────────────────────── Module panel ────────────────────────────

function ModulePanel({
  module: m, onTitleChange, onSelectLesson, onAddLesson,
}: {
  module: DraftModule;
  onTitleChange: (t: string) => void;
  onSelectLesson: (idx: number) => void;
  onAddLesson: (t: CourseNode["type"]) => void;
}) {
  return (
    <div className="space-y-4">
      <Section title="Module">
        <Field label="Module title">
          <input value={m.title} onChange={(e) => onTitleChange(e.target.value)} className="input" placeholder="e.g. Foundations" />
        </Field>
      </Section>
      <Section title={`Lessons (${m.nodes.length})`}>
        {m.nodes.length === 0 ? (
          <p className="text-xs text-fg-dim">No lessons yet. Add one using a button below — or via <span className="text-brand">+ Add lesson</span> in the explorer.</p>
        ) : (
          <ul className="space-y-1">
            {m.nodes.map((n, ni) => (
              <li key={n.id || ni}>
                <button onClick={() => onSelectLesson(ni)} className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-sm transition hover:border-brand">
                  {lessonIcon(n.type)} <span className="flex-1 truncate">{n.title || `Lesson ${ni + 1}`}</span>
                  <span className="text-[10px] uppercase tracking-widest text-fg-dim">{n.type || "video"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          {LESSON_TYPES.map((lt) => (
            <button key={lt.type} onClick={() => onAddLesson(lt.type)} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg-dim transition hover:border-brand hover:text-fg">
              <Plus className="h-3 w-3" /> {lt.icon} {lt.label}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ──────────────────────────── Lesson panel ────────────────────────────

function LessonPanel({ value, onChange }: { value: DraftNode; onChange: (n: Partial<CourseNode>) => void }) {
  return (
    <div className="card">
      <NodeEditor value={value} onChange={onChange} />
    </div>
  );
}

// ──────────────────────────── Layout helpers ────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-fg-dim">{title}</p>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function StatusPill({ status }: { status: "draft" | "under_review" | "published" | "archived" }) {
  const map = {
    draft:        { label: "Draft",         cls: "bg-surface-2 text-fg-dim border-border" },
    under_review: { label: "Under review",  cls: "bg-amber-400/15 text-amber-300 border-amber-400/30" },
    published:    { label: "Published",     cls: "bg-success/15 text-success border-success/30" },
    archived:     { label: "Archived",      cls: "bg-surface-2 text-fg-dim border-border" },
  } as const;
  const m = map[status];
  return <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest", m.cls)}>{m.label}</span>;
}

/**
 * Edit-lock banner. Three states, one component:
 *  - lockHeld → green "You're editing" with [Release lock] button + countdown.
 *  - locked by other → amber "Locked by X" + advisory text; no action.
 *  - unlocked, nobody holds it → neutral "Take edit lock to start editing"
 *    with the explicit [Take edit lock] button.
 * The button is the explicit GitHub-style request to start editing — the
 * page stays read-only until clicked, and the owner has to wait their turn
 * just like any collaborator.
 */
function LockBanner({
  lockHeld, holderName, expiresAt, busy, onTake, onRelease,
}: {
  lockHeld: boolean;
  holderName: string | null;
  expiresAt: string | null;
  busy: boolean;
  onTake: () => void;
  onRelease: () => void;
}) {
  if (lockHeld) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
        <Lock className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold">You hold the edit lock</p>
          <p className="mt-0.5 text-xs text-success/80">
            Save and publish freely.{expiresAt && <> Auto-releases if idle for 10 minutes (current expiry {relativeTime(expiresAt)}).</>} Release the lock when done so others can edit.
          </p>
        </div>
        <button onClick={onRelease} disabled={busy} className="btn-ghost text-xs disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
          Release lock
        </button>
      </div>
    );
  }
  if (holderName) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-300">
        <Lock className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold">Locked — read-only</p>
          <p className="mt-0.5 text-xs text-amber-300/80">
            <b>{holderName}</b> is editing this course right now.
            {expiresAt && <> The lock expires {relativeTime(expiresAt)} if they leave it idle.</>} You can take over once they release it.
          </p>
        </div>
        <button onClick={onTake} disabled={busy} className="btn-ghost text-xs disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Try to take
        </button>
      </div>
    );
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2/40 p-3 text-sm">
      <Lock className="h-4 w-4 shrink-0 text-fg-dim" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold">Read-only</p>
        <p className="mt-0.5 text-xs text-fg-dim">
          Take the edit lock to start editing. Only one collaborator can edit at a time — others see this page read-only until you release.
        </p>
      </div>
      <button onClick={onTake} disabled={busy} className="btn-primary text-xs disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
        Take edit lock
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg-dim">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-dim">{hint}</span>}
    </label>
  );
}

// ──────────────────────────── Collaborator panel ────────────────────────────

function CollaboratorPanel({
  courseId, viewerId, ownerId, canEdit,
}: {
  courseId: string;
  viewerId: string;
  ownerId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const isOwner = viewerId === ownerId;
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  const { data: collaborators, isLoading } = useQuery({
    queryKey: ["collaborators", courseId],
    queryFn: () => api.courses.listCollaborators(courseId),
  });

  const { data: searchResults } = useQuery({
    // activeOnly:false — the public /creators directory hides creators with
    // zero published courses, but for collaborator invites we want every
    // creator on the platform (you might be the one bringing them into
    // their first course).
    queryKey: ["creator-search-all", debouncedQuery],
    queryFn: ({ signal }) => api.search.creators({ q: debouncedQuery, limit: 8, activeOnly: false }, signal),
    enabled: searchOpen && !!debouncedQuery,
  });

  const invite = useMutation({
    mutationFn: (userId: string) => api.courses.inviteCollaborator(courseId, userId),
    onSuccess: () => {
      setQuery(""); setSearchOpen(false);
      qc.invalidateQueries({ queryKey: ["collaborators", courseId] });
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.courses.removeCollaborator(courseId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collaborators", courseId] }),
  });

  // Hide existing collaborators (any non-removed status) and self from the
  // search results so the picker doesn't suggest people who can't be added.
  const existingUserIds = new Set([ownerId, ...(collaborators || []).filter((c) => c.status !== "removed").map((c) => c.user_id)]);
  const candidates = (searchResults || []).filter((c: CreatorListing) => !existingUserIds.has(c.user_id));

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-fg-dim">Collaborators</p>
          <p className="text-xs text-fg-dim">Co-creators get full edit access. Only one collaborator can edit at a time — the rest see read-only.</p>
        </div>
        {isOwner && canEdit && (
          <button onClick={() => setSearchOpen((v) => !v)} className="btn-primary text-xs">
            <UserPlus className="h-3.5 w-3.5" /> Invite
          </button>
        )}
      </div>

      {searchOpen && (
        <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-dim" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
              placeholder="Search creators by name or username…" className="input pl-9 text-sm" />
          </div>
          {debouncedQuery && candidates.length === 0 && (
            <p className="mt-3 text-xs text-fg-dim">No creators match. The user must be a creator and not already on the course.</p>
          )}
          {candidates.length > 0 && (
            <ul className="mt-3 space-y-1">
              {candidates.map((c) => (
                <li key={c.user_id}>
                  <button
                    onClick={() => invite.mutate(c.user_id)}
                    disabled={invite.isPending}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-2 text-left transition hover:border-brand disabled:opacity-50"
                  >
                    <Avatar name={c.display_name} src={c.avatar_url || avatarUrl(c.username)} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.display_name}</p>
                      <p className="truncate text-[11px] text-fg-dim">@{c.username}</p>
                    </div>
                    <span className="text-xs text-brand">Invite</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {/* Owner row first, then collaborators. */}
        <li className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/40 p-2">
          <Avatar name="Owner" src={avatarUrl(ownerId)} size={32} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{ownerId === viewerId ? "You" : "Course owner"}</p>
            <p className="text-[11px] text-fg-dim">Owner — full rights</p>
          </div>
          <span className="chip border-brand/30 text-brand">Owner</span>
        </li>

        {isLoading ? (
          <li className="text-center text-xs text-fg-dim"><Loader2 className="inline h-3 w-3 animate-spin" /> Loading…</li>
        ) : (
          (collaborators || [])
            .filter((c: Collaborator) => c.status !== "removed" && c.user_id !== ownerId)
            .map((c: Collaborator) => {
              const isSelf = c.user_id === viewerId;
              return (
                <li key={c.user_id} className="flex items-center gap-3 rounded-lg border border-border p-2">
                  <Avatar
                    name={c.profiles?.display_name || "Collaborator"}
                    src={c.profiles?.avatar_url || avatarUrl(c.user_id)}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.profiles?.display_name || "Collaborator"}{isSelf ? " (you)" : ""}</p>
                    <p className="truncate text-[11px] text-fg-dim">
                      {c.status === "pending" ? `Invited ${relativeTime(c.invited_at)}` : `Joined ${relativeTime(c.responded_at || c.invited_at)}`}
                    </p>
                  </div>
                  <StatusChip status={c.status} />
                  {(isOwner || isSelf) && canEdit && (
                    <button
                      onClick={() => {
                        const label = isSelf ? "Leave this course?" : `Remove ${c.profiles?.display_name || "this collaborator"}?`;
                        if (confirm(label)) remove.mutate(c.user_id);
                      }}
                      className="text-xs text-fg-dim hover:text-danger"
                    >
                      {isSelf ? "Leave" : "Remove"}
                    </button>
                  )}
                </li>
              );
            })
        )}
        {(collaborators || []).filter((c) => c.status !== "removed" && c.user_id !== ownerId).length === 0 && !isLoading && (
          <li className="text-center text-xs text-fg-dim">No collaborators yet.</li>
        )}
      </ul>
    </div>
  );
}

function StatusChip({ status }: { status: Collaborator["status"] }) {
  const map = {
    pending:  { label: "Pending",  cls: "border-amber-400/30 text-amber-300" },
    accepted: { label: "Editor",   cls: "border-success/30 text-success" },
    declined: { label: "Declined", cls: "border-border text-fg-dim" },
    removed:  { label: "Removed",  cls: "border-border text-fg-dim" },
  } as const;
  const m = map[status];
  return <span className={cn("chip", m.cls)}>{m.label}</span>;
}

