export type ViewKind = "calendar" | "list" | "inbox" | "settings" | "issue";
export type Tab = { id: string; view: ViewKind; issueId?: string };
export type Pane = { id: string; tabs: Tab[]; activeTabId: string };
export type WorkspaceState = {
  panes: Pane[]; // length 1 (single) or 2 (split: [left, right])
  focusedPaneId: string;
  ratio: number; // left-pane width fraction
  seq: number; // monotonic tab-id counter
};

export const VIEWS: ViewKind[] = ["calendar", "list", "inbox", "settings", "issue"];
export const MIN_PANE_PX = 320;

export const FALLBACK: WorkspaceState = {
  panes: [{ id: "pane-0", tabs: [{ id: "tab-0", view: "calendar" }], activeTabId: "tab-0" }],
  focusedPaneId: "pane-0",
  ratio: 0.5,
  seq: 1,
};

export function clampRatio(ratio: number, usableWidthPx: number, minPanePx = MIN_PANE_PX): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(usableWidthPx) || usableWidthPx <= 0) return 0.5;
  const minFraction = Math.min(0.5, minPanePx / usableWidthPx);
  return Math.min(1 - minFraction, Math.max(minFraction, ratio));
}

export function nextPaneId(panes: Pane[]): string {
  for (let n = 0; ; n++) {
    const id = `pane-${n}`;
    if (!panes.some((p) => p.id === id)) return id;
  }
}

function isViewKind(v: unknown): v is ViewKind {
  return typeof v === "string" && (VIEWS as string[]).includes(v);
}

function validTab(t: unknown): t is Tab {
  const tab = t as Tab;
  if (!tab || typeof tab.id !== "string" || !isViewKind(tab.view)) return false;
  if (tab.view === "issue" && !(typeof tab.issueId === "string" && tab.issueId.length > 0)) return false;
  return true;
}

function maxTabSeq(panes: Pane[]): number {
  let max = -1;
  for (const p of panes) {
    for (const t of p.tabs) {
      const m = /^tab-(\d+)$/.exec(t.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max;
}

/** Rebuild a state that satisfies every global invariant, dropping/repairing bad parts. */
function repair(input: Partial<WorkspaceState>): WorkspaceState {
  const seenTabIds = new Set<string>();
  const seenPaneIds = new Set<string>();
  const panes: Pane[] = [];
  for (const raw of Array.isArray(input.panes) ? input.panes : []) {
    if (panes.length >= 2) break; // truncate to two
    if (!raw || typeof raw.id !== "string" || seenPaneIds.has(raw.id)) continue;
    const tabs: Tab[] = [];
    for (const t of Array.isArray(raw.tabs) ? raw.tabs : []) {
      if (!validTab(t) || seenTabIds.has(t.id)) continue;
      seenTabIds.add(t.id);
      tabs.push(t.issueId ? { id: t.id, view: t.view, issueId: t.issueId } : { id: t.id, view: t.view });
    }
    if (tabs.length === 0) continue; // drop empty pane
    const activeTabId = tabs.some((t) => t.id === raw.activeTabId) ? raw.activeTabId : tabs[0].id;
    seenPaneIds.add(raw.id);
    panes.push({ id: raw.id, tabs, activeTabId });
  }
  if (panes.length === 0) return FALLBACK;
  const focusedPaneId = panes.some((p) => p.id === input.focusedPaneId) ? (input.focusedPaneId as string) : panes[0].id;
  const ratio = Number.isFinite(input.ratio) ? Math.min(1, Math.max(0, input.ratio as number)) : 0.5;
  const seq = Math.max(Number.isFinite(input.seq) ? Math.floor(input.seq as number) : 0, maxTabSeq(panes) + 1);
  return { panes, focusedPaneId, ratio, seq };
}

export function parsePersisted(raw: string | null): WorkspaceState {
  if (!raw) return FALLBACK;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return FALLBACK;
  }
  if (!parsed || typeof parsed !== "object") return FALLBACK;
  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj.panes)) {
    return repair(obj as unknown as Partial<WorkspaceState>);
  }
  // Old shape migration: { tabs, activeId, seq } -> one pane.
  if (Array.isArray(obj.tabs)) {
    const tabs = (obj.tabs as unknown[]).filter(validTab) as Tab[];
    if (tabs.length === 0) return FALLBACK;
    const activeTabId = typeof obj.activeId === "string" ? obj.activeId : tabs[0].id;
    return repair({
      panes: [{ id: "pane-0", tabs, activeTabId }],
      focusedPaneId: "pane-0",
      ratio: 0.5,
      seq: typeof obj.seq === "number" ? obj.seq : tabs.length,
    });
  }
  return FALLBACK;
}
