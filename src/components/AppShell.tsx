import { useSyncLoop } from "@/lib/queries";
import { WorkspaceProvider, useWorkspace } from "@/lib/tabs";
import { TabBar } from "@/components/TabBar";
import { Dock } from "@/components/Dock";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { IssuesView } from "@/features/issues/IssuesView";
import { Settings } from "@/features/settings/Settings";
import { IssueDrawer } from "@/features/drawer/IssueDrawer";
import { IssueMenuProvider } from "@/features/issues/IssueContextMenu";

function Shell() {
  const { active } = useWorkspace();
  const { isSyncing, refresh } = useSyncLoop();

  return (
    <div className="relative flex h-screen flex-col bg-background text-foreground">
      <TabBar />
      {/* Keyed by tab id so each tab gets a fresh view instance. */}
      <main key={active.id} className="min-h-0 flex-1 overflow-hidden">
        {active.view === "calendar" && <CalendarPage />}
        {active.view === "list" && <IssuesView />}
        {active.view === "settings" && <Settings />}
      </main>
      <Dock isSyncing={isSyncing} refresh={refresh} />
      <IssueDrawer />
    </div>
  );
}

export function AppShell() {
  return (
    <WorkspaceProvider>
      <IssueMenuProvider>
        <Shell />
      </IssueMenuProvider>
    </WorkspaceProvider>
  );
}
