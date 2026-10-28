import { useSyncLoop } from "@/lib/queries";
import { useModules } from "@/lib/modules";
import { WorkspaceProvider } from "@/lib/tabs";
import { SplitLayout } from "@/components/SplitLayout";
import { ModulePicker } from "@/features/onboarding/ModulePicker";
import { Dock } from "@/components/Dock";
import { TaskDrawer } from "@/features/drawer/TaskDrawer";
import { IssueMenuProvider } from "@/features/issues/IssueContextMenu";
import { CommandPaletteProvider } from "@/features/command/CommandPalette";

function Shell() {
  const { isActive } = useModules();
  // The background sync is Linear's; other trackers (local tasks) have nothing to pull.
  const { isSyncing, refresh } = useSyncLoop(isActive("linear"));

  return (
    <div className="relative flex h-screen flex-col bg-background text-foreground">
      <SplitLayout />
      <Dock isSyncing={isSyncing} refresh={refresh} />
      <TaskDrawer />
    </div>
  );
}

export function AppShell() {
  const { ready, data } = useModules();
  // The picker renders outside the providers so their global shortcuts are not registered behind it.
  if (ready && data?.onboarded === false) return <ModulePicker />;

  return (
    <WorkspaceProvider>
      {/* Palette outside the issue menu: the menu's "Create" actions open the
          seeded create modal via useCommandPalette. */}
      <CommandPaletteProvider>
        <IssueMenuProvider>
          <Shell />
        </IssueMenuProvider>
      </CommandPaletteProvider>
    </WorkspaceProvider>
  );
}
