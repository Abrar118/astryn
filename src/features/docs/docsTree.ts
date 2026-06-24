import type { DocNode } from "@/lib/commands";

export type DocTreeNode = {
  path: string;
  name: string;
  label: string;
  kind: "blob" | "tree";
  children: DocTreeNode[];
};

/** Strip a leading "NN-"/"NN_"/"NN." ordering prefix and a trailing ".md". */
export function displayLabel(name: string): string {
  const stripped = name.replace(/\.md$/i, "").replace(/^\d+[-_.]\s*/, "");
  return stripped.length > 0 ? stripped : name;
}

/** Sort key per node: README first, then numeric prefix, then case-insensitive name. */
function sortKey(node: DocTreeNode): [number, number, string] {
  const readme = /^readme\.md$/i.test(node.name) ? 0 : 1;
  const m = /^(\d+)/.exec(node.name);
  const num = m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  return [readme, num, node.name.toLowerCase()];
}

function cmp(a: DocTreeNode, b: DocTreeNode): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < 3; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/** Build a nested, sorted tree from the flat cached entries. */
export function buildDocTree(flat: DocNode[]): DocTreeNode[] {
  const byPath = new Map<string, DocTreeNode>();
  for (const e of flat) {
    byPath.set(e.path, {
      path: e.path,
      name: e.name,
      label: displayLabel(e.name),
      kind: e.kind,
      children: [],
    });
  }
  const roots: DocTreeNode[] = [];
  for (const e of flat) {
    const self = byPath.get(e.path)!;
    const parent = e.parentPath ? byPath.get(e.parentPath) : undefined;
    if (parent) parent.children.push(self);
    else roots.push(self);
  }
  const sortRec = (nodes: DocTreeNode[]) => {
    nodes.sort(cmp);
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Path to auto-open: the root README.md if present, else the first file. */
export function defaultDocPath(flat: DocNode[]): string | null {
  const rootReadme = flat.find(
    (e) => e.parentPath === "" && /^readme\.md$/i.test(e.name),
  );
  if (rootReadme) return rootReadme.path;
  const firstFile = flat.find((e) => e.kind === "blob");
  return firstFile ? firstFile.path : null;
}
