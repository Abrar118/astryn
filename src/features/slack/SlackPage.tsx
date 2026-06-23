import { AtSign, MessageCircle, MessageSquare, MessagesSquare, Hash, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/tabs";
import { useSlackCatchup, useSlackStatus, useSlackSync } from "@/lib/queries";
import type { SlackConversation } from "@/lib/commands";
import { SlackRow, SlackMentionRow, SlackThreadRow } from "./SlackRow";

export function SlackPage() {
  const { setActiveView } = useWorkspace();
  const { data: status } = useSlackStatus();
  const connected = status?.state === "connected" || status?.state === "unverified";
  const { data: catchup } = useSlackCatchup();
  const sync = useSlackSync(connected);

  if (status?.state === "not_configured") {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
          <MessageSquare className="size-7 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold text-foreground">Slack</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            Link your Slack workspace to catch up on what you missed.
          </p>
        </div>
        <Button onClick={() => setActiveView("settings")}>Connect Slack</Button>
      </main>
    );
  }

  const conversations = catchup?.conversations ?? [];
  const mentions = catchup?.mentions ?? [];
  const threads = catchup?.threads ?? [];
  const dms = conversations.filter((c) => c.kind === "dm" || c.kind === "group_dm");
  const channels = conversations.filter((c) => c.kind === "channel");
  const workspaceName = status?.state === "connected" ? status.workspaceName : null;

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-6 py-3 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-foreground">Slack</h1>
          {workspaceName && <span className="text-xs text-muted-foreground">{workspaceName}</span>}
          {sync.isError && <span className="text-xs text-amber-400">Sync failed — showing cached data.</span>}
        </div>
        <Button variant="ghost" size="sm" aria-label="Refresh" disabled={sync.isFetching} onClick={() => sync.refetch()}>
          <RefreshCw className={`size-4 ${sync.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-8 pt-7 pb-28">
        <Section title="Mentions" count={mentions.length} icon={AtSign} tint="text-amber-400" empty="No unread mentions.">
          {mentions.map((m) => <SlackMentionRow key={`${m.conversationId}:${m.ts}`} msg={m} convName={convName(conversations, m.conversationId)} />)}
        </Section>
        <Section title="Direct messages" count={dms.length} icon={MessageCircle} tint="text-emerald-400" empty="No unread DMs.">
          {dms.map((c) => <SlackRow key={c.id} conv={c} />)}
        </Section>
        <Section title="Threads" count={threads.length} icon={MessagesSquare} tint="text-sky-400" empty="No unread threads.">
          {threads.map((t) => <SlackThreadRow key={`${t.conversationId}:${t.threadTs}`} thread={t} />)}
        </Section>
        <Section title="Channels" count={channels.length} icon={Hash} tint="text-indigo-400" empty="No unread channels.">
          {channels.map((c) => <SlackRow key={c.id} conv={c} />)}
        </Section>
      </div>
    </main>
  );
}

function convName(conversations: SlackConversation[], id: string): string {
  const c = conversations.find((x) => x.id === id);
  return c?.name ?? id;
}

function Section({
  title, count, icon: Icon, tint, empty, children,
}: {
  title: string;
  count: number;
  icon: typeof AtSign;
  tint: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex items-center gap-2.5 px-0.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/50">
          <Icon className={`size-4 ${tint}`} />
        </span>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
          {count}
        </span>
      </header>
      {count === 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-card/40 px-5 py-4 text-sm text-muted-foreground">
          <Icon className="size-4 shrink-0 opacity-50" />
          <span>{empty}</span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">{children}</div>
      )}
    </section>
  );
}
