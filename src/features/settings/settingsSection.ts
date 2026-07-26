import {
  BookText,
  Calendar,
  GitBranch,
  MessageSquare,
  Palette,
  Sparkles,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";

export type SettingsSection =
  | "linear"
  | "github"
  | "slack"
  | "documentation"
  | "ai"
  | "appearance"
  | "calendar";

export type SettingsGroup = {
  label: string;
  items: { id: SettingsSection; label: string; icon: LucideIcon }[];
};

/**
 * Sidebar structure. Order here is the order rendered. Icons are component
 * references rather than JSX so this stays a plain `.ts` registry; SettingsNav
 * sizes them. Where a section maps onto a Dock view (Slack, Documentation,
 * Calendar) it reuses that view's icon so the two navigations agree.
 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Connections",
    items: [
      { id: "linear", label: "Linear", icon: SquareKanban },
      { id: "github", label: "GitHub", icon: GitBranch },
      { id: "slack", label: "Slack", icon: MessageSquare },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "documentation", label: "Documentation", icon: BookText },
      { id: "ai", label: "AI", icon: Sparkles },
    ],
  },
  {
    label: "Preferences",
    items: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "calendar", label: "Calendar", icon: Calendar },
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
