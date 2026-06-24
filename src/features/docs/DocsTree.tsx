import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import type { DocTreeNode } from "./docsTree";

function TreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: DocTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: depth * 12 + 8 } as const;

  if (node.kind === "tree") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          {open ? <FolderOpen className="size-3.5 shrink-0 text-amber-400/80" /> : <Folder className="size-3.5 shrink-0 text-amber-400/80" />}
          <span className="truncate">{node.label}</span>
        </button>
        {open &&
          node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }

  const active = node.path === selectedPath;
  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      style={pad}
      className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors ${
        active
          ? "bg-primary/15 text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <FileText className={`size-3.5 shrink-0 ${active ? "text-primary" : ""}`} />
      <span className="truncate">{node.label}</span>
    </button>
  );
}

export function DocsTree({
  tree,
  selectedPath,
  onSelect,
}: {
  tree: DocTreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}
