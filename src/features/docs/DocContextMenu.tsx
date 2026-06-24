import { useEffect, type ReactNode } from "react";
import { PanelRight, SquarePlus } from "lucide-react";
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

/** Right-click menu for a doc file: open it in a new tab or alongside (split view). */
export function DocContextMenu({
  path,
  x,
  y,
  onClose,
}: {
  path: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const { openDocTab, openDocToSide } = useWorkspace();

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

  const left = Math.min(x, window.innerWidth - 196);
  const top = Math.min(y, window.innerHeight - 96);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ left, top }}
      className="fixed z-50 w-48 rounded-lg border border-border bg-popover p-1 text-foreground shadow-2xl"
    >
      <Row icon={<SquarePlus className="size-4" />} label="Open in new tab" onClick={act(() => openDocTab(path))} />
      <Row icon={<PanelRight className="size-4" />} label="Open to the side" onClick={act(() => openDocToSide(path))} />
    </div>
  );
}
