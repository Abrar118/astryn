import { useEffect, useRef, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import { Copy, ExternalLink, Star } from "lucide-react";
import type { GithubPr } from "@/lib/commands";

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }
  gooeyToast.success(`${label} copied`);
}

function MenuRow({
  icon,
  label,
  disabled,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-40"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function PrContextMenu({
  pr,
  favorite,
  x,
  y,
  onFavoriteChange,
  onClose,
}: {
  pr: GithubPr;
  favorite: boolean;
  x: number;
  y: number;
  onFavoriteChange: (repo: string, favorite: boolean) => void | Promise<void>;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const close = () => onClose();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const act = (action: () => void | Promise<void>) => () => {
    void action();
    onClose();
  };
  const left = Math.max(8, Math.min(x, window.innerWidth - 216));
  const top = Math.max(8, Math.min(y, window.innerHeight - 152));

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${pr.title ?? "pull request"}`}
      style={{ left, top }}
      onClick={(event) => event.stopPropagation()}
      className="fixed z-50 w-52 rounded-lg border border-border bg-popover p-1 text-foreground shadow-2xl"
    >
      <MenuRow
        icon={<Copy className="size-4" />}
        label="Copy link"
        disabled={!pr.url}
        onSelect={act(() => copyText(pr.url!, "PR link"))}
      />
      <MenuRow
        icon={<Copy className="size-4" />}
        label="Copy PR title"
        disabled={!pr.title}
        onSelect={act(() => copyText(pr.title!, "PR title"))}
      />
      <MenuRow
        icon={<ExternalLink className="size-4" />}
        label="Open PR"
        disabled={!pr.url}
        onSelect={act(async () => {
          try {
            await openUrl(pr.url!);
          } catch {
            gooeyToast.error("Couldn't open the pull request");
          }
        })}
      />
      <div className="my-1 h-px bg-border/70" />
      <MenuRow
        icon={<Star className={`size-4 ${favorite ? "fill-current" : ""}`} />}
        label={favorite ? "Unfavorite repository" : "Favorite repository"}
        onSelect={act(() => onFavoriteChange(pr.repo, !favorite))}
      />
    </div>
  );
}
