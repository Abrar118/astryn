import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { IndicatorLamp } from "@/components/IndicatorLamp";
import { errorText, exportLocalTasksBackup, importLinearToLocal, restoreLocalTasksBackup } from "@/lib/commands";
import { invalidateLocal, useLocalBackup, useLocalTree } from "@/lib/localTaskQueries";
import { useFilterOptions } from "@/lib/queries";
import { useModules } from "@/lib/modules";
import { dhakaToday } from "@/lib/dates";
import { SectionHeader } from "../SectionHeader";

const SELECT =
  "h-8 min-w-0 cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

function BackupCard() {
  const qc = useQueryClient();
  const backup = useLocalBackup();
  const [restoreArmed, setRestoreArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const exportNow = async () => {
    setBusy(true);
    try {
      if (await exportLocalTasksBackup(dhakaToday())) gooeyToast.success("Backup saved");
    } catch (e) {
      gooeyToast.error("Couldn't save the backup", { description: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    setRestoreArmed(false);
    setBusy(true);
    try {
      if (await restoreLocalTasksBackup()) {
        invalidateLocal(qc, { tree: true });
        gooeyToast.success("Local tasks restored", { description: "Your previous data was saved to the backups folder first." });
      }
    } catch (e) {
      gooeyToast.error("Couldn't restore that backup", { description: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <Label>Backups</Label>
        <p className="text-sm text-muted-foreground">
          Local tasks live only on this computer. Astryn saves a backup each day (the last 14 are kept) and before any restore.
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Latest automatic</dt>
        <dd className="flex items-center gap-2 text-foreground">
          <IndicatorLamp tone={backup.data?.latest ? "success" : backup.isError ? "warning" : "off"} />
          {backup.isLoading
            ? "Checking…"
            : backup.isError
              ? "Couldn't read the backups folder"
              : backup.data?.latest ?? "None yet — saved once you have tasks"}
        </dd>
        <dt className="text-muted-foreground">Folder</dt>
        <dd className="min-w-0 break-all font-mono text-xs text-foreground">{backup.data?.folder ?? "—"}</dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void exportNow()} disabled={busy}>
          Export backup…
        </Button>
        {restoreArmed ? (
          <>
            <Button variant="destructive" size="sm" onClick={() => void restore()} disabled={busy} autoFocus>
              Replace all local tasks from a file…
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRestoreArmed(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setRestoreArmed(true)} disabled={busy}>
            Restore from backup…
          </Button>
        )}
      </div>
    </Card>
  );
}

function ImportCard() {
  const qc = useQueryClient();
  const { isActive } = useModules();
  const linearOn = isActive("linear");
  const { data: teams } = useFilterOptions();
  const { data: tree } = useLocalTree();
  const [teamId, setTeamId] = useState("");
  const [listId, setListId] = useState("");
  const [busy, setBusy] = useState(false);
  const team = teamId || teams?.teams[0]?.id || "";
  const list = listId || tree?.lists[0]?.id || "";

  const run = async () => {
    setBusy(true);
    try {
      const r = await importLinearToLocal(team, list);
      invalidateLocal(qc, { tree: true });
      gooeyToast.success(`Imported ${r.imported} issue${r.imported === 1 ? "" : "s"}`, {
        description: r.skipped > 0 ? `${r.skipped} already imported earlier were left as they are.` : undefined,
      });
    } catch (e) {
      gooeyToast.error("Import failed", { description: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <Label>Import from Linear</Label>
        <p className="text-sm text-muted-foreground">
          Copies a Linear team's cached issues into a local list — statuses, labels, priorities, dates, sub-issues and
          blocking links come along. Issues imported before are skipped, so your local edits stay.
        </p>
      </div>
      {!linearOn ? (
        <p className="text-sm text-muted-foreground">Turn on Linear in Modules to import from it.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Linear team" className={SELECT} value={team} onChange={(e) => setTeamId(e.target.value)}>
            {(teams?.teams ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.key}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">into</span>
          <select aria-label="Local list" className={SELECT} value={list} onChange={(e) => setListId(e.target.value)}>
            {(tree?.lists ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {tree?.spaces.find((s) => s.id === l.spaceId)?.name} / {l.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => void run()} disabled={busy || !team || !list}>
            Import
          </Button>
        </div>
      )}
    </Card>
  );
}

export function LocalTasksSection() {
  return (
    <>
      <SectionHeader title="Local tasks" description="Backups and imports for tasks kept on this computer." />
      <BackupCard />
      <ImportCard />
    </>
  );
}
