export type ViewKind = "calendar" | "list" | "this-week" | "inbox" | "settings" | "issue";
export type Tab = { id: string; view: ViewKind; issueId?: string };
export type Pane = { id: string; tabs: Tab[]; activeTabId: string };
export type WorkspaceState = {
  panes: Pane[]; // length 1 (single) or 2 (split: [left, right])
  focusedPaneId: string;
  ratio: number; // left-pane width fraction
  seq: number; // monotonic tab-id counter
};

export const VIEWS: ViewKind[] = ["calendar", "list", "this-week", "inbox", "settings", "issue"];
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

function findTab(state: WorkspaceState, tabId: string): { paneIdx: number; tabIdx: number } | null {
  for (let pi = 0; pi < state.panes.length; pi++) {
    const ti = state.panes[pi].tabs.findIndex((t) => t.id === tabId);
    if (ti >= 0) return { paneIdx: pi, tabIdx: ti };
  }
  return null;
}

/** After removing the tab at `originalIdx`, pick the new active id from the remaining tabs. */
function neighborId(originalIdx: number, rem: Tab[]): string {
  return (rem[originalIdx] ?? rem[originalIdx - 1] ?? rem[0]).id;
}

/** Move `tabId` from pane `srcIdx` to pane `destIdx`; collapse the source if it empties. */
function moveTabCore(state: WorkspaceState, tabId: string, srcIdx: number, tabIdx: number, destIdx: number): WorkspaceState {
  const src = state.panes[srcIdx];
  const dest = state.panes[destIdx];
  const tab = src.tabs[tabIdx];
  const remain = src.tabs.filter((t) => t.id !== tabId);
  const destPane: Pane = { ...dest, tabs: [...dest.tabs, tab], activeTabId: tabId };
  if (remain.length === 0) {
    return { ...state, panes: [destPane], focusedPaneId: destPane.id };
  }
  const srcActive = src.activeTabId === tabId ? neighborId(tabIdx, remain) : src.activeTabId;
  const srcPane: Pane = { ...src, tabs: remain, activeTabId: srcActive };
  const panes = srcIdx < destIdx ? [srcPane, destPane] : [destPane, srcPane];
  return { ...state, panes, focusedPaneId: destPane.id };
}

export function addTabIn(state: WorkspaceState, paneId: string, view: ViewKind = "calendar"): WorkspaceState {
  const idx = state.panes.findIndex((p) => p.id === paneId);
  if (idx < 0) return state;
  const id = `tab-${state.seq}`;
  const tab: Tab = { id, view };
  const panes = state.panes.map((p, i) => (i === idx ? { ...p, tabs: [...p.tabs, tab], activeTabId: id } : p));
  return { ...state, panes, focusedPaneId: paneId, seq: state.seq + 1 };
}

export function closeTabIn(state: WorkspaceState, tabId: string): WorkspaceState {
  const loc = findTab(state, tabId);
  if (!loc) return state;
  const { paneIdx, tabIdx } = loc;
  const pane = state.panes[paneIdx];
  if (state.panes.length === 1 && pane.tabs.length === 1) return state; // keep >= 1 tab
  const rem = pane.tabs.filter((t) => t.id !== tabId);
  if (rem.length === 0) {
    const survivor = state.panes[1 - paneIdx];
    return { ...state, panes: [survivor], focusedPaneId: survivor.id };
  }
  const activeTabId = pane.activeTabId === tabId ? neighborId(tabIdx, rem) : pane.activeTabId;
  const panes = state.panes.map((p, i) => (i === paneIdx ? { ...p, tabs: rem, activeTabId } : p));
  return { ...state, panes };
}

