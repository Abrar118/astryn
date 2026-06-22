import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Rect = { top: number; bottom: number; left: number; right: number };

/**
 * A dropdown whose panel renders in a portal at fixed coordinates, so it is
 * never clipped by a scrolling/overflow-hidden ancestor (the issue body, the
 * properties rail, etc.). Closes on outside-click, Escape, scroll, and resize.
 */
export function Popover({
  button,
  children,
  align = "start",
  buttonClassName,
  buttonTitle,
  panelClassName = "max-h-[18rem] w-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-2xl",
  disabled,
}: {
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  buttonClassName?: string;
  buttonTitle?: string;
  panelClassName?: string;
  disabled?: boolean;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = rect !== null;

  const toggle = () => {
    if (disabled) return;
    if (open) {
      setRect(null);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  };
  const close = () => setRect(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onScroll = (e: Event) => {
      // Scrolling inside the panel's own list must not close it; only an
      // ancestor scroll (which detaches the anchored panel) should.
      if (panelRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const flipUp = rect ? rect.bottom > window.innerHeight - 320 : false;
  const style: React.CSSProperties | undefined = rect
    ? {
        position: "fixed",
        ...(flipUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
        ...(align === "end" ? { right: window.innerWidth - rect.right } : { left: rect.left }),
        zIndex: 60,
      }
    : undefined;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        title={buttonTitle}
        data-popover-open={open || undefined}
        onClick={toggle}
        className={buttonClassName}
      >
        {button}
      </button>
      {open &&
        createPortal(
          <div ref={panelRef} style={style} className={panelClassName} data-popover-open>
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

/** A standard option row for use inside a Popover panel. */
export function PopoverItem({
  icon,
  label,
  active,
  onClick,
  danger,
}: {
  icon?: ReactNode;
  label: ReactNode;
  active?: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        danger ? "text-red-400 hover:bg-red-500/10" : "text-foreground hover:bg-accent"
      }`}
    >
      {icon !== undefined && <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {active && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
    </button>
  );
}
