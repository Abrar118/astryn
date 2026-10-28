import { useState } from "react";
import { ownerActive, useModules } from "@/lib/modules";
import { SettingsNav } from "./SettingsNav";
import { DEFAULT_SECTION, SETTINGS_GROUPS, takeRequestedSection, type SettingsSection } from "./settingsSection";
import { AiSection } from "./sections/AiSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { CalendarSection } from "./sections/CalendarSection";
import { DocsSection } from "./sections/DocsSection";
import { GithubSection } from "./sections/GithubSection";
import { LinearSection } from "./sections/LinearSection";
import { ModulesSection } from "./sections/ModulesSection";
import { SlackSection } from "./sections/SlackSection";
import { TeamsSection } from "./sections/TeamsSection";

function SectionBody({ section }: { section: SettingsSection }) {
  switch (section) {
    case "modules":
      return <ModulesSection />;
    case "linear":
      return <LinearSection />;
    case "github":
      return <GithubSection />;
    case "slack":
      return <SlackSection />;
    case "teams":
      return <TeamsSection />;
    case "documentation":
      return <DocsSection />;
    case "ai":
      return <AiSection />;
    case "appearance":
      return <AppearanceSection />;
    case "calendar":
      return <CalendarSection />;
  }
}

export function Settings() {
  // Consumed once on mount so a deep-link (Docs' "add a repository") lands on the
  // right section; ordinary visits open on the default.
  const { isActive, ready } = useModules();
  const [selected, setSection] = useState<SettingsSection>(
    () => takeRequestedSection() ?? DEFAULT_SECTION,
  );

  // A section whose module was just turned off falls back to Modules.
  const owner = SETTINGS_GROUPS.flatMap((g) => g.items).find((i) => i.id === selected)?.module ?? "core";
  const section: SettingsSection = !ready || ownerActive(owner, isActive) ? selected : "modules";

  return (
    <main className="flex h-full min-h-0">
      <SettingsNav active={section} onSelect={setSection} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* pb-28 keeps the last card clear of the floating dock that overlaps the bottom */}
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-10 pt-10 pb-28">
          <SectionBody section={section} />
        </div>
      </div>
    </main>
  );
}
