import { GitPullRequest, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/tabs";
import { useGithubPrs, useGithubStatus, useGithubSync } from "@/lib/queries";
import type { GithubPr, GithubSyncMeta, PrBucket } from "@/lib/commands";
import { PrRow } from "./PrRow";

const SECTIONS: { bucket: PrBucket; title: string; empty: string }[] = [
  { bucket: "needs_review", title: "Needs my review", empty: "Nothing awaiting your review." },
  { bucket: "mine", title: "My open PRs", empty: "You have no open PRs." },
  { bucket: "assigned", title: "Assigned to me", empty: "No PRs assigned to you." },
  { bucket: "involved", title: "Involved / mentioned", empty: "Nothing else involving you." },
];

function Section({
  title,
  empty,
  prs,
  meta,
  stale,
}: {
  title: string;
  empty: string;
  prs: GithubPr[];
  meta: GithubSyncMeta | undefined;
  stale: boolean;
}) {
  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <span className="rounded-full bg-white/10 px-1.5 text-[11px] text-muted-foreground">{prs.length}</span>
        {meta?.truncated && (
          <span className="text-[11px] text-amber-400">showing 300 most recent</span>
        )}
        {stale && <span className="text-[11px] text-amber-400">couldn't refresh — cached</span>}
      </div>
      {prs.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        prs.map((pr) => <PrRow key={`${pr.bucket}:${pr.id}`} pr={pr} />)
      )}
    </section>
  );
}

export function PrsPage() {
  const { setActiveView } = useWorkspace();
  const { data: status } = useGithubStatus();
  const connected = status?.state === "connected" || status?.state === "unverified";
  const { data: dashboard } = useGithubPrs();
  const sync = useGithubSync(connected);

  if (status?.state === "not_configured") {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <GitPullRequest className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Link your GitHub account to see your pull requests.</p>
        <Button onClick={() => setActiveView("settings")}>Connect GitHub</Button>
      </main>
    );
  }

  const prs = dashboard?.prs ?? [];
  const meta = dashboard?.meta ?? [];
  const failed = new Set((sync.data ?? []).filter((r) => !r.ok).map((r) => r.bucket));

  return (
    <main className="flex h-full flex-col overflow-y-auto">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">Pull Requests</h1>
          {sync.isError && (
            <span className="text-[11px] text-amber-400">Sync failed — showing cached data.</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Refresh"
          disabled={sync.isFetching}
          onClick={() => sync.refetch()}
        >
          <RefreshCw className={`size-4 ${sync.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </header>
      {SECTIONS.map((s) => (
        <Section
          key={s.bucket}
          title={s.title}
          empty={s.empty}
          prs={prs.filter((p) => p.bucket === s.bucket)}
          meta={meta.find((m) => m.bucket === s.bucket)}
          stale={failed.has(s.bucket)}
        />
      ))}
    </main>
  );
}
