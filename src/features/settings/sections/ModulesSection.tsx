import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { IndicatorLamp } from "@/components/IndicatorLamp";
import { Popover } from "@/components/Popover";
import { removeModuleData, setDisabledScreens, setEnabledModules, type ModuleId, type ModuleInfo, type ScreenId } from "@/lib/commands";
import {
  CAPABILITY_PROVIDERS,
  MODULES_KEY,
  MODULE_COPY,
  MODULE_MANIFEST,
  SWITCHABLE_SCREENS,
  VIEW_META,
  screenListedUnder,
  useModules,
} from "@/lib/modules";
import { SectionHeader } from "../SectionHeader";
import { SettingsPanel, Switch } from "../SettingsPanel";

const GROUPS = [
  { title: "Integrations", kind: "provider" },
  { title: "Features", kind: "feature" },
] as const;

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
      void qc.invalidateQueries({ queryKey: ["teams-catchup"] });
      void qc.invalidateQueries({ queryKey: ["bitbucket-prs"] });
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
    setBusy(true);
    try {
      await removeModuleData(id);
      void qc.invalidateQueries({ queryKey: MODULES_KEY });
      gooeyToast.success(`${MODULE_COPY[id].name} data removed`);
    } catch {
      gooeyToast.error(`Couldn't remove ${MODULE_COPY[id].name} data`);
    } finally {
      setBusy(false);
    }
  };

  const row = (m: ModuleInfo) => {
    const copy = MODULE_COPY[m.id];
    const screens = m.enabled ? SWITCHABLE_SCREENS.filter((s) => screenListedUnder(s, m.id)) : [];
    return (
      <li key={m.id} className="dash-zone px-4 py-3.5">
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[14px] font-medium text-foreground">{copy.name}</span>
            <span className="text-[13px] text-muted-foreground">{copy.description}</span>
            {m.enabled &&
              m.missing.map((cap) => (
                <span key={cap} className="mt-1 flex items-center gap-2 text-[12px] text-foreground">
                  <IndicatorLamp tone="warning" />
                  Needs {CAPABILITY_PROVIDERS[cap]}
                </span>
              ))}
          </div>
          {!m.enabled && copy.removes.length > 0 && (
            <Popover
              align="end"
              button={`Remove ${copy.name} data`}
              buttonClassName="dash-control shrink-0 rounded-md px-2 py-1 text-[12px] text-destructive hover:bg-destructive/10"
              panelClassName="w-64 rounded-lg border border-border bg-popover p-3 shadow-[0_4px_16px_var(--overlay-shadow)]"
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
                    {copy.warning && <p className="mt-2 font-medium text-destructive">{copy.warning}</p>}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={close} autoFocus>
                      Cancel
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => void remove(m.id, close)}>
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </Popover>
          )}
          <Switch label={copy.name} checked={m.enabled} disabled={busy} onChange={(on) => void toggle(m.id, on)} />
        </div>
        {screens.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 pl-4">
            <ul aria-label={`${copy.name} screens`} className="g5-rule-list flex flex-col">
              {screens.map((s) => {
                const { label, icon: Icon } = VIEW_META[s];
                return (
                  <li key={s} className="flex items-center gap-2.5 py-2">
                    <Icon aria-hidden className="size-4 text-muted-foreground" />
                    <span className="flex-1 text-[13px] text-foreground">{label}</span>
                    <Switch
                      label={label}
                      checked={!disabledScreens.includes(s)}
                      disabled={busy}
                      onChange={(on) => void toggleScreen(s, on)}
                    />
                  </li>
                );
              })}
            </ul>
            {m.id === "linear" && (
              <span className="text-[12px] text-muted-foreground">Calendar and the Dashboard always stay on.</span>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <SectionHeader title="Modules" description="Turn on only what you use. Anything off disappears from the app." />
      {!data && isError ? (
        <SettingsPanel className="flex items-center gap-3 px-4 py-3.5">
          <IndicatorLamp tone="warning" />
          <p role="alert" className="flex-1 text-[13px] text-foreground">
            Couldn't load modules. Your choices are unchanged.
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </SettingsPanel>
      ) : (
        GROUPS.map((g) => {
          const items = modules.filter((m) => MODULE_MANIFEST[m.id].kind === g.kind);
          if (items.length === 0) return null;
          return (
            <section key={g.kind} aria-label={g.title} className="flex flex-col gap-2">
              <h2 className="flex items-baseline gap-2 text-[13px] font-semibold tracking-tight text-foreground">
                {g.title}
                <span className="font-normal tabular-nums text-muted-foreground">
                  {items.filter((m) => m.enabled).length} of {items.length} on
                </span>
              </h2>
              <ul className="dash-panel dash-face">{items.map(row)}</ul>
            </section>
          );
        })
      )}
    </>
  );
}
