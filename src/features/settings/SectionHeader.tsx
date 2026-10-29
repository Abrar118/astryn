/** Page heading + one-line description at the top of every settings section. */
export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="text-[13px] text-muted-foreground">{description}</p>
    </header>
  );
}
