import { useQuery } from "@tanstack/react-query";
import {
  BookText,
  Calendar,
  CalendarRange,
  GitPullRequest,
  Inbox,
  LayoutDashboard,
  List,
  MessageSquare,
  Network,
  NotebookPen,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { listModules, type Capability, type ModuleId, type ModulesView } from "@/lib/commands";
import type { ViewKind } from "@/lib/paneModel";

type NavView = Exclude<ViewKind, "issue">;

/** The one view registry: label, icon and owning module for every navigable view. */
export const VIEW_META: Record<NavView, { label: string; icon: LucideIcon; module: ModuleId | "core" }> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard, module: "core" },
  calendar: { label: "Calendar", icon: Calendar, module: "linear" },
  list: { label: "Issues", icon: List, module: "linear" },
  "this-week": { label: "This Week", icon: CalendarRange, module: "linear" },
  graph: { label: "Dependencies", icon: Network, module: "linear" },
  inbox: { label: "Inbox", icon: Inbox, module: "linear" },
  prs: { label: "Pull Requests", icon: GitPullRequest, module: "github" },
  slack: { label: "Slack", icon: MessageSquare, module: "slack" },
  docs: { label: "Docs", icon: BookText, module: "docs" },
  reports: { label: "Reports", icon: NotebookPen, module: "reports" },
  settings: { label: "Settings", icon: SettingsIcon, module: "core" },
};

export const NAV_VIEWS = Object.keys(VIEW_META) as NavView[];

export type IsActive = (id: ModuleId) => boolean;

export function ownerActive(owner: ModuleId | "core", isActive: IsActive): boolean {
  return owner === "core" || isActive(owner);
}

export function visibleViews(isActive: IsActive): NavView[] {
  return NAV_VIEWS.filter((v) => ownerActive(VIEW_META[v].module, isActive));
}

/** Issue tabs belong to the tracker module. */
export function viewActive(view: ViewKind, isActive: IsActive): boolean {
  return view === "issue" ? isActive("linear") : ownerActive(VIEW_META[view].module, isActive);
}

const PROVIDES: Partial<Record<ModuleId, Capability[]>> = {
  linear: ["tracker"],
  github: ["code-host"],
  slack: ["chat", "notifications"],
  llm: ["llm"],
  docs: ["docs-source"],
};

export const MODULES_KEY = ["modules"] as const;

export function useModules(): {
  data?: ModulesView;
  isActive: IsActive;
  hasCapability: (cap: Capability) => boolean;
  ready: boolean;
} {
  const { data } = useQuery({ queryKey: MODULES_KEY, queryFn: listModules });
  // Until the first load resolves nothing is active, so only core entries render.
  const isActive: IsActive = (id) => !!data?.modules.find((m) => m.id === id && m.enabled && m.available);
  const hasCapability = (cap: Capability) =>
    !!data?.modules.some((m) => m.enabled && m.available && PROVIDES[m.id]?.includes(cap));
  return { data, isActive, hasCapability, ready: !!data };
}
