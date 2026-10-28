import { FileStack, FolderClosed, GitBranch } from "lucide-react";
import type { DocsSourceKind } from "@/lib/commands";

const ICONS = { github: GitBranch, local: FolderClosed, clickup: FileStack } as const;

/** Small glyph telling repositories, local folders and ClickUp Docs apart. */
export function SourceKindIcon({ kind, className }: { kind: DocsSourceKind; className?: string }) {
  const Icon = ICONS[kind];
  return <Icon className={className} aria-hidden />;
}
