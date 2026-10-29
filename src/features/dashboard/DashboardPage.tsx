import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { dueLabel } from "@/features/issues/IssueRow";
import { relativeTime } from "@/features/inbox/notifications";
import {
  useDocsSources,
  useDocsStatus,
  useConnectionStatus,
  useGithubPrs,
  useGithubStatus,
  useNotifications,
  useSlackCatchup,
  useSlackStatus,
} from "@/lib/queries";
import { useTasks, useViewer } from "@/lib/taskQueries";
import { useWorkspace, type ViewKind } from "@/lib/tabs";
import { requestSettingsSection } from "@/features/settings/settingsSection";
import { trackerModulesActive, viewActive, useModules } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import { dhakaToday } from "@/lib/dates";
import {
  attentionItems,
  dashboardMetrics,
  dueLoad,
  noModulesActive,
  weekPreview,
  workloadBuckets,
  type AttentionItem,
  type DueLoadDay,
  type WorkloadBucket,
} from "./dashboard";

function SectionTitle({
  id,
  children,
  aside,
  size = "md",
}: {
  id: string;
  children: ReactNode;
  aside?: ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <header className="flex min-w-0 items-baseline justify-between gap-3">
      <h2
        id={id}
        className={cn("font-semibold tracking-tight text-foreground", size === "lg" ? "text-[15px]" : "text-[13px]")}
      >
        {children}
      </h2>
      {aside}
    </header>
  );
}

// ── Source lamps: the panel's status row, one lamp per active source ─────────

type SourceLamp = {
  key: string;
  name: string;
  status: string;
  detail: string;
  tone: Lamp;
  onOpen: () => void;
};

