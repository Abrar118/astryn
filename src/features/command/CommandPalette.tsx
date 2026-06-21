import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import {
  ArrowLeft,
  Calendar,
  CalendarRange,
  Copy,
  ExternalLink,
  Inbox,
  List,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  SquareSplitHorizontal,
} from "lucide-react";
import { invalidateWorkspaceQueries, useIssues } from "@/lib/queries";
import { useWorkspace, type ViewKind } from "@/lib/tabs";
import { errorText, syncIssues, type IssueListItem } from "@/lib/commands";
import { CreateIssueModal } from "./CreateIssueModal";
import { shouldOpenCreateShortcut } from "./shortcuts";

// Platform-aware shortcut hints shown in the palette (must match the global bindings below).
const IS_MAC = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform || navigator.userAgent || "");
const HINT = {
  newTab: IS_MAC ? "⌘T" : "Ctrl+T",
  back: IS_MAC ? "⌘[" : "Ctrl+[",
  sync: IS_MAC ? "⌘R" : "Ctrl+R",
  fullSync: IS_MAC ? "⇧⌘R" : "Ctrl+Shift+R",
};

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      ta.remove();
    }
  }
  gooeyToast.success(`${label} copied`);
}

type Ctx = { openPalette: () => void; openCreate: () => void };
const PaletteCtx = createContext<Ctx | null>(null);

export function useCommandPalette(): Ctx {
  const ctx = useContext(PaletteCtx);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}

/** Is the user currently typing in a field? Used to gate single-key shortcuts. */
function isEditableTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<null | "palette" | "create">(null);
  const { addTab } = useWorkspace();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const resync = useCallback(
    (full: boolean) => {
      gooeyToast.info(full ? "Full resync started…" : "Syncing…");
      syncIssues(full)
        .then(() => gooeyToast.success(full ? "Full resync complete" : "Synced"))
        .catch((e) => gooeyToast.error("Sync failed", { description: errorText(e) }))
        .finally(() => invalidateWorkspaceQueries(qc));
    },
    [qc],
  );

  // A single stable keydown listener reads the latest handlers via this ref, so
  // the global shortcuts never re-subscribe on every render.
  const handlers = useRef({ mode, addTab, navigate, resync });
  handlers.current = { mode, addTab, navigate, resync };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Cmd/Ctrl+K toggles the palette from anywhere.
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setMode((m) => (m === "palette" ? null : "palette"));
        return;
      }
      // Cmd/Ctrl+T opens a new tab (defaults to calendar).
      if (mod && !e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        handlers.current.addTab("calendar");
        return;
      }
      // Cmd/Ctrl+[ navigates back.
      if (mod && e.key === "[") {
        e.preventDefault();
        handlers.current.navigate(-1);
        return;
      }
      // Cmd/Ctrl+R resyncs the workspace; add Shift for a full resync.
      if (mod && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        handlers.current.resync(e.shiftKey);
        return;
      }
      // Bare "c" opens the create modal, unless typing or an overlay is open.
      if (shouldOpenCreateShortcut({
        key: e.key,
        editable: isEditableTarget(e.target),
        overlayOpen: !!handlers.current.mode || !!document.querySelector("[data-command-shortcut-blocker], [data-popover-open]"),
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
      })) {
        e.preventDefault();
        setMode("create");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ openPalette: () => setMode("palette"), openCreate: () => setMode("create") }),
    [],
  );

  return (
    <PaletteCtx.Provider value={value}>
      {children}
      {mode === "palette" && (
        <Palette onClose={() => setMode(null)} onCreate={() => setMode("create")} resync={resync} />
      )}
      {mode === "create" && <CreateIssueModal onClose={() => setMode(null)} />}
    </PaletteCtx.Provider>
  );
}

type Command = {
  key: string;
  section: string;
  icon: ReactNode;
  label: string;
  hint?: string;
  onSelect: () => void;
};

