import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import {
  Copy,
  ExternalLink,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GithubPr } from "@/lib/commands";
import { useGithubPrDetail } from "@/lib/queries";
import { PrDrawerChanges } from "./PrDrawerChanges";
import { PrDrawerOverview } from "./PrDrawerOverview";
import {
  clampDrawerWidth,
  loadDrawerWidth,
  saveDrawerWidth,
} from "./prDetailDisplay";

type DrawerTab = "overview" | "changes";

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = url;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }
  gooeyToast.success("PR link copied");
}

export function PrDrawer({
  pr,
  favorite,
  onFavoriteChange,
  onClose,
  returnFocus,
}: {
  pr: GithubPr;
  favorite: boolean;
  onFavoriteChange: (repo: string, favorite: boolean) => void | Promise<void>;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const detailQuery = useGithubPrDetail(pr.repo, pr.number);
  const detail = detailQuery.data;
  const [tab, setTab] = useState<DrawerTab>("overview");
  const [width, setWidth] = useState(loadDrawerWidth);
  const widthRef = useRef(width);
  const closeRef = useRef<HTMLButtonElement>(null);
  const resizing = useRef(false);
  widthRef.current = width;

  const close = () => {
    onClose();
    returnFocus?.focus();
  };

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  });

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!resizing.current) return;
      const next = clampDrawerWidth(window.innerWidth - event.clientX, window.innerWidth);
      widthRef.current = next;
      setWidth(next);
    };
    const handleUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const next = saveDrawerWidth(widthRef.current);
      widthRef.current = next;
      setWidth(next);
    };
    const handleResize = () => {
      const next = clampDrawerWidth(widthRef.current, window.innerWidth);
      widthRef.current = next;
      setWidth(next);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      window.removeEventListener("resize", handleResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    resizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? 24 : -24;
    const next = saveDrawerWidth(widthRef.current + delta);
    widthRef.current = next;
    setWidth(next);
  };

  const title = detail?.title ?? pr.title ?? "(untitled)";
  const url = detail?.url ?? pr.url;
  const headBranch = detail?.headBranch ?? pr.branch;
  const baseBranch = detail?.baseBranch ?? pr.baseBranch;
  const additions = detail?.additions ?? pr.additions ?? 0;
  const deletions = detail?.deletions ?? pr.deletions ?? 0;

  return (
    <div className="fixed inset-0 z-30" data-command-shortcut-blocker>
      <button
        type="button"
        aria-label="Close pull request drawer backdrop"
        onClick={close}
        className="absolute inset-0 size-full cursor-default bg-black/45 transition-opacity duration-200 motion-reduce:transition-none"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${pr.repo} pull request ${pr.number}`}
        style={{ width }}
        className="absolute right-0 top-0 flex h-full max-w-[96vw] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none"
      >
        <div
          role="separator"
          aria-label="Resize pull request drawer"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeWithKeyboard}
          className="absolute left-0 top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize outline-none transition-colors hover:bg-primary/40 focus-visible:bg-primary/60"
        />

        <header className="shrink-0 border-b border-border/60 bg-background/90 px-5 pt-4 backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] text-muted-foreground">
                {pr.repo} <span className="text-border">/</span> #{pr.number}
              </p>
              <h1 className="mt-1 truncate text-lg font-semibold text-foreground">
                {title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {(headBranch || baseBranch) && (
                  <span className="flex min-w-0 items-center gap-1.5 font-mono">
                    <GitBranch className="size-3.5 shrink-0" />
                    <span className="max-w-52 truncate">{headBranch ?? "head"}</span>
                    <span>→</span>
                    <span className="max-w-40 truncate">{baseBranch ?? "base"}</span>
                  </span>
                )}
                <span className="text-emerald-400">+{additions}</span>
                <span className="text-red-400">−{deletions}</span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={favorite ? "Unfavorite repository" : "Favorite repository"}
                title={favorite ? "Unfavorite repository" : "Favorite repository"}
                onClick={() => void onFavoriteChange(pr.repo, !favorite)}
              >
                <Star className={`size-4 ${favorite ? "fill-current text-amber-400" : ""}`} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy pull request link"
                title="Copy link"
                disabled={!url}
                onClick={() => url && void copyLink(url)}
              >
                <Copy className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open pull request on GitHub"
                title="Open on GitHub"
                disabled={!url}
                onClick={() => {
                  if (!url) return;
                  openUrl(url).catch(() =>
                    gooeyToast.error("Couldn't open the pull request"),
                  );
                }}
              >
                <ExternalLink className="size-4" />
              </Button>
              <Button
                ref={closeRef}
                variant="ghost"
                size="icon-sm"
                aria-label="Close pull request"
                title="Close"
                onClick={close}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div role="tablist" aria-label="Pull request detail" className="mt-4 flex gap-5">
            {(["overview", "changes"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`border-b-2 px-0.5 pb-2 text-xs font-medium capitalize transition-colors ${
                  tab === value
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {value}
                {value === "changes" && ` ${detail?.changedFiles ?? pr.changedFiles ?? 0}`}
              </button>
            ))}
          </div>
        </header>

        {detailQuery.isLoading && (
          <div
            role="status"
            aria-label="Loading pull request details"
            className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-muted/20 px-5 py-2 text-xs text-muted-foreground"
          >
            <LoaderCircle className="size-3.5 animate-spin" />
            Loading live details…
          </div>
        )}
        {detailQuery.isError && (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-3 border-b border-amber-500/20 bg-amber-500/[0.06] px-5 py-2 text-xs text-amber-200"
          >
            <span className="min-w-0 flex-1">
              Couldn't load live details. Cached pull request data remains available.
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => detailQuery.refetch()}
            >
              <RefreshCw className="size-3" />
              Retry
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "overview" ? (
            <PrDrawerOverview seed={pr} detail={detail} />
          ) : (
            <PrDrawerChanges seed={pr} detail={detail} />
          )}
        </div>
      </aside>
    </div>
  );
}
