import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { TaskDetail } from "./TaskDetail";

const WIDTH_KEY = "astryn.drawer-width";
const DEFAULT_WIDTH = 920;
const MIN_WIDTH = 480;

function loadWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return v >= MIN_WIDTH ? v : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/**
 * The right-side task drawer for any tracker, driven by `?issue=<task id>`.
 * The shell (overlay, slide, resize, Escape) is shared; `TaskDetail` renders
 * the owning tracker's body.
 */
export function TaskDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get("issue");
  const [shownId, setShownId] = useState<string | null>(id);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (id) {
      setShownId(id);
      const r = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(r);
    }
    setOpen(false);
    const t = setTimeout(() => setShownId(null), 220);
    return () => clearTimeout(t);
  }, [id]);

  if (!shownId) return null;
  return <DrawerShell id={shownId} open={open} onClose={() => setParams({})} />;
}

function DrawerShell({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const [width, setWidth] = useState(loadWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  const resizing = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[data-drawer-resource-modal]")) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!resizing.current) return;
      setWidth(Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.96, window.innerWidth - e.clientX)));
    };
    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(widthRef.current)));
      } catch {
        /* storage unavailable */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    resizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div className="fixed inset-0 z-30" data-command-shortcut-blocker>
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <aside
        style={{ width }}
        className={`absolute right-0 top-0 flex h-full max-w-[96vw] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div
          onPointerDown={startResize}
          title="Drag to resize"
          className="absolute left-0 top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-primary/40"
        />
        <TaskDetail id={id} mode="drawer" onClose={onClose} />
      </aside>
    </div>
  );
}
