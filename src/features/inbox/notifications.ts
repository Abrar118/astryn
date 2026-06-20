import type { Notification } from "@/lib/commands";

/** Turn a Linear notification `type` into a readable inbox subtitle.
 *  Unknown types fall back to a humanized form of the raw `kind`, so the inbox
 *  never shows a blank line even if Linear adds new notification types. */
export function notificationLabel(n: Notification): string {
  const actor = n.actorName ?? "Someone";
  const k = n.kind.toLowerCase();
  if (k.includes("mention")) return `${actor} mentioned you`;
  if (k.includes("comment")) return `${actor} commented`;
  if (k.includes("assign")) return `${actor} assigned this to you`;
  if (k.includes("added")) return `Issue added to ${n.issueProjectName ?? "a project"}`;
  if (k.includes("status") || k.includes("state")) {
    if (n.issueStateType === "completed") return `Marked as completed by ${actor}`;
    if (n.issueStateType === "canceled") return `Marked as canceled by ${actor}`;
    return `${actor} changed the status`;
  }
  if (k.includes("subscribed")) return `${actor} subscribed you`;
  if (k.includes("reaction")) return `${actor} reacted`;
  if (k.includes("due")) return `${actor} changed the due date`;
  return humanizeKind(n.kind);
}

/** "issueNewComment" → "New comment"; defensive fallback for unmapped types. */
function humanizeKind(kind: string): string {
  const spaced = kind
    .replace(/^issue/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return "Notification";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Compact relative timestamp ("now", "5m", "15h", "2d", "3w", "4mo"). */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  return `${Math.floor(day / 30)}mo`;
}
