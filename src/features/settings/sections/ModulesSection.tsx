import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/Popover";
import { removeModuleData, setDisabledScreens, setEnabledModules, type ModuleId, type ScreenId } from "@/lib/commands";
import { CAPABILITY_PROVIDERS, MODULES_KEY, MODULE_COPY, SWITCHABLE_SCREENS, VIEW_META, useModules } from "@/lib/modules";
import { SectionHeader } from "../SectionHeader";

const SWITCH_CLASS = "size-4 cursor-pointer accent-primary disabled:cursor-not-allowed";

export function ModulesSection() {
  const { data, disabledScreens, isError, refetch } = useModules();
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

  const toggleScreen = async (screen: ScreenId, on: boolean) => {
    const next = SWITCHABLE_SCREENS.filter((s) => (s === screen ? !on : disabledScreens.includes(s)));
    setBusy(true);
    try {
      qc.setQueryData(MODULES_KEY, await setDisabledScreens(next));
    } catch {
      gooeyToast.error("Couldn't update screens");
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
      {!data && isError ? (
        <Card className="flex flex-row items-center gap-4 px-6 py-4">
          <p role="alert" className="flex-1 text-sm text-muted-foreground">
            Couldn't load modules. Your choices are unchanged.
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </Card>
      ) : (
        <Card className="flex flex-col divide-y divide-border/60 p-0">
          {modules.map((m) => {
            const copy = MODULE_COPY[m.id];
            const screens = m.enabled ? SWITCHABLE_SCREENS.filter((s) => VIEW_META[s].module === m.id) : [];
            return (
              <div key={m.id} className="flex flex-col gap-3 px-6 py-4">
                <div className="flex items-center gap-4">
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
                    className={SWITCH_CLASS}
                  />
                </div>
                {screens.length > 0 && (
                  <div className="flex flex-col gap-1 border-l border-border pl-4">
                    <ul aria-label={`${copy.name} screens`} className="flex flex-col">
                      {screens.map((s) => {
                        const { label, icon: Icon } = VIEW_META[s];
                        return (
                          <li key={s} className="flex items-center gap-2.5 py-1.5">
                            <Icon aria-hidden className="size-4 text-muted-foreground" />
                            <span className="flex-1 text-sm text-foreground">{label}</span>
                            <input
                              type="checkbox"
                              role="switch"
                              aria-label={label}
                              checked={!disabledScreens.includes(s)}
                              disabled={busy}
                              onChange={(e) => void toggleScreen(s, e.target.checked)}
                              className={SWITCH_CLASS}
                            />
                          </li>
                        );
                      })}
                    </ul>
                    {m.id === "linear" && (
                      <span className="text-xs text-muted-foreground">Calendar and the Dashboard always stay on.</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