export function splitTabRight(state: WorkspaceState, tabId: string): WorkspaceState {
  const loc = findTab(state, tabId);
  if (!loc) return state;
  const { paneIdx, tabIdx } = loc;
  if (state.panes.length === 2) {
    if (paneIdx === 1) return state; // already on the right
    return moveTabCore(state, tabId, 0, tabIdx, 1);
  }
  const src = state.panes[0];
  const tab = src.tabs[tabIdx];
  if (src.tabs.length === 1) {
    const cloneId = `tab-${state.seq}`;
    const clone: Tab = tab.issueId ? { id: cloneId, view: tab.view, issueId: tab.issueId } : { id: cloneId, view: tab.view };
    const right: Pane = { id: nextPaneId(state.panes), tabs: [clone], activeTabId: cloneId };
    return { ...state, panes: [src, right], focusedPaneId: right.id, seq: state.seq + 1 };
  }
  const remain = src.tabs.filter((t) => t.id !== tabId);
  const left: Pane = { ...src, tabs: remain, activeTabId: src.activeTabId === tabId ? neighborId(tabIdx, remain) : src.activeTabId };
  const right: Pane = { id: nextPaneId(state.panes), tabs: [tab], activeTabId: tabId };
  return { ...state, panes: [left, right], focusedPaneId: right.id };
}

export function moveTabToOtherPane(state: WorkspaceState, tabId: string): WorkspaceState {
  if (state.panes.length !== 2) return state;
  const loc = findTab(state, tabId);
  if (!loc) return state;
  return moveTabCore(state, tabId, loc.paneIdx, loc.tabIdx, 1 - loc.paneIdx);
}

/**
 * Move `tabId` to `targetPaneId` at `targetIndex` — the general drag-and-drop
 * reducer. Handles reorder within a pane (same source/target pane) and precise
 * cross-pane insertion; the moved tab becomes the target pane's active tab and
 * the target pane is focused. Collapses the source pane if it empties.
 */
export function moveTab(state: WorkspaceState, tabId: string, targetPaneId: string, targetIndex: number): WorkspaceState {
  const loc = findTab(state, tabId);
  if (!loc) return state;
  const targetPaneIdx = state.panes.findIndex((p) => p.id === targetPaneId);
  if (targetPaneIdx < 0) return state;
  const srcPane = state.panes[loc.paneIdx];
  const tab = srcPane.tabs[loc.tabIdx];

  if (loc.paneIdx === targetPaneIdx) {
    const without = srcPane.tabs.filter((t) => t.id !== tabId);
    const idx = Math.max(0, Math.min(targetIndex, without.length));
    const tabs = [...without.slice(0, idx), tab, ...without.slice(idx)];
    const panes = state.panes.map((p, i) => (i === loc.paneIdx ? { ...p, tabs, activeTabId: tabId } : p));
    return { ...state, panes, focusedPaneId: srcPane.id };
  }

  const srcRemain = srcPane.tabs.filter((t) => t.id !== tabId);
  const destPane = state.panes[targetPaneIdx];
  const idx = Math.max(0, Math.min(targetIndex, destPane.tabs.length));
  const destTabs = [...destPane.tabs.slice(0, idx), tab, ...destPane.tabs.slice(idx)];
  const destNew: Pane = { ...destPane, tabs: destTabs, activeTabId: tabId };
  if (srcRemain.length === 0) {
    return { ...state, panes: [destNew], focusedPaneId: destNew.id };
  }
  const srcActive = srcPane.activeTabId === tabId ? neighborId(loc.tabIdx, srcRemain) : srcPane.activeTabId;
  const srcNew: Pane = { ...srcPane, tabs: srcRemain, activeTabId: srcActive };
  const panes = loc.paneIdx < targetPaneIdx ? [srcNew, destNew] : [destNew, srcNew];
  return { ...state, panes, focusedPaneId: destNew.id };
}

export function swapPanes(state: WorkspaceState): WorkspaceState {
  if (state.panes.length !== 2) return state;
  // Pure reducer: exact mirror. Live-width clamping is SplitLayout's job.
  return { ...state, panes: [state.panes[1], state.panes[0]], ratio: 1 - state.ratio };
}

export function selectTabIn(state: WorkspaceState, tabId: string): WorkspaceState {
  const loc = findTab(state, tabId);
  if (!loc) return state;
  const panes = state.panes.map((p, i) => (i === loc.paneIdx ? { ...p, activeTabId: tabId } : p));
  return { ...state, panes, focusedPaneId: state.panes[loc.paneIdx].id };
}

