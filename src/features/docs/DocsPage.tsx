import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  BookText,
  Check,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/Popover";
import { useWorkspace } from "@/lib/tabs";
import {
  useDocContent,
  useDocPdf,
  useDocsSources,
  useDocsStatus,
  useDocsRescan,
  useDocsSync,
  useDocsTree,
} from "@/lib/queries";
import { requestSettingsSection, type SettingsSection } from "@/features/settings/settingsSection";
import type { DocsSource } from "@/lib/commands";
import { buildDocTree, defaultDocPath } from "./docTree";
import { resolveActiveSource, saveActiveSourceId, useStoredSourceId } from "./activeSource";
import { docFormat, sourceDetail, sourceProvider, unavailableReason } from "./docSource";
import { SourceKindIcon } from "./SourceKindIcon";
import { DocsTree } from "./DocsTree";
import { DocViewer } from "./DocViewer";

// pdf.js is large; load it only when a PDF is opened.
const PdfViewer = lazy(() => import("./PdfViewer"));

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 560;
const SIDEBAR_DEFAULT = 288; // matches the old w-72
const SIDEBAR_STEP = 16;

/** Centered empty state for the "no sources" case. */
function DocsEmptyState({
  message,
  action,
  onAction,
}: {
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
        <BookText className="size-7 text-muted-foreground" />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold text-foreground">Docs</h1>
        <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
      </div>
      <Button onClick={onAction}>{action}</Button>
    </main>
  );
}

