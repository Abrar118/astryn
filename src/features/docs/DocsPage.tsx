import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { BookText, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/tabs";
import { useDocContent, useDocsStatus, useDocsSync, useDocsTree } from "@/lib/queries";
import { buildDocTree, defaultDocPath } from "./docsTree";
import { DocsTree } from "./DocsTree";
import { DocViewer } from "./DocViewer";

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 560;
const SIDEBAR_DEFAULT = 288; // matches the old w-72
const SIDEBAR_STEP = 16;

export function DocsPage({ docPath }: { docPath?: string } = {}) {
  const { setActiveView } = useWorkspace();
  const { data: status } = useDocsStatus();
  const tokenPresent = status?.tokenPresent ?? false;
  const { data: flat } = useDocsTree();
  const sync = useDocsSync(tokenPresent);

  // Seed from the tab's docPath when opened via the tree's "new tab" / "to the
  // side" actions; otherwise fall back to the root README once the tree loads.
  const [selected, setSelected] = useState<string | null>(docPath ?? null);
  const tree = useMemo(() => buildDocTree(flat ?? []), [flat]);

  // Auto-select the root README (or first file) once the tree is available.
  useEffect(() => {
    if (!selected && flat && flat.length > 0) {
      const def = defaultDocPath(flat);
      if (def) setSelected(def);
    }
  }, [flat, selected]);

  const docQuery = useDocContent(selected);

  // Resizable left panel: drag the divider (or arrow-key it when focused).
  const rowRef = useRef<HTMLDivElement>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [collapsed, setCollapsed] = useState(false);
  const clampWidth = (px: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px));

  // Tear down an in-flight drag if the page unmounts mid-resize.
  useEffect(() => () => resizeCleanup.current?.(), []);

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const move = (ev: globalThis.PointerEvent) => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSidebarWidth(clampWidth(ev.clientX - rect.left));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      resizeCleanup.current = null;
    };
    resizeCleanup.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const onDividerKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSidebarWidth((w) => clampWidth(w - SIDEBAR_STEP));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setSidebarWidth((w) => clampWidth(w + SIDEBAR_STEP));
    }
  };

  if (status && !tokenPresent) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
          <BookText className="size-7 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold text-foreground">Docs</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            Connect your GitHub account to browse the project documentation.
          </p>
        </div>
        <Button onClick={() => setActiveView("settings")}>Connect GitHub</Button>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-background/60 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            aria-pressed={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
          <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookText className="size-3.5" />
          </span>
          <h1 className="text-sm font-semibold tracking-tight text-foreground">Docs</h1>
          {sync.isError && (
            <span className="text-xs text-amber-400">Sync failed — showing cached.</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Refresh"
          disabled={sync.isFetching}
          onClick={() => sync.refetch()}
        >
          <RefreshCw className={`size-4 ${sync.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <div ref={rowRef} className="flex min-h-0 flex-1">
        {!collapsed && (
          <>
            <aside
              style={{ width: sidebarWidth }}
              className="flex shrink-0 flex-col overflow-hidden border-r border-border/60 bg-sidebar/40"
            >
              <div className="flex shrink-0 items-center justify-between px-3.5 pb-1.5 pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  Contents
                </span>
                {(status?.fileCount ?? 0) > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground/60">
                    {status?.fileCount}
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pb-3">
                {tree.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-muted-foreground">
                    {sync.isFetching ? "Loading docs…" : "No docs cached yet."}
                  </p>
                ) : (
                  <DocsTree tree={tree} selectedPath={selected} onSelect={setSelected} />
                )}
              </div>
            </aside>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              aria-valuenow={Math.round(sidebarWidth)}
              aria-valuemin={SIDEBAR_MIN}
              aria-valuemax={SIDEBAR_MAX}
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={onDividerKey}
              className="group relative w-1 shrink-0 cursor-col-resize outline-none"
            >
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary/60" />
            </div>
          </>
        )}
        <div className="min-w-0 flex-1 overflow-y-auto bg-card">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a document to read.
            </div>
          ) : docQuery.isPending || docQuery.data === undefined ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" />
              Loading…
            </div>
          ) : docQuery.data === null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              This document isn't cached.
            </div>
          ) : (
            <DocViewer markdown={docQuery.data} />
          )}
        </div>
      </div>
    </main>
  );
}
