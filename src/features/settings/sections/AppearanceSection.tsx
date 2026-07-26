import { Minus, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  APPEARANCE_RANGES,
  clampAppearance,
  DEFAULT_APPEARANCE,
  saveAppearance,
  useAppearance,
  type Appearance,
} from "@/lib/appearance";
import { SectionHeader } from "../SectionHeader";

/** A −/value%/+ stepper for one appearance scale. */
function ScaleStepper({
  label,
  hint,
  field,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  field: keyof Appearance;
  value: number;
  onChange: (v: number) => void;
}) {
  const { min, max, step } = APPEARANCE_RANGES[field];
  const bump = (dir: 1 | -1) => onChange(clampAppearance(field, value + dir * step));
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => bump(-1)}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground ring-1 ring-border transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus className="size-3.5" />
        </button>
        <span className="w-12 text-center text-sm tabular-nums text-foreground">
          {Math.round(value * 100)}%
        </span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => bump(1)}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground ring-1 ring-border transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function AppearanceSection() {
  const appearance = useAppearance();
  const setScale = (field: keyof Appearance) => (v: number) =>
    saveAppearance({ ...appearance, [field]: v });

  return (
    <>
      <SectionHeader title="Appearance" description="Scale the interface to taste." />
      <Card className="flex flex-col gap-4 p-6">
        <ScaleStepper
          label="App font size"
          hint="Zooms the whole interface — text, icons and layout."
          field="appZoom"
          value={appearance.appZoom}
          onChange={setScale("appZoom")}
        />
        <ScaleStepper
          label="Icon size"
          hint="Scales icons on top of the app size."
          field="iconScale"
          value={appearance.iconScale}
          onChange={setScale("iconScale")}
        />
        <ScaleStepper
          label="Editor font size"
          hint="Description and comment editors, and rendered markdown."
          field="editorScale"
          value={appearance.editorScale}
          onChange={setScale("editorScale")}
        />
        {(appearance.appZoom !== DEFAULT_APPEARANCE.appZoom ||
          appearance.iconScale !== DEFAULT_APPEARANCE.iconScale ||
          appearance.editorScale !== DEFAULT_APPEARANCE.editorScale) && (
          <button
            type="button"
            onClick={() => saveAppearance({ ...DEFAULT_APPEARANCE })}
            className="w-fit text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Reset to defaults
          </button>
        )}
      </Card>
    </>
  );
}
