import type { ReactNode } from "react";
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
import { cn } from "@/lib/utils";
import { saveTheme, THEMES, useThemePreference, type Scheme, type ThemeId } from "@/lib/theme";
import { SectionHeader } from "../SectionHeader";

/** A miniature of the theme, drawn with that theme's own tokens via `data-theme`. */
function ThemeSwatch({ id }: { id: ThemeId }) {
  return (
    <span data-theme={id} aria-hidden className="flex h-14 w-full overflow-hidden rounded-md border border-border bg-background">
      <span className="w-1/4 border-r border-sidebar-border bg-sidebar" />
      <span className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="h-1.5 w-3/4 rounded-full bg-foreground/80" />
        <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/60" />
        <span className="mt-auto flex items-center gap-1">
          <span className="h-2.5 w-6 rounded-sm bg-primary" />
          <span className="size-2.5 rounded-full bg-success" />
          <span className="size-2.5 rounded-full bg-warning" />
          <span className="size-2.5 rounded-full bg-destructive" />
        </span>
      </span>
    </span>
  );
}

/** One radio option rendered as a selectable tile (native radio keeps arrow-key navigation). */
function ThemeOption({
  name,
  value,
  checked,
  label,
  onSelect,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-1.5 rounded-lg border p-1.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        checked ? "border-primary" : "border-border hover:border-input",
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
      <span className={cn("px-0.5 text-xs", checked ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
    </label>
  );
}

function ThemePicker() {
  const pref = useThemePreference();
  const pairFor = (scheme: Scheme) => THEMES.filter((t) => t.scheme === scheme);

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-sm text-foreground">Theme</legend>
      <div className="grid grid-cols-5 gap-2">
        {THEMES.map((t) => (
          <ThemeOption
            key={t.id}
            name="theme-mode"
            value={t.id}
            label={t.label}
            checked={pref.mode === t.id}
            onSelect={() => saveTheme({ ...pref, mode: t.id })}
          >
            <ThemeSwatch id={t.id} />
          </ThemeOption>
        ))}
        <ThemeOption
          name="theme-mode"
          value="auto"
          label="Match system"
          checked={pref.mode === "auto"}
          onSelect={() => saveTheme({ ...pref, mode: "auto" })}
        >
          <span aria-hidden className="grid grid-cols-2 gap-1">
            <ThemeSwatch id={pref.light} />
            <ThemeSwatch id={pref.dark} />
          </span>
        </ThemeOption>
      </div>
      {pref.mode === "auto" &&
        (["light", "dark"] as const).map((scheme) => (
          <div key={scheme} role="radiogroup" aria-label={`Theme when the system is ${scheme}`} className="flex items-center gap-3">
            <span className="w-40 text-xs text-muted-foreground">When the system is {scheme}</span>
            {pairFor(scheme).map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
                <input
                  type="radio"
                  name={`theme-${scheme}`}
                  checked={pref[scheme] === t.id}
                  onChange={() => saveTheme({ ...pref, [scheme]: t.id })}
                  className="accent-primary"
                />
                {t.label}
              </label>
            ))}
          </div>
        ))}
    </fieldset>
  );
}

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
      <SectionHeader title="Appearance" description="Color theme and interface scale." />
      <Card className="p-6">
        <ThemePicker />
      </Card>
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
