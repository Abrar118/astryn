import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { loadLinearImage } from "@/lib/commands";
import { classifyImageSource } from "./linearImages";

export function LinearMarkdownImage({ src, alt }: { src: string; alt: string }) {
  const kind = classifyImageSource(src);
  const [resolved, setResolved] = useState<string | null>(kind === "direct" ? src : null);
  const [failed, setFailed] = useState(kind === "blocked");

  useEffect(() => {
    let active = true;
    setFailed(kind === "blocked");
    setResolved(kind === "direct" ? src : null);
    if (kind === "proxy") {
      loadLinearImage(src)
        .then((dataUrl) => {
          if (active) setResolved(dataUrl);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    }
    return () => {
      active = false;
    };
  }, [kind, src]);

  if (failed) {
    return (
      <span className="my-3 flex min-h-24 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm text-muted-foreground" role="img" aria-label={alt || "Unavailable image"}>
        <ImageOff className="size-4" />
        Image unavailable
      </span>
    );
  }
  if (!resolved) {
    return <span className="my-3 block h-40 w-full animate-pulse rounded-xl border border-border bg-card motion-reduce:animate-none" aria-label="Loading image" />;
  }
  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      className="my-3 max-h-[70vh] w-auto max-w-full rounded-xl border border-border bg-card object-contain"
    />
  );
}
