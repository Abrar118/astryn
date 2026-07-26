import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  generateReport,
  type ReportKind,
  type ReportResult,
  type ReportTokenEvent,
  type ReportWindowArgs,
} from "./commands";

// Report state lives here (not in ReportsPage's component state) because
// SplitLayout unmounts a tab's content whenever another tab becomes active
// (`<PaneContent key={pane.activeTabId} ...>`) — a component-local draft would
// vanish the moment you switch views. A module-level store survives that, and
// keeping the `report:token` listener here too means a still-streaming
// generation keeps accumulating even while the Reports tab isn't mounted.

export type ReportPhase = "idle" | "generating" | "done";

export type ReportSlot = {
  phase: ReportPhase;
  draft: string;
  result: ReportResult | null;
  genId: number;
};

const EMPTY_SLOT: ReportSlot = { phase: "idle", draft: "", result: null, genId: 0 };

type State = { daily: ReportSlot; weekly: ReportSlot };

let state: State = { daily: { ...EMPTY_SLOT }, weekly: { ...EMPTY_SLOT } };
const listeners = new Set<() => void>();

function setState(kind: ReportKind, slot: ReportSlot): void {
  state = { ...state, [kind]: slot };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive read of one kind's slot. */
export function useReportSlot(kind: ReportKind): ReportSlot {
  return useSyncExternalStore(subscribe, () => state[kind]);
}

// Registered once at module load (not per-mount) so tokens for an in-flight
// generation are captured even while no ReportsPage instance is mounted.
// Caught: outside a real Tauri webview (e.g. component tests) listen() rejects.
listen<ReportTokenEvent>("report:token", (e) => {
  for (const kind of ["daily", "weekly"] as const) {
    const slot = state[kind];
    if (slot.phase === "generating" && slot.genId === e.payload.genId) {
      setState(kind, { ...slot, draft: slot.draft + e.payload.token });
    }
  }
}).catch(() => {});

export function setDraft(kind: ReportKind, draft: string): void {
  setState(kind, { ...state[kind], draft });
}

/** Orphan any in-flight stream for `kind` and reset it to idle. */
export function resetSlot(kind: ReportKind): void {
  setState(kind, { ...EMPTY_SLOT });
}

/** Returns the finished result, or `undefined` if superseded by a newer call. */
export async function generate(
  kind: ReportKind,
  window: ReportWindowArgs,
): Promise<ReportResult | undefined> {
  if (state[kind].phase === "generating") return undefined;
  const genId = Date.now();
  setState(kind, { phase: "generating", draft: "", result: null, genId });
  try {
    const res = await generateReport(window, genId);
    if (state[kind].genId !== genId) return undefined; // superseded by a newer generate/reset
    setState(kind, { phase: "done", draft: res.llmText ?? res.factSheet, result: res, genId });
    return res;
  } catch (err) {
    if (state[kind].genId !== genId) return undefined;
    setState(kind, { ...EMPTY_SLOT });
    throw err;
  }
}
