import { useWorkspace } from "@/lib/tabs";
import { requestSettingsSection } from "@/features/settings/settingsSection";
import { useTeamsCatchup, useTeamsStatus, useTeamsSync } from "@/lib/queries";
import { CatchupBoard } from "@/features/chat/CatchupBoard";
import { teamsProvider } from "./teamsProvider";

/**
 * Teams catch-up: unread chats (1:1, group, meeting) and @mentions. Graph has
 * no per-user read marker for channel messages, so there is no Threads or
 * Channels section.
 */
export function TeamsPage() {
  const { setActiveView } = useWorkspace();
  const { data: status } = useTeamsStatus();
  const connected = status?.state === "connected" || status?.state === "unverified";
  const { data: catchup } = useTeamsCatchup();
  const sync = useTeamsSync(connected);

  return (
    <CatchupBoard
      provider={teamsProvider}
      notConfigured={status?.state === "not_configured"}
      connectText="Sign in with your work account to catch up on unread Teams chats."
      onConnect={() => {
        requestSettingsSection("teams");
        setActiveView("settings");
      }}
      state={status?.state}
      subtitle={status?.state === "connected" ? status.userName : null}
      catchup={catchup}
      sync={sync}
      sections={["mentions", "dms"]}
      sectionCopy={{ dms: { title: "Chats", empty: "No unread chats." } }}
    />
  );
}
