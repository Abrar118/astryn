import { useMemo, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  CheckCircle2,
  CircleDot,
  GitCommitHorizontal,
  GitMerge,
  MessageSquare,
  ShieldCheck,
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import type { GithubPr, GithubPrDetail } from "@/lib/commands";
import { timeAgo } from "@/features/drawer/timeAgo";
import {
  detailTimeline,
  reviewStateLabel,
  type PrTimelineEvent,
} from "./prDetailDisplay";

function openExternal(url: string) {
  openUrl(url).catch(() => gooeyToast.error("Couldn't open the GitHub link"));
}

function Markdown({ children }: { children: string }) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children: linkChildren, ...props }) => (
        <a
          {...props}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            if (href) openExternal(href);
          }}
        >
          {linkChildren}
        </a>
      ),
    }),
    [],
  );
  return (
    <div className="astryn-prose prose prose-sm prose-invert max-w-none break-words prose-headings:font-semibold prose-a:text-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function Actor({
  avatar,
  login,
}: {
  avatar: string | null;
  login: string | null;
}) {
  return (
    <span className="flex items-center gap-2">
      {avatar ? (
        <img
          src={avatar}
          alt=""
          className="size-6 rounded-full ring-1 ring-border"
        />
      ) : (
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] uppercase text-muted-foreground">
          {login?.slice(0, 1) ?? "?"}
        </span>
      )}
      <span className="font-medium text-foreground">{login ?? "Unknown user"}</span>
    </span>
  );
}

function TimelineIcon({ event }: { event: PrTimelineEvent }) {
  if (event.kind === "commit") {
    return <GitCommitHorizontal className="size-4 text-muted-foreground" />;
  }
  if (event.kind === "review") {
    return event.review.state.toLowerCase() === "approved" ? (
      <CheckCircle2 className="size-4 text-emerald-400" />
    ) : (
      <UserRoundCheck className="size-4 text-amber-400" />
    );
  }
  return <MessageSquare className="size-4 text-sky-400" />;
}

function TimelineItem({ event }: { event: PrTimelineEvent }) {
  const actor =
    event.kind === "comment"
      ? {
          avatar: event.comment.authorAvatar,
          login: event.comment.authorLogin,
        }
      : event.kind === "review"
        ? {
            avatar: event.review.authorAvatar,
            login: event.review.authorLogin,
          }
        : {
            avatar: event.commit.authorAvatar,
            login: event.commit.authorLogin ?? event.commit.authorName,
          };
  return (
    <article className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
      <div className="relative z-10 flex size-7 items-center justify-center rounded-full border border-border bg-card">
        <TimelineIcon event={event} />
      </div>
      <div className="min-w-0 rounded-lg border border-border/60 bg-background/30 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Actor avatar={actor.avatar} login={actor.login} />
          <span className="text-muted-foreground">
            {event.kind === "commit"
              ? "committed"
              : event.kind === "review"
                ? reviewStateLabel(event.review.state)
                : "commented"}
          </span>
          <span className="ml-auto text-muted-foreground">
            {timeAgo(event.timestamp)}
          </span>
        </div>
        {event.kind === "commit" ? (
          <button
            type="button"
            onClick={() => openExternal(event.commit.url)}
            className="mt-2 flex max-w-full items-center gap-2 text-left text-sm text-foreground hover:text-primary"
          >
            <code className="shrink-0 text-xs text-muted-foreground">
              {event.commit.oid.slice(0, 7)}
            </code>
            <span className="truncate">{event.commit.headline}</span>
          </button>
        ) : event.kind === "review" ? (
          event.review.body ? (
            <div className="mt-2">
              <Markdown>{event.review.body}</Markdown>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {reviewStateLabel(event.review.state)}
            </p>
          )
        ) : (
          <div className="mt-2">
            <Markdown>{event.comment.body}</Markdown>
          </div>
        )}
      </div>
    </article>
  );
}

