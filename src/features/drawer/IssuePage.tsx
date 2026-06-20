import { useIssueDetail } from "@/lib/queries";
import { useWorkspace } from "@/lib/tabs";
import { IssueDetail } from "./IssueDrawer";

/** Full-page issue view rendered in a workspace pane (an "issue" tab). */
export function IssuePage({ issueId, tabId }: { issueId: string; tabId: string }) {
  const { data: result } = useIssueDetail(issueId);
  const { closeTab } = useWorkspace();

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <IssueDetail id={issueId} result={result} mode="page" onClose={() => closeTab(tabId)} />
    </div>
  );
}