function SourceLamps({ sources }: { sources: SourceLamp[] }) {
  if (sources.length === 0) return null;
  return (
    <ul aria-label="Sources" className="flex flex-wrap items-center gap-x-1 gap-y-1">
      {sources.map((s) => (
        <li key={s.key}>
          <button
            type="button"
            onClick={s.onOpen}
            aria-label={`${s.name}: ${s.status}`}
            title={`${s.status} · ${s.detail}`}
            className="dash-control flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <IndicatorLamp tone={s.tone} />
            <span className="lowercase">{s.name}</span>
            {s.tone !== "success" && <span className="text-foreground lowercase">· {s.status}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Dial scale: the week read like a tuning dial, one needle at now ──────────

function DayTicks() {
  // One major tick at the day boundary and three minor ticks inside the day.
  return (
    <svg aria-hidden viewBox="0 0 100 12" preserveAspectRatio="none" className="dash-ticks h-3 w-full">
      <line x1="0.5" y1="0" x2="0.5" y2="12" vectorEffect="non-scaling-stroke" className="dash-tick-major" />
      {[25, 50, 75].map((x) => (
        <line key={x} x1={x} y1="6" x2={x} y2="12" vectorEffect="non-scaling-stroke" className="dash-tick-minor" />
      ))}
    </svg>
  );
}

function DialScale({
  days,
  overdue,
  available,
  onOpen,
}: {
  days: DueLoadDay[];
  overdue: number | null;
  available: boolean;
  onOpen: () => void;
}) {
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const longDay = (date: string) => new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: "long", month: "long", day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
  const shortDay = (date: string) => new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: "short",
  }).format(new Date(`${date}T00:00:00Z`)).toLowerCase();

  return (
    <div className="dash-zone px-4 pt-4 pb-3">
      <div className="dash-dial">
        <button
          type="button"
          onClick={onOpen}
          aria-label={overdue === null ? "Overdue: not cached. Open the agenda" : `Overdue: ${overdue}. Open the agenda`}
          className="dash-control dash-dial-past"
        >
          <span className={cn("dash-numeral text-[32px]", overdue ? "text-destructive" : "text-muted-foreground")}>
            {overdue ?? "—"}
          </span>
          <span className="flex h-2 items-center gap-0.5">
            {Array.from({ length: Math.min(overdue ?? 0, 4) }, (_, i) => (
              <IndicatorLamp key={i} tone="danger" className="size-1.5" />
            ))}
          </span>
          <span className="text-[12px] text-muted-foreground">overdue</span>
        </button>
        <div role="group" aria-label="Due in the next 7 days" className="dash-dial-days">
          <span aria-hidden className="dash-needle" />
          {days.map((day, index) => (
            <button
              key={day.date}
              type="button"
              onClick={onOpen}
              aria-label={`${index === 0 ? "Today, " : ""}${longDay(day.date)}: ${available ? day.count : "not cached"} due`}
              className="dash-control dash-day"
            >
              <span className="dash-numeral h-6 text-[22px] text-foreground">
                {available && day.count > 0 ? day.count : ""}
              </span>
              <span className="flex h-2 items-center gap-0.5">
                {available && Array.from({ length: Math.min(day.count, 4) }, (_, i) => (
                  <IndicatorLamp key={i} tone="neutral" className="size-1.5" />
                ))}
              </span>
              <DayTicks />
              <span className={cn(
                "text-[12px] tabular-nums",
                index === 0 ? "font-semibold text-foreground" : "text-muted-foreground",
              )}>
                <span className="dash-day-name">{index === 0 ? "today" : shortDay(day.date)}</span>{" "}
                <span className="dash-day-date">{Number(day.date.slice(8))}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-right text-[12px] tabular-nums text-muted-foreground">
        {available ? `${total} due in the next 7 days` : "Task cache unavailable"}
      </p>
    </div>
  );
}

// ── Readouts: live counts for the sources that are on ────────────────────────

type Readout = {
  key: string;
  label: string;
  value: number | null;
  /** The source is on but not connected: offer setup instead of a number. */
  setup?: boolean;
  alarm?: boolean;
  actionLabel: string;
  onOpen: () => void;
};

function Readouts({ readouts }: { readouts: Readout[] }) {
  if (readouts.length === 0) return null;
  return (
    <ul aria-label="Counts" className="dash-zone dash-readouts">
      {readouts.map((r) => (
        <li key={r.key} className="min-w-0">
          <button
            type="button"
            onClick={r.onOpen}
            aria-label={r.setup
              ? `${r.label}: not connected. ${r.actionLabel}`
              : `${r.label}: ${r.value ?? "not cached"}. ${r.actionLabel}`}
            className="dash-control dash-readout"
          >
            {r.setup ? (
              <span className="text-[14px] font-medium text-foreground underline decoration-muted-foreground underline-offset-4">set up</span>
            ) : (
              <span className={cn(
                "dash-numeral text-[28px]",
                r.alarm && r.value ? "text-destructive" : "text-foreground",
              )}>
                {r.value ?? "—"}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-[12px] lowercase text-muted-foreground">
              <IndicatorLamp tone={r.setup ? "off" : r.alarm && r.value ? "danger" : r.value ? "neutral" : "off"} />
              {r.label}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Attention queue: the ranked list the whole face is built around ──────────

const SOURCE_LABEL: Record<AttentionItem["source"], string> = {
  task: "task",
  github: "github",
  slack: "slack",
  inbox: "inbox",
};

const TONE_LAMP: Record<AttentionItem["tone"], Lamp> = {
  danger: "danger",
  warning: "warning",
  info: "info",
  neutral: "neutral",
};

function QueueMessage({ tone, title, body }: { tone: Lamp; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-6">
      <IndicatorLamp tone={tone} className="mt-1.5" />
      <div>
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function AttentionQueue({
  items,
  onOpen,
  loading,
  partial,
}: {
  items: AttentionItem[];
  onOpen: (item: AttentionItem) => void;
  loading: boolean;
  partial: boolean;
}) {
  const headingId = useId();
  const hintId = useId();
  const [cursor, setCursor] = useState(0);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = Math.min(cursor, Math.max(0, items.length - 1));

  const move = (next: number) => {
    const target = Math.max(0, Math.min(items.length - 1, next));
    setCursor(target);
    rowRefs.current[target]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const keys: Record<string, number> = {
      j: active + 1, ArrowDown: active + 1, k: active - 1, ArrowUp: active - 1, Home: 0, End: items.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    move(keys[event.key]);
  };

  return (
    <section aria-labelledby={headingId} className="dash-zone">
      <div className="border-b border-border px-4 py-3">
        <SectionTitle
          size="lg"
          id={headingId}
          aside={items.length > 0 ? (
            <span id={hintId} className="text-[12px] text-muted-foreground">
              j / k to move · enter to open
            </span>
          ) : undefined}
        >
          Needs you{items.length > 0 && (
            <span className="ml-2 font-normal tabular-nums text-muted-foreground">{items.length}</span>
          )}
        </SectionTitle>
      </div>
      {items.length === 0 ? (
        loading ? (
          <QueueMessage tone="off" title="Reading cached attention…" body="Available provider data will appear as it loads." />
        ) : partial ? (
          <QueueMessage
            tone="warning"
            title="Some caches are unavailable"
            body="The sources that loaded have nothing urgent. The lamps above show which source failed."
          />
        ) : (
          <QueueMessage
            tone="success"
            title="Nothing urgent right now"
            body="No overdue work, review requests, mentions or unread notifications."
          />
        )
      ) : (
        <ul aria-label="Needs you" aria-describedby={hintId} onKeyDown={onKeyDown} className="dash-queue">
          {items.map((item, index) => (
            <li key={item.key}>
              <button
                ref={(el) => { rowRefs.current[index] = el; }}
                type="button"
                tabIndex={index === active ? 0 : -1}
                onFocus={() => setCursor(index)}
                onClick={() => onOpen(item)}
                aria-label={item.source === "task" ? `Open ${item.context}` : `Open ${item.source} ${item.context}`}
                className="dash-control dash-queue-row"
              >
                <IndicatorLamp tone={TONE_LAMP[item.tone]} />
                <span className="dash-queue-source text-[12px] text-muted-foreground">{SOURCE_LABEL[item.source]}</span>
                <span className="truncate font-mono text-[12px] text-muted-foreground">{item.context}</span>
                <span className="truncate text-[14px] font-medium text-foreground">{item.title}</span>
                <span className={cn(
                  "dash-queue-detail text-right text-[12px]",
                  item.tone === "danger" ? "text-destructive" : "text-muted-foreground",
                )}>
                  {item.detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── This week: the agenda below the fold ─────────────────────────────────────

function WeekAgenda({
  issues,
  workload,
  today,
  onOpenIssue,
  onOpenWeek,
  available,
}: {
  issues: ReturnType<typeof weekPreview>;
  workload: WorkloadBucket[];
  today: string;
  onOpenIssue: (id: string) => void;
  onOpenWeek: () => void;
  available: boolean;
}) {
  const headingId = useId();
  const plate = workload.map((b) => `${b.count} ${b.label.toLowerCase()}`).join(" · ");
  return (
    <section aria-labelledby={headingId} className="dash-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <SectionTitle id={headingId}>This week</SectionTitle>
        <div className="flex items-baseline gap-3">
          {available && <span className="text-[12px] tabular-nums text-muted-foreground">{plate}</span>}
          <button
            type="button"
            onClick={onOpenWeek}
            className="dash-control flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-foreground underline-offset-4 hover:underline"
          >
            Full agenda
            <ChevronRight className="size-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
      {!available ? (
        <QueueMessage tone="warning" title="Task cache unavailable" body="Your assigned tasks could not be read from the local cache." />
      ) : issues.length === 0 ? (
        <QueueMessage tone="success" title="Nothing else due this week" body="No assigned task is due between today and Saturday." />
      ) : (
        <ul className="dash-week-row-list">
          {issues.map((issue) => (
            <li key={issue.id}>
              <button
                type="button"
                aria-label={`Open ${issue.identifier} from this week`}
                onClick={() => onOpenIssue(issue.id)}
                className="dash-control dash-week-row"
              >
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: issue.stateColor }} />
                <span className="font-mono text-[12px] text-muted-foreground">{issue.identifier}</span>
                <span className="truncate text-[13px] text-foreground">{issue.title}</span>
                {issue.dueDate && (
                  <span className={cn(
                    "text-right text-[12px] tabular-nums",
                    issue.dueDate < today ? "text-destructive" : "text-muted-foreground",
                  )}>
                    {dueLabel(issue.dueDate, today)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Sources: provider health below the fold ──────────────────────────────────

function SourcesPanel({ sources }: { sources: SourceLamp[] }) {
  const headingId = useId();
  if (sources.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="dash-panel">
      <div className="border-b border-border px-4 py-3">
        <SectionTitle id={headingId}>Sources</SectionTitle>
      </div>
      <ul className="dash-week-row-list">
        {sources.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={s.onOpen}
              aria-label={`${s.name} ${s.status}: ${s.detail}`}
              className="dash-control dash-source-row"
            >
              <IndicatorLamp tone={s.tone} />
              <span className="text-[13px] font-medium text-foreground">{s.name}</span>
              <span className="truncate text-[12px] text-muted-foreground">
                {s.status}{s.detail ? ` · ${s.detail}` : ""}
              </span>
              <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Now", re-read on each minute boundary so Dhaka dates roll over on time. */
function useDashboardNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
  return now;
}

export function DashboardPage() {
  const { setActiveView } = useWorkspace();
  const [, setParams] = useSearchParams();
  const now = useDashboardNow();
  const today = dhakaToday(now);
  const { isActive, disabledScreens } = useModules();
  const linearOn = isActive("linear");
  const active = {
    tracker: trackerModulesActive(isActive),
    inbox: linearOn,
    github: isActive("github"),
    slack: isActive("slack"),
  };
  const docsOn = isActive("docs");
  const shown = (view: ViewKind) => viewActive(view, isActive, disabledScreens);
  const inboxOn = shown("inbox");
  // Links to switchable screens open the first one still shown; Calendar stays on with Linear.
  const weekView = (["this-week", "list"] as const).find(shown) ?? "calendar";
  const issuesView = shown("list") ? "list" : "calendar";

  const issuesQuery = useTasks({});
  const viewer = useViewer();
  const connectionStatusQuery = useConnectionStatus();
  const notificationsQuery = useNotifications({ enabled: false });
  const githubStatusQuery = useGithubStatus();
  const githubQuery = useGithubPrs();
  const slackStatusQuery = useSlackStatus();
  const slackQuery = useSlackCatchup();
  const docsStatusQuery = useDocsStatus();
  const docsSourcesQuery = useDocsSources();

  const issues = issuesQuery.data ?? [];
  const { viewerIds } = viewer;
  const notifications = inboxOn ? notificationsQuery.data?.notifications ?? [] : [];
  const prs = githubQuery.data?.prs ?? [];
  const slack = slackQuery.data;
  const input = { issues, prs, notifications, slack, viewerIds, today, active };
  const metrics = dashboardMetrics(input);
  const attention = attentionItems(input);
  const workload = workloadBuckets(issues, viewerIds);
  const dueDays = dueLoad(issues, viewerIds, today);
  // Overdue work already leads "Needs you"; the agenda lists what is still ahead.
  const preview = weekPreview(issues, viewerIds, today, 50).filter((i) => !i.dueDate || i.dueDate >= today).slice(0, 5);
  const taskDataAvailable = issuesQuery.data !== undefined && viewerIds.length > 0;
  const attentionPartial = (
    (issuesQuery.isError && issuesQuery.data === undefined)
    || (viewer.isError && viewerIds.length === 0)
    || (inboxOn && notificationsQuery.isError && notificationsQuery.data === undefined)
    || (githubQuery.isError && githubQuery.data === undefined)
    || (slackQuery.isError && slackQuery.data === undefined)
  );

  const openAttention = (item: AttentionItem) => {
    if (item.target === "issue" && item.entityId) {
      setParams({ issue: item.entityId });
      return;
    }
    setActiveView(item.target);
  };
  const openProviderSettings = (section: "linear" | "github" | "slack") => {
    requestSettingsSection(section);
    setActiveView("settings");
  };

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  if (noModulesActive(active)) {
    return (
      <main className="dashboard-surface h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col items-start gap-2 px-6 pt-8">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{dateLabel}</h1>
          <p className="text-[13px] text-muted-foreground">No modules are on. Turn some on in Settings → Modules.</p>
          <button
            type="button"
            onClick={() => setActiveView("settings")}
            className="dash-control mt-1 rounded-md bg-foreground px-3 py-1.5 text-[13px] font-medium text-background transition-opacity hover:opacity-90"
          >
            Open Settings
          </button>
        </div>
      </main>
    );
  }

  const newest = (values: (string | null | undefined)[]) =>
    values.filter((v): v is string => !!v).sort().pop();
  const latestGithubSync = newest(githubQuery.data?.meta.map((m) => m.lastSyncedAt) ?? []);
  const latestDocsSync = newest((docsSourcesQuery.data ?? []).map((s) => s.lastSyncedAt));
  const githubConfigured = githubStatusQuery.data !== undefined && githubStatusQuery.data.state !== "not_configured";
  const slackConfigured = slackStatusQuery.data !== undefined && slackStatusQuery.data.state !== "not_configured";
  const docsConnected = (docsStatusQuery.data?.sourceCount ?? 0) > 0;

  type Status = Pick<SourceLamp, "status" | "detail" | "tone">;
  const providerStatus = (
    q: { isError: boolean; isLoading: boolean },
    readError: boolean,
    state: string | undefined,
    connected: Status,
    setupDetail: string,
  ): Status => {
    if (readError) return { status: "Unavailable", detail: "Cached data could not be read", tone: "warning" };
    if (q.isLoading) return { status: "Reading cache", detail: "Checking local connection", tone: "off" };
    if (state === "connected") return connected;
    if (state === "unverified") return { status: "Cached", detail: "Connection not verified", tone: "warning" };
    return { status: "Set up", detail: setupDetail, tone: "off" };
  };

  const sources: SourceLamp[] = [];
  if (linearOn) {
    sources.push({
      key: "linear",
      name: "Linear",
      ...providerStatus(
        connectionStatusQuery,
        connectionStatusQuery.isError || issuesQuery.isError || viewer.isError,
        connectionStatusQuery.data?.state,
        { status: "Connected", detail: connectionStatusQuery.data?.state === "connected" ? connectionStatusQuery.data.name : "", tone: "success" },
        "Open Settings to connect",
      ),
      onOpen: () => setActiveView(connectionStatusQuery.data?.state === "not_configured" ? "settings" : issuesView),
    });
  }
  if (active.github) {
    sources.push({
      key: "github",
      name: "GitHub",
      ...providerStatus(
        githubStatusQuery,
        githubStatusQuery.isError || githubQuery.isError,
        githubStatusQuery.data?.state,
        {
          status: "Connected",
          detail: latestGithubSync
            ? `Last sync ${relativeTime(latestGithubSync)}`
            : githubStatusQuery.data?.state === "connected" ? `@${githubStatusQuery.data.login}` : "",
          tone: "success",
        },
        "Connect GitHub in Settings",
      ),
      onOpen: () => (githubConfigured ? setActiveView("prs") : openProviderSettings("github")),
    });
  }
  if (active.slack) {
    sources.push({
      key: "slack",
      name: "Slack",
      ...providerStatus(
        slackStatusQuery,
        slackStatusQuery.isError || slackQuery.isError,
        slackStatusQuery.data?.state,
        {
          status: "Connected",
          detail: slack?.lastSyncedAt
            ? `Last sync ${relativeTime(slack.lastSyncedAt)}`
            : slackStatusQuery.data?.state === "connected" ? slackStatusQuery.data.workspaceName ?? "Workspace connected" : "",
          tone: "success",
        },
        "Connect Slack in Settings",
      ),
      onOpen: () => (slackConfigured ? setActiveView("slack") : openProviderSettings("slack")),
    });
  }
  if (docsOn) {
    const docsError = docsStatusQuery.isError || docsSourcesQuery.isError;
    sources.push({
      key: "docs",
      name: "Docs",
      ...(docsError
        ? { status: "Unavailable", detail: "Cached data could not be read", tone: "warning" as const }
        : docsStatusQuery.isLoading
          ? { status: "Reading cache", detail: "Checking local sources", tone: "off" as const }
          : docsConnected
            ? {
                status: "Connected",
                detail: latestDocsSync
                  ? `Last sync ${relativeTime(latestDocsSync)}`
                  : `${docsStatusQuery.data?.sourceCount ?? 0} source${docsStatusQuery.data?.sourceCount === 1 ? "" : "s"}`,
                tone: "success" as const,
              }
            : { status: "Set up", detail: "Add a docs source in Settings", tone: "off" as const }),
      onOpen: () => setActiveView(docsConnected ? "docs" : "settings"),
    });
  }

  const readouts: Readout[] = [];
  if (active.github) {
    readouts.push({
      key: "reviews",
      label: "Reviews",
      value: githubQuery.data ? metrics.reviews : null,
      setup: githubStatusQuery.data?.state === "not_configured",
      actionLabel: "Open pull requests",
      onOpen: () => (githubConfigured ? setActiveView("prs") : openProviderSettings("github")),
    });
  }
  if (inboxOn) {
    readouts.push({
      key: "inbox",
      label: "Inbox",
      value: notificationsQuery.data ? metrics.inbox : null,
      setup: connectionStatusQuery.data?.state === "not_configured",
      actionLabel: "Open inbox",
      onOpen: () => (connectionStatusQuery.data?.state === "not_configured"
        ? openProviderSettings("linear")
        : setActiveView("inbox")),
    });
  }
  if (active.slack) {
    readouts.push({
      key: "mentions",
      label: "Mentions",
      value: slackQuery.data ? metrics.mentions : null,
      setup: slackStatusQuery.data?.state === "not_configured",
      actionLabel: "Open Slack",
      onOpen: () => (slackConfigured ? setActiveView("slack") : openProviderSettings("slack")),
    });
  }

  const anyLoading = issuesQuery.isLoading || viewer.isLoading || notificationsQuery.isLoading
    || githubQuery.isLoading || slackQuery.isLoading;

  return (
    <main className="dashboard-surface drawer-scrollbar h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-6 pt-6 pb-28">
        <header className="dash-head">
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{dateLabel}</h1>
          <SourceLamps sources={sources} />
        </header>

        <section aria-label="Overview" className="dash-panel dash-face">
          {active.tracker && (
            <DialScale
              days={dueDays}
              overdue={taskDataAvailable ? metrics.overdue : null}
              available={taskDataAvailable}
              onOpen={() => setActiveView(weekView)}
            />
          )}
          <Readouts readouts={readouts} />
          <AttentionQueue items={attention} onOpen={openAttention} loading={anyLoading} partial={attentionPartial} />
        </section>

        <div className="dash-lower">
          {active.tracker && (
            <WeekAgenda
              issues={preview}
              workload={workload}
              today={today}
              onOpenIssue={(id) => setParams({ issue: id })}
              onOpenWeek={() => setActiveView(weekView)}
              available={taskDataAvailable}
            />
          )}
          <SourcesPanel sources={sources} />
        </div>
      </div>
    </main>
  );
}
