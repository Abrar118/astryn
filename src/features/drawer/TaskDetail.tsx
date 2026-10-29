import { trackerOf } from "@/lib/tracker";
import { useModules } from "@/lib/modules";
import { DocLinksPanel } from "@/features/docs/DocLinksPanel";
import { LocalTaskDetail } from "@/features/local-tasks/LocalTaskDetail";
import { LinearIssueDetail } from "./LinearIssueDetail";

export type TaskDetailMode = "drawer" | "page";

/**
 * One task's detail (drawer or full-page tab) for any tracker. Each tracker
 * renders its own body — Linear keeps its Linear-familiar one, local tasks a
 * ClickUp-style one. Panels that apply to every tracker (F9 doc links) are
 * built here, once, and each body places them in its own layout.
 */
export function TaskDetail({ id, mode, onClose }: { id: string; mode: TaskDetailMode; onClose: () => void }) {
  const docsOn = useModules().isActive("docs");
  const tracker = trackerOf(id);
  // Opening a doc switches the pane to a Docs tab, so the drawer gets out of the way.
  const docLinks = docsOn ? <DocLinksPanel tracker={tracker} taskId={id} onNavigate={mode === "drawer" ? onClose : undefined} /> : null;
  switch (tracker) {
    case "linear":
      return <LinearIssueDetail id={id} mode={mode} onClose={onClose} docLinks={docLinks} />;
    case "local-tasks":
      return <LocalTaskDetail id={id} mode={mode} onClose={onClose} docLinks={docLinks} />;
  }
}
