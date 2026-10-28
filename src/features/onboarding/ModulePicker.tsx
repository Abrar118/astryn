import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { setDisabledScreens, setEnabledModules, type ModuleId, type ScreenId } from "@/lib/commands";
import {
  CAPABILITY_PROVIDERS,
  MODULES_KEY,
  MODULE_COPY,
  MODULE_MANIFEST,
  SWITCHABLE_SCREENS,
  VIEW_META,
  previewMissing,
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
        SWITCHABLE_SCREENS.filter((s) => screensOff.has(s) && selected.has(VIEW_META[s].module as ModuleId)),
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
    <div className="flex h-screen items-center justify-center overflow-auto bg-background p-6 text-foreground">
      <form onSubmit={submit} className="w-full max-w-2xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Choose your tools</h1>
          <p className="text-sm text-muted-foreground">You can change this any time in Settings → Modules.</p>
        </div>
        {GROUPS.map((g, gi) => (
          <fieldset key={g.title}>
            <legend className="mb-2 text-xs font-medium text-muted-foreground">{g.title}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {g.ids.map((id, i) => {
                const on = selected.has(id);
                const missing = on ? previewMissing(id, selected) : [];
                const { name, icon: Icon, description } = MODULE_COPY[id];
                return (
                  <label
                    key={id}
                    className={cn(
                      "relative flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                      on ? "border-primary bg-primary/[0.06]" : "border-border hover:border-input",
                    )}
                  >
                    <input
                      ref={gi === 0 && i === 0 ? first : undefined}
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => toggle(id)}
                    />
                    <span className="flex items-center justify-between">
                      <Icon aria-hidden className={cn("size-5", on ? "text-primary" : "text-muted-foreground")} />
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-4 items-center justify-center rounded-full border",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                        )}
                      >
                        {on && <Check className="size-3" strokeWidth={3} />}
                      </span>
                    </span>
                    <span className="text-sm font-medium">{name}</span>
                    <span className="text-xs leading-snug text-muted-foreground">{description}</span>
                    {missing.length > 0 && (
                      <span className="text-xs leading-snug text-warning">
                        Needs {missing.map((c) => CAPABILITY_PROVIDERS[c]).join(", ")}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        {IDS.filter((id) => selected.has(id)).map((id) => {
          const screens = SWITCHABLE_SCREENS.filter((s) => VIEW_META[s].module === id);
          if (screens.length === 0) return null;
          return (
            <fieldset key={id}>
              <legend className="mb-2 text-xs font-medium text-muted-foreground">{MODULE_COPY[id].name} screens</legend>
              <div className="flex flex-wrap gap-2">
                {screens.map((s) => {
                  const on = !screensOff.has(s);
                  const { label, icon: Icon } = VIEW_META[s];
                  return (
                    <label
                      key={s}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                        on ? "border-primary bg-primary/[0.06]" : "border-border text-muted-foreground hover:border-input",
                      )}
                    >
                      <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleScreen(s)} />
                      <Icon aria-hidden className={cn("size-4", on ? "text-primary" : "text-muted-foreground")} />
                      {label}
                    </label>
                  );
                })}
              </div>
              {id === "linear" && <p className="mt-2 text-xs text-muted-foreground">Calendar is always on with Linear.</p>}
            </fieldset>
          );
        })}
        <Button type="submit" disabled={busy}>
          Continue
        </Button>
      </form>
    </div>
  );
}
