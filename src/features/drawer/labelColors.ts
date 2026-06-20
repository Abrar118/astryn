import type { Label } from "@/lib/commands";

/** Linear-style label color palette. */
export const LABEL_COLORS = [
  "#6e79d6", "#4cb782", "#f2c94c", "#f2994a", "#eb5757",
  "#bb87fc", "#4ea7fc", "#2dd4bf", "#e879a6", "#95a2b3",
] as const;

/** Pick a palette color not already used by an existing label; cycle if all used. */
export function pickLabelColor(existing: Label[]): string {
  const used = new Set(existing.map((l) => (l.color ?? "").toLowerCase()));
  const free = LABEL_COLORS.find((c) => !used.has(c.toLowerCase()));
  return free ?? LABEL_COLORS[existing.length % LABEL_COLORS.length];
}
