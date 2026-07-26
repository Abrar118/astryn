import { useState } from "react";
import { SettingsNav } from "./SettingsNav";
import { DEFAULT_SECTION, takeRequestedSection, type SettingsSection } from "./settingsSection";
import { AiSection } from "./sections/AiSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { CalendarSection } from "./sections/CalendarSection";
import { DocsSection } from "./sections/DocsSection";
import { GithubSection } from "./sections/GithubSection";
import { LinearSection } from "./sections/LinearSection";
import { SlackSection } from "./sections/SlackSection";

function SectionBody({ section }: { section: SettingsSection }) {
  switch (section) {
    case "linear":
      return <LinearSection />;
    case "github":
      return <GithubSection />;
    case "slack":
      return <SlackSection />;
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
  const [section, setSection] = useState<SettingsSection>(
    () => takeRequestedSection() ?? DEFAULT_SECTION,
  );

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
