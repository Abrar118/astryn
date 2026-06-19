import { NavLink, Outlet } from "react-router-dom";
import { useSyncLoop } from "@/lib/queries";
import { DualClock } from "@/features/home/DualClock";
import { Button } from "@/components/ui/button";

const navItem = (active: boolean) =>
  `block rounded-md px-3 py-2 text-sm ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`;

export function AppShell() {
  const { isSyncing, refresh } = useSyncLoop();
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-56 flex-col gap-1 border-r p-3">
        <div className="px-3 py-2 text-lg font-semibold">Astryn</div>
        <nav className="flex flex-col gap-1">
          <NavLink to="/" className={({ isActive }) => navItem(isActive)} end>Calendar</NavLink>
          <NavLink to="/settings" className={({ isActive }) => navItem(isActive)}>Settings</NavLink>
          <span className={navItem(false) + " cursor-not-allowed opacity-40"}>Timeline · M2</span>
          <span className={navItem(false) + " cursor-not-allowed opacity-40"}>Standup · M3</span>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
          <DualClock />
          <Button variant="outline" size="sm" disabled={isSyncing} onClick={refresh}>
            {isSyncing ? "Syncing…" : "Refresh"}
          </Button>
        </header>
        <main className="min-w-0 flex-1"><Outlet /></main>
      </div>
    </div>
  );
}