/** Header title that doubles as the source picker. */
function SourcePicker({
  sources,
  active,
  onSelect,
  onManage,
}: {
  sources: DocsSource[];
  active: DocsSource;
  onSelect: (id: string) => void;
  onManage: () => void;
}) {
  return (
    <Popover
      align="start"
      buttonTitle="Switch documentation source"
      buttonClassName="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-semibold tracking-tight text-foreground transition-colors hover:bg-accent"
      panelClassName="max-h-[22rem] w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl"
      button={
        <>
          <span className="max-w-56 truncate">{active.name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </>
      }
    >
      {(close) => (
        <>
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={!s.available}
              onClick={() => {
                onSelect(s.id);
                close();
              }}
              className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
            >
              <span className="flex size-4 shrink-0 items-center justify-center pt-0.5 text-primary">
                {s.id === active.id && <Check className="size-3.5" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 text-[13px] text-foreground">
                  <SourceKindIcon kind={s.kind} className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="truncate text-[11px] text-muted-foreground" title={sourceDetail(s)}>
                  {s.available ? sourceDetail(s) : unavailableReason(s.kind)}
                </span>
              </span>
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => {
              onManage();
              close();
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
              <Settings2 className="size-3.5" />
            </span>
            Manage sources…
          </button>
        </>
      )}
    </Popover>
  );
}

export function DocsPage({
  docPath,
  docSourceId,
}: { docPath?: string; docSourceId?: string } = {}) {
  const { setActiveView } = useWorkspace();
  const { data: status } = useDocsStatus();
  const tokenPresent = status?.tokenPresent ?? false;
  const { data: sources } = useDocsSources();

  const openSettingsAt = (section: SettingsSection) => {
    requestSettingsSection(section);
    setActiveView("settings");
  };
  const openSourceSettings = () => openSettingsAt("documentation");

  // Which source this tab shows. A tab opened on a specific doc is pinned to that
  // doc's source; otherwise it follows the persisted default. Resolving lazily
  // (rather than via an effect) means it settles correctly as `sources` loads and
  // falls back on its own when the chosen source is deleted in Settings.
  const storedSourceId = useStoredSourceId();
  const [pinnedSourceId, setPinnedSourceId] = useState<string | null>(docSourceId ?? null);
  const active = resolveActiveSource(sources ?? [], pinnedSourceId ?? storedSourceId);
  const activeId = active?.id ?? null;
  const available = !!active?.available;
  const isLocal = active?.kind === "local";
  // A repository syncs with the GitHub token, a ClickUp Doc with the ClickUp
  // token; a local folder needs neither.
  const provider = active ? sourceProvider(active.kind) : null;
  const providerToken =
    active?.kind === "clickup" ? (status?.clickupTokenPresent ?? false) : tokenPresent;
  const needsToken = !!provider && !!status && !providerToken;
  const canSync = available && (isLocal || providerToken);

  const [selected, setSelected] = useState<string | null>(docPath ?? null);
  // An unavailable source (provider off) is never queried — its commands refuse.
  const {
    data: flat,
    isError: treeError,
    isFetching: treeFetching,
  } = useDocsTree(available ? activeId : null);
  // A repository syncs once when first viewed; a local folder never auto-syncs —
  // its tree query is the one scan, and the button rescans on request.
  const sync = useDocsSync(activeId, canSync && !isLocal);
  const rescan = useDocsRescan();
  const refreshing = isLocal ? treeFetching : sync.isFetching;
  const refresh = () => {
    if (isLocal && activeId) void rescan(activeId);
    else void sync.refetch();
  };
  // ClickUp pages keep their author's order; files and repos sort by name.
  const keepOrder = active?.kind === "clickup";
  const tree = useMemo(() => buildDocTree(flat ?? [], { keepOrder }), [flat, keepOrder]);

  // A selected path belongs to one repo, so drop it whenever the active source
  // actually changes — whether the user picked another one or the current one was
  // deleted in Settings and `resolveActiveSource` fell back. Without this the page
  // would sit on "This document isn't cached" instead of the new README. The
  // null guards keep the initial `docPath` seed intact while sources are loading.
  const shownSource = useRef<string | null>(docSourceId ?? null);
  useEffect(() => {
    if (!activeId) return;
    if (shownSource.current && shownSource.current !== activeId) setSelected(null);
    shownSource.current = activeId;
  }, [activeId]);

  // Auto-select the root README (or first file) once the tree is available.
  useEffect(() => {
    if (!selected && flat && flat.length > 0) {
      const def = defaultDocPath(flat);
      if (def) setSelected(def);
    }
  }, [flat, selected]);

  const selectSource = (id: string) => {
    if (id === activeId) return;
    setPinnedSourceId(id);
    saveActiveSourceId(id); // becomes the default for newly opened Docs tabs
  };

  const selectedName = selected ? (flat?.find((n) => n.path === selected)?.name ?? selected.split("/").pop() ?? "") : "";
  const format = active ? docFormat(active.kind, selectedName) : "markdown";
  const docQuery = useDocContent(activeId, selected, available && format !== "pdf");
  const pdfQuery = useDocPdf(activeId, selected, available && format === "pdf");

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

  if (sources && sources.length === 0) {
    return (
      <DocsEmptyState
        message="Add a GitHub repository or a folder on this computer in Settings to start browsing."
        action="Add a source"
        onAction={openSourceSettings}
      />
    );
  }

  // When the active source can't show a tree, explain why in place of the reader.
  const notice: { message: string; action: string; onAction: () => void } | null = !active
    ? null
    : !available
      ? {
          message: `${unavailableReason(active.kind)}, so this source can't be read. Turn it back on in Settings → Modules.`,
          action: "Open Modules",
          onAction: () => openSettingsAt("modules"),
        }
      : needsToken && provider && (flat?.length ?? 0) === 0
        ? {
            message: `Connect your ${provider.name} account to sync this ${active.kind === "clickup" ? "Doc" : "repository"}.`,
            action: `Connect ${provider.name}`,
            onAction: () => openSettingsAt(provider.section),
          }
        : isLocal && treeError
          ? {
              message: "This folder can't be read. It may have been moved, renamed or deleted.",
              action: "Manage sources",
              onAction: openSourceSettings,
            }
          : null;

  const loading = (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <RefreshCw className="size-4 animate-spin" />
      Loading…
    </div>
  );
  const unreadable = (message: string) => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{message}</div>
  );

  let reader;
  if (!selected) {
    reader = unreadable("Select a document to read.");
  } else if (format === "pdf") {
    reader = pdfQuery.isError
      ? unreadable("This PDF couldn't be read.")
      : !pdfQuery.data
        ? loading
        : (
          <Suspense fallback={loading}>
            <PdfViewer data={pdfQuery.data} />
          </Suspense>
        );
  } else if (docQuery.isPending || docQuery.data === undefined) {
    reader = loading;
  } else if (docQuery.data === null) {
    reader = unreadable(isLocal ? "This file couldn't be read." : "This document isn't cached.");
  } else if (format === "text") {
    reader = (
      <pre className="whitespace-pre-wrap break-words px-10 py-8 font-mono text-[13px] leading-relaxed text-foreground">
        {docQuery.data}
      </pre>
    );
  } else {
    reader = <DocViewer markdown={docQuery.data} />;
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-background px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            aria-pressed={!collapsed}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookText className="size-3.5" />
          </span>
          {active && sources ? (
            <SourcePicker
              sources={sources}
              active={active}
              onSelect={selectSource}
              onManage={openSourceSettings}
            />
          ) : (
            <h1 className="text-sm font-semibold tracking-tight text-foreground">Docs</h1>
          )}
          {sync.isError && !isLocal && (
            <span className="shrink-0 text-xs text-warning">Sync failed — showing cached.</span>
          )}
          {needsToken && provider && !notice && (
            <span className="shrink-0 text-xs text-warning">
              {provider.name} not connected — showing cached.
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={isLocal ? "Rescan folder" : "Refresh"}
          title={isLocal ? "Rescan folder" : "Refresh"}
          disabled={refreshing || !canSync}
          onClick={refresh}
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </header>

      {notice ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-card p-10 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">{notice.message}</p>
          <Button variant="secondary" onClick={notice.onAction}>
            {notice.action}
          </Button>
        </div>
      ) : (
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
                {(active?.fileCount ?? 0) > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground/60">
                    {active?.fileCount}
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pb-3">
                {tree.length === 0 || !activeId ? (
                  <p className="px-4 py-6 text-xs text-muted-foreground">
                    {refreshing
                      ? "Loading docs…"
                      : isLocal
                        ? "No Markdown, text or PDF files in this folder."
                        : "No docs cached yet."}
                  </p>
                ) : (
                  // Keyed by source so folder-expansion state doesn't carry across a switch.
                  <DocsTree
                    key={activeId}
                    sourceId={activeId}
                    tree={tree}
                    selectedPath={selected}
                    onSelect={setSelected}
                  />
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
        <div className="min-w-0 flex-1 overflow-y-auto bg-card">{reader}</div>
      </div>
      )}
    </main>
  );
}
