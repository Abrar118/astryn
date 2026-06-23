import { FileText } from "lucide-react";

/** Linear-style card for an uploaded file: icon + filename + optional size.
 *  Shared by the read-only Milkdown description (node view) and the ReactMarkdown
 *  comment/fallback renderer so both look identical. */
export function FileAttachmentCard({
  filename,
  size,
  onOpen,
  title,
}: {
  filename: string;
  size?: string | null;
  onOpen: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className="my-1.5 flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/20 hover:bg-accent"
    >
      <FileText className="size-5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{filename || "Attachment"}</span>
        {size && <span className="text-xs text-muted-foreground">{size}</span>}
      </span>
    </button>
  );
}
