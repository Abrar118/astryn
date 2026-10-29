import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** A small focused dialog (workflow and sprint editors). Escape or the backdrop closes it. */
export function LocalDialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, select, button:not([data-dialog-close])")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={onClose} data-command-shortcut-blocker>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onMouseDown={(e) => e.stopPropagation()}
        className="lt-lifted flex max-h-[76vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-lg border border-border bg-popover"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id={headingId} className="text-[15px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <button
            type="button"
            data-dialog-close
            aria-label="Close"
            onClick={onClose}
            className="lt-focus cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
