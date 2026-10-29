import { useState, type MouseEvent } from "react";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import type { DocTreeNode } from "./docTree";
import { DocContextMenu } from "./DocContextMenu";

function TreeRow({
  node,
  depth,
  selectedPath,
  onSelect,
  onContextMenu,
}: {
  node: DocTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: (e: MouseEvent, path: string) => void;
}) {
  // Folders start collapsed so a large repo opens as a scannable top level.
  const [open, setOpen] = useState(false);
  const pad = { paddingLeft: depth * 12 + 10 } as const;

  if (node.kind === "tree") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={pad}
          aria-expanded={open}
          className="dash-control flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
          {open ? (
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          )}
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
              onContextMenu={onContextMenu}
            />
          ))}
      </div>
    );
  }

  const active = node.path === selectedPath;
  const fileButton = (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      onContextMenu={(e) => onContextMenu(e, node.path)}
      style={node.children.length > 0 ? undefined : pad}
      aria-current={active ? "page" : undefined}
      className={`dash-control flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[13px] transition-colors ${
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <FileText className={`size-3.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
      <span className="truncate">{node.label}</span>
    </button>
  );

  if (node.children.length === 0) return fileButton;

  // A document that is also a parent (a ClickUp page with sub-pages): the row
  // opens the page, the chevron beside it shows or hides the sub-pages.
  return (
    <div>
      <div style={pad} className="flex items-center gap-0.5">
        <button
          type="button"
          aria-label={`${open ? "Collapse" : "Expand"} ${node.label}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="dash-control -ml-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronRight
            className={`size-3.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
        </button>
        {fileButton}
      </div>
      {open &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  );
}

export function DocsTree({
  sourceId,
  tree,
  selectedPath,
  onSelect,
}: {
  sourceId: string;
  tree: DocTreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);

  const onContextMenu = (e: MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ path, x: e.clientX, y: e.clientY });
  };

  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
      {menu && (
        <DocContextMenu
          sourceId={sourceId}
          path={menu.path}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </nav>
  );
}
