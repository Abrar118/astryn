/** User avatar: image when available, otherwise initials on a muted circle. */
export function Avatar({
  name,
  src,
  size = 18,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
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
