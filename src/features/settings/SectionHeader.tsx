/** Title + one-line description at the top of every settings section. */
export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </header>
  );
}
