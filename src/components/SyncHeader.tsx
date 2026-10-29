import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";

/** Connection + sync state of a synced source, read off one lamp. */
export function syncLamp({
  state,
  syncFailed,
  connectedDetail,
}: {
  state: string | undefined;
  syncFailed: boolean;
  connectedDetail?: string | null;
}): { tone: Lamp; text: string } {
  if (syncFailed) return { tone: "warning", text: "sync failed · showing cached data" };
  if (state === "unverified") return { tone: "warning", text: "cached · connection not verified" };
  if (state === "connected") return { tone: "success", text: connectedDetail || "connected" };
  return { tone: "off", text: "reading cache" };
}

/** The header of a synced screen: page title, its source lamp and a refresh key. */
export function SyncHeader({
  title,
  status,
  refreshing,
  onRefresh,
}: {
  title: string;
  status: { tone: Lamp; text: string };
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
      <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{title}</h1>
      <div className="flex min-w-0 items-center gap-2">
        <span role="status" className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
          <IndicatorLamp tone={status.tone} />
          <span className={status.tone === "warning" ? "truncate text-foreground" : "truncate"}>{status.text}</span>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh" title="Refresh" disabled={refreshing} onClick={onRefresh}>
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />
        </Button>
      </div>
    </header>
  );
}
