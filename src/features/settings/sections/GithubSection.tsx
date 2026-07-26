import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  clearGithubToken,
  errorText,
  getGithubStatus,
  setGithubToken,
  testGithubConnection,
} from "@/lib/commands";
import { clearGithubQueries } from "@/lib/queries";
import { SectionHeader } from "../SectionHeader";

export function GithubSection() {
  const qc = useQueryClient();
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

  return (
    <>
      <SectionHeader
        title="GitHub"
        description="Powers pull requests, contributions and the documentation viewer."
      />
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
    </>
  );
}
