import { useQuery } from "@tanstack/react-query";
import {
  BookText,
  Calendar,
  CalendarRange,
  GitBranch,
  GitPullRequest,
  Inbox,
  LayoutDashboard,
  Link2,
  List,
  MessageSquare,
  Network,
  NotebookPen,
  Settings as SettingsIcon,
  Sparkles,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
import { listModules, type Capability, type ModuleId, type ModulesView } from "@/lib/commands";
import type { Tab, ViewKind } from "@/lib/paneModel";
import { trackerOf, type TrackerId } from "@/lib/tracker";

type NavView = Exclude<ViewKind, "issue">;

/** A view's owner: a module, the app core, or "tracker" (shown while any tracker module is on). */
export type ViewOwner = ModuleId | "core" | "tracker";

/** The one view registry: label, icon and owner for every navigable view. */
export const VIEW_META: Record<NavView, { label: string; icon: LucideIcon; module: ViewOwner }> = {
  dashboard: { label: "Dashboard", icon: LayoutDashboard, module: "core" },
  calendar: { label: "Calendar", icon: Calendar, module: "tracker" },
  list: { label: "Issues", icon: List, module: "linear" },
  "this-week": { label: "This Week", icon: CalendarRange, module: "tracker" },
  graph: { label: "Dependencies", icon: Network, module: "tracker" },
  inbox: { label: "Inbox", icon: Inbox, module: "linear" },
  prs: { label: "Pull Requests", icon: GitPullRequest, module: "github" },
  slack: { label: "Slack", icon: MessageSquare, module: "slack" },
  docs: { label: "Docs", icon: BookText, module: "docs" },
  reports: { label: "Reports", icon: NotebookPen, module: "reports" },
  settings: { label: "Settings", icon: SettingsIcon, module: "core" },
};

export const NAV_VIEWS = Object.keys(VIEW_META) as NavView[];

export type IsActive = (id: ModuleId) => boolean;

export function ownerActive(owner: ViewOwner, isActive: IsActive): boolean {
  if (owner === "core") return true;
  if (owner === "tracker") return trackerModulesActive(isActive);
  return isActive(owner);
}

export function visibleViews(isActive: IsActive): NavView[] {
  return NAV_VIEWS.filter((v) => ownerActive(VIEW_META[v].module, isActive));
}

/** Issue views need a tracker; use `tabActive` when the tab (and so its task) is known. */
export function viewActive(view: ViewKind, isActive: IsActive): boolean {
  return ownerActive(view === "issue" ? "tracker" : VIEW_META[view].module, isActive);
}

/** A task tab stays open only while the tracker that owns its task is on. */
export function tabActive(tab: Tab, isActive: IsActive): boolean {
  if (tab.view === "issue" && tab.issueId) return isActive(trackerOf(tab.issueId));
  return viewActive(tab.view, isActive);
}

type ManifestEntry = { kind: "provider" | "feature"; provides: Capability[]; requires: Capability[]; optional: Capability[] };

/** TS mirror of the Rust module manifest. */
export const MODULE_MANIFEST: Record<ModuleId, ManifestEntry> = {
  linear: { kind: "provider", provides: ["tracker", "notifications"], requires: [], optional: [] },
  github: { kind: "provider", provides: ["code-host", "docs-source"], requires: [], optional: [] },
  slack: { kind: "provider", provides: ["chat"], requires: [], optional: [] },
  llm: { kind: "provider", provides: ["llm"], requires: [], optional: [] },
  docs: { kind: "feature", provides: [], requires: ["docs-source"], optional: [] },
  reports: { kind: "feature", provides: [], requires: ["tracker"], optional: ["code-host", "llm"] },
  "link-previews": { kind: "feature", provides: [], requires: [], optional: [] },
};

/** The modules that provide the `tracker` capability — the one list of trackers. */
export const TRACKER_MODULES = (Object.keys(MODULE_MANIFEST) as ModuleId[]).filter((id) =>
  MODULE_MANIFEST[id].provides.includes("tracker"),
) as TrackerId[];

/** True while at least one tracker module is active (the `tracker` capability). */
export function trackerModulesActive(isActive: IsActive): boolean {
  return TRACKER_MODULES.some((t) => isActive(t));
}

/** Capabilities `id` requires that no module in `selected` provides. */
export function previewMissing(id: ModuleId, selected: Set<ModuleId>): Capability[] {
  const provided = new Set<Capability>();
  for (const m of selected) MODULE_MANIFEST[m].provides.forEach((c) => provided.add(c));
  return MODULE_MANIFEST[id].requires.filter((c) => !provided.has(c));
}

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
    !!data?.modules.some((m) => m.enabled && m.available && MODULE_MANIFEST[m.id].provides.includes(cap));
  return { data, isActive, hasCapability, ready: !!data };
}

/** User-facing name, icon and one-line purpose for each module. Icons match Settings nav. */
export const MODULE_COPY: Record<ModuleId, { name: string; icon: LucideIcon; description: string; removes: string[] }> = {
  linear: { name: "Linear", icon: SquareKanban, description: "Issues, calendar, dependencies and inbox.", removes: ["Linear API key", "cached issues"] },
  github: { name: "GitHub", icon: GitBranch, description: "Pull requests and repository documentation.", removes: ["GitHub token", "favorite repositories", "cached pull requests", "cached docs files"] },
  slack: { name: "Slack", icon: MessageSquare, description: "Messages and mentions from your workspace.", removes: ["Slack token and cookie", "cached Slack messages"] },
  llm: { name: "AI", icon: Sparkles, description: "Summaries and polish for reports.", removes: ["AI endpoint URL", "model name", "API key"] },
  docs: { name: "Docs", icon: BookText, description: "Markdown docs from your GitHub repositories.", removes: ["documentation sources", "cached docs"] },
  reports: { name: "Reports", icon: NotebookPen, description: "Daily scrum and weekly review.", removes: [] },
  "link-previews": { name: "Link previews", icon: Link2, description: "Rich previews for pasted links.", removes: [] },
};

/** What turns a missing capability on, phrased to follow "Needs ". */
export const CAPABILITY_PROVIDERS: Record<Capability, string> = {
  tracker: "an issue tracker — turn on Linear",
  notifications: "a notification source — turn on Linear",
  "code-host": "a code host — turn on GitHub",
  "docs-source": "a docs source — turn on GitHub",
  chat: "a chat provider — turn on Slack",
  llm: "an AI provider — turn on AI",
};
