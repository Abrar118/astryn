import { Button } from "@/components/ui/button";
import { IndicatorLamp } from "@/components/IndicatorLamp";

/** A screen whose source is not connected yet: the page title, then one faceplate row
 *  with an unlit lamp, the reason, and the action that fixes it. */
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
    <main className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-6 pt-8">
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{title}</h1>
        <section className="dash-panel mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
          <IndicatorLamp tone="off" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground">Not connected</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{message}</p>
          </div>
          <Button onClick={onAction}>{action}</Button>
        </section>
      </div>
    </main>
  );
}
