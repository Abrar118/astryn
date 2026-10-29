import { Button } from "@/components/ui/button";
import { IndicatorLamp } from "@/components/IndicatorLamp";

/** A screen whose source is not connected yet: the page heading at the shared
 *  header inset, then one row on the faceplate with an unlit lamp, the reason,
 *  and the action that fixes it. */
export function SetupState({
  title,
  message,
  action,
  onAction,
}: {
  title: string;
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <main className="flex h-full flex-col bg-background">
      <header className="border-b border-border px-4 pt-4 pb-3">
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{title}</h1>
      </header>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-4 py-4">
        <IndicatorLamp tone="off" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground">Not connected</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{message}</p>
        </div>
        <Button onClick={onAction}>{action}</Button>
      </div>
    </main>
  );
}
