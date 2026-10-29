import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { GitCommitHorizontal, MessageSquare, UserRoundCheck } from "lucide-react";
import type { GithubPr, GithubPrDetail } from "@/lib/commands";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import { timeAgo } from "@/features/drawer/timeAgo";
import { useCodeHost } from "./codeHost";
import {
  detailTimeline,
  reviewStateLabel,
  type PrTimelineEvent,
} from "./prDetailDisplay";

function openExternal(url: string) {
  openUrl(url).catch(() => gooeyToast.error("Couldn't open the link"));
}

/** A review state (GitHub's or the cached reviewer's) read as a lamp. */
function reviewLamp(state: string): Lamp {
  const s = state.toLowerCase();
  if (s === "approved") return "success";
  if (s === "changes_requested") return "warning";
  if (s === "commented") return "info";
  return "off";
}

/** A check conclusion read as a lamp: passing, failing, or still running. */
function checkLamp(conclusion: string | null): Lamp {
  const c = conclusion?.toLowerCase();
  if (c === "success") return "success";
  if (c === "failure" || c === "timed_out" || c === "action_required" || c === "startup_failure") return "danger";
  return "off";
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
    <div className="astryn-prose max-w-none break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function Legend({ children }: { children: string }) {
  return <h2 className="mb-2.5 text-[12px] font-medium text-muted-foreground">{children}</h2>;
}

