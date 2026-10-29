import type { IconComponent } from "@/lib/modules";
import { BitbucketIcon, ClickUpIcon, GitHubIcon, LinearIcon, TeamsIcon } from "@/components/BrandIcons";
import {
  Blocks,
  BookText,
  BrainCircuit,
  Calendar,
  ListTodo,
  MessageSquare,
  Palette,
} from "lucide-react";
import type { ModuleId } from "@/lib/commands";

export type SettingsSection =
  | "modules"
  | "linear"
  | "github"
  | "bitbucket"
  | "slack"
  | "teams"
  | "clickup"
  | "documentation"
  | "local-tasks"
  | "ai"
  | "appearance"
  | "calendar";

export type SettingsGroup = {
  label: string;
  items: { id: SettingsSection; label: string; icon: IconComponent; module: ModuleId | "core"; tint?: string }[];
};

/**
 * Sidebar structure. Order here is the order rendered. Icons are component
 * references rather than JSX so this stays a plain `.ts` registry; SettingsNav
 * sizes them. Where a section maps onto a Dock view (Slack, Documentation,
 * Calendar) it reuses that view's icon so the two navigations agree.
 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Modules",
    items: [{ id: "modules", label: "Modules", icon: Blocks, module: "core", tint: "tint-blue" }],
  },
  {
    label: "Connections",
    items: [
      { id: "linear", label: "Linear", icon: LinearIcon, module: "linear" },
      { id: "github", label: "GitHub", icon: GitHubIcon, module: "github" },
      { id: "bitbucket", label: "Bitbucket", icon: BitbucketIcon, module: "bitbucket" },
      { id: "slack", label: "Slack", icon: MessageSquare, module: "slack", tint: "tint-pink" },
      { id: "teams", label: "Teams", icon: TeamsIcon, module: "teams" },
      { id: "clickup", label: "ClickUp", icon: ClickUpIcon, module: "clickup" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "local-tasks", label: "Local tasks", icon: ListTodo, module: "local-tasks", tint: "tint-green" },
      { id: "documentation", label: "Documentation", icon: BookText, module: "docs", tint: "tint-amber" },
      { id: "ai", label: "AI", icon: BrainCircuit, module: "llm", tint: "tint-violet" },
    ],
  },
  {
    label: "Preferences",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette, module: "core", tint: "tint-pink" },
      { id: "calendar", label: "Calendar", icon: Calendar, module: "core", tint: "tint-red" },
    ],
  },
];

export const DEFAULT_SECTION: SettingsSection = SETTINGS_GROUPS[0].items[0].id;

// Deep-link seam. `setActiveView("settings")` carries no parameters, so a screen
// that wants to send the user to a *specific* section (Docs' "add a repository"
// empty state) parks it here first. Settings consumes it once on mount — the same
// module-store trick lib/reportsStore.ts uses to survive tab remounts.
let requested: SettingsSection | null = null;

export function requestSettingsSection(section: SettingsSection): void {
  requested = section;
}

/** Read and clear the pending section, so a later visit opens where you left off. */
export function takeRequestedSection(): SettingsSection | null {
  const section = requested;
  requested = null;
  return section;
}
