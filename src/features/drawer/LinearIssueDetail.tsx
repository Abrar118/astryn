import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useIssueDetail } from "@/lib/queries";
import type { CalendarIssue } from "@/lib/commands";
import { IssueDetail } from "./IssueDrawer";

/** A cached calendar row to show instantly while the live detail loads. */
function useSeed(id: string): CalendarIssue | undefined {
  const qc = useQueryClient();
  for (const key of [["calendar"], ["unscheduled"]] as const) {
    for (const [, list] of qc.getQueriesData<CalendarIssue[]>({ queryKey: key })) {
      const found = list?.find((i) => i.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

/** Linear's task body: loads the live (or cached) issue and renders the Linear issue detail. */
export function LinearIssueDetail({ id, mode, onClose, docLinks }: { id: string; mode: "drawer" | "page"; onClose: () => void; docLinks?: ReactNode }) {
  const seed = useSeed(id);
  const { data: result } = useIssueDetail(id, mode === "drawer" ? seed : undefined);

  if (!result) {
    return mode === "page" ? (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
    ) : null;
  }
  const body = <IssueDetail id={id} result={result} mode={mode} onClose={onClose} docLinks={docLinks} />;
  return mode === "page" ? <div className="flex h-full w-full flex-col">{body}</div> : body;
}