function Actor({
  avatar,
  login,
  size = 6,
}: {
  avatar: string | null;
  login: string | null;
  size?: 5 | 6;
}) {
  const dim = size === 5 ? "size-5" : "size-6";
  return (
    <span className="flex min-w-0 items-center gap-2">
      {avatar ? (
        <img src={avatar} alt="" className={`${dim} shrink-0 rounded-full`} />
      ) : (
        <span className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground`}>
          {login?.slice(0, 1).toUpperCase() ?? "?"}
        </span>
      )}
      <span className="truncate font-medium text-foreground">{login ?? "Unknown user"}</span>
    </span>
  );
}

function TimelineIcon({ event }: { event: PrTimelineEvent }) {
  const Icon =
    event.kind === "commit" ? GitCommitHorizontal : event.kind === "review" ? UserRoundCheck : MessageSquare;
  return <Icon aria-hidden className="size-4 text-muted-foreground" />;
}

/** One activity entry: kind glyph, who and what on one line, the body under it. */
function TimelineItem({ event }: { event: PrTimelineEvent }) {
  const actor =
    event.kind === "comment"
      ? { avatar: event.comment.authorAvatar, login: event.comment.authorLogin }
      : event.kind === "review"
        ? { avatar: event.review.authorAvatar, login: event.review.authorLogin }
        : {
            avatar: event.commit.authorAvatar,
            login: event.commit.authorLogin ?? event.commit.authorName,
          };
  return (
    <article className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 py-3.5">
      <span className="flex h-6 items-center">
        <TimelineIcon event={event} />
      </span>
      <div className="min-w-0">
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <Actor avatar={actor.avatar} login={actor.login} size={5} />
          {event.kind === "review" ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <IndicatorLamp tone={reviewLamp(event.review.state)} />
              {reviewStateLabel(event.review.state).toLowerCase()}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {event.kind === "commit" ? "committed" : "commented"}
            </span>
          )}
          <span className="ml-auto tabular-nums text-muted-foreground">
            {timeAgo(event.timestamp)}
          </span>
        </div>
        {event.kind === "commit" ? (
          <button
            type="button"
            onClick={() => openExternal(event.commit.url)}
            className="dash-control mt-1 flex max-w-full items-center gap-2 rounded-sm text-left text-[13px] text-foreground underline-offset-4 hover:underline"
          >
            <code className="shrink-0 font-mono text-[12px] text-muted-foreground">
              {event.commit.oid.slice(0, 7)}
            </code>
            <span className="truncate">{event.commit.headline}</span>
          </button>
        ) : event.kind === "review" ? (
          event.review.body ? (
            <div className="mt-1">
              <Markdown>{event.review.body}</Markdown>
            </div>
          ) : null
        ) : (
          <div className="mt-1">
            <Markdown>{event.comment.body}</Markdown>
          </div>
        )}
      </div>
    </article>
  );
}

export function PrDrawerOverview({
  seed,
  detail,
}: {
  seed: GithubPr;
  detail: GithubPrDetail | undefined;
}) {
  const host = useCodeHost();
  const timeline = detail ? detailTimeline(detail) : [];
  const checks = detail?.checks ?? [];
  const passingChecks = checks.filter(
    (check) => check.conclusion?.toLowerCase() === "success",
  ).length;
  const reviewers = useMemo(() => {
    const merged = new Map<string, { login: string; avatar: string | null; state: string }>();
    for (const reviewer of seed.reviewers) {
      merged.set(reviewer.login.toLowerCase(), {
        login: reviewer.login,
        avatar: reviewer.avatar,
        state: reviewer.state,
      });
    }
    // Oldest first, so the last live review per author is their current verdict.
    const live = [...(detail?.reviews ?? [])].sort(
      (a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt),
    );
    for (const review of live) {
      if (!review.authorLogin) continue;
      const key = review.authorLogin.toLowerCase();
      const cached = merged.get(key);
      merged.set(key, {
        login: review.authorLogin,
        avatar: review.authorAvatar ?? cached?.avatar ?? null,
        state: review.state,
      });
    }
    return [...merged.values()];
  }, [detail?.reviews, seed.reviewers]);
  const files = detail?.files ?? [];
  const draft = detail?.draft ?? seed.draft;
  const state = detail?.state.toLowerCase() ?? "open";
  const mergeable = detail?.mergeable ?? seed.mergeable ?? "unknown";
  const statusLamp: Lamp = draft
    ? "off"
    : state === "merged"
      ? "neutral"
      : mergeable === "conflicting"
        ? "danger"
        : state === "closed"
          ? "off"
          : "neutral";

  return (
    <div className="grid min-h-full grid-cols-1 items-start gap-10 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_280px] xl:px-10">
      <div className="min-w-0">
        <h1 className="max-w-4xl text-[20px] font-semibold leading-tight tracking-tight text-foreground">
          {detail?.title ?? seed.title ?? "(untitled)"}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          <Actor
            avatar={detail?.authorAvatar ?? seed.authorAvatar}
            login={detail?.authorLogin ?? seed.authorLogin}
            size={5}
          />
          <span aria-hidden>·</span>
          <span className="font-mono">
            {seed.repo}#{seed.number}
          </span>
          {(detail?.baseBranch ?? seed.baseBranch) && (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate font-mono">
                {detail?.baseBranch ?? seed.baseBranch} ←{" "}
                {detail?.headBranch ?? seed.branch ?? "head"}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className="tabular-nums">{detail?.createdAt ? timeAgo(detail.createdAt) : "cached"}</span>
        </div>

        <section className="mt-7">
          <h2 className="mb-2 text-[13px] font-semibold tracking-tight text-foreground">Description</h2>
          {detail?.body ? (
            <Markdown>{detail.body}</Markdown>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Live description is unavailable. Cached pull request metadata is
              still shown.
            </p>
          )}
        </section>

        <section className="mt-10 border-t border-border pt-5">
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Activity</h2>
          <div aria-label="Pull request activity" className="mt-1 divide-y divide-border/70">
            {!detail ? (
              <p className="py-3 text-[13px] text-muted-foreground">
                Activity loads with live details.
              </p>
            ) : timeline.length === 0 ? (
              <p className="py-3 text-[13px] text-muted-foreground">
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
              <p className="mt-3 text-[12px] text-muted-foreground">
                Showing the most recent bounded activity from {host.name}.
              </p>
            )}
        </section>
      </div>

      <aside
        aria-label="Pull request metadata"
        className="divide-y divide-border rounded-lg border border-border bg-card xl:sticky xl:top-6"
      >
        <section className="px-4 py-3.5">
          <Legend>status</Legend>
          <div className="flex items-center gap-2 text-[13px] text-foreground">
            <IndicatorLamp tone={statusLamp} className={state === "merged" && !draft ? "bg-merged" : undefined} />
            <span>{draft ? "Draft" : reviewStateLabel(detail?.state ?? "open")}</span>
            <span className={mergeable === "conflicting" ? "text-destructive" : "text-muted-foreground"}>
              · {reviewStateLabel(mergeable).toLowerCase()}
            </span>
          </div>
        </section>

        <section className="px-4 py-3.5">
          <Legend>related to</Legend>
          {detail?.linearIdentifier ?? seed.linearIdentifier ? (
            <span className="font-mono text-[13px] text-foreground">
              {detail?.linearIdentifier ?? seed.linearIdentifier}
            </span>
          ) : (
            <span className="text-[13px] text-muted-foreground">Not linked</span>
          )}
        </section>

        <section className="px-4 py-3.5">
          <Legend>reviewers</Legend>
          {reviewers.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No reviewers</p>
          ) : (
            <ul className="space-y-2">
              {reviewers.map((reviewer) => (
                <li
                  key={reviewer.login.toLowerCase()}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <Actor avatar={reviewer.avatar} login={reviewer.login} size={5} />
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                    <IndicatorLamp tone={reviewLamp(reviewer.state)} />
                    {reviewStateLabel(reviewer.state).toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="px-4 py-3.5">
          <Legend>checks</Legend>
          <div className="mb-2 flex items-center gap-2 text-[13px] text-foreground">
            <IndicatorLamp
              tone={
                checks.length > 0
                  ? passingChecks === checks.length ? "success" : checks.some((c) => checkLamp(c.conclusion) === "danger") ? "danger" : "off"
                  : seed.ciStatus === "success" ? "success" : "off"
              }
            />
            <span className="tabular-nums">
              {checks.length === 0
                ? seed.ciStatus === "success"
                  ? "Cached checks passing"
                  : "No live checks"
                : `${passingChecks}/${checks.length} passing`}
            </span>
          </div>
          <ul className="space-y-1.5">
            {checks.slice(0, 6).map((check) => (
              <li
                key={check.name}
                className="flex items-center gap-2 text-[12px] text-muted-foreground"
              >
                <IndicatorLamp tone={checkLamp(check.conclusion)} className="size-1.5" />
                <span className="truncate">{check.name}</span>
              </li>
            ))}
            {detail?.truncated.checks && (
              <li className="text-[12px] text-muted-foreground">
                More checks on {host.name}
              </li>
            )}
          </ul>
        </section>

        <section className="px-4 py-3.5">
          <Legend>{`${detail?.changedFiles ?? seed.changedFiles ?? 0} files changed`}</Legend>
          {files.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              File names load with live details.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {files.slice(0, 12).map((file) => (
                <li
                  key={file.path}
                  className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-foreground"
                >
                  <span className="min-w-0 truncate" title={file.path}>{file.path}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-success">
                    +{file.additions}
                  </span>
                  <span className="shrink-0 tabular-nums text-destructive">
                    −{file.deletions}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
