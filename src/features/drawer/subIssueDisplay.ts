import {
  DEFAULT_DISPLAY,
  type Completed,
  type DisplayKey,
  type DisplayProps,
  type Ordering,
} from "@/features/issues/viewConfig";

/** Persisted display config for the issue-detail Sub-issues section. One global
 *  preference (like the Issues list view config), so toggles survive reopens. */
export const SUBISSUE_DISPLAY_KEY = "astryn.subissue-display";

export type SubIssueDisplay = { ordering: Ordering; completed: Completed; display: DisplayProps };

/** Sub-issues default to a leaner column set than the list (id/created/updated off). */
export const DEFAULT_SUBISSUE_DISPLAY: SubIssueDisplay = {
  ordering: "priority",
  completed: "all",
  display: { ...DEFAULT_DISPLAY, id: false, created: false, updated: false },
};

const ORDERINGS: readonly Ordering[] = ["status", "priority", "dueDate", "title", "created", "updated"];
const COMPLETEDS: readonly Completed[] = ["all", "active"];

/** Pure: validate persisted sub-issue display JSON; fall back per field. */
export function parseSubIssueDisplay(raw: string | null): SubIssueDisplay {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "{}");
  } catch {
    return DEFAULT_SUBISSUE_DISPLAY;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_SUBISSUE_DISPLAY;
  const input = value as Record<string, unknown>;
  const ordering = ORDERINGS.includes(input.ordering as Ordering)
    ? (input.ordering as Ordering)
    : DEFAULT_SUBISSUE_DISPLAY.ordering;
  const completed = COMPLETEDS.includes(input.completed as Completed)
    ? (input.completed as Completed)
    : DEFAULT_SUBISSUE_DISPLAY.completed;
  const rawDisplay =
    input.display && typeof input.display === "object" && !Array.isArray(input.display)
      ? (input.display as Record<string, unknown>)
      : {};
  const display = { ...DEFAULT_SUBISSUE_DISPLAY.display };
  for (const key of Object.keys(display) as DisplayKey[]) {
    if (typeof rawDisplay[key] === "boolean") display[key] = rawDisplay[key];
  }
  return { ordering, completed, display };
}

export function loadSubIssueDisplay(): SubIssueDisplay {
  try {
    return parseSubIssueDisplay(localStorage.getItem(SUBISSUE_DISPLAY_KEY));
  } catch {
    return DEFAULT_SUBISSUE_DISPLAY;
  }
}

export function saveSubIssueDisplay(cfg: SubIssueDisplay): void {
  try {
    localStorage.setItem(SUBISSUE_DISPLAY_KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
