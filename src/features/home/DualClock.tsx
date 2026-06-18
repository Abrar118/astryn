import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function ClockCard({ city, zone, now }: { city: string; zone: string; now: Date }) {
  return (
    <Card className="flex flex-col gap-1 p-6">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{city}</span>
      <span className="font-mono text-4xl tabular-nums">{formatTime(now, zone)}</span>
      <span className="text-xs text-muted-foreground">{zone}</span>
    </Card>
  );
}

export function DualClock() {
  const now = useNow();
  return (
    <div className="grid grid-cols-2 gap-4">
      <ClockCard city="Dhaka" zone="Asia/Dhaka" now={now} />
      <ClockCard city="Germany" zone="Europe/Berlin" now={now} />
    </div>
  );
}
