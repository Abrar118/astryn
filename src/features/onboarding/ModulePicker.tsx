import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { IndicatorLamp } from "@/components/IndicatorLamp";
import { setDisabledScreens, setEnabledModules, type ModuleId, type ScreenId } from "@/lib/commands";
import {
  CAPABILITY_PROVIDERS,
  MODULES_KEY,
  MODULE_COPY,
  MODULE_MANIFEST,
  SWITCHABLE_SCREENS,
  VIEW_META,
  ownerActive,
  previewMissing,
  screenListedUnder,
} from "@/lib/modules";
import { Button } from "@/components/ui/button";

const IDS = Object.keys(MODULE_MANIFEST) as ModuleId[];
const GROUPS: { title: string; ids: ModuleId[] }[] = [
  { title: "Integrations", ids: IDS.filter((i) => MODULE_MANIFEST[i].kind === "provider") },
  { title: "Features", ids: IDS.filter((i) => MODULE_MANIFEST[i].kind === "feature") },
];

export function ModulePicker() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<ModuleId>>(new Set());
  const [screensOff, setScreensOff] = useState<Set<ScreenId>>(new Set());
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => first.current?.focus(), []);

  const toggle = (id: ModuleId) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const toggleScreen = (id: ScreenId) =>
    setScreensOff((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // Screens first: saving the modules marks the app onboarded and closes the picker.
      // Only screens of chosen modules: a choice made under a module that was then unticked is dropped.
      await setDisabledScreens(
        SWITCHABLE_SCREENS.filter((s) => screensOff.has(s) && ownerActive(VIEW_META[s].module, (m) => selected.has(m))),
      );
      const view = await setEnabledModules(IDS.filter((i) => selected.has(i)));
      qc.setQueryData(MODULES_KEY, view);
      await qc.invalidateQueries({ queryKey: MODULES_KEY });
    } catch {
      gooeyToast.error("Couldn't save your choices");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-scrollbar h-screen overflow-auto bg-background text-foreground">
      <form onSubmit={submit} className="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-6 pt-14 pb-16">
        <header className="flex flex-col gap-1">
          <h1 className="text-[20px] font-semibold tracking-tight">Choose your tools</h1>
          <p className="text-[13px] text-muted-foreground">
            Turn on only what you use. You can change this any time in Settings → Modules.
          </p>
        </header>
        {GROUPS.map((g, gi) => (
          <fieldset key={g.title} className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-semibold tracking-tight">{g.title}</legend>
            <ul className="dash-panel dash-face">
              {g.ids.map((id, i) => {
                const on = selected.has(id);
                const missing = on ? previewMissing(id, selected) : [];
                const screens = on ? SWITCHABLE_SCREENS.filter((s) => screenListedUnder(s, id)) : [];
                const { name, description } = MODULE_COPY[id];
                return (
                  <li key={id} className="dash-zone">
                    <label className="flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-colors hover:bg-accent/60">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[14px] font-medium">{name}</span>
                        <span className="text-[13px] text-muted-foreground">{description}</span>
                        {missing.length > 0 && (
                          <span className="mt-1 flex items-center gap-2 text-[12px]">
                            <IndicatorLamp tone="warning" />
                            Needs {missing.map((c) => CAPABILITY_PROVIDERS[c]).join(", ")}
                          </span>
                        )}
                      </span>
                      <input
                        ref={gi === 0 && i === 0 ? first : undefined}
                        type="checkbox"
                        className="g5-switch"
                        checked={on}
                        onChange={() => toggle(id)}
                      />
                    </label>
                    {screens.length > 0 && (
                      <fieldset className="px-4 pb-3 pl-8">
                        <legend className="sr-only">{name} screens</legend>
                        <ul className="g5-rule-list flex flex-col">
                          {screens.map((s) => {
                            const { label, icon: Icon } = VIEW_META[s];
                            return (
                              <li key={s}>
                                <label className="flex cursor-pointer items-center gap-2.5 py-2 text-[13px]">
                                  <Icon aria-hidden className="size-4 text-muted-foreground" />
                                  <span className="flex-1">{label}</span>
                                  <input
                                    type="checkbox"
                                    className="g5-switch"
                                    checked={!screensOff.has(s)}
                                    onChange={() => toggleScreen(s)}
                                  />
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                        {id === "linear" && (
                          <p className="pt-1 text-[12px] text-muted-foreground">Calendar is always on with Linear.</p>
                        )}
                      </fieldset>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            Continue
          </Button>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {selected.size === 0 ? "Nothing on yet" : `${selected.size} on`}
          </span>
        </div>
      </form>
    </div>
  );
}
