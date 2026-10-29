import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { SettingsPanel, SettingsZone } from "../SettingsPanel";

/**
 * A miniature of one finish, drawn with that finish's own tokens via `data-theme`:
 * the body tone around a faceplate, two lines of text, a lit lamp and the key's needle.
 */
function FinishSwatch({ id }: { id: ThemeId }) {
  return (
    <span data-theme={id} aria-hidden className="g5-finish">
      <span className="g5-finish-plate">
        <span className="g5-finish-zone">
          <span className="h-1.5 w-3/5 rounded-full bg-foreground" />
          <span className="h-1.5 w-2/5 rounded-full bg-muted-foreground" />
        </span>
        <span className="g5-finish-zone g5-finish-scale">
          <span className="dash-lamp dash-lamp-lit size-1.5 bg-success" />
          <span className="dash-lamp dash-lamp-lit size-1.5 bg-muted-foreground" />
          <span className="g5-finish-needle" />
        </span>
      </span>
    </span>
  );
}

/** One radio option drawn as a finish tile (native radio keeps arrow-key navigation). */
function FinishOption({
  name,
  value,
  checked,
  label,
  legend,
  onSelect,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  legend?: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label className={cn("g5-finish-option", checked && "g5-finish-option-on")}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="sr-only" />
      {children}
      <span className="flex items-baseline justify-between gap-2 px-0.5">
        <span className={cn("truncate text-[13px] text-foreground", checked && "font-medium")}>{label}</span>
        {legend && <span className="text-[12px] text-muted-foreground">{legend}</span>}
      </span>
    </label>
  );
}

function ThemePicker() {
  const pref = useThemePreference();
  const pairFor = (scheme: Scheme) => THEMES.filter((t) => t.scheme === scheme);

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-[13px] font-semibold tracking-tight text-foreground">Theme</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-2">
        {THEMES.map((t) => (
          <FinishOption
            key={t.id}
            name="theme-mode"
            value={t.id}
            label={t.label}
            legend={t.scheme}
            checked={pref.mode === t.id}
            onSelect={() => saveTheme({ ...pref, mode: t.id })}
          >
            <FinishSwatch id={t.id} />
          </FinishOption>
        ))}
        <FinishOption
          name="theme-mode"
          value="auto"
          label="Match system"
          checked={pref.mode === "auto"}
          onSelect={() => saveTheme({ ...pref, mode: "auto" })}
        >
          <span aria-hidden className="grid grid-cols-2 gap-1">
            <FinishSwatch id={pref.light} />
            <FinishSwatch id={pref.dark} />
          </span>
        </FinishOption>
      </div>
      {pref.mode === "auto" &&
        (["light", "dark"] as const).map((scheme) => (
          <div
            key={scheme}
            role="radiogroup"
            aria-label={`Theme when the system is ${scheme}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-1"
          >
            <span className="w-44 text-[12px] text-muted-foreground">When the system is {scheme}</span>
            {pairFor(scheme).map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-1.5 text-[13px] text-foreground">
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

/** A −/reading/+ stepper for one appearance scale; the reading is a light tabular numeral. */
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
    <div className="dash-zone flex items-center gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] text-foreground">{label}</span>
        <span className="text-[12px] text-muted-foreground">{hint}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => bump(-1)}
        >
          <Minus />
        </Button>
        <span className="flex w-16 items-baseline justify-center gap-0.5 text-foreground">
          <span className="dash-numeral text-[22px]">{Math.round(value * 100)}</span>
          <span className="text-[12px] text-muted-foreground">%</span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => bump(1)}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

export function AppearanceSection() {
  const appearance = useAppearance();
  const setScale = (field: keyof Appearance) => (v: number) =>
    saveAppearance({ ...appearance, [field]: v });
  const changed =
    appearance.appZoom !== DEFAULT_APPEARANCE.appZoom ||
    appearance.iconScale !== DEFAULT_APPEARANCE.iconScale ||
    appearance.editorScale !== DEFAULT_APPEARANCE.editorScale;

  return (
    <>
      <SectionHeader title="Appearance" description="Color theme and interface scale." />
      <SettingsPanel label="Theme">
        <SettingsZone>
          <ThemePicker />
        </SettingsZone>
      </SettingsPanel>
      <SettingsPanel label="Scale">
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
        {changed && (
          <div className="dash-zone px-4 py-2.5">
            <Button type="button" variant="link" size="sm" className="px-0" onClick={() => saveAppearance({ ...DEFAULT_APPEARANCE })}>
              Reset to defaults
            </Button>
          </div>
        )}
      </SettingsPanel>
    </>
  );
}
