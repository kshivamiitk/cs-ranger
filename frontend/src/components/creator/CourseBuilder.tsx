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
import { CourseShareButton } from "@/components/common/CourseShareButton";
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
  certificate_min_progress: number;
  certificate_require_quiz_pass: boolean;
  certificate_template: { heading?: string; body?: string; accentColor?: string; footerNote?: string };
}
interface DraftNode extends Partial<CourseNode> { _local?: boolean; _localId: string; _parentLocalId?: string }
interface DraftModule { id?: string; _localId: string; title: string; nodes: DraftNode[] }
type DraftNodeTree = Omit<DraftNode, "children"> & { children: DraftNodeTree[]; _index: number };
type OrderedDraftNode = DraftNodeTree & { _siblingPosition: number };

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
  { type: "folder", label: "Folder", icon: <Folder className="h-3.5 w-3.5" /> },
];

function lessonIcon(t?: CourseNode["type"]) {
  return LESSON_TYPES.find((x) => x.type === t)?.icon ?? <FileText className="h-3.5 w-3.5" />;
}

function nodeBody(n: DraftNode, fallbackTitle: string, parentNodeId = n.parent_node_id) {
  return {
    type: (n.type || "video") as CourseNode["type"],
    title: n.title || fallbackTitle,
    parent_node_id: parentNodeId,
    duration_seconds: n.duration_seconds,
    is_free_preview: n.is_free_preview,
    video_url: n.video_url, video_provider: n.video_provider,
    video_chapters: n.video_chapters, video_subtitles: n.video_subtitles,
    markdown: n.markdown, pdf_url: n.pdf_url,
    static_website: n.static_website, quiz_payload: n.quiz_payload,
  };
}

function buildDraftNodeTree(nodes: DraftNode[]): DraftNodeTree[] {
  const clones = nodes.map((node, index) => ({ ...node, children: [] as DraftNodeTree[], _index: index }));
  const byId = new Map<string, DraftNodeTree>();
  const byLocalId = new Map<string, DraftNodeTree>();
  for (const node of clones) {
    if (node.id) byId.set(node.id, node);
    byLocalId.set(node._localId, node);
  }
  const roots: DraftNodeTree[] = [];
  for (const node of clones) {
    const parent =
      (node._parentLocalId ? byLocalId.get(node._parentLocalId) : null) ||
      (node.parent_node_id ? byId.get(node.parent_node_id) : null);
    if (parent && parent._localId !== node._localId) parent.children.push(node);
    else roots.push(node);
  }
  const sortSiblings = (items: DraftNodeTree[]) => {
    items.sort((a, b) => {
      const aPos = Number.isFinite(a.position) ? Number(a.position) : a._index;
      const bPos = Number.isFinite(b.position) ? Number(b.position) : b._index;
      return aPos - bPos || a._index - b._index;
    });
    for (const item of items) sortSiblings(item.children);
  };
  sortSiblings(roots);
  return roots;
}

function flattenDraftNodeTree(nodes: DraftNodeTree[], out: OrderedDraftNode[] = []): OrderedDraftNode[] {
  nodes.forEach((node, position) => {
    out.push({ ...node, _siblingPosition: position });
    flattenDraftNodeTree(node.children, out);
  });
  return out;
}

function stripTreeFields(node: OrderedDraftNode): DraftNode {
  const { children: _children, _index: _index, _siblingPosition: _siblingPosition, ...draftNode } = node;
  return draftNode;
}

function descendantNodeRefs(nodes: DraftNode[], root: DraftNode): { localIds: Set<string>; serverIds: Set<string> } {
  const localIds = new Set<string>([root._localId]);
  const serverIds = new Set<string>();
  if (root.id) serverIds.add(root.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (localIds.has(node._localId)) continue;
      const isLocalChild = !!node._parentLocalId && localIds.has(node._parentLocalId);
      const isServerChild = !!node.parent_node_id && serverIds.has(node.parent_node_id);
      if (isLocalChild || isServerChild) {
        localIds.add(node._localId);
        if (node.id) serverIds.add(node.id);
        changed = true;
      }
    }
  }
  return { localIds, serverIds };
}

