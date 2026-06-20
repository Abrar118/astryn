import { useState, type ComponentType } from "react";
import {
  AtSign,
  Check,
  Inbox as InboxIcon,
  MessageSquare,
  Plus,
  type LucideProps,
} from "lucide-react";
import { useIssueDetail, useNotifications } from "@/lib/queries";
import type { Notification } from "@/lib/commands";
import { Avatar } from "@/components/Avatar";
import { StatusIcon } from "@/features/drawer/issueGlyphs";
import { IssueDetail } from "@/features/drawer/IssueDrawer";
import { notificationLabel, relativeTime } from "./notifications";

/** A small overlay badge on the actor avatar that hints at the notification kind. */
function kindBadge(n: Notification): { Icon: ComponentType<LucideProps>; className: string } {
  const k = n.kind.toLowerCase();
  if (k.includes("mention")) return { Icon: AtSign, className: "bg-primary text-primary-foreground" };
  if (k.includes("comment")) return { Icon: MessageSquare, className: "bg-sky-600 text-white" };
  if (k.includes("status") || k.includes("state")) {
    if (n.issueStateType === "completed") return { Icon: Check, className: "bg-emerald-600 text-white" };
  }
  return { Icon: Plus, className: "bg-muted text-muted-foreground" };
}

function NotificationRow({
  n,
  active,
  onClick,
}: {
  n: Notification;
  active: boolean;
  onClick: () => void;
}) {
  const { Icon, className } = kindBadge(n);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={`flex w-full cursor-pointer items-start gap-3 border-b border-border/40 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
        active ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <span className="relative mt-0.5 shrink-0">
        <Avatar name={n.actorName ?? "?"} size={28} />
        <span
          className={`absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full ring-2 ring-sidebar ${className}`}
        >
          <Icon className="size-2" strokeWidth={3} />
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
          <span className={`font-mono text-[11px] shrink-0 ${n.read ? "text-muted-foreground/70" : "text-muted-foreground"}`}>
            {n.issueIdentifier}
          </span>
          <span className={`min-w-0 truncate text-[13px] ${n.read ? "text-muted-foreground" : "font-medium text-foreground"}`}>
            {n.issueTitle}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {notificationLabel(n)}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <StatusIcon type={n.issueStateType} color={n.issueStateColor} />
        <span className="text-[11px] tabular-nums text-muted-foreground/70">{relativeTime(n.createdAt)}</span>
      </span>
    </button>
  );
}

/** Right-pane issue detail for the selected notification — reuses the drawer's
 *  shared IssueDetail composition (description + properties + activity). */
function NotificationDetail({ issueId, onClose }: { issueId: string; onClose: () => void }) {
  const { data: result } = useIssueDetail(issueId);
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
    );
  }
  return (
    <div className="flex h-full w-full flex-col">
      <IssueDetail id={issueId} result={result} mode="drawer" onClose={onClose} />
    </div>
  );
}

export function InboxView() {
  const { data, isLoading } = useNotifications();
  const list = data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = list.find((n) => n.id === selectedId) ?? null;
  const unread = list.filter((n) => !n.read).length;

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail — notification list */}
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-border bg-sidebar/30">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">Inbox</h1>
          {unread > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              {unread}
            </span>
          )}
        </header>

        <div className="drawer-scrollbar min-h-0 flex-1 overflow-y-auto">
          {isLoading && list.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <InboxIcon className="size-7 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">You're all caught up</p>
            </div>
          ) : (
            list.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                active={n.id === selectedId}
                onClick={() => setSelectedId(n.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* Right pane — selected issue (reused drawer) or empty state */}
      <section className="min-w-0 flex-1">
        {selected ? (
          <NotificationDetail issueId={selected.issueId} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <InboxIcon className="size-14 text-muted-foreground/30" strokeWidth={1.25} />
            <p className="text-sm text-muted-foreground">
              {unread > 0
                ? `${unread} unread notification${unread === 1 ? "" : "s"}`
                : "No unread notifications"}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
