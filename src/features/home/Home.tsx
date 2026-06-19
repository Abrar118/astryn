import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { errorText, getConnectionStatus } from "@/lib/commands";
import { DualClock } from "./DualClock";

export function Home({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { data: status, isError, error } = useQuery({
    queryKey: ["connection-status"],
    queryFn: getConnectionStatus,
  });

  useEffect(() => {
    if (isError)
      gooeyToast.error("Could not read connection status", {
        description: errorText(error),
      });
  }, [isError, error]);

  let label = "Checking…";
  if (isError) {
    label = "Status unavailable";
  } else if (status) {
    if (status.state === "not_configured") label = "Not connected";
    else if (status.state === "unverified") label = "Key saved — not verified";
    else label = `Connected as ${status.name}`;
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-10">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Astryn</h1>
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          Settings
        </Button>
      </header>
      <DualClock />
      <p className="text-sm text-muted-foreground">{label}</p>
    </main>
  );
}
