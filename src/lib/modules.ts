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
  MessageSquare,
  MessagesSquare,
  Network,
  NotebookPen,
  Settings as SettingsIcon,
  Sparkles,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
import { listModules, type Capability, type ModuleId, type ModulesView, type ScreenId } from "@/lib/commands";
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

export function ownerActive(owner: ModuleId | "core", isActive: IsActive): boolean {
  return owner === "core" || isActive(owner);
}

export function visibleViews(isActive: IsActive, disabledScreens: readonly ScreenId[] = []): NavView[] {
  return NAV_VIEWS.filter((v) => viewActive(v, isActive, disabledScreens));
}

/** A view is shown when its module is active and its screen is not switched off. Issue tabs belong to the tracker module. */
export function viewActive(view: ViewKind, isActive: IsActive, disabledScreens: readonly ScreenId[] = []): boolean {
  if (view === "issue") return isActive("linear");
  return ownerActive(VIEW_META[view].module, isActive) && !(disabledScreens as readonly string[]).includes(view);
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
  teams: { kind: "provider", provides: ["chat"], requires: [], optional: [] },
  clickup: { kind: "provider", provides: ["docs-source"], requires: [], optional: [] },
};

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

/** User-facing name, icon and one-line purpose for each module. Icons match Settings nav. */
export const MODULE_COPY: Record<ModuleId, { name: string; icon: LucideIcon; description: string; removes: string[] }> = {
  linear: { name: "Linear", icon: SquareKanban, description: "Issues, calendar, dependencies and inbox.", removes: ["Linear API key", "cached issues"] },
  github: { name: "GitHub", icon: GitBranch, description: "Pull requests and repository documentation.", removes: ["GitHub token", "favorite repositories", "cached pull requests", "cached docs files"] },
  slack: { name: "Slack", icon: MessageSquare, description: "Messages and mentions from your workspace.", removes: ["Slack token and cookie", "cached Slack messages"] },
  llm: { name: "AI", icon: Sparkles, description: "Summaries and polish for reports.", removes: ["AI endpoint URL", "model name", "API key"] },
  docs: { name: "Docs", icon: BookText, description: "Docs from GitHub repositories, ClickUp Docs and local folders.", removes: ["documentation sources (your local files are kept)", "cached docs"] },
  reports: { name: "Reports", icon: NotebookPen, description: "Daily scrum and weekly review.", removes: [] },
  "link-previews": { name: "Link previews", icon: Link2, description: "Rich previews for pasted links.", removes: [] },
  bitbucket: { name: "Bitbucket", icon: FolderGit2, description: "Pull requests from Bitbucket Cloud.", removes: ["Bitbucket email and API token", "favorite repositories", "cached pull requests"] },
  clickup: { name: "ClickUp", icon: FileStack, description: "ClickUp Docs as a documentation source.", removes: ["ClickUp token", "cached ClickUp Doc pages"] },
  teams: { name: "Microsoft Teams", icon: MessagesSquare, description: "Unread chats and mentions from Teams.", removes: ["Teams sign-in", "app registration settings", "cached Teams messages"] },
};

/** What turns a missing capability on, phrased to follow "Needs ". */
export const CAPABILITY_PROVIDERS: Record<Capability, string> = {
  tracker: "an issue tracker — turn on Linear",
  notifications: "a notification source — turn on Linear",
  "code-host": "a code host — turn on GitHub or Bitbucket",
  "docs-source": "a docs source — turn on GitHub or ClickUp",
  chat: "a chat provider — turn on Slack or Teams",
  llm: "an AI provider — turn on AI",
};