/**
 * Course create + edit, VS Code–style. Left pane is a file-explorer tree
 * (course → modules → lessons); right pane edits whatever you select.
 * Modules cannot nest inside modules; folders can nest lessons/folders inside
 * a module so imported courses can keep their real file structure.
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
    certificate_min_progress: 100,
    certificate_require_quiz_pass: false,
    certificate_template: {},
  });
  const [modules, setModules] = useState<DraftModule[]>([]);
  const [selected, setSelected] = useState<Selection>({ kind: "course" });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [adderOpenFor, setAdderOpenFor] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
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
      certificate_min_progress: existing.certificate_min_progress ?? 100,
      certificate_require_quiz_pass: existing.certificate_require_quiz_pass ?? false,
      certificate_template: existing.certificate_template || {},
    });
    setStatus((existing.status as typeof status) || "draft");
    const loaded: DraftModule[] = (existing.modules || []).map((m) => ({
      id: m.id, _localId: m.id || localId("m"), title: m.title,
      nodes: (m.nodes || []).map((n) => ({ ...n, _localId: n.id || localId("n") })) as DraftNode[],
    }));
    setModules(loaded);
    const exp: Record<string, boolean> = {};
    for (const m of loaded) {
      exp[m._localId] = true;
      for (const n of m.nodes) if (n.type === "folder") exp[n._localId] = true;
    }
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

  function addLesson(moduleLocalId: string, type: CourseNode["type"], parent?: { id?: string; _localId: string }) {
    if (!guardEdit()) return;
    const mi = modules.findIndex((m) => m._localId === moduleLocalId);
    if (mi < 0) return;
    const m = modules[mi];
    const idx = m.nodes.length;
    const next = [...modules];
    const parent_node_id = parent?.id;
    const _parentLocalId = parent?._localId;
    const nodeLocalId = localId("n");
    next[mi] = {
      ...m,
      nodes: [...m.nodes, { type, parent_node_id, _parentLocalId, title: type === "folder" ? `Folder ${idx + 1}` : `Lesson ${idx + 1}`, _local: true, _localId: nodeLocalId }],
    };
    setModules(next);
    setExpanded((e) => ({ ...e, [moduleLocalId]: true, ...(parent ? { [parent._localId]: true } : {}) }));
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
    if (!confirm(`Delete ${n?.type === "folder" ? "folder" : "lesson"} "${n?.title || "Untitled"}"?${n?.type === "folder" ? " This also deletes everything inside it." : ""}`)) return;
    const refsToRemove = n ? descendantNodeRefs(m.nodes, n) : { localIds: new Set<string>(), serverIds: new Set<string>() };
    for (const id of refsToRemove.serverIds) removedNodeIds.current.push(id);
    const next = [...modules];
    next[mi] = {
      ...m,
      nodes: m.nodes.filter((node, i) => i !== nodeIndex && !refsToRemove.localIds.has(node._localId)),
    };
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

  // Reorder a node within its container (the module root, or a folder). Each
  // container is its own drag context (see ExplorerNodeTree), so `activeId` and
  // `overId` are ALWAYS siblings — a lesson can never be dragged out of its
  // folder. We find that sibling group, re-sort it, and rewrite only its
  // `position` values. The flat `nodes` array order is unchanged, so node
  // indices (and the current selection) stay valid; buildDraftNodeTree re-sorts
  // siblings by the new positions on the next render.
  function onNodeReorder(moduleLocalId: string, activeId: string, overId: string) {
    if (!guardEdit()) return;
    if (!activeId || !overId || activeId === overId) return;
    setModules((ms) => ms.map((m) => {
      if (m._localId !== moduleLocalId) return m;
      const newPos = new Map<string, number>();
      const walk = (siblings: DraftNodeTree[]): boolean => {
        const from = siblings.findIndex((n) => n._localId === activeId);
        const to = siblings.findIndex((n) => n._localId === overId);
        if (from >= 0 && to >= 0) {
          arrayMove(siblings, from, to).forEach((n, i) => newPos.set(n._localId, i));
          return true;
        }
        return siblings.some((n) => walk(n.children));
      };
      walk(buildDraftNodeTree(m.nodes));
      if (newPos.size === 0) return m;
      return { ...m, nodes: m.nodes.map((n) => (newPos.has(n._localId) ? { ...n, position: newPos.get(n._localId)! } : n)) };
    }));
  }

  // Persist the whole draft. Idempotent: existing rows are updated (not re-created),
  // and the created server ids are written back into state.
  async function saveAll(): Promise<string | null> {
    const selectedNodeLocalId =
      selected.kind === "lesson"
        ? modules.find((m) => m._localId === selected.moduleLocalId)?.nodes[selected.nodeIndex]?._localId
        : null;
    const basics = {
      title: course.title, subtitle: course.subtitle, description: course.description,
      category_id: course.category_id, level: course.level, language: course.language, tags: course.tags,
      thumbnail_url: course.thumbnail_url, promo_video_url: course.promo_video_url,
      price: course.price, discounted_price: course.discounted_price, certificate_enabled: course.certificate_enabled,
      certificate_min_progress: course.certificate_min_progress,
      certificate_require_quiz_pass: course.certificate_require_quiz_pass,
      certificate_template: course.certificate_template,
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
      const serverIdByLocalId = new Map<string, string>();
      for (const node of m.nodes) {
        if (node.id) serverIdByLocalId.set(node._localId, node.id);
      }

      const orderedNodes = flattenDraftNodeTree(buildDraftNodeTree(m.nodes));
      for (let ni = 0; ni < orderedNodes.length; ni++) {
        const n = orderedNodes[ni];
        const parentNodeId = n._parentLocalId
          ? serverIdByLocalId.get(n._parentLocalId)
          : n.parent_node_id;
        if (n._parentLocalId && !parentNodeId) {
          throw new Error(`Could not save "${n.title || "Untitled"}" because its parent folder is missing.`);
        }
        const draftNode = stripTreeFields(n);
        const body = nodeBody(draftNode, `Lesson ${ni + 1}`, parentNodeId);
        if (!n.id) {
          const created = await api.courses.addNode({ moduleId: mId!, ...body });
          // Keep the node's stable _localId so drag identity + selection survive the save.
          serverIdByLocalId.set(n._localId, created.id);
          nextNodes.push({ ...created, _localId: n._localId, _parentLocalId: n._parentLocalId });
        } else {
          await api.courses.updateNode(n.id, { ...body, position: n._siblingPosition });
          serverIdByLocalId.set(n._localId, n.id);
          nextNodes.push({ ...draftNode, ...body });
        }
      }
      // Carry over the local id so currently-selected module/lesson stays selected after save.
      nextModules.push({ id: mId, _localId: m._localId, title: m.title, nodes: nextNodes });
    }

    setCourse((c) => ({ ...c, id: cid }));
    setModules(nextModules);
    if (selected.kind === "lesson" && selectedNodeLocalId) {
      const nextModule = nextModules.find((m) => m._localId === selected.moduleLocalId);
      const nextIndex = nextModule?.nodes.findIndex((node) => node._localId === selectedNodeLocalId) ?? -1;
      if (nextIndex >= 0) setSelected({ kind: "lesson", moduleLocalId: selected.moduleLocalId, nodeIndex: nextIndex });
    }
    qc.invalidateQueries({ queryKey: ["creator-courses"] });
    if (cid) {
      qc.invalidateQueries({ queryKey: ["course-content", cid] });
      qc.invalidateQueries({ queryKey: ["course-detail", cid] });
    }
    return cid || null;
  }

  async function onSave() {
    setStorageBlocked(false);
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
      const message = e instanceof Error ? e.message : "Save failed";
      if (message.toLowerCase().includes("storage quota")) setStorageBlocked(true);
      setError(message);
    } finally { setBusy(false); }
  }

  async function onPublish(skipTermsCheck = false) {
    setStorageBlocked(false);
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
      if (message.toLowerCase().includes("storage quota")) setStorageBlocked(true);
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
            {course.id && <CourseShareButton courseId={course.id} label="Copy link" showViewLink />}
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
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            <div className="flex min-w-0 items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            {storageBlocked && (
              <a href="/creator/storage" className="shrink-0 rounded-md border border-danger/30 px-2 py-1 text-xs font-medium hover:bg-danger/10">
                Buy storage
              </a>
            )}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[320px_minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* Explorer */}
          <aside className="card sticky top-4 self-start p-0">
            <div className="flex items-center justify-between rounded-t-2xl border-b border-border bg-surface-2/60 px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-dim">Explorer</span>
              <button
                onClick={addModule}
                disabled={!canEdit}
                title="New module"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-fg-dim transition hover:bg-surface-2 hover:text-brand disabled:pointer-events-none disabled:opacity-40"
              >
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
                variant="course"
              />
              {/* Modules — drag the grip to reorder. Order is saved on Save. */}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onModuleDragEnd}>
              <SortableContext items={modules.map((m) => m._localId)} strategy={verticalListSortingStrategy}>
              {modules.map((m) => {
                const isOpen = !!expanded[m._localId];
                const moduleSelected = selected.kind === "module" && selected.localId === m._localId;
                const adderKey = `module:${m._localId}`;
                const adderOpen = adderOpenFor === adderKey;
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
                          variant="module"
                          onAdd={canEdit ? () => setAdderOpenFor(adderKey) : undefined}
                          addTitle="Add at module root"
                          onDelete={canEdit ? () => removeModule(m._localId) : undefined}
                          dragHandle={dragHandle}
                        />
                    {isOpen && (
                      <>
                        <ExplorerNodeTree
                          moduleLocalId={m._localId}
                          nodes={buildDraftNodeTree(m.nodes)}
                          selected={selected}
                          expanded={expanded}
                          canEdit={canEdit}
                          onSelect={selectLesson}
                          onToggle={toggleExpand}
                          onDelete={removeLesson}
                          onAddChild={addLesson}
                          onReorder={onNodeReorder}
                          adderOpenFor={adderOpenFor}
                          setAdderOpenFor={setAdderOpenFor}
                        />
                        {adderOpen ? (
                          <AddNodePicker
                            open={adderOpen}
                            onClose={() => setAdderOpenFor(null)}
                            onAdd={(type) => addLesson(m._localId, type)}
                            indent={2}
                          />
                        ) : null}
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
                onAddChild={selectedLesson.type === "folder" && canEdit
                  ? (type) => addLesson(selectedModule._localId, type, selectedLesson)
                  : undefined}
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
  indent, selected, onClick, onChevronClick, chevron, icon, label, onAdd, addTitle, onDelete, dragHandle, variant = "lesson",
}: {
  indent: number;
  selected: boolean;
  onClick: () => void;
  onChevronClick?: () => void;
  chevron?: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  onAdd?: () => void;
  addTitle?: string;
  onDelete?: () => void;
  dragHandle?: React.ReactNode;
  variant?: "course" | "module" | "folder" | "lesson";
}) {
  const isCourse = variant === "course";
  const isModule = variant === "module";
  const isFolder = variant === "folder";
  return (
    <div
      className={cn(
        "group relative mx-1 flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg py-1 pr-16 transition",
        selected ? "bg-brand/15 text-fg ring-1 ring-brand/35" : "text-fg-dim hover:bg-surface-2/70 hover:text-fg",
        isCourse && "font-semibold text-fg",
        isModule && "font-medium text-fg",
        isFolder && "text-[13px]",
      )}
      style={{ paddingLeft: indent === 0 ? 12 : 8 + indent * 16 }}
      onClick={onClick}
    >
      {dragHandle}
      {onChevronClick ? (
        <button
          onClick={(e) => { e.stopPropagation(); onChevronClick?.(); }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg-dim transition hover:bg-surface hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/60"
        >{chevron}</button>
      ) : indent > 0 && !dragHandle ? <span className="h-5 w-5 shrink-0" /> : null}
      <span className={cn("shrink-0", isFolder && "opacity-90")}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {(onAdd || onDelete) ? (
        <span className="absolute right-2 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          {onAdd ? (
            <ExplorerActionButton title={addTitle || "Add"} onClick={onAdd}>
              <Plus className="h-3.5 w-3.5" />
            </ExplorerActionButton>
          ) : null}
          {onDelete ? (
            <ExplorerActionButton title="Delete" onClick={onDelete} danger>
              <Trash2 className="h-3.5 w-3.5" />
            </ExplorerActionButton>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function ExplorerActionButton({
  title, onClick, danger, children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md bg-surface/90 text-fg-dim shadow-sm ring-1 ring-border transition hover:text-brand focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/70",
        danger && "hover:text-danger focus-visible:ring-danger/60",
      )}
    >
      {children}
    </button>
  );
}

function ExplorerNodeTree({
  moduleLocalId, nodes, selected, expanded, canEdit, onSelect, onToggle, onDelete, onAddChild, onReorder, adderOpenFor, setAdderOpenFor, depth = 2,
}: {
  moduleLocalId: string;
  nodes: DraftNodeTree[];
  selected: Selection;
  expanded: Record<string, boolean>;
  canEdit: boolean;
  onSelect: (moduleLocalId: string, nodeIndex: number) => void;
  onToggle: (localId: string) => void;
  onDelete: (moduleLocalId: string, nodeIndex: number) => void;
  onAddChild: (moduleLocalId: string, type: CourseNode["type"], parent?: { id?: string; _localId: string }) => void;
  onReorder: (moduleLocalId: string, activeId: string, overId: string) => void;
  adderOpenFor: string | null;
  setAdderOpenFor: React.Dispatch<React.SetStateAction<string | null>>;
  depth?: number;
}) {
  // Each container (this list of siblings) is its own drag context, so a node
  // can be reordered up/down among its siblings but never dragged into a
  // different folder or out to the module root. Nested folders render their own
  // ExplorerNodeTree → their own context, so the same rule applies at every level.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(e) => {
        const { active, over } = e;
        if (over && active.id !== over.id) onReorder(moduleLocalId, String(active.id), String(over.id));
      }}
    >
      <SortableContext items={nodes.map((n) => n._localId)} strategy={verticalListSortingStrategy}>
        {nodes.map((node) => {
          const isFolder = node.type === "folder";
          const isOpen = !!expanded[node._localId];
          const adderKey = `folder:${node._localId}`;
          const lessonSelected =
            selected.kind === "lesson" && selected.moduleLocalId === moduleLocalId && selected.nodeIndex === node._index;
          return (
            <div key={node._localId}>
              <Sortable id={node._localId} disabled={!canEdit}>
                {(dragHandle) => (
                  <ExplorerRow
                    indent={depth}
                    selected={lessonSelected}
                    onClick={() => onSelect(moduleLocalId, node._index)}
                    onChevronClick={isFolder ? () => onToggle(node._localId) : undefined}
                    chevron={isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    icon={isFolder ? (isOpen ? <FolderOpen className="h-4 w-4 text-fg-dim" /> : <Folder className="h-4 w-4 text-fg-dim" />) : lessonIcon(node.type)}
                    label={node.title || (isFolder ? "Untitled folder" : "Untitled lesson")}
                    variant={isFolder ? "folder" : "lesson"}
                    onAdd={isFolder && canEdit ? () => setAdderOpenFor(adderKey) : undefined}
                    addTitle="Add inside"
                    onDelete={canEdit ? () => onDelete(moduleLocalId, node._index) : undefined}
                    dragHandle={dragHandle}
                  />
                )}
              </Sortable>
              {isFolder && isOpen ? (
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-1 top-1 w-px bg-fg-dim/25"
                    style={{ left: 20 + depth * 16 }}
                  />
                  <ExplorerNodeTree
                    moduleLocalId={moduleLocalId}
                    nodes={node.children}
                    selected={selected}
                    expanded={expanded}
                    canEdit={canEdit}
                    onSelect={onSelect}
                    onToggle={onToggle}
                    onDelete={onDelete}
                    onAddChild={onAddChild}
                    onReorder={onReorder}
                    adderOpenFor={adderOpenFor}
                    setAdderOpenFor={setAdderOpenFor}
                    depth={depth + 1}
                  />
                  {adderOpenFor === adderKey ? (
                    <AddNodePicker
                      open
                      onClose={() => setAdderOpenFor(null)}
                      onAdd={(type) => onAddChild(moduleLocalId, type, node)}
                      indent={depth + 1}
                      compact
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </SortableContext>
    </DndContext>
  );
}

function AddNodePicker({
  open, onClose, onAdd, indent, compact = false,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (type: CourseNode["type"]) => void;
  indent: number;
  compact?: boolean;
}) {
  if (!open) return null;

  return (
    <div className="mx-2 my-1 rounded-lg border border-border bg-surface-2/90 p-2" style={{ marginLeft: 8 + indent * 16 }}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg-dim">New item</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1 text-[10px] text-fg-dim hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/60"
        >
          cancel
        </button>
      </div>
      <div className={cn("grid gap-1", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
        {LESSON_TYPES.map((lt) => (
          <button
            key={lt.type}
            type="button"
            onClick={() => onAdd(lt.type)}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-left text-[11px] text-fg-dim transition hover:border-brand hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/60"
          >
            <span className="shrink-0">{lt.icon}</span>
            <span className="truncate">{lt.label}</span>
          </button>
        ))}
      </div>
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
  const handle = disabled ? (
    <span className="h-5 w-5 shrink-0" aria-hidden="true" />
  ) : (
    <button
      {...attributes}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
      className="flex h-5 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-fg-dim opacity-30 transition hover:bg-surface hover:text-fg focus:outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-brand/60 group-hover:opacity-100 active:cursor-grabbing"
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
  const setCertificateTemplate = (patch: DraftCourse["certificate_template"]) => {
    setCourse((c) => ({ ...c, certificate_template: { ...c.certificate_template, ...patch } }));
  };

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
        {course.certificate_enabled && (
          <div className="mt-4 space-y-4 rounded-xl border border-border bg-surface-2/50 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Minimum progress for certificate" hint="100% means only fully completed learners can claim it.">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={course.certificate_min_progress}
                  onChange={(e) => setCourse({ ...course, certificate_min_progress: Math.max(1, Math.min(100, Number(e.target.value) || 100)) })}
                  className="input"
                />
              </Field>
              <label className="mt-6 flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={course.certificate_require_quiz_pass}
                  onChange={(e) => setCourse({ ...course, certificate_require_quiz_pass: e.target.checked })}
                  className="accent-[color:var(--brand-primary)]"
                />
                Require all quiz lessons to be passed
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Certificate heading">
                <input
                  maxLength={80}
                  value={course.certificate_template.heading || ""}
                  onChange={(e) => setCertificateTemplate({ heading: e.target.value || undefined })}
                  className="input"
                  placeholder="CERTIFICATE OF COMPLETION"
                />
              </Field>
              <Field label="Accent color">
                <input
                  type="color"
                  value={course.certificate_template.accentColor || "#7c3aed"}
                  onChange={(e) => setCertificateTemplate({ accentColor: e.target.value })}
                  className="h-11 w-20 rounded-xl border border-border bg-surface p-1"
                />
              </Field>
            </div>
            <Field label="Certificate body sentence">
              <input
                maxLength={120}
                value={course.certificate_template.body || ""}
                onChange={(e) => setCertificateTemplate({ body: e.target.value || undefined })}
                className="input"
                placeholder="has successfully completed the course"
              />
            </Field>
            <Field label="Footer note">
              <input
                maxLength={120}
                value={course.certificate_template.footerNote || ""}
                onChange={(e) => setCertificateTemplate({ footerNote: e.target.value || undefined })}
                className="input"
                placeholder="LearnRift - learn. build. ship."
              />
            </Field>
          </div>
        )}
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
  const lessonCount = m.nodes.filter((node) => node.type !== "folder").length;
  return (
    <div className="space-y-4">
      <Section title="Module">
        <Field label="Module title">
          <input value={m.title} onChange={(e) => onTitleChange(e.target.value)} className="input" placeholder="e.g. Foundations" />
        </Field>
      </Section>
      <Section title={`Lessons (${lessonCount})`}>
        {m.nodes.length === 0 ? (
          <p className="text-xs text-fg-dim">No lessons yet. Add one using a button below — or via <span className="text-brand">+ Add lesson</span> in the explorer.</p>
        ) : (
          <ModuleNodeTree nodes={buildDraftNodeTree(m.nodes)} onSelectLesson={onSelectLesson} />
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

function ModuleNodeTree({ nodes, onSelectLesson, depth = 0 }: { nodes: DraftNodeTree[]; onSelectLesson: (idx: number) => void; depth?: number }) {
  return (
    <ul className="space-y-1">
      {nodes.map((n) => (
        <li key={n.id || n._localId}>
          <button
            onClick={() => onSelectLesson(n._index)}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-sm transition hover:border-brand"
            style={{ paddingLeft: 12 + depth * 18 }}
          >
            {lessonIcon(n.type)} <span className="flex-1 truncate">{n.title || (n.type === "folder" ? "Untitled folder" : `Lesson ${n._index + 1}`)}</span>
            <span className="text-[10px] uppercase tracking-widest text-fg-dim">{n.type || "video"}</span>
          </button>
          {n.children.length > 0 ? <ModuleNodeTree nodes={n.children} onSelectLesson={onSelectLesson} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

// ──────────────────────────── Lesson panel ────────────────────────────

function LessonPanel({
  value, onChange, onAddChild,
}: {
  value: DraftNode;
  onChange: (n: Partial<CourseNode>) => void;
  onAddChild?: (type: CourseNode["type"]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="card">
        <NodeEditor value={value} onChange={onChange} />
      </div>
      {value.type === "folder" && onAddChild ? (
        <Section title="Add inside this folder">
          <div className="flex flex-wrap gap-2">
            {LESSON_TYPES.map((lt) => (
              <button
                key={lt.type}
                type="button"
                onClick={() => onAddChild(lt.type)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-fg-dim transition hover:border-brand hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/60"
              >
                <Plus className="h-3 w-3" /> {lt.icon} {lt.label}
              </button>
            ))}
          </div>
        </Section>
      ) : null}
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
