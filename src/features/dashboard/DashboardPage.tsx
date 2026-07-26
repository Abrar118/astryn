import { useEffect, useId, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  BookText,
  Calendar,
  CalendarRange,
  CheckCircle2,
  CircleDot,
  Clock3,
  GitMerge,
  GitPullRequest,
  Inbox,
  Layers3,
  List,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  NotebookPen,
  Radio,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { DualClock } from "@/features/home/DualClock";
import { dueLabel } from "@/features/issues/IssueRow";
import { prStats } from "@/features/prs/prActivity";
import { relativeTime } from "@/features/inbox/notifications";
import {
  useDocsSources,
  useDocsStatus,
  useConnectionStatus,
  useGithubPrs,
  useGithubStatus,
  useIssues,
  useMe,
  useNotifications,
  useSlackCatchup,
  useSlackStatus,
} from "@/lib/queries";
import { useWorkspace, type ViewKind } from "@/lib/tabs";
import { cn } from "@/lib/utils";
import { dhakaToday } from "@/lib/dates";
import {
  attentionItems,
  dashboardMetrics,
  dueLoad,
  weekPreview,
  workloadBuckets,
  type AttentionItem,
  type DueLoadDay,
  type WorkloadBucket,
} from "./dashboard";

type GlassCardProps = {
  children: ReactNode;
  className?: string;
  ariaLabelledBy?: string;
};

function GlassCard({ children, className, ariaLabelledBy }: GlassCardProps) {
  return (
    <section
      aria-labelledby={ariaLabelledBy}
      className={cn("dashboard-glass min-w-0 rounded-xl border", className)}
    >
      {children}
    </section>
  );
}

function SectionHeading({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-[13px] font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </header>
  );
}

function CacheUnavailable({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-lg bg-amber-500/5 px-3 py-5 text-center text-xs text-amber-300 ring-1 ring-amber-400/15">
      {children}
    </p>
  );
}

const KPI_STYLES = {
  rose: {
    icon: "bg-rose-500/12 text-rose-400 ring-rose-400/20",
    glow: "from-rose-500/16 via-rose-500/4",
  },
  violet: {
    icon: "bg-violet-500/12 text-violet-400 ring-violet-400/20",
    glow: "from-violet-500/16 via-violet-500/4",
  },
  cyan: {
    icon: "bg-cyan-500/12 text-cyan-400 ring-cyan-400/20",
    glow: "from-cyan-500/16 via-cyan-500/4",
  },
  amber: {
    icon: "bg-amber-500/12 text-amber-400 ring-amber-400/20",
    glow: "from-amber-500/16 via-amber-500/4",
  },
} as const;

function KpiCard({
  label,
  value,
  description,
  Icon,
  tone,
  loading,
  actionLabel,
  onOpen,
}: {
  label: string;
  value: number | null;
  description: string;
  Icon: LucideIcon;
  tone: keyof typeof KPI_STYLES;
  loading: boolean;
  actionLabel: string;
  onOpen: () => void;
}) {
  const style = KPI_STYLES[tone];
  return (
    <button
      type="button"
      aria-label={actionLabel}
      onClick={onOpen}
      className="dashboard-glass group relative min-w-0 cursor-pointer overflow-hidden rounded-xl border p-3.5 text-left transition-colors duration-150 hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent opacity-70",
          style.glow,
        )}
      />
      <span className="relative flex items-start justify-between gap-3">
        <span>
          <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
          <span className="mt-1.5 block text-[28px] font-semibold leading-none tabular-nums tracking-tight text-foreground">
            {loading || value === null ? "—" : value}
          </span>
        </span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg ring-1", style.icon)}>
          <Icon className="size-4" />
        </span>
      </span>
      <span className="relative mt-2.5 flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-[10.5px] text-muted-foreground">
          {loading ? "Reading cache…" : description}
        </span>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      </span>
    </button>
  );
}

const ATTENTION_ICON: Record<AttentionItem["source"], LucideIcon> = {
  linear: Layers3,
  github: GitPullRequest,
  slack: MessageSquare,
  inbox: Inbox,
};

