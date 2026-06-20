import { useEffect, type ReactNode } from "react";
import { ArrowLeftRight, PanelRight, SquareSplitHorizontal, X } from "lucide-react";
import { useWorkspace } from "@/lib/tabs";

function Row({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

export function TabContextMenu({
  tabId,
  isSplit,
  canClose,
  x,
  y,
  onClose,
}: {
  tabId: string;
  isSplit: boolean;
  canClose: boolean;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const { splitTabRight, moveTabToOtherPane, swapPanes, closeTab } = useWorkspace();

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const left = Math.min(x, window.innerWidth - 188);
  const top = Math.min(y, window.innerHeight - 160);

  return (
    <div
      data-command-shortcut-blocker
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 w-44 rounded-lg border border-border bg-popover p-1 text-foreground shadow-2xl"
      style={{ left, top }}
    >
      {!isSplit && (
        <Row icon={<SquareSplitHorizontal className="size-4" />} label="Open in split (right)" onClick={act(() => splitTabRight(tabId))} />
      )}
      {isSplit && (
        <>
          <Row icon={<PanelRight className="size-4" />} label="Move to other pane" onClick={act(() => moveTabToOtherPane(tabId))} />
          <Row icon={<ArrowLeftRight className="size-4" />} label="Swap panes" onClick={act(() => swapPanes())} />
        </>
      )}
      {canClose && (
        <>
          <div className="my-1 border-t border-border/60" />
          <Row icon={<X className="size-4" />} label="Close" onClick={act(() => closeTab(tabId))} />
        </>
      )}
    </div>
  );
}
