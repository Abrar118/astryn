import { useEffect, useState } from "react";

/**
 * User avatar. Renders the Linear profile image directly (the avatar CDN hosts
 * are allowlisted in the app CSP `img-src`); on a missing URL or load error it
 * falls back to name initials.
 */
export function Avatar({
  name,
  src,
  size = 18,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  // A new src is a fresh chance to load (reset the prior error).
  useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-secondary font-medium text-muted-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initials}
    </span>
  );
}
