import { trackerOf } from "@/lib/tracker";
import { LocalTaskDetail } from "@/features/local-tasks/LocalTaskDetail";
import { LinearIssueDetail } from "./LinearIssueDetail";

export type TaskDetailMode = "drawer" | "page";

/**
 * One task's detail (drawer or full-page tab) for any tracker. Each tracker
 * renders its own body — Linear keeps its Linear-familiar one, local tasks a
 * ClickUp-style one. Panels that apply to every tracker (e.g. per-task doc
 * links) attach here, once.
 */
export function TaskDetail({ id, mode, onClose }: { id: string; mode: TaskDetailMode; onClose: () => void }) {
  switch (trackerOf(id)) {
    case "linear":
      return <LinearIssueDetail id={id} mode={mode} onClose={onClose} />;
    case "local-tasks":
      return <LocalTaskDetail id={id} mode={mode} onClose={onClose} />;
  }
}
