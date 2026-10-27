/** Shared issue glyph components extracted from IssueDrawer to avoid circular imports. */

export const PRIORITIES = [
  { value: 0, label: "No priority", color: "var(--muted-foreground)" },
  { value: 1, label: "Urgent", color: "var(--destructive)" },
  { value: 2, label: "High", color: "var(--warning)" },
  { value: 3, label: "Medium", color: "var(--info)" },
  { value: 4, label: "Low", color: "var(--muted-foreground)" },
];

export function StatusIcon({ type, color }: { type: string; color: string }) {
  const c = color || "var(--muted-foreground)";
  if (type === "completed")
    return (
      <svg viewBox="0 0 14 14" className="size-3.5">
        <circle cx="7" cy="7" r="6" fill={c} />
        <path d="M4.2 7.2l1.8 1.8 3.8-3.8" stroke="var(--background)" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (type === "canceled")
    return (
      <svg viewBox="0 0 14 14" className="size-3.5">
        <circle cx="7" cy="7" r="6" fill="var(--muted-foreground)" />
        <path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke="var(--background)" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  const fill = type === "started" ? 0.55 : 0;
  return (
    <svg viewBox="0 0 14 14" className="size-3.5">
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray={type === "backlog" ? "2 1.6" : undefined} />
      {fill > 0 && <circle cx="7" cy="7" r="3.1" fill="none" stroke={c} strokeWidth="3.4" strokeDasharray={`${fill * 19.5} 19.5`} transform="rotate(-90 7 7)" />}
    </svg>
  );
}
