import { useSyncLoop } from "@/lib/queries";
import { useModules } from "@/lib/modules";
import { WorkspaceProvider } from "@/lib/tabs";
import { SplitLayout } from "@/components/SplitLayout";
import { ModulePicker } from "@/features/onboarding/ModulePicker";
import { Dock } from "@/components/Dock";
import { IssueDrawer } from "@/features/drawer/IssueDrawer";
import { IssueMenuProvider } from "@/features/issues/IssueContextMenu";
import { CommandPaletteProvider } from "@/features/command/CommandPalette";

function Shell() {
  const { hasCapability, ready, data } = useModules();
  const { isSyncing, refresh } = useSyncLoop(hasCapability("tracker"));

  if (ready && data?.onboarded === false) return <ModulePicker />;

  return (
    <div className="relative flex h-screen flex-col bg-background text-foreground">
      <SplitLayout />
      <Dock isSyncing={isSyncing} refresh={refresh} />
      <IssueDrawer />
    </div>
  );
}

export function AppShell() {
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
