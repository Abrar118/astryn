import { SetupState } from "@/components/SetupState";
import { useId, type ReactNode } from "react";
import type { ChatCatchup, ChatConversation } from "@/lib/commands";
import { cn } from "@/lib/utils";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import { SyncHeader, syncLamp } from "@/components/SyncHeader";
import type { ChatProvider, ChatSection } from "./provider";
import { ChatConversationRow, ChatMentionRow, ChatThreadRow } from "./ChatRows";

type SyncState = { isFetching: boolean; isError: boolean; refetch: () => unknown };

/** Section copy; `dms` can be renamed per provider (Teams calls them "Chats"). */
const SECTION_COPY: Record<ChatSection, { title: string; empty: string }> = {
  mentions: { title: "Mentions", empty: "No unread mentions." },
  dms: { title: "Direct messages", empty: "No unread DMs." },
  threads: { title: "Threads", empty: "No unread threads." },
  channels: { title: "Channels", empty: "No unread channels." },
};

/** A mention is the one section that asks for you; the rest are neutral counts. */
function sectionLamp(section: ChatSection, count: number): Lamp {
  if (count === 0) return "off";
  return section === "mentions" ? "warning" : "neutral";
}

/**
 * The provider-neutral catch-up board: header with the source lamp and refresh,
 * then one faceplate: a reading per section (each jumps to its section), and
 * the sections the provider supports as hairline zones, in signal order. A
 * provider that is not configured gets the shared setup row instead.
 */
export function CatchupBoard({
  provider,
  notConfigured,
  connectText,
  onConnect,
  state,
  subtitle,
  catchup,
  sync,
  sections,
  sectionCopy,
}: {
  provider: ChatProvider;
  notConfigured: boolean;
  connectText: string;
  onConnect: () => void;
  /** The provider's connection state, read by the header lamp. */
  state?: string;
  subtitle?: string | null;
  catchup?: ChatCatchup;
  sync: SyncState;
  sections: ChatSection[];
  sectionCopy?: Partial<Record<ChatSection, { title: string; empty: string }>>;
}) {
  const idBase = useId();
  if (notConfigured) {
    return (
      <SetupState
        title={provider.name}
        message={connectText}
        action={`Connect ${provider.name}`}
        onAction={onConnect}
      />
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
  const copyOf = (s: ChatSection) => ({ ...SECTION_COPY[s], ...sectionCopy?.[s] });
  const headingId = (s: ChatSection) => `${idBase}-${s}`;
  const jumpTo = (s: ChatSection) => {
    const heading = document.getElementById(headingId(s));
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    heading?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    heading?.focus({ preventScroll: true });
  };

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <SyncHeader
        title={provider.name}
        status={syncLamp({
          state,
          syncFailed: sync.isError,
          connectedDetail: subtitle ? `${provider.name.toLowerCase()} · ${subtitle}` : provider.name.toLowerCase(),
        })}
        refreshing={sync.isFetching}
        onRefresh={() => void sync.refetch()}
      />

      <div className="drawer-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[920px] px-6 pt-5 pb-28">
          <section aria-label="Catch-up" className="dash-panel dash-face">
            <ul aria-label="Unread" className="dash-zone dash-readouts">
              {sections.map((s) => {
                const count = body[s].count;
                const legend = copyOf(s).title.toLowerCase();
                return (
                  <li key={s} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => jumpTo(s)}
                      aria-label={`${count} ${legend}. Go to ${legend}`}
                      className="dash-control dash-readout"
                    >
                      <span className={cn("dash-numeral text-[28px]", count ? "text-foreground" : "text-muted-foreground")}>
                        {count}
                      </span>
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-muted-foreground">
                        <IndicatorLamp tone={sectionLamp(s, count)} />
                        {legend}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {sections.map((s) => {
              const copy = copyOf(s);
              return (
                <Section key={s} id={headingId(s)} title={copy.title} count={body[s].count} empty={copy.empty}>
                  {body[s].rows}
                </Section>
              );
            })}
          </section>
        </div>
      </div>
    </main>
  );
}

function convName(conversations: ChatConversation[], id: string): string {
  const c = conversations.find((x) => x.id === id);
  return c?.name ?? id;
}

function Section({
  id, title, count, empty, children,
}: {
  id: string;
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="dash-zone">
      <header className="flex items-baseline gap-2 border-b border-border px-4 py-3">
        <h2 id={id} tabIndex={-1} className="scroll-mt-4 text-[15px] font-semibold tracking-tight text-foreground outline-none">
          {title}
        </h2>
        <span className="text-[13px] tabular-nums text-muted-foreground">{count}</span>
      </header>
      {count === 0 ? (
        <div className="flex items-center gap-3 px-4 py-4">
          <IndicatorLamp tone="off" />
          <p className="text-[13px] text-muted-foreground">{empty}</p>
        </div>
      ) : (
        <div className="divide-y divide-border/70">{children}</div>
      )}
    </section>
  );
}
