import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Clock, Users } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import type { User } from "@/lib/commands";

type Rect = { top: number; bottom: number; left: number };

/** Current time in the user's IANA timezone, e.g. "12:47 AM", or null. */
function localTime(timezone: string | null | undefined): string | null {
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat([], {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return null; // unknown/invalid zone
  }
}

/**
 * Wraps a user-mention pill and reveals a Linear-style profile card on hover:
 * avatar, name, @handle, the user's current local time, and their team. Fields
 * Linear doesn't expose via the API (live presence, job title) are omitted.
 */
export function MentionHoverCard({ user, children }: { user: User; children: ReactNode }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | null>(null);

  const open = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.top, bottom: r.bottom, left: r.left });
  };
  const scheduleClose = () => {
    closeTimer.current = window.setTimeout(() => setRect(null), 120);
  };

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const time = localTime(user.timezone);
  const flipUp = rect ? rect.bottom > window.innerHeight - 220 : false;
  const style: React.CSSProperties | undefined = rect
    ? {
        position: "fixed",
        left: Math.min(rect.left, window.innerWidth - 288),
        ...(flipUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
        zIndex: 70,
      }
    : undefined;

  return (
    <span ref={anchorRef} onMouseEnter={open} onMouseLeave={scheduleClose} className="inline">
      {children}
      {rect &&
        createPortal(
          <div
            style={style}
            onMouseEnter={open}
            onMouseLeave={scheduleClose}
            className="w-72 rounded-xl border border-border bg-popover p-3 shadow-2xl"
          >
            <div className="flex items-center gap-3">
              <Avatar name={user.name} src={user.avatarUrl} size={44} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{user.name}</div>
                {user.displayName && (
                  <div className="truncate text-xs text-muted-foreground">{user.displayName}</div>
                )}
              </div>
            </div>
            {(time || user.teamName) && (
              <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-[13px] text-foreground">
                {time && (
                  <div className="flex items-center gap-2">
                    <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                    <span>
                      {time} <span className="text-muted-foreground">local time</span>
                    </span>
                  </div>
                )}
                {user.teamName && (
                  <div className="flex items-center gap-2">
                    <Users className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{user.teamName}</span>
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