function MetadataItem({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[20px_84px_minmax(0,1fr)] items-start gap-2 py-2.5 text-xs">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}

export function PrDrawerOverview({
  seed,
  detail,
}: {
  seed: GithubPr;
  detail: GithubPrDetail | undefined;
}) {
  const timeline = detail ? detailTimeline(detail) : [];
  const checks = detail?.checks ?? [];
  const passingChecks = checks.filter(
    (check) => check.conclusion?.toLowerCase() === "success",
  ).length;
  const reviewers = useMemo(() => {
    const merged = new Map<string, { login: string; avatar: string | null }>();
    for (const reviewer of seed.reviewers) {
      merged.set(reviewer.login.toLowerCase(), {
        login: reviewer.login,
        avatar: reviewer.avatar,
      });
    }
    for (const review of detail?.reviews ?? []) {
      if (!review.authorLogin) continue;
      const key = review.authorLogin.toLowerCase();
      const cached = merged.get(key);
      merged.set(key, {
        login: review.authorLogin,
        avatar: review.authorAvatar ?? cached?.avatar ?? null,
      });
    }
    return [...merged.values()];
  }, [detail?.reviews, seed.reviewers]);

  return (
    <div className="grid min-h-full grid-cols-1 items-start gap-8 px-7 py-6 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
          <Actor
            avatar={detail?.authorAvatar ?? seed.authorAvatar}
            login={detail?.authorLogin ?? seed.authorLogin}
          />
          <span>opened this pull request</span>
          <span>
            {detail?.createdAt ? timeAgo(detail.createdAt) : "from cached data"}
          </span>
        </div>

        <section className="rounded-xl border border-border/60 bg-card/45 px-5 py-4">
          {detail?.body ? (
            <Markdown>{detail.body}</Markdown>
          ) : (
            <div>
              <h2 className="text-sm font-semibold text-foreground">Description</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Live description is unavailable. Cached pull request metadata is
                still shown.
              </p>
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Activity</h2>
          <div
            aria-label="Pull request activity"
            className="relative before:absolute before:bottom-3 before:left-[13px] before:top-3 before:w-px before:bg-border"
          >
            {!detail ? (
              <p className="pl-10 text-sm text-muted-foreground">
                Activity loads with live details.
              </p>
            ) : timeline.length === 0 ? (
              <p className="pl-10 text-sm text-muted-foreground">
                No comments, reviews, or commits to show.
              </p>
            ) : (
              timeline.map((event) => (
                <TimelineItem key={event.key} event={event} />
              ))
            )}
          </div>
          {detail &&
            (detail.truncated.comments ||
              detail.truncated.reviews ||
              detail.truncated.commits) && (
              <p className="mt-4 text-xs text-muted-foreground">
                Showing the most recent bounded activity from GitHub.
              </p>
            )}
        </section>
      </div>

      <aside className="rounded-xl border border-border/60 bg-card/35 px-4 py-2 2xl:sticky 2xl:top-6">
        <h2 className="border-b border-border/60 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Pull request
        </h2>
        <MetadataItem icon={<CircleDot className="size-4" />} label="State">
          {detail?.draft ?? seed.draft
            ? "Draft"
            : reviewStateLabel(detail?.state ?? "open")}
        </MetadataItem>
        <MetadataItem icon={<GitMerge className="size-4" />} label="Mergeable">
          {reviewStateLabel(detail?.mergeable ?? seed.mergeable ?? "unknown")}
        </MetadataItem>
        <MetadataItem icon={<ShieldCheck className="size-4" />} label="Review">
          {reviewStateLabel(
            detail?.reviewDecision ?? seed.reviewDecision ?? "not requested",
          )}
        </MetadataItem>
        <MetadataItem icon={<UserRoundCheck className="size-4" />} label="Reviewers">
          {reviewers.length === 0
            ? "No reviewers"
            : reviewers.map((reviewer) => reviewer.login).join(", ")}
        </MetadataItem>
        <MetadataItem
          icon={
            checks.length > 0 && passingChecks === checks.length ? (
              <CheckCircle2 className="size-4 text-emerald-400" />
            ) : (
              <XCircle className="size-4 text-muted-foreground" />
            )
          }
          label="Checks"
        >
          {checks.length === 0 ? (
            seed.ciStatus === "success" ? (
              "Cached checks passing"
            ) : (
              "No live checks"
            )
          ) : (
            <div className="space-y-1.5">
              <span>
                {passingChecks}/{checks.length} passing
              </span>
              {checks.slice(0, 6).map((check) => (
                <div key={check.name} className="flex items-center gap-1.5">
                  {check.conclusion?.toLowerCase() === "success" ? (
                    <Check className="size-3 text-emerald-400" />
                  ) : (
                    <CircleDot className="size-3 text-amber-400" />
                  )}
                  <span className="truncate">{check.name}</span>
                </div>
              ))}
              {detail?.truncated.checks && (
                <span className="text-muted-foreground">More checks on GitHub</span>
              )}
            </div>
          )}
        </MetadataItem>
        <MetadataItem icon={<MessageSquare className="size-4" />} label="Linear">
          {detail?.linearIdentifier ?? seed.linearIdentifier ?? "Not linked"}
        </MetadataItem>
        <MetadataItem icon={<GitCommitHorizontal className="size-4" />} label="Files">
          {detail?.changedFiles ?? seed.changedFiles ?? 0} changed
        </MetadataItem>
      </aside>
    </div>
  );
}
