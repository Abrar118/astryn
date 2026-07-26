import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import {
  ExternalLink,
  FileDiff,
  FileMinus2,
  FilePen,
  FilePlus2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GithubPr, GithubPrDetail, GithubPrFile } from "@/lib/commands";

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
      return { Icon: FilePen, className: "text-amber-400" };
    default:
      return { Icon: FileDiff, className: "text-muted-foreground" };
  }
}

function FileRow({ file }: { file: GithubPrFile }) {
  const { Icon, className } = fileIcon(file.changeType);
  const total = Math.max(1, file.additions + file.deletions);
  const additionWidth = `${(file.additions / total) * 100}%`;
  const deletionWidth = `${(file.deletions / total) * 100}%`;
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/50 px-4 py-3 last:border-b-0">
      <span className="flex size-7 items-center justify-center rounded-md bg-muted/35">
        <Icon className={`size-4 ${className}`} />
      </span>
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-foreground">{file.path}</p>
        <div className="mt-2 flex h-1.5 max-w-44 overflow-hidden rounded-full bg-muted">
          <span className="bg-emerald-500" style={{ width: additionWidth }} />
          <span className="bg-red-500" style={{ width: deletionWidth }} />
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs tabular-nums">
        <span className="text-emerald-400">+{file.additions}</span>
        <span className="text-red-400">−{file.deletions}</span>
        <span className="hidden rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground sm:inline">
          {file.changeType}
        </span>
      </div>
    </li>
  );
}

export function PrDrawerChanges({
  seed,
  detail,
}: {
  seed: GithubPr;
  detail: GithubPrDetail | undefined;
}) {
  const changedFiles = detail?.changedFiles ?? seed.changedFiles ?? 0;
  const additions = detail?.additions ?? seed.additions ?? 0;
  const deletions = detail?.deletions ?? seed.deletions ?? 0;
  const pullRequestUrl = detail?.url ?? seed.url;
  const diffUrl = pullRequestUrl
    ? `${pullRequestUrl.replace(/\/files\/?$/, "").replace(/\/$/, "")}/files`
    : null;
  return (
    <div className="px-7 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          {changedFiles} changed {changedFiles === 1 ? "file" : "files"}
        </h2>
        <span className="text-xs tabular-nums text-emerald-400">+{additions}</span>
        <span className="text-xs tabular-nums text-red-400">−{deletions}</span>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={!diffUrl}
          onClick={() => {
            if (!diffUrl) return;
            openUrl(diffUrl).catch(() =>
              gooeyToast.error("Couldn't open the full diff"),
            );
          }}
        >
          <ExternalLink className="size-3" />
          Open full diff on GitHub
        </Button>
      </div>

      {!detail ? (
        <div className="rounded-xl border border-border/60 bg-card/35 px-5 py-10 text-center text-sm text-muted-foreground">
          File details load with live data.
        </div>
      ) : detail.files.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card/35 px-5 py-10 text-center text-sm text-muted-foreground">
          GitHub returned no changed files.
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border/60 bg-card/35">
          {detail.files.map((file) => (
            <FileRow key={file.path} file={file} />
          ))}
        </ul>
      )}
      {detail?.truncated.files && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing the first {detail.files.length} changed files. Open GitHub for
          the complete diff.
        </p>
      )}
    </div>
  );
}
