/** Local-task status hues that hold 3:1 against both the dark and the light
 *  finishes. Older palette values stored in the database map to their
 *  replacement at render time; any other color (Linear's) passes through. */
const LEGACY_STATUS_HUES: Record<string, string> = {
  "#8b8d98": "#858793",
  "#a3a6b4": "#6f7a8c",
  "#3e9e9a": "#3a9894",
  "#4b9e6a": "#479865",
  "#d99a2b": "#ac6721",
  "#d9773b": "#c96a30",
};

export function statusHue(color: string): string;
export function statusHue(color: string | null | undefined): string | undefined;
export function statusHue(color: string | null | undefined): string | undefined {
  if (!color) return color ?? undefined;
  return LEGACY_STATUS_HUES[color.toLowerCase()] ?? color;
}
