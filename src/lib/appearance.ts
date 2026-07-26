import { useSyncExternalStore } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** Persisted UI-scale preferences (Settings → Appearance). */
export const APPEARANCE_KEY = "astryn.appearance";

export type Appearance = {
  /** Whole-app scale, applied as webview zoom (fonts, icons, layout — like browser zoom). */
  appZoom: number;
  /** Extra multiplier on lucide icons, applied via CSS `zoom` on the svg. */
  iconScale: number;
  /** Multiplier for the description/comment editors and rendered markdown. */
  editorScale: number;
};

export const DEFAULT_APPEARANCE: Appearance = { appZoom: 1, iconScale: 1, editorScale: 1 };

export const APPEARANCE_RANGES: Record<keyof Appearance, { min: number; max: number; step: number }> = {
  appZoom: { min: 0.8, max: 1.4, step: 0.05 },
  iconScale: { min: 0.8, max: 1.5, step: 0.05 },
  editorScale: { min: 0.8, max: 1.6, step: 0.05 },
};

/** Snap to the field's step grid and clamp into range (kills float drift like 1.1500000002). */
export function clampAppearance(key: keyof Appearance, value: number): number {
  const { min, max, step } = APPEARANCE_RANGES[key];
  const snapped = Math.round(value / step) * step;
  return Math.round(Math.min(max, Math.max(min, snapped)) * 100) / 100;
}

/** Pure: validate persisted appearance JSON; fall back per field. */
export function parseAppearance(raw: string | null): Appearance {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "{}");
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_APPEARANCE };
  const input = value as Record<string, unknown>;
  const out = { ...DEFAULT_APPEARANCE };
  for (const key of Object.keys(out) as (keyof Appearance)[]) {
    const v = input[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = clampAppearance(key, v);
  }
  return out;
}

/** Push the preference into the live UI: CSS vars for icons/editor, webview zoom
 *  for the whole app. Zoom is unavailable outside Tauri (tests, plain browser) —
 *  ignore failures rather than crash the renderer. */
function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  root.style.setProperty("--icon-scale", String(a.iconScale));
  root.style.setProperty("--editor-font-scale", String(a.editorScale));
  try {
    void getCurrentWebview().setZoom(a.appZoom).catch(() => {});
  } catch {
    /* not running inside a Tauri webview */
  }
}

let cached: Appearance | null = null;
const listeners = new Set<() => void>();

export function loadAppearance(): Appearance {
  if (!cached) {
    try {
      cached = parseAppearance(localStorage.getItem(APPEARANCE_KEY));
    } catch {
      cached = { ...DEFAULT_APPEARANCE };
    }
  }
  return cached;
}

export function saveAppearance(next: Appearance): void {
  cached = next;
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
  applyAppearance(next);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive appearance: re-renders the subscriber whenever `saveAppearance` runs. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, loadAppearance);
}

/** Apply the persisted appearance once at startup (before first paint matters
 *  little — zoom is async anyway — but vars must be set before screens mount). */
export function initAppearance(): void {
  applyAppearance(loadAppearance());
}
