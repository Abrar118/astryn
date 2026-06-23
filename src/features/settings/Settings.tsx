import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  clearGithubToken,
  clearLinearKey,
  clearSlackToken,
  errorText,
  getConnectionStatus,
  getGithubStatus,
  getSlackStatus,
  setGithubToken,
  setLinearKey,
  setSlackToken,
  syncIssues,
  testGithubConnection,
  testLinearConnection,
  testSlackConnection,
} from "@/lib/commands";
import { clearGithubQueries, clearSlackQueries, clearWorkspaceQueries, invalidateWorkspaceQueries } from "@/lib/queries";

export function Settings() {
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

  const [ghInput, setGhInput] = useState("");
  const [ghSaving, setGhSaving] = useState(false);
  const invalidateGhStatus = () => qc.invalidateQueries({ queryKey: ["github-status"] });
  const { data: ghStatus } = useQuery({ queryKey: ["github-status"], queryFn: getGithubStatus });

  const ghTestMut = useMutation({
    mutationFn: () => testGithubConnection(),
    onSuccess: (s) => {
      if (s.state === "connected") gooeyToast.success(`Connected as ${s.login}`);
      invalidateGhStatus();
    },
    onError: (err) => gooeyToast.error("GitHub connection failed", { description: errorText(err) }),
  });

  const ghClearMut = useMutation({
    mutationFn: () => clearGithubToken(),
    onSuccess: () => {
      clearGithubQueries(qc);
      gooeyToast.success("GitHub token cleared");
      invalidateGhStatus();
    },
    onError: (err) => {
      clearGithubQueries(qc);
      gooeyToast.error("Could not clear the token", { description: errorText(err) });
    },
  });

  const ghBusy = ghSaving || ghTestMut.isPending || ghClearMut.isPending;

  const handleGhSave = async (e: FormEvent) => {
    e.preventDefault();
    if (ghBusy) return;
    const token = ghInput.trim();
    if (!token) return;
    setGhInput(""); // clear the secret from component state immediately
    setGhSaving(true);
    try {
      await setGithubToken(token);
      clearGithubQueries(qc);
      gooeyToast.success("GitHub token saved");
      invalidateGhStatus();
    } catch (err) {
      clearGithubQueries(qc);
      gooeyToast.error("Could not save the token", { description: errorText(err) });
    } finally {
      setGhSaving(false);
    }
  };

  const [slackInput, setSlackInput] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const invalidateSlackStatus = () => qc.invalidateQueries({ queryKey: ["slack-status"] });
  const { data: slackStatus } = useQuery({ queryKey: ["slack-status"], queryFn: getSlackStatus });

  const slackTestMut = useMutation({
    mutationFn: () => testSlackConnection(),
    onSuccess: (s) => {
      if (s.state === "connected") gooeyToast.success(`Connected as ${s.userName}`);
      invalidateSlackStatus();
    },
    onError: (err) => gooeyToast.error("Slack connection failed", { description: errorText(err) }),
  });

  const slackClearMut = useMutation({
    mutationFn: () => clearSlackToken(),
    onSuccess: () => { clearSlackQueries(qc); gooeyToast.success("Slack token cleared"); invalidateSlackStatus(); },
    onError: (err) => { clearSlackQueries(qc); gooeyToast.error("Could not clear the token", { description: errorText(err) }); },
  });

  const slackBusy = slackSaving || slackTestMut.isPending || slackClearMut.isPending;

  const handleSlackSave = async (e: FormEvent) => {
    e.preventDefault();
    if (slackBusy) return;
    const token = slackInput.trim();
    if (!token) return;
    setSlackInput(""); // clear the secret from component state immediately
    setSlackSaving(true);
    try {
      await setSlackToken(token);
      clearSlackQueries(qc);
      gooeyToast.success("Slack token saved");
      invalidateSlackStatus();
    } catch (err) {
      clearSlackQueries(qc);
      gooeyToast.error("Could not save the token", { description: errorText(err) });
    } finally {
      setSlackSaving(false);
    }
  };

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
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-10">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>

      <Card className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {status === undefined
            ? "Checking…"
            : status.state === "connected"
              ? `Connected as ${status.name}`
              : status.state === "unverified"
                ? "Key saved — not verified"
                : "Not connected"}
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleSave}>
          <Label htmlFor="linear-key">Linear personal API key</Label>
          <Input
            id="linear-key"
            type="password"
            autoComplete="off"
            placeholder="lin_api_…"
            value={keyInput}
            onChange={(e) => setKeyInput(e.currentTarget.value)}
            disabled={busy}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => testMut.mutate()}
            >
              Test connection
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => clearMut.mutate()}
            >
              Clear key
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => resyncMut.mutate()}
            >
              Resync workspace
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {ghStatus === undefined
            ? "Checking…"
            : ghStatus.state === "connected"
              ? `Connected as ${ghStatus.login}`
              : ghStatus.state === "unverified"
                ? "Token saved — not verified"
                : "Not connected"}
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleGhSave}>
          <Label htmlFor="github-token">GitHub personal access token (classic)</Label>
          <Input
            id="github-token"
            type="password"
            autoComplete="off"
            placeholder="ghp_…"
            value={ghInput}
            onChange={(e) => setGhInput(e.currentTarget.value)}
            disabled={ghBusy}
          />
          <p className="text-xs text-muted-foreground">
            Needs <code>repo</code> scope. Add <code>read:org</code> only if org/team membership is
            required. Classic tokens grant broad repo access; for SSO orgs, authorize the token.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={ghBusy}>Save GitHub token</Button>
            <Button type="button" variant="secondary" disabled={ghBusy} onClick={() => ghTestMut.mutate()}>
              Test connection
            </Button>
            <Button type="button" variant="ghost" disabled={ghBusy} onClick={() => ghClearMut.mutate()}>
              Clear token
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {slackStatus === undefined
            ? "Checking…"
            : slackStatus.state === "connected"
              ? `Connected as ${slackStatus.userName}${slackStatus.workspaceName ? ` · ${slackStatus.workspaceName}` : ""}`
              : slackStatus.state === "unverified"
                ? "Token saved — not verified"
                : "Not connected"}
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleSlackSave}>
          <Label htmlFor="slack-token">Slack user token</Label>
          <Input id="slack-token" type="password" autoComplete="off" placeholder="xoxp-…" value={slackInput} onChange={(e) => setSlackInput(e.currentTarget.value)} disabled={slackBusy} />
          <p className="text-xs text-muted-foreground">
            Create a Slack app, add the read scopes (<code>channels:read</code>, <code>groups:read</code>, <code>im:read</code>, <code>mpim:read</code>, the matching <code>*:history</code> scopes, <code>users:read</code>, <code>team:read</code>), install it, and paste the user token. Read-only — Astryn never posts or marks anything read.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={slackBusy}>Save Slack token</Button>
            <Button type="button" variant="secondary" disabled={slackBusy} onClick={() => slackTestMut.mutate()}>Test connection</Button>
            <Button type="button" variant="ghost" disabled={slackBusy} onClick={() => slackClearMut.mutate()}>Clear token</Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
