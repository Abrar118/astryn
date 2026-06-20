import { useSyncLoop } from "@/lib/queries";
import { WorkspaceProvider } from "@/lib/tabs";
import { SplitLayout } from "@/components/SplitLayout";
import { Dock } from "@/components/Dock";
import { IssueDrawer } from "@/features/drawer/IssueDrawer";
import { IssueMenuProvider } from "@/features/issues/IssueContextMenu";
import { CommandPaletteProvider } from "@/features/command/CommandPalette";

function Shell() {
  const { isSyncing, refresh } = useSyncLoop();

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
      <IssueMenuProvider>
        <CommandPaletteProvider>
          <Shell />
        </CommandPaletteProvider>
      </IssueMenuProvider>
    </WorkspaceProvider>
  );
}
