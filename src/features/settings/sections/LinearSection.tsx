import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConnectionReadout, SettingsPanel } from "../SettingsPanel";
import {
  clearLinearKey,
  errorText,
  getConnectionStatus,
  setLinearKey,
  syncIssues,
  testLinearConnection,
} from "@/lib/commands";
import { clearWorkspaceQueries, invalidateWorkspaceQueries } from "@/lib/queries";
import { SectionHeader } from "../SectionHeader";

export function LinearSection() {
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  const invalidateStatus = () => qc.invalidateQueries({ queryKey: ["connection-status"] });

  const { data: status } = useQuery({ queryKey: ["connection-status"], queryFn: getConnectionStatus });

  const testMut = useMutation({
    mutationFn: () => testLinearConnection(),
    onSuccess: (status) => {
      if (status.state === "connected") gooeyToast.success(`Connected as ${status.name}`);
      // A successful test may detect an org change and wipe the Rust cache; drop
      // the renderer's workspace queries so stale data can't linger.
      clearWorkspaceQueries(qc);
      invalidateStatus();
    },
    onError: (err) =>
      gooeyToast.error("Connection failed", { description: errorText(err) }),
  });

  const clearMut = useMutation({
    mutationFn: () => clearLinearKey(),
    onSuccess: () => {
      clearWorkspaceQueries(qc);
      gooeyToast.success("Key cleared");
      invalidateStatus();
    },
    onError: (err) => {
      clearWorkspaceQueries(qc);
      gooeyToast.error("Could not clear the key", { description: errorText(err) });
    },
  });

  const resyncMut = useMutation({
    mutationFn: () => syncIssues(true),
    // Resync wipes + rebuilds the Rust cache. Refetch workspace queries on EITHER
    // outcome: a failed post-wipe resync can leave the renderer showing issues
    // that no longer exist locally.
    onSuccess: (r) => {
      invalidateWorkspaceQueries(qc);
      gooeyToast.success(`Resynced ${r.synced} issues`);
    },
    onError: (err) => {
      invalidateWorkspaceQueries(qc);
      gooeyToast.error("Resync failed", { description: errorText(err) });
    },
  });

  // One operation at a time: never let Test/Clear/Resync run while a key is being saved
  // (or vice versa), which could cache an identity against the wrong key.
  const busy = saving || testMut.isPending || clearMut.isPending || resyncMut.isPending;

  // Save WITHOUT TanStack Query so the secret never enters the mutation cache.
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const key = keyInput.trim();
    if (!key) return;
    setKeyInput(""); // clear the secret from component state immediately
    setSaving(true);
    try {
      await setLinearKey(key);
      clearWorkspaceQueries(qc);
      gooeyToast.success("Linear key saved");
      invalidateStatus();
    } catch (err) {
      clearWorkspaceQueries(qc);
      gooeyToast.error("Could not save the key", { description: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionHeader title="Linear" description="The workspace Astryn reads issues from." />
      <SettingsPanel label="Linear connection">
        <ConnectionReadout
          state={status?.state}
          text={
            status === undefined
              ? "Checking…"
              : status.state === "connected"
                ? `Connected as ${status.name}`
                : status.state === "unverified"
                  ? "Key saved — not verified"
                  : "Not connected"
          }
          detail={status?.state === "not_configured" ? "Paste a personal API key below." : undefined}
          actions={
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => testMut.mutate()}>
                Test connection
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => resyncMut.mutate()}>
                Resync workspace
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => clearMut.mutate()}>
                Clear key
              </Button>
            </>
          }
        />
        <form className="dash-zone flex flex-col gap-2 px-4 py-4" onSubmit={handleSave}>
          <Label htmlFor="linear-key">Linear personal API key</Label>
          <div className="flex gap-2">
            <Input
              id="linear-key"
              type="password"
              autoComplete="off"
              placeholder="lin_api_…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.currentTarget.value)}
              disabled={busy}
            />
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Stored in the system keychain and never shown again.
          </p>
        </form>
      </SettingsPanel>
    </>
  );
}