function Palette({ onClose, onCreate, resync }: { onClose: () => void; onCreate: () => void; resync: (full: boolean) => void }) {
  const { data: issues } = useIssues({});
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const { openIssueInRightSplit, setActiveView, addTab } = useWorkspace();
  const [target, setTarget] = useState<"drawer" | "rightSplit">("drawer");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const openIssue = (id: string) => {
    if (target === "rightSplit") openIssueInRightSplit(id);
    else setParams({ issue: id });
    onClose();
  };

  const goTo = (view: ViewKind) => {
    setActiveView(view);
    onClose();
  };

  const commands: Command[] = useMemo(
    () => [
      { key: "create", section: "Create", icon: <Plus className="size-4" />, label: "Create new issue", hint: "C", onSelect: onCreate },
      { key: "go-calendar", section: "Go to", icon: <Calendar className="size-4" />, label: "Go to Calendar", onSelect: () => goTo("calendar") },
      { key: "go-issues", section: "Go to", icon: <List className="size-4" />, label: "Go to Issues", onSelect: () => goTo("list") },
      { key: "go-this-week", section: "Go to", icon: <CalendarRange className="size-4" />, label: "Go to Overview", onSelect: () => goTo("this-week") },
      { key: "go-graph", section: "Go to", icon: <Network className="size-4" />, label: "Go to Dependencies", onSelect: () => goTo("graph") },
      { key: "go-inbox", section: "Go to", icon: <Inbox className="size-4" />, label: "Go to Inbox", onSelect: () => goTo("inbox") },
      { key: "go-settings", section: "Go to", icon: <SettingsIcon className="size-4" />, label: "Go to Settings", onSelect: () => goTo("settings") },
      { key: "new-tab", section: "Navigation", icon: <Plus className="size-4" />, label: "Open new tab", hint: HINT.newTab, onSelect: () => { addTab("calendar"); onClose(); } },
      { key: "back", section: "Navigation", icon: <ArrowLeft className="size-4" />, label: "Go back", hint: HINT.back, onSelect: () => { navigate(-1); onClose(); } },
      { key: "split-right", section: "Navigation", icon: <SquareSplitHorizontal className="size-4" />, label: "Open issue in right split", onSelect: () => { setTarget("rightSplit"); setQ(""); } },
      { key: "sync", section: "Workspace", icon: <RefreshCw className="size-4" />, label: "Resync workspace", hint: HINT.sync, onSelect: () => { onClose(); resync(false); } },
      { key: "full-sync", section: "Workspace", icon: <RotateCcw className="size-4" />, label: "Full resync", hint: HINT.fullSync, onSelect: () => { onClose(); resync(true); } },
    ],
    // handlers are stable enough for this overlay's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const term = q.trim().toLowerCase();
  const filteredCommands = target === "rightSplit"
    ? []
    : term
      ? commands.filter((c) => c.label.toLowerCase().includes(term))
      : commands;

  // Issue search: rank identifier-prefix matches first, then any substring.
  const matchedIssues = useMemo(() => {
    const all = issues ?? [];
    if (!term) return all.slice(0, 6);
    const scored = all
      .map((i) => {
        const id = i.identifier.toLowerCase();
        const title = i.title.toLowerCase();
        let score = -1;
        if (id.startsWith(term)) score = 0;
        else if (id.includes(term)) score = 1;
        else if (title.includes(term)) score = 2;
        return { i, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score);
    return scored.slice(0, 8).map((x) => x.i);
  }, [issues, term]);

  // Flatten command + issue selections so arrow keys traverse the whole list.
  const items = useMemo(
    () => [
      ...filteredCommands.map((c) => ({ kind: "cmd" as const, cmd: c })),
      ...matchedIssues.map((i) => ({ kind: "issue" as const, issue: i })),
    ],
    [filteredCommands, matchedIssues],
  );

  useEffect(() => setSel(0), [term]);
  useEffect(() => {
    if (sel >= items.length) setSel(Math.max(0, items.length - 1));
  }, [items.length, sel]);

  const activate = (idx: number) => {
    const it = items[idx];
    if (!it) return;
    if (it.kind === "cmd") it.cmd.onSelect();
    else openIssue(it.issue.id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(sel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (target === "rightSplit") {
        setTarget("drawer");
        setQ("");
      } else {
        onClose();
      }
    }
  };

  // Keep the selected row in view as the user arrows through.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  // Section dividers: render a heading when the section changes.
  let lastSection = "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="flex w-[min(640px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          {target === "rightSplit" ? (
            <button
              type="button"
              aria-label="Back"
              onClick={() => {
                setTarget("drawer");
                setQ("");
              }}
              className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : (
            <Search className="size-4 shrink-0 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={target === "rightSplit" ? "Open in right split — pick an issue…" : "Type a command or search…"}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">No results</div>
          )}
          {items.map((it, idx) => {
            const section = it.kind === "cmd" ? it.cmd.section : "Issues";
            const heading = section !== lastSection ? section : null;
            lastSection = section;
            const selected = idx === sel;
            return (
              <div key={it.kind === "cmd" ? `c-${it.cmd.key}` : `i-${it.issue.id}`}>
                {heading && (
                  <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {heading}
                  </div>
                )}
                {it.kind === "cmd" ? (
                  <button
                    type="button"
                    data-idx={idx}
                    onMouseMove={() => setSel(idx)}
                    onClick={() => activate(idx)}
                    className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-foreground ${
                      selected ? "bg-accent" : ""
                    }`}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{it.cmd.icon}</span>
                    <span className="flex-1 truncate">{it.cmd.label}</span>
                    {it.cmd.hint && (
                      <kbd className="rounded border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">{it.cmd.hint}</kbd>
                    )}
                  </button>
                ) : (
                  <IssueRow issue={it.issue} idx={idx} selected={selected} onSelect={setSel} onOpen={() => activate(idx)} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IssueRow({
  issue,
  idx,
  selected,
  onSelect,
  onOpen,
}: {
  issue: IssueListItem;
  idx: number;
  selected: boolean;
  onSelect: (idx: number) => void;
  onOpen: () => void;
}) {
  return (
    <div
      data-idx={idx}
      onMouseMove={() => onSelect(idx)}
      className={`group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] ${selected ? "bg-accent" : ""}`}
    >
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: issue.stateColor }} />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{issue.identifier}</span>
        <span className="truncate text-foreground">{issue.title}</span>
      </button>
      <div className={`flex shrink-0 items-center gap-0.5 ${selected ? "" : "opacity-0 group-hover:opacity-100"}`}>
        <IconBtn title="Copy ID" onClick={() => copyText(issue.identifier, "ID")}>
          <Copy className="size-3.5" />
        </IconBtn>
        <IconBtn title="Copy link" onClick={() => copyText(issue.url, "Link")}>
          <Copy className="size-3.5 opacity-60" />
        </IconBtn>
        <IconBtn title="Open in Linear" onClick={() => openUrl(issue.url).catch(() => gooeyToast.error("Couldn't open the link"))}>
          <ExternalLink className="size-3.5" />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  );
}
