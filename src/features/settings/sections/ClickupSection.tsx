import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  clearClickupToken,
  errorText,
  getClickupStatus,
  setClickupToken,
  testClickupConnection,
} from "@/lib/commands";
import { clearClickupQueries } from "@/lib/queries";
import { SectionHeader } from "../SectionHeader";

export function ClickupSection() {
  const qc = useQueryClient();
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: status } = useQuery({ queryKey: ["clickup-status"], queryFn: getClickupStatus });
  const refreshStatus = () => qc.invalidateQueries({ queryKey: ["clickup-status"] });

  const testMut = useMutation({
    mutationFn: () => testClickupConnection(),
    onSuccess: (s) => {
      if (s.state === "connected") gooeyToast.success(`Connected as ${s.username}`);
      refreshStatus();
    },
    onError: (err) => gooeyToast.error("ClickUp connection failed", { description: errorText(err) }),
  });

  const clearMut = useMutation({
    mutationFn: () => clearClickupToken(),
    onSuccess: () => {
      clearClickupQueries(qc);
      gooeyToast.success("ClickUp token cleared");
    },
    onError: (err) => {
      clearClickupQueries(qc);
      gooeyToast.error("Could not clear the token", { description: errorText(err) });
    },
  });

  const busy = saving || testMut.isPending || clearMut.isPending;

  // A direct async call, not a mutation, so the token never sits in a cached
  // mutation's `variables`.
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const token = tokenInput.trim();
    if (!token) return;
    setTokenInput(""); // clear the secret from component state immediately
    setSaving(true);
    try {
      await setClickupToken(token);
      clearClickupQueries(qc);
      gooeyToast.success("ClickUp token saved");
    } catch (err) {
      clearClickupQueries(qc);
      gooeyToast.error("Could not save the token", { description: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionHeader title="ClickUp" description="Lets the Docs page read ClickUp Docs." />
      <Card className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {status === undefined
            ? "Checking…"
            : status.state === "connected"
              ? `Connected as ${status.username}`
              : status.state === "unverified"
                ? "Token saved — not verified"
                : "Not connected"}
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleSave}>
          <Label htmlFor="clickup-token">ClickUp personal API token</Label>
          <Input
            id="clickup-token"
            type="password"
            autoComplete="off"
            placeholder="pk_…"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.currentTarget.value)}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            Create one in ClickUp under Settings → Apps → API Token. It is stored in your system
            keychain and only used to read the Docs you add.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>Save ClickUp token</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => testMut.mutate()}>
              Test connection
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => clearMut.mutate()}>
              Clear token
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
