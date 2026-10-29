import { cn } from "@/lib/utils";

/** Indicator-lamp states: a lit lamp reports state, an unlit ring means "nothing to report". */
export type Lamp = "danger" | "warning" | "info" | "success" | "neutral" | "off";

const LAMP_CLASS: Record<Lamp, string> = {
  danger: "dash-lamp-lit bg-destructive",
  warning: "dash-lamp-lit bg-warning",
  info: "dash-lamp-lit bg-info",
  success: "dash-lamp-lit bg-success",
  neutral: "dash-lamp-lit bg-muted-foreground",
  off: "border border-muted-foreground/70",
};

export function IndicatorLamp({ tone, className }: { tone: Lamp; className?: string }) {
  return <span aria-hidden className={cn("dash-lamp", LAMP_CLASS[tone], className)} />;
}
