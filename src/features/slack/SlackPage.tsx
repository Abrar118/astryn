import { useWorkspace } from "@/lib/tabs";
import { requestSettingsSection } from "@/features/settings/settingsSection";
import { useSlackCatchup, useSlackStatus, useSlackSync } from "@/lib/queries";
import { CatchupBoard } from "@/features/chat/CatchupBoard";
import { slackProvider } from "./slackProvider";

export function SlackPage() {
  const { setActiveView } = useWorkspace();
  const { data: status } = useSlackStatus();
  const connected = status?.state === "connected" || status?.state === "unverified";
  const { data: catchup } = useSlackCatchup();
  const sync = useSlackSync(connected);

  return (
    <CatchupBoard
      provider={slackProvider}
      notConfigured={status?.state === "not_configured"}
      connectText="Link your Slack workspace to catch up on what you missed."
      onConnect={() => {
        requestSettingsSection("slack");
        setActiveView("settings");
      }}
      subtitle={status?.state === "connected" ? status.workspaceName : null}
      catchup={catchup}
      sync={sync}
      sections={["mentions", "dms", "threads", "channels"]}
    />
  );
}
