import { useQuery } from "@tanstack/react-query";
import {
  BookText,
  Calendar,
  CalendarRange,
  FolderGit2,
  FileStack,
  GitBranch,
  GitPullRequest,
  GitPullRequestArrow,
  Inbox,
  LayoutDashboard,
  Link2,
  List,
  ListTodo,
  MessageSquare,
  MessagesSquare,
  Network,
  NotebookPen,
  Settings as SettingsIcon,
  Cpu,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
import { listModules, type Capability, type ModuleId, type ModulesView, type ScreenId } from "@/lib/commands";
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
  tasks: { label: "Tasks", icon: ListTodo, module: "local-tasks" },
  prs: { label: "Pull Requests", icon: GitPullRequest, module: "github" },
  "bitbucket-prs": { label: "Bitbucket PRs", icon: GitPullRequestArrow, module: "bitbucket" },
  slack: { label: "Slack", icon: MessageSquare, module: "slack" },
  teams: { label: "Teams", icon: MessagesSquare, module: "teams" },
  docs: { label: "Docs", icon: BookText, module: "docs" },
  reports: { label: "Reports", icon: NotebookPen, module: "reports" },
  settings: { label: "Settings", icon: SettingsIcon, module: "core" },
};

export const NAV_VIEWS = Object.keys(VIEW_META) as NavView[];

/** Screens the owner can switch off on top of their module. Calendar, Dashboard and Settings always stay on. */
export const SWITCHABLE_SCREENS: ScreenId[] = ["list", "this-week", "graph", "inbox"];

export type IsActive = (id: ModuleId) => boolean;

export function ownerActive(owner: ViewOwner, isActive: IsActive): boolean {
  if (owner === "core") return true;
  if (owner === "tracker") return trackerModulesActive(isActive);
  return isActive(owner);
}

export function visibleViews(isActive: IsActive, disabledScreens: readonly ScreenId[] = []): NavView[] {
  return NAV_VIEWS.filter((v) => viewActive(v, isActive, disabledScreens));
}

/**
 * A view is shown when its owner is active and its screen is not switched off.
 * Issue views need a tracker; use `tabActive` when the tab (and so its task) is known.
 */
export function viewActive(view: ViewKind, isActive: IsActive, disabledScreens: readonly ScreenId[] = []): boolean {
  if (view === "issue") return ownerActive("tracker", isActive);
  return ownerActive(VIEW_META[view].module, isActive) && !(disabledScreens as readonly string[]).includes(view);
}

/** A task tab stays open only while the tracker that owns its task is on. */
export function tabActive(tab: Tab, isActive: IsActive, disabledScreens: readonly ScreenId[] = []): boolean {
  if (tab.view === "issue" && tab.issueId) return isActive(trackerOf(tab.issueId));
  return viewActive(tab.view, isActive, disabledScreens);
}

type ManifestEntry = { kind: "provider" | "feature"; provides: Capability[]; requires: Capability[]; optional: Capability[] };

/** TS mirror of the Rust module manifest. */
export const MODULE_MANIFEST: Record<ModuleId, ManifestEntry> = {
  linear: { kind: "provider", provides: ["tracker", "notifications"], requires: [], optional: [] },
  github: { kind: "provider", provides: ["code-host", "docs-source"], requires: [], optional: [] },
  bitbucket: { kind: "provider", provides: ["code-host"], requires: [], optional: [] },
  slack: { kind: "provider", provides: ["chat"], requires: [], optional: [] },
  llm: { kind: "provider", provides: ["llm"], requires: [], optional: [] },
  docs: { kind: "feature", provides: [], requires: [], optional: ["docs-source"] },
  reports: { kind: "feature", provides: [], requires: ["tracker"], optional: ["code-host", "llm"] },
  "link-previews": { kind: "feature", provides: [], requires: [], optional: [] },
  "local-tasks": { kind: "provider", provides: ["tracker"], requires: [], optional: [] },
  teams: { kind: "provider", provides: ["chat"], requires: [], optional: [] },
  clickup: { kind: "provider", provides: ["docs-source"], requires: [], optional: [] },
};

/** The modules that provide the `tracker` capability — the one list of trackers. */
export const TRACKER_MODULES = (Object.keys(MODULE_MANIFEST) as ModuleId[]).filter((id) =>
  MODULE_MANIFEST[id].provides.includes("tracker"),
) as TrackerId[];

