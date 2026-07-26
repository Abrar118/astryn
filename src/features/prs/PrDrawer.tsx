import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import {
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Link2,
  LoaderCircle,
  RefreshCw,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GithubPr } from "@/lib/commands";
import { useGithubPrDetail, useGithubPrDiff } from "@/lib/queries";
import { PrDrawerChanges } from "./PrDrawerChanges";
import { PrDrawerOverview } from "./PrDrawerOverview";
import {
  clampDrawerWidth,
  loadDrawerWidth,
  saveDrawerWidth,
} from "./prDetailDisplay";
import { copyPrText } from "./prClipboard";

type DrawerTab = "overview" | "diff";

function drawerFocusable(dialog: HTMLElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>("a[href], button, [tabindex]"),
  ].filter(
    (element) =>
      element.tabIndex >= 0 &&
      (!(element instanceof HTMLButtonElement) || !element.disabled),
  );
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
  const diffQuery = useGithubPrDiff(pr.repo, pr.number, tab === "diff");
  const [width, setWidth] = useState(loadDrawerWidth);
  const widthRef = useRef(width);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const closing = useRef(false);
  widthRef.current = width;

  const close = useCallback(() => {
    closing.current = true;
    onClose();
    returnFocus?.focus();
  }, [onClose, returnFocus]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = drawerFocusable(dialog);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (
        !closing.current &&
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node)
      ) {
        closeRef.current?.focus();
      }
    };
    const overlay = overlayRef.current;
    const siblings = overlay?.parentElement
      ? [...overlay.parentElement.children].filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element !== overlay,
        )
      : [];
    const previous = siblings.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const element of siblings) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("focusin", containFocus);
      for (const { element, inert, ariaHidden } of previous) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
    };
  }, [close]);

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
  const additions = detail?.additions ?? pr.additions ?? 0;
  const deletions = detail?.deletions ?? pr.deletions ?? 0;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-30"
      data-command-shortcut-blocker
    >
      <div
        aria-hidden="true"
        onClick={close}
        className="absolute inset-0 size-full cursor-default bg-black/45 transition-opacity duration-200 motion-reduce:transition-none"
      />
      <aside
        ref={dialogRef}
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

        <header
          aria-label="Pull request header"
          className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-4 text-xs backdrop-blur"
        >
          <GitPullRequest className="size-4 shrink-0 text-emerald-400" />
          <span className="shrink-0 font-medium text-foreground">
            {pr.repo} #{pr.number}
          </span>
          <span className="text-border">›</span>
          <GitBranch className="size-3.5 shrink-0 text-emerald-400" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {title}
          </span>
          <span className="shrink-0 tabular-nums text-emerald-400">
            +{additions}
          </span>
          <span className="shrink-0 tabular-nums text-red-400">−{deletions}</span>
          <div className="ml-1 flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                favorite ? "Unfavorite repository" : "Favorite repository"
              }
              title={favorite ? "Unfavorite repository" : "Favorite repository"}
              onClick={() => void onFavoriteChange(pr.repo, !favorite)}
            >
              <Star
                className={`size-4 ${favorite ? "fill-current text-amber-400" : ""}`}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy pull request link"
              title="Copy link"
              disabled={!url}
              onClick={() => url && void copyPrText(url, "PR link")}
            >
              <Link2 className="size-4" />
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
        </header>

        <div
          role="tablist"
          aria-label="Pull request detail"
          className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-4"
        >
          {(["overview", "diff"] as const).map((value) => (
            <button
              key={value}
              id={`pr-drawer-${value}-tab`}
              type="button"
              role="tab"
              aria-controls={`pr-drawer-${value}-panel`}
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                tab === value
                  ? "border-border bg-muted text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border/70 hover:text-foreground"
              }`}
            >
              {value === "overview" ? "Overview" : "Diff"}
            </button>
          ))}
        </div>

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

        <div
          id={`pr-drawer-${tab}-panel`}
          data-testid="pr-drawer-scroll"
          role="tabpanel"
          aria-labelledby={`pr-drawer-${tab}-tab`}
          className="min-h-0 flex-1 overflow-y-auto pb-24"
        >
          {tab === "overview" ? (
            <PrDrawerOverview seed={pr} detail={detail} />
          ) : (
            <PrDrawerChanges
              seed={pr}
              detail={detail}
              diff={diffQuery.data}
              loading={diffQuery.isLoading}
              error={diffQuery.isError}
              onRetry={() => void diffQuery.refetch()}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
