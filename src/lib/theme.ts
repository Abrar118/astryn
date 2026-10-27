import { useSyncExternalStore } from "react";

/** Persisted color-theme preference (Settings → Appearance). */
export const THEME_KEY = "astryn.theme";

/** Palettes live in src/styles/themes.css, one `[data-theme="<id>"]` block each. */
export const THEMES = [
  { id: "graphite", label: "Graphite", scheme: "dark" },
  { id: "charcoal", label: "Charcoal", scheme: "dark" },
  { id: "paper", label: "Paper", scheme: "light" },
  { id: "stone", label: "Stone", scheme: "light" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type Scheme = "dark" | "light";

export type ThemePreference = {
  /** A fixed theme, or "auto" to follow the OS light/dark setting. */
  mode: ThemeId | "auto";
  /** Theme used by "auto" when the OS is dark. */
  dark: ThemeId;
  /** Theme used by "auto" when the OS is light. */
  light: ThemeId;
};

export const DEFAULT_THEME: ThemePreference = { mode: "graphite", dark: "graphite", light: "paper" };

const byId = new Map<string, (typeof THEMES)[number]>(THEMES.map((t) => [t.id, t]));

export function schemeOf(id: ThemeId): Scheme {
  return byId.get(id)!.scheme;
}

function isTheme(v: unknown, scheme?: Scheme): v is ThemeId {
  const t = typeof v === "string" ? byId.get(v) : undefined;
  return !!t && (!scheme || t.scheme === scheme);
}

/** Pure: validate persisted JSON; fall back per field. */
export function parseTheme(raw: string | null): ThemePreference {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "{}");
  } catch {
    return { ...DEFAULT_THEME };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_THEME };
  const input = value as Record<string, unknown>;
  return {
    mode: input.mode === "auto" || isTheme(input.mode) ? (input.mode as ThemePreference["mode"]) : DEFAULT_THEME.mode,
    dark: isTheme(input.dark, "dark") ? input.dark : DEFAULT_THEME.dark,
    light: isTheme(input.light, "light") ? input.light : DEFAULT_THEME.light,
  };
}

/** Pure: the theme actually shown for a preference and the OS setting. */
export function resolveTheme(pref: ThemePreference, osPrefersDark: boolean): ThemeId {
  if (pref.mode !== "auto") return pref.mode;
  return osPrefersDark ? pref.dark : pref.light;
}

const darkQuery = (): MediaQueryList | null =>
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

let cached: ThemePreference | null = null;
let resolved: ThemeId = DEFAULT_THEME.mode as ThemeId;
const listeners = new Set<() => void>();

function apply(): void {
  resolved = resolveTheme(loadTheme(), darkQuery()?.matches ?? true);
  const root = document.documentElement;
  const scheme = schemeOf(resolved);
  root.dataset.theme = resolved;
  root.classList.toggle("dark", scheme === "dark");
  root.style.colorScheme = scheme;
  for (const l of listeners) l();
}

export function loadTheme(): ThemePreference {
  if (!cached) {
    try {
      cached = parseTheme(localStorage.getItem(THEME_KEY));
    } catch {
      cached = { ...DEFAULT_THEME };
    }
  }
  return cached;
}

export function saveTheme(next: ThemePreference): void {
  cached = next;
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
  apply();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive preference: re-renders whenever `saveTheme` runs. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, loadTheme);
}

/** Reactive light/dark of the theme on screen (follows the OS in "auto"). */
export function useScheme(): Scheme {
  return useSyncExternalStore(subscribe, () => schemeOf(resolved));
}

/** Apply the persisted theme before first render and track OS changes for "auto". */
export function initTheme(): void {
  apply();
  darkQuery()?.addEventListener("change", apply);
}