function findIssueTab(state: WorkspaceState, issueId: string): { paneIdx: number; tabId: string } | null {
  for (let pi = 0; pi < state.panes.length; pi++) {
    const t = state.panes[pi].tabs.find((x) => x.view === "issue" && x.issueId === issueId);
    if (t) return { paneIdx: pi, tabId: t.id };
  }
  return null;
}

function addIssueTabIn(state: WorkspaceState, paneId: string, issueId: string): WorkspaceState {
  const idx = state.panes.findIndex((p) => p.id === paneId);
  if (idx < 0) return state;
  const id = `tab-${state.seq}`;
  const tab: Tab = { id, view: "issue", issueId };
  const panes = state.panes.map((p, i) => (i === idx ? { ...p, tabs: [...p.tabs, tab], activeTabId: id } : p));
  return { ...state, panes, focusedPaneId: paneId, seq: state.seq + 1 };
}

export function openIssueTabAcross(state: WorkspaceState, issueId: string): WorkspaceState {
  const found = findIssueTab(state, issueId);
  if (found) {
    const panes = state.panes.map((p, i) => (i === found.paneIdx ? { ...p, activeTabId: found.tabId } : p));
    return { ...state, panes, focusedPaneId: state.panes[found.paneIdx].id };
  }
  return addIssueTabIn(state, state.focusedPaneId, issueId);
}

export function openIssueInRightSplit(state: WorkspaceState, issueId: string): WorkspaceState {
  // Prefer an existing copy in the RIGHT pane — focus it, disturb nothing else.
  if (state.panes.length === 2) {
    const rightTab = state.panes[1].tabs.find((t) => t.view === "issue" && t.issueId === issueId);
    if (rightTab) {
      const panes = state.panes.map((p, i) => (i === 1 ? { ...p, activeTabId: rightTab.id } : p));
      return { ...state, panes, focusedPaneId: state.panes[1].id };
    }
  }
  const found = findIssueTab(state, issueId);
  if (found) {
    // Sole issue tab in the only pane: cloning would duplicate the issue. Replace the
    // left with a fresh calendar tab and move the issue itself to a new right pane.
    const leftPane = state.panes[found.paneIdx];
    if (state.panes.length === 1 && leftPane.tabs.length === 1) {
      const issueTab = leftPane.tabs[0];
      const calId = `tab-${state.seq}`;
      const left: Pane = { ...leftPane, tabs: [{ id: calId, view: "calendar" }], activeTabId: calId };
      const right: Pane = { id: nextPaneId(state.panes), tabs: [issueTab], activeTabId: issueTab.id };
      return { ...state, panes: [left, right], focusedPaneId: right.id, seq: state.seq + 1 };
    }
    // Found only in the left pane → move that tab to the right.
    return splitTabRight(state, found.tabId);
  }
  // Not open anywhere → fresh issue tab in the right pane, left untouched.
  if (state.panes.length === 2) return addIssueTabIn(state, state.panes[1].id, issueId);
  const id = `tab-${state.seq}`;
  const right: Pane = { id: nextPaneId(state.panes), tabs: [{ id, view: "issue", issueId }], activeTabId: id };
  return { ...state, panes: [state.panes[0], right], focusedPaneId: right.id, seq: state.seq + 1 };
}

/** Throws if any global invariant is violated. Test-only guard. */
export function assertInvariants(state: WorkspaceState): void {
  if (state.panes.length < 1 || state.panes.length > 2) throw new Error("panes length out of range");
  const tabIds = new Set<string>();
  const paneIds = new Set<string>();
  for (const p of state.panes) {
    if (paneIds.has(p.id)) throw new Error(`duplicate pane id ${p.id}`);
    paneIds.add(p.id);
    if (p.tabs.length < 1) throw new Error(`empty pane ${p.id}`);
    if (!p.tabs.some((t) => t.id === p.activeTabId)) throw new Error(`active tab not in pane ${p.id}`);
    for (const t of p.tabs) {
      if (tabIds.has(t.id)) throw new Error(`duplicate tab id ${t.id}`);
      tabIds.add(t.id);
    }
  }
  if (!state.panes.some((p) => p.id === state.focusedPaneId)) throw new Error("focusedPaneId not a pane");
}
