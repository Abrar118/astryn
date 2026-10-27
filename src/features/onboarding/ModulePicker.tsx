import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { setEnabledModules, type ModuleId } from "@/lib/commands";
import { CAPABILITY_PROVIDERS, MODULES_KEY, MODULE_COPY, MODULE_MANIFEST, previewMissing } from "@/lib/modules";
import { Button } from "@/components/ui/button";

const IDS = Object.keys(MODULE_MANIFEST) as ModuleId[];
const GROUPS: { title: string; ids: ModuleId[] }[] = [
  { title: "Integrations", ids: IDS.filter((i) => MODULE_MANIFEST[i].kind === "provider") },
  { title: "Features", ids: IDS.filter((i) => MODULE_MANIFEST[i].kind === "feature") },
];

export function ModulePicker() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<ModuleId>>(new Set());
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => first.current?.focus(), []);

  const toggle = (id: ModuleId) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const view = await setEnabledModules(IDS.filter((i) => selected.has(i)));
      qc.setQueryData(MODULES_KEY, view);
      await qc.invalidateQueries({ queryKey: MODULES_KEY });
    } catch {
      gooeyToast.error("Couldn't save your choices");
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center overflow-auto bg-background p-6 text-foreground">
      <form onSubmit={submit} className="w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Choose your tools</h1>
          <p className="text-sm text-muted-foreground">You can change this any time in Settings → Modules.</p>
        </div>
        {GROUPS.map((g, gi) => (
          <fieldset key={g.title} className="space-y-2">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</legend>
            {g.ids.map((id, i) => {
              const missing = selected.has(id) ? previewMissing(id, selected) : [];
              return (
                <label key={id} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
                  <input
                    ref={gi === 0 && i === 0 ? first : undefined}
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={selected.has(id)}
                    onChange={() => toggle(id)}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{MODULE_COPY[id].name}</span>
                    <span className="block text-xs text-muted-foreground">{MODULE_COPY[id].description}</span>
                    {missing.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        Needs {missing.map((c) => CAPABILITY_PROVIDERS[c]).join(", ")}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ))}
        <Button type="submit" disabled={busy}>
          Continue
        </Button>
      </form>
    </div>
  );
}
