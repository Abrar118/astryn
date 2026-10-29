import { useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import {
  AtSign,
  Check,
  MessageSquare,
  Plus,
  RotateCw,
  type LucideProps,
} from "lucide-react";
import { useIssueDetail, useNotifications } from "@/lib/queries";
import type { Notification } from "@/lib/commands";
import { Avatar } from "@/components/Avatar";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { IssueDetail } from "@/features/drawer/IssueDrawer";
import { notificationLabel, relativeTime } from "./notifications";

/** The notification kind as a small monochrome glyph on the actor avatar.
 *  Kind is a category, not a state, so it never takes a colour. */
function kindGlyph(n: Notification): ComponentType<LucideProps> {
  const k = n.kind.toLowerCase();
  if (k.includes("mention")) return AtSign;
  if (k.includes("comment")) return MessageSquare;
  if ((k.includes("status") || k.includes("state")) && n.issueStateType === "completed") return Check;
  return Plus;
}

function NotificationRow({
  n,
  active,
  tabIndex,
  onFocus,
  onClick,
  rowRef,
}: {
  n: Notification;
  active: boolean;
  tabIndex: number;
  onFocus: () => void;
  onClick: () => void;
  rowRef: (el: HTMLButtonElement | null) => void;
}) {
  const Glyph = kindGlyph(n);
  return (
    <button
      ref={rowRef}
      type="button"
      tabIndex={tabIndex}
      onFocus={onFocus}
      onClick={onClick}
      aria-current={active}
      aria-label={`${n.read ? "" : "Unread: "}${n.issueIdentifier} ${n.issueTitle}. ${notificationLabel(n)}`}
      className={`dash-control grid w-full grid-cols-[8px_28px_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 text-left transition-colors ${
        active ? "bg-accent" : "hover:bg-accent"
      }`}
    >
      <span className="flex h-7 items-center">
        {!n.read && <IndicatorLamp tone="neutral" />}
      </span>

      <span className="relative">
        <Avatar name={n.actorName ?? "?"} size={28} />
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground">
          <Glyph className="size-2.5" strokeWidth={2.5} />
        </span>
      </span>

      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
            {n.issueIdentifier}
          </span>
          <span className={`min-w-0 truncate text-[13px] ${n.read ? "text-muted-foreground" : "font-medium text-foreground"}`}>
            {n.issueTitle}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {notificationLabel(n)}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
        <StatusIcon type={n.issueStateType} color={n.issueStateColor} />
        <span className="text-[12px] tabular-nums text-muted-foreground">{relativeTime(n.createdAt)}</span>
      </span>
    </button>
  );
}

/** A one-line state message: lamp, what happened, and the way back. */
function InboxMessage({
  tone,
  title,
  body,
  onRetry,
}: {
  tone: Lamp;
  title: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-5">
      <IndicatorLamp tone={tone} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        {body && <p className="mt-0.5 text-[12px] text-muted-foreground">{body}</p>}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="dash-control mt-3 flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
          >
            <RotateCw aria-hidden className="size-3.5" />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

/** Right-pane issue detail for the selected notification — reuses the drawer's
 *  shared IssueDetail composition (description + properties + activity). */
function NotificationDetail({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const { data: result, isError, isLoading, refetch } = useIssueDetail(issueId);
  if (isError && !result) {
    return (
      <div className="max-w-[560px] pt-4">
        <InboxMessage
          tone="warning"
          title="Couldn't load this issue."
          onRetry={() => refetch()}
        />
      </div>
    );
  }
  if (!result) {
    return (
      <div className="max-w-[560px] pt-4">
        <InboxMessage tone="off" title={isLoading ? "Reading the issue…" : "Issue unavailable."} />
      </div>
    );
  }
  return (
    <div className="flex h-full w-full flex-col">
      <IssueDetail id={issueId} result={result} mode="drawer" onClose={onClose} />
    </div>
  );
}

export function InboxView() {
  const { data, isLoading, isError, refetch } = useNotifications();
  const list = data?.notifications ?? [];
  const hasMore = data?.hasMore ?? false;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = list.find((n) => n.id === selectedId) ?? null;
  const unread = list.filter((n) => !n.read).length;
  const focusIndex = Math.min(cursor, Math.max(0, list.length - 1));

  // j / k and the arrows move through the list (Linear's inbox keys); Enter opens.
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const keys: Record<string, number> = {
      j: focusIndex + 1, ArrowDown: focusIndex + 1, k: focusIndex - 1, ArrowUp: focusIndex - 1, Home: 0, End: list.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(list.length - 1, keys[event.key]));
    setCursor(next);
    rowRefs.current[next]?.focus();
  };

  return (
    <div className="flex h-full min-h-0 bg-background">
      {/* Left rail — notification list */}
      <aside aria-label="Notifications" className="flex w-[360px] shrink-0 flex-col border-r border-border">
        <header className="flex items-baseline gap-3 border-b border-border px-4 py-3">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Inbox</h1>
          {list.length > 0 && (
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {unread > 0 ? `${unread} unread` : "all read"}
            </span>
          )}
        </header>

        <div className="drawer-scrollbar min-h-0 flex-1 overflow-y-auto">
          {isError && list.length === 0 ? (
            <InboxMessage
              tone="warning"
              title="Couldn't load notifications."
              onRetry={() => refetch()}
            />
          ) : isLoading && list.length === 0 ? (
            <InboxMessage tone="off" title="Reading notifications…" />
          ) : list.length === 0 ? (
            <InboxMessage tone="success" title="You're all caught up" body="Linear has no notifications for you." />
          ) : (
            <>
              <div onKeyDown={onListKeyDown} className="divide-y divide-border/70">
                {list.map((n, index) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    active={n.id === selectedId}
                    tabIndex={index === focusIndex ? 0 : -1}
                    onFocus={() => setCursor(index)}
                    onClick={() => setSelectedId(n.id)}
                    rowRef={(el) => { rowRefs.current[index] = el; }}
                  />
                ))}
              </div>
              {hasMore && (
                <p className="border-t border-border/70 px-4 py-3 text-[12px] text-muted-foreground">
                  Showing your most recent notifications
                </p>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Right pane — selected issue (reused drawer) or the unread reading */}
      <section aria-label="Notification detail" className="min-w-0 flex-1">
        {selected ? (
          <NotificationDetail issueId={selected.issueId} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="px-8 pt-8">
            <span className={`dash-numeral text-[32px] ${unread ? "text-foreground" : "text-muted-foreground"}`}>
              {data ? unread : "—"}
            </span>
            <span className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <IndicatorLamp tone={unread ? "neutral" : "off"} />
              unread
            </span>
            <p className="mt-6 max-w-[52ch] text-[13px] text-pretty text-muted-foreground">
              {list.length > 0
                ? "Select a notification to read its issue here. j / k to move, enter to open."
                : "Notifications from Linear land here."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
