import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import type {
  GithubPr,
  GithubPrDetail,
  GithubPrDiff,
  GithubPrDiffFile,
} from "@/lib/commands";
import { useCodeHost } from "./codeHost";
import { parseUnifiedPatch, type PrDiffRow } from "./prDiffDisplay";

/** A changed file's kind as a lowercase legend; added and deleted files light their lamp. */
function changeKind(changeType: string): { label: string; tone: Lamp } {
  const kind = changeType.toLowerCase();
  if (kind === "added") return { label: "added", tone: "success" };
  if (kind === "deleted" || kind === "removed") return { label: "deleted", tone: "danger" };
  return { label: kind || "changed", tone: "off" };
}

function openExternal(url: string, message: string) {
  openUrl(url).catch(() => gooeyToast.error(message));
}

const rowClasses: Record<PrDiffRow["kind"], string> = {
  hunk: "prs-diff-hunk",
  context: "text-foreground",
  addition: "prs-diff-add text-foreground",
  deletion: "prs-diff-del text-foreground",
  metadata: "text-muted-foreground italic",
};

function DiffRow({ row }: { row: PrDiffRow }) {
  if (row.kind === "hunk") {
    return (
      <tr className={rowClasses.hunk}>
        <td
          aria-hidden="true"
          colSpan={2}
          className="border-r border-border px-2 text-right font-mono text-[12px]"
        >
          ···
        </td>
        <td className="whitespace-pre px-3 py-1 font-mono text-[12px] leading-5">
          <code>{row.text}</code>
        </td>
      </tr>
    );
  }

  const marker =
    row.kind === "addition" ? "+" : row.kind === "deletion" ? "−" : " ";
  return (
    <tr className={rowClasses[row.kind]}>
      <td className="w-12 select-none border-r border-border/70 px-2 text-right font-mono text-[11px] leading-5 text-muted-foreground">
        {row.oldLine ?? ""}
      </td>
      <td className="w-12 select-none border-r border-border px-2 text-right font-mono text-[11px] leading-5 text-muted-foreground">
        {row.newLine ?? ""}
      </td>
      <td className="whitespace-pre px-3 font-mono text-[12px] leading-5">
        <code>
          <span aria-hidden="true" className="prs-diff-marker mr-2 inline-block w-2 select-none">
            {marker}
          </span>
          <span>{row.text || " "}</span>
        </code>
      </td>
    </tr>
  );
}

function FilePanel({ file }: { file: GithubPrDiffFile }) {
  const host = useCodeHost();
  const kind = changeKind(file.changeType);
  const rows = file.patch ? parseUnifiedPatch(file.patch) : [];

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex h-10 items-center gap-2.5 border-b border-border px-3">
        <IndicatorLamp tone={kind.tone} />
        <h3 className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-foreground">
          {file.path}
        </h3>
        <span className="shrink-0 text-[12px] text-muted-foreground">{kind.label}</span>
        {file.previousPath && (
          <span className="hidden min-w-0 truncate text-[12px] text-muted-foreground lg:inline">
            from {file.previousPath}
          </span>
        )}
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-success">
          +{file.additions}
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-destructive">
          −{file.deletions}
        </span>
        {file.blobUrl && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Open ${file.path} on ${host.name}`}
            title={`Open file on ${host.name}`}
            onClick={() =>
              openExternal(file.blobUrl!, "Couldn't open the changed file")
            }
          >
            <ExternalLink className="size-3" />
          </Button>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-4 text-[12px] text-muted-foreground">
          {host.name} did not provide a text patch for this file.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            aria-label={`Diff for ${file.path}`}
            className="w-full min-w-max border-collapse text-left"
          >
            <thead className="sr-only">
              <tr>
                <th>Old line</th>
                <th>New line</th>
                <th>Code</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DiffRow key={row.key} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** A one-line state message in the diff: lamp, sentence, optional action. */
function DiffMessage({ tone, children }: { tone: Lamp; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3.5 text-[13px] text-muted-foreground">
      <IndicatorLamp tone={tone} />
      {children}
    </div>
  );
}

export function PrDrawerChanges({
  seed,
  detail,
  diff,
  loading = false,
  error = false,
  onRetry,
}: {
  seed: GithubPr;
  detail: GithubPrDetail | undefined;
  diff?: GithubPrDiff;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const changedFiles =
    diff?.totalFiles ?? detail?.changedFiles ?? seed.changedFiles ?? 0;
  const additions = detail?.additions ?? seed.additions ?? 0;
  const deletions = detail?.deletions ?? seed.deletions ?? 0;
  const commitCount = detail?.commitCount ?? detail?.commits.length ?? 0;
  const host = useCodeHost();
  const pullRequestUrl = detail?.url ?? seed.url;
  const diffUrl = pullRequestUrl ? host.diffUrl(pullRequestUrl) : null;

  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="tabular-nums text-foreground">Files {changedFiles}</span>
        <span className="tabular-nums text-muted-foreground">Commits {commitCount}</span>
        <span className="ml-auto font-mono tabular-nums text-success">+{additions}</span>
        <span className="font-mono tabular-nums text-destructive">−{deletions}</span>
        <Button
          variant="ghost"
          size="xs"
          disabled={!diffUrl}
          onClick={() => {
            if (diffUrl) {
              openExternal(diffUrl, "Couldn't open the full diff");
            }
          }}
        >
          <ExternalLink className="size-3" />
          Open full diff on {host.name}
        </Button>
      </div>

      {loading ? (
        <div role="status">
          <DiffMessage tone="off">Loading file patches…</DiffMessage>
        </div>
      ) : error ? (
        <div role="alert">
          <DiffMessage tone="warning">
            <p className="min-w-0 flex-1 text-foreground">Couldn't load the full diff.</p>
            {onRetry && (
              <Button variant="outline" size="xs" onClick={onRetry}>
                Retry
              </Button>
            )}
          </DiffMessage>
        </div>
      ) : !diff ? (
        <DiffMessage tone="off">File patches load when Diff is opened.</DiffMessage>
      ) : diff.files.length === 0 ? (
        <DiffMessage tone="off">No changed files.</DiffMessage>
      ) : (
        <div className="space-y-3">
          {diff.files.map((file) => (
            <FilePanel key={file.path} file={file} />
          ))}
        </div>
      )}

      {diff?.truncated && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Showing the first {diff.files.length} changed files. Open {host.name}{" "}
          for the complete diff.
        </p>
      )}
    </div>
  );
}
