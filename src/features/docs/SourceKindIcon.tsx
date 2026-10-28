import { FolderClosed, GitBranch } from "lucide-react";
import type { DocsSourceKind } from "@/lib/commands";

/** Small glyph telling a repository from a local folder in lists and pickers. */
export function SourceKindIcon({ kind, className }: { kind: DocsSourceKind; className?: string }) {
  const Icon = kind === "local" ? FolderClosed : GitBranch;
  return <Icon className={className} aria-hidden />;
}
