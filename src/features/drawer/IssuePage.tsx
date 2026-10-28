import { useWorkspace } from "@/lib/tabs";
import { TaskDetail } from "./TaskDetail";

/** Full-page task view rendered in a workspace pane (an "issue" tab), for any tracker. */
export function IssuePage({ issueId, tabId }: { issueId: string; tabId: string }) {
  const { closeTab } = useWorkspace();
  return <TaskDetail id={issueId} mode="page" onClose={() => closeTab(tabId)} />;
}
