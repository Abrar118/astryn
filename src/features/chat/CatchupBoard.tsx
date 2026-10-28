import type { ReactNode } from "react";
import { AtSign, Hash, MessageCircle, MessagesSquare, RefreshCw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatCatchup, ChatConversation } from "@/lib/commands";
import type { ChatProvider, ChatSection } from "./provider";
import { ChatConversationRow, ChatMentionRow, ChatThreadRow } from "./ChatRows";

type SyncState = { isFetching: boolean; isError: boolean; refetch: () => unknown };

/** Section copy; `dms` can be renamed per provider (Teams calls them "Chats"). */
const SECTION_COPY: Record<ChatSection, { title: string; icon: LucideIcon; empty: string }> = {
  mentions: { title: "Mentions", icon: AtSign, empty: "No unread mentions." },
  dms: { title: "Direct messages", icon: MessageCircle, empty: "No unread DMs." },
  threads: { title: "Threads", icon: MessagesSquare, empty: "No unread threads." },
  channels: { title: "Channels", icon: Hash, empty: "No unread channels." },
};

/**
 * The provider-neutral catch-up board: header with refresh and stale warning,
 * then the sections the provider supports, in signal order. A provider that is
 * not configured gets a quiet connect prompt instead.
 */
export function CatchupBoard({
  provider,
  notConfigured,
  icon: ProviderIcon,
  connectText,
  onConnect,
  subtitle,
  catchup,
  sync,
  sections,
  sectionCopy,
}: {
  provider: ChatProvider;
  notConfigured: boolean;
  icon: LucideIcon;
  connectText: string;
  onConnect: () => void;
  subtitle?: string | null;
  catchup?: ChatCatchup;
  sync: SyncState;
  sections: ChatSection[];
  sectionCopy?: Partial<Record<ChatSection, { title: string; empty: string }>>;
}) {
  if (notConfigured) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted/50">
          <ProviderIcon className="size-7 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold text-foreground">{provider.name}</h1>
          <p className="max-w-xs text-sm text-muted-foreground">{connectText}</p>
        </div>
        <Button onClick={onConnect}>Connect {provider.name}</Button>
      </main>
    );
  }

  const conversations = catchup?.conversations ?? [];
  const mentions = catchup?.mentions ?? [];
  const threads = catchup?.threads ?? [];
  const dms = conversations.filter((c) => (c.kind === "dm" || c.kind === "group_dm") && c.unreadCount > 0);
  const channels = conversations.filter((c) => c.kind === "channel" && c.unreadCount > 0);

  const body: Record<ChatSection, { count: number; rows: ReactNode }> = {
    mentions: {
      count: mentions.length,
      rows: mentions.map((m) => (
        <ChatMentionRow key={`${m.conversationId}:${m.ts}`} msg={m} convName={convName(conversations, m.conversationId)} provider={provider} />
      )),
    },
    dms: { count: dms.length, rows: dms.map((c) => <ChatConversationRow key={c.id} conv={c} provider={provider} />) },
    threads: {
      count: threads.length,
      rows: threads.map((t) => <ChatThreadRow key={`${t.conversationId}:${t.threadTs}`} thread={t} provider={provider} />),
    },
    channels: { count: channels.length, rows: channels.map((c) => <ChatConversationRow key={c.id} conv={c} provider={provider} />) },
  };

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/60 bg-background px-6 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-foreground">{provider.name}</h1>
          {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
          {sync.isError && <span className="text-xs text-warning">Sync failed — showing cached data.</span>}
        </div>
        <Button variant="ghost" size="sm" aria-label="Refresh" disabled={sync.isFetching} onClick={() => sync.refetch()}>
          <RefreshCw className={`size-4 ${sync.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-8 pt-7 pb-28">
        {sections.map((s) => {
          const copy = { ...SECTION_COPY[s], ...sectionCopy?.[s] };
          return (
            <Section key={s} title={copy.title} count={body[s].count} icon={copy.icon} empty={copy.empty}>
              {body[s].rows}
            </Section>
          );
        })}
      </div>
    </main>
  );
}

function convName(conversations: ChatConversation[], id: string): string {
  const c = conversations.find((x) => x.id === id);
  return c?.name ?? id;
}

function Section({
  title, count, icon: Icon, empty, children,
}: {
  title: string;
  count: number;
  icon: LucideIcon;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex items-center gap-2.5 px-0.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/50">
          <Icon className="size-4 text-muted-foreground" />
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
