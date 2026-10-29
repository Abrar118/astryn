import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import { cn } from "@/lib/utils";

/** A one-row status message on the faceplate: a lamp, what is true, and what to expect. */
export function LampMessage({
  tone,
  title,
  body,
  className,
}: {
  tone: Lamp;
  title: string;
  body?: string;
  className?: string;
}) {
  return (
    <div role="status" className={cn("flex items-start gap-3 px-4 py-6", className)}>
      <IndicatorLamp tone={tone} className="mt-1.5" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        {body && <p className="mt-0.5 text-[12px] text-muted-foreground">{body}</p>}
      </div>
    </div>
  );
}
