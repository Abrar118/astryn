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

/** User-facing name and one-line purpose for each module. */
export const MODULE_COPY: Record<ModuleId, { name: string; description: string; removes: string[] }> = {
  linear: { name: "Linear", description: "Issues, calendar, dependencies and inbox.", removes: ["Linear API key", "cached issues"] },
  github: { name: "GitHub", description: "Pull requests and repository documentation.", removes: ["GitHub token", "favorite repositories", "cached pull requests", "cached docs files"] },
  slack: { name: "Slack", description: "Messages and mentions from your workspace.", removes: ["Slack token and cookie", "cached Slack messages"] },
  llm: { name: "AI", description: "Summaries and polish for reports.", removes: ["AI endpoint URL", "model name", "API key"] },
  docs: { name: "Docs", description: "Documentation linked to your issues.", removes: ["documentation sources", "cached docs"] },
  reports: { name: "Reports", description: "Standup and weekly generators.", removes: [] },
  "link-previews": { name: "Link previews", description: "Rich previews for pasted links.", removes: [] },
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
