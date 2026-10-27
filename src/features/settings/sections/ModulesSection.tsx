import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Card } from "@/components/ui/card";
import { Popover } from "@/components/Popover";
import { removeModuleData, setEnabledModules, type ModuleId } from "@/lib/commands";
import { CAPABILITY_PROVIDERS, MODULES_KEY, MODULE_COPY, useModules } from "@/lib/modules";
import { SectionHeader } from "../SectionHeader";

export function ModulesSection() {
  const { data } = useModules();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const modules = data?.modules ?? [];

  const toggle = async (id: ModuleId, on: boolean) => {
    const ids = modules.filter((m) => (m.id === id ? on : m.enabled)).map((m) => m.id);
    setBusy(true);
    try {
      qc.setQueryData(MODULES_KEY, await setEnabledModules(ids));
      void qc.invalidateQueries({ queryKey: ["github-prs"] });
      void qc.invalidateQueries({ queryKey: ["slack-catchup"] });
    } catch {
      gooeyToast.error("Couldn't update modules");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: ModuleId, close: () => void) => {
    close();
    try {
      await removeModuleData(id);
      void qc.invalidateQueries({ queryKey: MODULES_KEY });
      gooeyToast.success(`${MODULE_COPY[id].name} data removed`);
    } catch {
      gooeyToast.error(`Couldn't remove ${MODULE_COPY[id].name} data`);
    }
  };

  return (
    <>
      <SectionHeader title="Modules" description="Turn on only what you use. Anything off disappears from the app." />
      <Card className="flex flex-col divide-y divide-border/60 p-0">
        {modules.map((m) => {
          const copy = MODULE_COPY[m.id];
          return (
            <div key={m.id} className="flex items-center gap-4 px-6 py-4">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{copy.name}</span>
                <span className="text-sm text-muted-foreground">{copy.description}</span>
                {m.enabled &&
                  m.missing.map((cap) => (
                    <span key={cap} className="text-xs text-muted-foreground">
                      Needs {CAPABILITY_PROVIDERS[cap]}
                    </span>
                  ))}
              </div>
              {!m.enabled && copy.removes.length > 0 && (
                <Popover
                  align="end"
                  button={`Remove ${copy.name} data`}
                  buttonClassName="cursor-pointer rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  panelClassName="w-64 rounded-lg border border-border bg-popover p-3 shadow-2xl"
                >
                  {(close) => (
                    <div className="flex flex-col gap-3">
                      <div className="text-[13px] text-foreground">
                        <p>Permanently deletes from this device:</p>
                        <ul className="mt-1 list-disc pl-5">
                          {copy.removes.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={close}
                          autoFocus
                          className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(m.id, close)}
                          className="cursor-pointer rounded-md bg-destructive px-2.5 py-1 text-xs text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </Popover>
              )}
              <input
                type="checkbox"
                role="switch"
                aria-label={copy.name}
                checked={m.enabled}
                disabled={busy}
                onChange={(e) => void toggle(m.id, e.target.checked)}
                className="size-4 cursor-pointer accent-primary"
              />
            </div>
          );
        })}
      </Card>
    </>
  );
}
