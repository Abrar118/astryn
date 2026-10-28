import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// The worker is bundled by Vite and served from the app's own origin, which the
// CSP's `script-src 'self'` already allows.
GlobalWorkerOptions.workerSrc = workerUrl;

/** Widest a page renders, so a wide pane doesn't blow pages up past legibility. */
const MAX_PAGE_WIDTH = 960;
/** US Letter height / width, used for placeholders until page 1 is measured. */
const DEFAULT_RATIO = 11 / 8.5;

function PdfPage({
  doc,
  number,
  width,
  ratio,
}: {
  doc: PDFDocumentProxy;
  number: number;
  width: number;
  ratio: number;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  // Render lazily: a page draws once it comes near the viewport, then stays.
  useEffect(() => {
    const el = holderRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || width <= 0) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void doc.getPage(number).then((page) => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale: scale * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${viewport.height / dpr}px`;
      task = page.render({ canvas, viewport });
      // A cancelled render rejects; nothing to report.
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, visible, width]);

  return (
    <div
      ref={holderRef}
      style={{ width, minHeight: width * ratio }}
      className="shrink-0 overflow-hidden rounded-sm bg-white ring-1 ring-border"
    >
      <canvas ref={canvasRef} role="img" aria-label={`Page ${number}`} />
    </div>
  );
}

/** Render a PDF's pages to canvases with pdf.js, lazily as they scroll into view. */
export default function PdfViewer({ data }: { data: ArrayBuffer }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    setDoc(null);
    setFailed(false);
    // pdf.js transfers the buffer to its worker, so hand it a copy and keep the
    // query cache's bytes intact. No cMap / font / wasm URLs are configured: the
    // CSP allows no fetches besides IPC, so pdf.js uses its built-in fallbacks.
    const task = getDocument({ data: new Uint8Array(data.slice(0)) });
    let cancelled = false;
    // One chain, one catch: a failed load *or* an unreadable first page ends in
    // the error state rather than an unhandled rejection stuck on "Opening".
    task.promise
      .then(async (loaded) => {
        const first = await loaded.getPage(1);
        if (cancelled) return;
        const vp = first.getViewport({ scale: 1 });
        setRatio(vp.height / vp.width);
        setDoc(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [data]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.min(MAX_PAGE_WIDTH, Math.max(0, el.clientWidth - 48)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="flex min-h-full flex-col items-center gap-4 px-6 py-6">
      {failed ? (
        <p className="py-10 text-sm text-muted-foreground">This PDF couldn't be opened.</p>
      ) : !doc ? (
        <p className="py-10 text-sm text-muted-foreground">Opening PDF…</p>
      ) : (
        <>
          <p className="self-stretch text-right text-[11px] tabular-nums text-muted-foreground">
            {doc.numPages} page{doc.numPages === 1 ? "" : "s"}
          </p>
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i + 1} doc={doc} number={i + 1} width={width} ratio={ratio} />
          ))}
        </>
      )}
    </div>
  );
}
