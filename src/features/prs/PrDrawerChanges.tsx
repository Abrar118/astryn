import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import {
  ExternalLink,
  FileDiff,
  FileMinus2,
  FilePen,
  FilePlus2,
  Files,
  GitCommitHorizontal,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  GithubPr,
  GithubPrDetail,
  GithubPrDiff,
  GithubPrDiffFile,
} from "@/lib/commands";
import { parseUnifiedPatch, type PrDiffRow } from "./prDiffDisplay";

function fileIcon(changeType: string): {
  Icon: LucideIcon;
  className: string;
} {
  switch (changeType.toLowerCase()) {
    case "added":
      return { Icon: FilePlus2, className: "text-emerald-400" };
    case "deleted":
    case "removed":
      return { Icon: FileMinus2, className: "text-red-400" };
    case "renamed":
    case "modified":
      return { Icon: FilePen, className: "text-muted-foreground" };
    default:
      return { Icon: FileDiff, className: "text-muted-foreground" };
  }
}

function openExternal(url: string, message: string) {
  openUrl(url).catch(() => gooeyToast.error(message));
}

const rowClasses: Record<PrDiffRow["kind"], string> = {
  hunk: "bg-sky-500/[0.055] text-sky-300/80",
  context: "text-foreground/85",
  addition:
    "bg-emerald-500/[0.10] text-emerald-100 selection:bg-emerald-400/35",
  deletion: "bg-red-500/[0.10] text-red-100 selection:bg-red-400/35",
  metadata: "text-muted-foreground italic",
};

function DiffRow({ row }: { row: PrDiffRow }) {
  if (row.kind === "hunk") {
    return (
      <tr className={rowClasses.hunk}>
        <td
          aria-hidden="true"
          colSpan={2}
          className="border-r border-border/50 px-2 text-right"
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
      <td className="w-12 select-none border-r border-border/40 px-2 text-right font-mono text-[11px] leading-5 text-muted-foreground/65">
        {row.oldLine ?? ""}
      </td>
      <td className="w-12 select-none border-r border-border/50 px-2 text-right font-mono text-[11px] leading-5 text-muted-foreground/65">
        {row.newLine ?? ""}
      </td>
      <td className="whitespace-pre px-3 font-mono text-[12px] leading-5">
        <code>
          <span aria-hidden="true" className="mr-2 inline-block w-2 select-none">
            {marker}
          </span>
          <span>{row.text || " "}</span>
        </code>
      </td>
    </tr>
  );
}

function FilePanel({ file }: { file: GithubPrDiffFile }) {
  const { Icon, className } = fileIcon(file.changeType);
  const rows = file.patch ? parseUnifiedPatch(file.patch) : [];

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-[#101011]">
      <header className="flex h-10 items-center gap-2 border-b border-border/60 bg-muted/20 px-3">
        <Icon className={`size-3.5 shrink-0 ${className}`} />
        <h3 className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
          {file.path}
        </h3>
        {file.previousPath && (
          <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground lg:inline">
            from {file.previousPath}
          </span>
        )}
        <span className="shrink-0 text-xs tabular-nums text-emerald-400">
          +{file.additions}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-red-400">
          −{file.deletions}
        </span>
        {file.blobUrl && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Open ${file.path} on GitHub`}
            title="Open file on GitHub"
            onClick={() =>
              openExternal(file.blobUrl!, "Couldn't open the changed file")
            }
          >
            <ExternalLink className="size-3" />
          </Button>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-xs text-muted-foreground">
          GitHub did not provide a text patch for this file.
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
  const pullRequestUrl = detail?.url ?? seed.url;
  const diffUrl = pullRequestUrl
    ? `${pullRequestUrl.replace(/\/files\/?$/, "").replace(/\/$/, "")}/files`
    : null;

  return (
    <div className="px-4 py-3">
      <div className="mb-4 flex h-9 items-center gap-1 rounded-lg border border-border/60 bg-muted/20 px-2 text-xs">
        <span className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-foreground">
          <Files className="size-3.5" />
          Files {changedFiles}
        </span>
        <span className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground">
          <GitCommitHorizontal className="size-3.5" />
          Commits {commitCount}
        </span>
        <span className="ml-auto tabular-nums text-emerald-400">+{additions}</span>
        <span className="tabular-nums text-red-400">−{deletions}</span>
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
          Open full diff on GitHub
        </Button>
      </div>

      {loading ? (
        <div
          role="status"
          className="flex items-center justify-center gap-2 rounded-lg border border-border/60 px-5 py-12 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" />
          Loading file patches…
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-5 py-10 text-center text-sm text-amber-200"
        >
          <p>Couldn't load the full diff.</p>
          {onRetry && (
            <Button variant="ghost" size="xs" className="mt-3" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      ) : !diff ? (
        <div className="rounded-lg border border-border/60 px-5 py-12 text-center text-sm text-muted-foreground">
          File patches load when Diff is opened.
        </div>
      ) : diff.files.length === 0 ? (
        <div className="rounded-lg border border-border/60 px-5 py-12 text-center text-sm text-muted-foreground">
          No changed files.
        </div>
      ) : (
        <div className="space-y-4">
          {diff.files.map((file) => (
            <FilePanel key={file.path} file={file} />
          ))}
        </div>
      )}

      {diff?.truncated && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing the first {diff.files.length} changed files. Open GitHub for
          the complete diff.
        </p>
      )}
    </div>
  );
}