/** Whether a switchable screen is offered under module `id` (tracker screens sit under every tracker). */
export function screenListedUnder(screen: ScreenId, id: ModuleId): boolean {
  const owner = VIEW_META[screen].module;
  return owner === id || (owner === "tracker" && (TRACKER_MODULES as ModuleId[]).includes(id));
}

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

const NO_SCREENS_OFF: ScreenId[] = [];

export function useModules(): {
  data?: ModulesView;
  isActive: IsActive;
  hasCapability: (cap: Capability) => boolean;
  disabledScreens: ScreenId[];
  isViewActive: (view: ViewKind) => boolean;
  ready: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
} {
  const { data, isError, refetch } = useQuery({ queryKey: MODULES_KEY, queryFn: listModules });
  // Until the first load resolves nothing is active, so only core entries render.
  const isActive: IsActive = (id) => !!data?.modules.find((m) => m.id === id && m.enabled && m.available);
  const hasCapability = (cap: Capability) =>
    !!data?.modules.some((m) => m.enabled && m.available && MODULE_MANIFEST[m.id].provides.includes(cap));
  const disabledScreens = data?.disabledScreens ?? NO_SCREENS_OFF;
  const isViewActive = (view: ViewKind) => viewActive(view, isActive, disabledScreens);
  return { data, isActive, hasCapability, disabledScreens, isViewActive, ready: !!data, isError, refetch };
}

/**
 * User-facing name, icon and one-line purpose for each module. Icons match Settings nav.
 * `warning` is shown in the remove-data confirmation when the data exists nowhere else.
 */
export const MODULE_COPY: Record<
  ModuleId,
  { name: string; icon: LucideIcon; description: string; removes: string[]; warning?: string }
> = {
  linear: { name: "Linear", icon: SquareKanban, description: "Issues, calendar, dependencies and inbox.", removes: ["Linear API key", "cached issues"] },
  github: { name: "GitHub", icon: GitBranch, description: "Pull requests and repository documentation.", removes: ["GitHub token", "favorite repositories", "cached pull requests", "cached docs files"] },
  slack: { name: "Slack", icon: MessageSquare, description: "Messages and mentions from your workspace.", removes: ["Slack token and cookie", "cached Slack messages"] },
  llm: { name: "AI", icon: Cpu, description: "Summaries and polish for reports.", removes: ["AI endpoint URL", "model name", "API key"] },
  docs: { name: "Docs", icon: BookText, description: "Docs from GitHub repositories, ClickUp Docs and local folders, and doc links on tasks.", removes: ["documentation sources (your local files are kept)", "cached docs", "doc links on tasks"] },
  reports: { name: "Reports", icon: NotebookPen, description: "Daily scrum and weekly review.", removes: [] },
  "link-previews": { name: "Link previews", icon: Link2, description: "Rich previews for pasted links.", removes: [] },
  "local-tasks": {
    name: "Local tasks",
    icon: ListTodo,
    description: "Spaces, lists and sprints kept on this computer — no account needed.",
    removes: ["all local spaces, lists and tasks", "their workflows, sprints and labels"],
    warning: "These tasks exist only on this computer. A final backup is saved to the backups folder first.",
  },
  bitbucket: { name: "Bitbucket", icon: FolderGit2, description: "Pull requests from Bitbucket Cloud.", removes: ["Bitbucket email and API token", "favorite repositories", "cached pull requests"] },
  clickup: { name: "ClickUp", icon: FileStack, description: "ClickUp Docs as a documentation source.", removes: ["ClickUp token", "cached ClickUp Doc pages"] },
  teams: { name: "Microsoft Teams", icon: MessagesSquare, description: "Unread chats and mentions from Teams.", removes: ["Teams sign-in", "app registration settings", "cached Teams messages"] },
};

/** What turns a missing capability on, phrased to follow "Needs ". */
export const CAPABILITY_PROVIDERS: Record<Capability, string> = {
  tracker: "a task tracker — turn on Linear or Local tasks",
  notifications: "a notification source — turn on Linear",
  "code-host": "a code host — turn on GitHub or Bitbucket",
  "docs-source": "a docs source — turn on GitHub or ClickUp",
  chat: "a chat provider — turn on Slack or Teams",
  llm: "an AI provider — turn on AI",
};
