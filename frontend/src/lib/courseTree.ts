import type { Course, CourseNode, Module } from "@/lib/api";

export function isPlayableNode(node: Pick<CourseNode, "type">): boolean {
  return node.type !== "folder";
}

function byPosition(a: CourseNode, b: CourseNode): number {
  return (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);
}

export function buildNodeTree(nodes: CourseNode[] | null | undefined): CourseNode[] {
  if (!Array.isArray(nodes)) return [];
  const clones = new Map<string, CourseNode>();
  for (const node of nodes) clones.set(node.id, { ...node, children: [] });

  const roots: CourseNode[] = [];
  for (const node of clones.values()) {
    const parentId = node.parent_node_id || "";
    const parent = parentId ? clones.get(parentId) : null;
    if (parent && parent.id !== node.id) parent.children = [...(parent.children || []), node];
    else roots.push(node);
  }

  const sortDeep = (list: CourseNode[]): CourseNode[] => {
    const sorted = [...list].sort(byPosition);
    for (const node of sorted) {
      if (node.children?.length) node.children = sortDeep(node.children);
    }
    return sorted;
  };
  return sortDeep(roots);
}

export function flattenNodeTree(nodes: CourseNode[] | null | undefined, opts: { includeFolders?: boolean } = {}): CourseNode[] {
  const out: CourseNode[] = [];
  const visit = (node: CourseNode) => {
    if (opts.includeFolders || isPlayableNode(node)) out.push(node);
    for (const child of node.children || []) visit(child);
  };
  for (const node of buildNodeTree(nodes)) visit(node);
  return out;
}

export function modulePlayableNodes(module: Pick<Module, "nodes">): CourseNode[] {
  return flattenNodeTree(module.nodes || []);
}

export function flattenCourseNodes(course: Pick<Course, "modules">, opts: { includeFolders?: boolean } = {}): CourseNode[] {
  return (course.modules || []).flatMap((courseModule) => flattenNodeTree(courseModule.nodes || [], opts));
}

export function countPlayableNodes(nodes: CourseNode[] | null | undefined): number {
  return flattenNodeTree(nodes).length;
}

export function firstPlayableNode(modules: Module[] | null | undefined): CourseNode | undefined {
  for (const courseModule of modules || []) {
    const first = modulePlayableNodes(courseModule)[0];
    if (first) return first;
  }
  return undefined;
}

export function nodeTreeContains(nodes: CourseNode[] | null | undefined, nodeId: string): boolean {
  return flattenNodeTree(nodes, { includeFolders: true }).some((node) => node.id === nodeId);
}
