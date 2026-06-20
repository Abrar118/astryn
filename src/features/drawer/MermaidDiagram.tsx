import { useEffect, useId, useState } from "react";

/**
 * Renders a Mermaid code block as an SVG diagram (read-only). `mermaid` is a
 * heavy dependency, so it's loaded with a dynamic import and lands in its own
 * lazy chunk — fetched only the first time a diagram is viewed, not on startup.
 *
 * Rendering uses `securityLevel: "strict"`, which sanitizes the produced SVG
 * (no inline scripts or click handlers), so injecting it via innerHTML is safe.
 * An invalid diagram degrades to the raw source in a code block instead of
 * throwing, matching the pre-render behavior.
 */
export function MermaidDiagram({ code }: { code: string }) {
  // Mermaid uses the id for an element id + internal querySelector; useId()
  // contains colons, which are invalid in CSS selectors, so strip them.
  const id = `mermaid-${useId().replace(/:/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        // initialize() merges global config idempotently; it only runs when a
        // diagram actually mounts, so re-calling per diagram is negligible.
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (failed) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }
  if (svg === null) {
    return <div className="astryn-mermaid astryn-mermaid--loading" aria-busy="true" />;
  }
  return <div className="astryn-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
