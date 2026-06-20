import { useSearchParams } from "react-router-dom";
import { CalendarRange } from "lucide-react";
import { useIssues, useRelations, useMe, useUsers } from "../../lib/queries";
import { dhakaToday, weekWindow } from "../../lib/dates";
import { buildAgenda, type AgendaItem } from "./agenda";
import { IssueRow } from "../issues/IssueRow";
import { DEFAULT_DISPLAY } from "../issues/viewConfig";
import { useIssueMenu } from "../issues/IssueContextMenu";

const RELATION_LABEL: Record<string, string> = {
  blocks: "Blocks",
  blocked_by: "Blocked by",
  related: "Related",
  duplicate: "Duplicate",
};

export function AgendaView() {
  const today = dhakaToday();
  const window = weekWindow();
  const me = useMe();
  const { data: issues, isLoading: issuesLoading } = useIssues({});
  const { data: relations, isLoading: relsLoading } = useRelations();
  const { data: users } = useUsers();
  const { openMenu } = useIssueMenu();
  const [, setParams] = useSearchParams();

  const open = (id: string) => setParams({ issue: id });
  const avatarOf = (id: string | null) => {
    if (!id) return null;
    const u = (users ?? []).find((x) => x.id === id);
    return u ? { name: u.name } : null;
  };

  if (issuesLoading || relsLoading || me.isLoading) {
    return (
      <div className="space-y-2 p-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
        ))}
      </div>
    );
  }

  const viewerId = me.data?.viewerId;
  const groups = viewerId
    ? buildAgenda({ issues: issues ?? [], relations: relations ?? [], viewerId, window })
    : [];

  const isEmpty = groups.every((g) => g.items.length === 0);

  const renderItem = (item: AgendaItem) => (
    <div key={item.issue.id}>
      <IssueRow
        issue={item.issue}
        display={DEFAULT_DISPLAY}
        avatar={avatarOf(item.issue.assigneeId)}
        onOpen={open}
        onContextMenu={(e) => openMenu(e, item.issue.id)}
        today={today}
      />
      {(item.children.length > 0 || item.relations.length > 0) && (
        <div className="ml-5 border-l border-border/60 pl-1">
          {item.children.map((child) => (
            <IssueRow
              key={child.id}
              issue={child}
              display={DEFAULT_DISPLAY}
              avatar={avatarOf(child.assigneeId)}
              onOpen={open}
              onContextMenu={(e) => openMenu(e, child.id)}
              today={today}
            />
          ))}
          {item.relations.map((r) => (
            <button
              key={`${r.type}-${r.relatedId}`}
              type="button"
              onClick={() => open(r.relatedId)}
              className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50"
            >
              <span className="w-16 shrink-0 uppercase tracking-wide text-[10px]">
                {RELATION_LABEL[r.type] ?? r.type}
              </span>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: r.relatedStateColor ?? "#888" }}
                title={r.relatedStateName ?? undefined}
              />
              <span className="w-16 shrink-0 font-mono">{r.relatedIdentifier}</span>
              <span className="flex-1 truncate text-foreground/80">{r.relatedTitle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <CalendarRange className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">This Week</h1>
        <span className="text-xs text-muted-foreground">
          {window.weekStart} – {window.weekdays[4]}
        </span>
      </header>

      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">
          Nothing on your plate this week.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {groups.map((g) => (
            <section key={g.key}>
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-4 py-1.5 backdrop-blur">
                <span className="text-xs font-medium">{g.label}</span>
                {g.date && <span className="text-[11px] text-muted-foreground">{g.date}</span>}
                <span className="ml-auto text-[11px] text-muted-foreground">{g.items.length}</span>
              </div>
              {g.items.length ? (
                g.items.map(renderItem)
              ) : (
                <div className="px-4 py-2 text-xs text-muted-foreground/70">Nothing due</div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