const ATTENTION_TONE: Record<AttentionItem["tone"], string> = {
  danger: "bg-rose-500/12 text-rose-400 ring-rose-400/20",
  warning: "bg-amber-500/12 text-amber-400 ring-amber-400/20",
  violet: "bg-violet-500/12 text-violet-400 ring-violet-400/20",
  cyan: "bg-cyan-500/12 text-cyan-400 ring-cyan-400/20",
};

function AttentionTable({
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
  return (
    <GlassCard className="overflow-hidden" ariaLabelledBy={headingId}>
      <div className="border-b border-border/60 px-4 py-3.5">
        <SectionHeading
          id={headingId}
          title="Needs your attention"
          description="Ranked across Linear, GitHub, Slack, and Inbox"
          action={(
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-primary ring-1 ring-primary/20">
              {items.length}
            </span>
          )}
        />
      </div>
      {items.length === 0 ? (
        loading ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400 ring-1 ring-violet-400/20">
              <Clock3 className="size-5" />
            </span>
            <p className="text-sm font-medium text-foreground">
              Reading cached attention…
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Available provider data will appear as it loads.
            </p>
          </div>
        ) : partial ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-400/20">
              <AlertTriangle className="size-5" />
            </span>
            <p className="text-sm font-medium text-foreground">
              Some caches are unavailable
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Available sources have no urgent items. Check Sources for details.
            </p>
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-400/20">
              <CheckCircle2 className="size-5" />
            </span>
            <p className="text-sm font-medium text-foreground">Nothing urgent right now</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Available caches have no overdue work or unread requests.
            </p>
          </div>
        )
      ) : (
        <div className="min-w-0 overflow-hidden">
          <table aria-label="Needs your attention" className="w-full table-fixed border-collapse">
            <thead className="sr-only">
              <tr>
                <th>Source</th>
                <th>Item</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const Icon = ATTENTION_ICON[item.source];
                const actionName = item.source === "linear"
                  ? `Open ${item.context}`
                  : `Open ${item.source} ${item.context}`;
                return (
                  <tr
                    key={item.key}
                    className="border-b border-border/45 last:border-b-0 hover:bg-foreground/[0.025]"
                  >
                    <td className="w-12 py-2.5 pl-4 pr-2 align-middle">
                      <span className={cn(
                        "flex size-7 items-center justify-center rounded-lg ring-1",
                        ATTENTION_TONE[item.tone],
                      )}>
                        <Icon className="size-3.5" />
                      </span>
                    </td>
                    <td className="min-w-0 py-2.5 pr-3 align-middle">
                      <button
                        type="button"
                        aria-label={actionName}
                        onClick={() => onOpen(item)}
                        className="group/item block w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                            {item.context}
                          </span>
                          <span className="truncate text-xs font-medium text-foreground group-hover/item:text-primary">
                            {item.title}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="dashboard-attention-status w-32 py-2.5 pr-3 text-right align-middle">
                      <span className="text-[10.5px] text-muted-foreground">{item.detail}</span>
                    </td>
                    <td className="w-9 py-2.5 pr-4 text-right align-middle">
                      <button
                        type="button"
                        aria-label={`${actionName} action`}
                        onClick={() => onOpen(item)}
                        className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <ArrowRight className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  );
}

function WorkloadChart({
  buckets,
  available,
}: {
  buckets: WorkloadBucket[];
  available: boolean;
}) {
  const headingId = useId();
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <GlassCard className="p-4" ariaLabelledBy={headingId}>
      <SectionHeading
        id={headingId}
        title="Active workload"
        description={`${total} viewer-assigned issue${total === 1 ? "" : "s"}`}
      />
      {!available ? (
        <CacheUnavailable>Linear workload cache unavailable.</CacheUnavailable>
      ) : <div className="mt-4 space-y-3">
        {buckets.map((bucket) => (
          <div key={bucket.key}>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[10.5px]">
              <span className="text-muted-foreground">{bucket.label}</span>
              <span className="font-medium tabular-nums text-foreground">{bucket.count}</span>
            </div>
            <div
              role="img"
              aria-label={`${bucket.label}: ${bucket.count}`}
              className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.055]"
            >
              <span
                className="block h-full rounded-full transition-[width] duration-200"
                style={{
                  width: `${bucket.count === 0 ? 0 : Math.max(8, (bucket.count / max) * 100)}%`,
                  backgroundColor: bucket.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>}
    </GlassCard>
  );
}

function DueLoadChart({
  days,
  available,
}: {
  days: DueLoadDay[];
  available: boolean;
}) {
  const headingId = useId();
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const max = Math.max(1, ...days.map((day) => day.count));
  return (
    <GlassCard className="p-4" ariaLabelledBy={headingId}>
      <SectionHeading
        id={headingId}
        title="Due load"
        description={`${total} issue${total === 1 ? "" : "s"} · next 7 days`}
      />
      {!available ? (
        <CacheUnavailable>Linear due-date cache unavailable.</CacheUnavailable>
      ) : <div className="mt-4 grid h-24 grid-cols-7 items-end gap-1.5">
        {days.map((day, index) => (
          <div key={day.date} className="flex h-full min-w-0 flex-col items-center justify-end gap-1.5">
            <span className="text-[9px] font-medium tabular-nums text-foreground">
              {day.count || ""}
            </span>
            <div
              role="img"
              aria-label={`${day.label}: ${day.count} due`}
              className="flex h-14 w-full max-w-6 items-end overflow-hidden rounded-md bg-foreground/[0.045]"
            >
              <span
                className={cn(
                  "block w-full rounded-md bg-gradient-to-t transition-[height] duration-200",
                  index === 0
                    ? "from-cyan-500/70 to-indigo-400"
                    : "from-indigo-600/45 to-violet-400/85",
                )}
                style={{ height: `${day.count === 0 ? 5 : Math.max(18, (day.count / max) * 100)}%` }}
              />
            </div>
            <span className="truncate text-[9px] text-muted-foreground">{day.label}</span>
          </div>
        ))}
      </div>}
    </GlassCard>
  );
}

function WeekCard({
  issues,
  today,
  onOpenIssue,
  onOpenWeek,
  available,
}: {
  issues: ReturnType<typeof weekPreview>;
  today: string;
  onOpenIssue: (id: string) => void;
  onOpenWeek: () => void;
  available: boolean;
}) {
  const headingId = useId();
  return (
    <GlassCard className="p-4" ariaLabelledBy={headingId}>
      <SectionHeading
        id={headingId}
        title="Today & this week"
        description="Your nearest Linear deadlines"
        action={(
          <button
            type="button"
            onClick={onOpenWeek}
            className="flex cursor-pointer items-center gap-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Full agenda <ArrowRight className="size-3" />
          </button>
        )}
      />
      {!available ? (
        <CacheUnavailable>Linear deadline cache unavailable.</CacheUnavailable>
      ) : <div className="mt-3 divide-y divide-border/45">
        {issues.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Nothing due this week.</p>
        ) : issues.map((issue) => (
          <button
            key={issue.id}
            type="button"
            aria-label={`Open ${issue.identifier} from week preview`}
            onClick={() => onOpenIssue(issue.id)}
            className="flex w-full min-w-0 cursor-pointer items-center gap-2 py-2 text-left transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: issue.stateColor }} />
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{issue.identifier}</span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{issue.title}</span>
            {issue.dueDate && (
              <span className={cn(
                "shrink-0 text-[10px]",
                issue.dueDate < today ? "text-rose-400" : "text-muted-foreground",
              )}>
                {dueLabel(issue.dueDate, today)}
              </span>
            )}
          </button>
        ))}
      </div>}
    </GlassCard>
  );
}

function MetricLine({
  Icon,
  label,
  value,
  tint,
}: {
  Icon: LucideIcon;
  label: string;
  value: number | null;
  tint: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-foreground/[0.025] px-2.5 py-2 ring-1 ring-foreground/[0.055]">
      <Icon className={cn("size-3.5 shrink-0", tint)} />
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold tabular-nums text-foreground">
        {value ?? "—"}
      </span>
    </div>
  );
}

function PrHealthCard({
  stats,
  onOpen,
  available,
}: {
  stats: ReturnType<typeof prStats>;
  onOpen: () => void;
  available: boolean;
}) {
  const headingId = useId();
  return (
    <GlassCard className="p-4" ariaLabelledBy={headingId}>
      <SectionHeading
        id={headingId}
        title="Pull request health"
        description="Distinct cached work across repositories"
        action={(
          <button
            type="button"
            onClick={onOpen}
            className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Open pull request health"
          >
            <ArrowRight className="size-3.5" />
          </button>
        )}
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MetricLine Icon={GitPullRequest} label="Open" value={available ? stats.open : null} tint="text-emerald-400" />
        <MetricLine Icon={CircleDot} label="Needs review" value={available ? stats.needsReview : null} tint="text-violet-400" />
        <MetricLine Icon={MessageCircle} label="Changes req." value={available ? stats.changesRequested : null} tint="text-amber-400" />
        <MetricLine Icon={GitMerge} label="Conflicts" value={available ? stats.conflicts : null} tint="text-rose-400" />
      </div>
    </GlassCard>
  );
}

function CommunicationCard({
  inbox,
  mentions,
  directMessages,
  threads,
  loading,
  onOpen,
}: {
  inbox: number | null;
  mentions: number | null;
  directMessages: number | null;
  threads: number | null;
  loading: boolean;
  onOpen: () => void;
}) {
  const headingId = useId();
  return (
    <GlassCard className="p-4" ariaLabelledBy={headingId}>
      <SectionHeading
        id={headingId}
        title="Communication"
        description={loading ? "Reading cache…" : "Unread conversations and notifications"}
        action={(
          <button
            type="button"
            onClick={onOpen}
            className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Open Slack"
          >
            <ArrowRight className="size-3.5" />
          </button>
        )}
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MetricLine Icon={Inbox} label="Inbox" value={inbox} tint="text-cyan-400" />
        <MetricLine Icon={AtSign} label="Mentions" value={mentions} tint="text-amber-400" />
        <MetricLine Icon={MessageSquare} label="Unread DMs" value={directMessages} tint="text-emerald-400" />
        <MetricLine Icon={MessagesSquare} label="Threads" value={threads} tint="text-indigo-400" />
      </div>
    </GlassCard>
  );
}

type SourceRowProps = {
  Icon: LucideIcon;
  name: string;
  status: string;
  detail: string;
  tone: "ready" | "warning" | "muted";
  onOpen: () => void;
};

function SourceRow({ Icon, name, status, detail, tone, onOpen }: SourceRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name} ${status}: ${detail}`}
      className="group/source flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg ring-1",
        tone === "ready" && "bg-emerald-500/10 text-emerald-400 ring-emerald-400/20",
        tone === "warning" && "bg-amber-500/10 text-amber-400 ring-amber-400/20",
        tone === "muted" && "bg-muted/50 text-muted-foreground ring-border",
      )}>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-foreground">{name}</span>
          <span className="text-[9.5px] text-muted-foreground">{status}</span>
        </span>
        <span className="block truncate text-[9.5px] text-muted-foreground/80">{detail}</span>
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/source:text-foreground" />
    </button>
  );
}

function QuickActions({ onOpen }: { onOpen: (view: ViewKind) => void }) {
  const actions: { view: ViewKind; label: string; Icon: LucideIcon; tint: string }[] = [
    { view: "calendar", label: "Calendar", Icon: Calendar, tint: "text-sky-400" },
    { view: "list", label: "Issues", Icon: List, tint: "text-indigo-400" },
    { view: "this-week", label: "This Week", Icon: CalendarRange, tint: "text-violet-400" },
    { view: "prs", label: "Pull Requests", Icon: GitPullRequest, tint: "text-emerald-400" },
    { view: "slack", label: "Slack", Icon: MessageSquare, tint: "text-amber-400" },
    { view: "docs", label: "Docs", Icon: BookText, tint: "text-rose-400" },
    { view: "reports", label: "Reports", Icon: NotebookPen, tint: "text-fuchsia-400" },
  ];
  return (
    <nav aria-label="Dashboard quick actions" className="dashboard-glass rounded-xl border p-2">
      <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
        <span className="hidden shrink-0 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:block">
          Jump to
        </span>
        {actions.map(({ view, label, Icon, tint }) => (
          <button
            key={view}
            type="button"
            onClick={() => onOpen(view)}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon className={cn("size-3.5", tint)} />
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function useDashboardNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function DashboardPage() {
  const { setActiveView } = useWorkspace();
  const [, setParams] = useSearchParams();
  const now = useDashboardNow();
  const today = dhakaToday(now);
  const sourcesHeadingId = useId();

  const issuesQuery = useIssues({});
  const meQuery = useMe();
  const connectionStatusQuery = useConnectionStatus();
  const notificationsQuery = useNotifications({ enabled: false });
  const githubStatusQuery = useGithubStatus();
  const githubQuery = useGithubPrs();
  const slackStatusQuery = useSlackStatus();
  const slackQuery = useSlackCatchup();
  const docsStatusQuery = useDocsStatus();
  const docsSourcesQuery = useDocsSources();

  const issues = issuesQuery.data ?? [];
  const viewerId = meQuery.data?.viewerId ?? null;
  const notifications = notificationsQuery.data?.notifications ?? [];
  const prs = githubQuery.data?.prs ?? [];
  const slack = slackQuery.data;
  const metrics = dashboardMetrics({
    issues,
    prs,
    notifications,
    slack,
    viewerId,
    today,
  });
  const attention = attentionItems({
    issues,
    prs,
    notifications,
    slack,
    viewerId,
    today,
  });
  const workload = workloadBuckets(issues, viewerId);
  const dueDays = dueLoad(issues, viewerId, today);
  const preview = weekPreview(issues, viewerId, today);
  const pullRequestStats = prStats(prs.filter((pr) => pr.bucket !== "merged"));
  const linearReadError = issuesQuery.isError || meQuery.isError;
  const githubReadError = githubStatusQuery.isError || githubQuery.isError;
  const slackReadError = slackStatusQuery.isError || slackQuery.isError;
  const docsReadError = docsStatusQuery.isError || docsSourcesQuery.isError;
  const linearDataAvailable = issuesQuery.data !== undefined && viewerId !== null;
  const githubDataAvailable = githubQuery.data !== undefined;
  const slackDataAvailable = slackQuery.data !== undefined;
  const attentionPartial = (
    (issuesQuery.isError && issuesQuery.data === undefined)
    || (meQuery.isError && meQuery.data === undefined)
    || (notificationsQuery.isError && notificationsQuery.data === undefined)
    || (githubQuery.isError && githubQuery.data === undefined)
    || (slackQuery.isError && slackQuery.data === undefined)
  );

  const dms = slack?.conversations.filter(
    (conversation) =>
      (conversation.kind === "dm" || conversation.kind === "group_dm")
      && conversation.unreadCount > 0,
  ).length ?? 0;
  const unreadThreads = slack?.threads.filter((thread) => thread.unreadReplies > 0).length ?? 0;

  const openAttention = (item: AttentionItem) => {
    if (item.target === "issue" && item.entityId) {
      setParams({ issue: item.entityId });
      return;
    }
    setActiveView(item.target);
  };

  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    hour12: false,
  }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const title = meQuery.data?.viewerName
    ? `${greeting}, ${meQuery.data.viewerName}`
    : "Your workspace";
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  const githubSyncs = githubQuery.data?.meta
    .map((meta) => meta.lastSyncedAt)
    .filter((value): value is string => !!value)
    .sort() ?? [];
  const latestGithubSync = githubSyncs[githubSyncs.length - 1];
  const docsSyncs = (docsSourcesQuery.data ?? [])
    .map((source) => source.lastSyncedAt)
    .filter((value): value is string => !!value)
    .sort();
  const latestDocsSync = docsSyncs[docsSyncs.length - 1];

  const githubStatus = githubStatusQuery.data?.state === "connected"
    ? { status: "Connected", detail: `@${githubStatusQuery.data.login}`, tone: "ready" as const }
    : githubStatusQuery.data?.state === "unverified"
      ? { status: "Cached", detail: "Connection not verified", tone: "warning" as const }
      : { status: "Setup needed", detail: "Connect GitHub in Settings", tone: "muted" as const };
  const slackStatus = slackStatusQuery.data?.state === "connected"
    ? {
        status: "Connected",
        detail: slack?.lastSyncedAt
          ? `Last sync · ${relativeTime(slack.lastSyncedAt)}`
          : slackStatusQuery.data.workspaceName ?? "Workspace connected",
        tone: "ready" as const,
      }
    : slackStatusQuery.data?.state === "unverified"
      ? { status: "Cached", detail: "Connection not verified", tone: "warning" as const }
      : { status: "Setup needed", detail: "Connect Slack in Settings", tone: "muted" as const };
  const docsConnected = (docsStatusQuery.data?.sourceCount ?? 0) > 0;
  const linearStatus = connectionStatusQuery.isError
    ? { status: "Unavailable", detail: "Cached status could not be read", tone: "warning" as const }
    : connectionStatusQuery.isLoading
      ? { status: "Reading cache", detail: "Checking local connection", tone: "muted" as const }
      : connectionStatusQuery.data?.state === "connected"
        ? {
            status: "Connected",
            detail: connectionStatusQuery.data.name,
            tone: "ready" as const,
          }
        : connectionStatusQuery.data?.state === "unverified"
          ? {
              status: "Cached",
              detail: "Connection not verified",
              tone: "warning" as const,
            }
          : {
              status: "Setup needed",
              detail: "Open Settings to connect",
              tone: "muted" as const,
            };

  return (
    <main className="dashboard-surface h-full overflow-y-auto">
      <div aria-hidden className="dashboard-aurora dashboard-aurora-primary" />
      <div aria-hidden className="dashboard-aurora dashboard-aurora-cyan" />

      <div className="relative mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 pt-4 pb-28">
        <header className="dashboard-header flex flex-col gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/20">
                <Radio className="size-3.5" />
              </span>
              <span className="rounded-full bg-emerald-500/8 px-2 py-0.5 text-[9.5px] font-medium text-emerald-400 ring-1 ring-emerald-400/15">
                Local cache · offline ready
              </span>
            </div>
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{dateLabel} · Asia/Dhaka</p>
          </div>
          <div className="dashboard-glass flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2">
            <Clock3 className="size-3.5 text-cyan-400" />
            <DualClock compact />
          </div>
        </header>

        <div className="dashboard-kpi-grid grid min-w-0 gap-3">
          <KpiCard
            label="Overdue"
            value={linearDataAvailable ? metrics.overdue : null}
            description={
              issuesQuery.isError && issuesQuery.data === undefined
                ? "Linear cache unavailable"
                : viewerId
                  ? "Active Linear issues"
                  : "Connect Linear to calculate"
            }
            Icon={AlertTriangle}
            tone="rose"
            loading={issuesQuery.isLoading || meQuery.isLoading}
            actionLabel="Open overdue issues"
            onOpen={() => setActiveView("this-week")}
          />
          <KpiCard
            label="Reviews"
            value={githubDataAvailable ? metrics.reviews : null}
            description={
              githubQuery.isError && !githubQuery.data
                ? "GitHub cache unavailable"
                : "Pull requests awaiting you"
            }
            Icon={GitPullRequest}
            tone="violet"
            loading={githubQuery.isLoading}
            actionLabel="Open pull requests"
            onOpen={() => setActiveView("prs")}
          />
          <KpiCard
            label="Inbox"
            value={notificationsQuery.data ? metrics.inbox : null}
            description={
              notificationsQuery.data
                ? "Unread Linear notifications"
                : "Open Inbox to read"
            }
            Icon={Inbox}
            tone="cyan"
            loading={notificationsQuery.isLoading}
            actionLabel="Open inbox"
            onOpen={() => setActiveView("inbox")}
          />
          <KpiCard
            label="Mentions"
            value={slackDataAvailable ? metrics.mentions : null}
            description={
              slackQuery.isError && !slackQuery.data
                ? "Slack cache unavailable"
                : slackQuery.data
                  ? "Unread Slack mentions"
                  : "No Slack cache yet"
            }
            Icon={AtSign}
            tone="amber"
            loading={slackQuery.isLoading}
            actionLabel="Open Slack mentions"
            onOpen={() => setActiveView("slack")}
          />
        </div>

        <div className="dashboard-main-grid grid min-w-0 gap-4">
          <AttentionTable
            items={attention}
            onOpen={openAttention}
            loading={
              issuesQuery.isLoading
              || meQuery.isLoading
              || notificationsQuery.isLoading
              || githubQuery.isLoading
              || slackQuery.isLoading
            }
            partial={attentionPartial}
          />
          <div className="dashboard-side-grid grid min-w-0 gap-4">
            <WorkloadChart buckets={workload} available={linearDataAvailable} />
            <DueLoadChart days={dueDays} available={linearDataAvailable} />
          </div>
        </div>

        <div className="dashboard-lower-grid grid min-w-0 gap-4">
          <WeekCard
            issues={preview}
            today={today}
            onOpenIssue={(id) => setParams({ issue: id })}
            onOpenWeek={() => setActiveView("this-week")}
            available={linearDataAvailable}
          />
          <PrHealthCard
            stats={pullRequestStats}
            onOpen={() => setActiveView("prs")}
            available={githubDataAvailable}
          />
          <CommunicationCard
            inbox={notificationsQuery.data ? metrics.inbox : null}
            mentions={slackDataAvailable ? metrics.mentions : null}
            directMessages={slackDataAvailable ? dms : null}
            threads={slackDataAvailable ? unreadThreads : null}
            loading={slackQuery.isLoading}
            onOpen={() => setActiveView("slack")}
          />
          <GlassCard className="p-4" ariaLabelledBy={sourcesHeadingId}>
            <SectionHeading
              id={sourcesHeadingId}
              title="Sources"
              description="Cached provider availability and freshness"
            />
            <div className="dashboard-source-grid mt-2 grid gap-0.5">
              <SourceRow
                Icon={Layers3}
                name="Linear"
                status={linearReadError ? "Unavailable" : linearStatus.status}
                detail={linearReadError ? "Cached data could not be read" : linearStatus.detail}
                tone={linearReadError ? "warning" : linearStatus.tone}
                onOpen={() => setActiveView(
                  connectionStatusQuery.data?.state === "not_configured"
                    ? "settings"
                    : "list",
                )}
              />
              <SourceRow
                Icon={GitPullRequest}
                name="GitHub"
                status={
                  githubReadError
                    ? "Unavailable"
                    : githubStatusQuery.isLoading
                      ? "Reading cache"
                      : githubStatus.status
                }
                detail={latestGithubSync
                  ? `Last sync · ${relativeTime(latestGithubSync)}`
                  : githubStatusQuery.isLoading
                    ? "Checking local connection"
                    : githubStatus.detail}
                tone={
                  githubReadError
                    ? "warning"
                    : githubStatusQuery.isLoading
                      ? "muted"
                      : githubStatus.tone
                }
                onOpen={() => setActiveView(githubStatusQuery.data?.state === "not_configured" ? "settings" : "prs")}
              />
              <SourceRow
                Icon={MessageSquare}
                name="Slack"
                status={
                  slackReadError
                    ? "Unavailable"
                    : slackStatusQuery.isLoading
                      ? "Reading cache"
                      : slackStatus.status
                }
                detail={
                  slackStatusQuery.isLoading
                    ? "Checking local connection"
                    : slackStatus.detail
                }
                tone={
                  slackReadError
                    ? "warning"
                    : slackStatusQuery.isLoading
                      ? "muted"
                      : slackStatus.tone
                }
                onOpen={() => setActiveView(slackStatusQuery.data?.state === "not_configured" ? "settings" : "slack")}
              />
              <SourceRow
                Icon={BookText}
                name="Docs"
                status={
                  docsReadError
                    ? "Unavailable"
                    : docsStatusQuery.isLoading
                      ? "Reading cache"
                      : docsConnected
                        ? "Connected"
                        : "Setup needed"
                }
                detail={latestDocsSync
                  ? `Last sync · ${relativeTime(latestDocsSync)}`
                  : docsStatusQuery.isLoading
                    ? "Checking local sources"
                    : docsConnected
                      ? `${docsStatusQuery.data?.sourceCount ?? 0} source${docsStatusQuery.data?.sourceCount === 1 ? "" : "s"}`
                      : "Add a repository in Settings"}
                tone={
                  docsReadError
                    ? "warning"
                    : docsStatusQuery.isLoading
                      ? "muted"
                      : docsConnected
                        ? "ready"
                        : "muted"
                }
                onOpen={() => setActiveView(docsConnected ? "docs" : "settings")}
              />
            </div>
          </GlassCard>
        </div>

        <QuickActions onOpen={setActiveView} />
      </div>
    </main>
  );
}
