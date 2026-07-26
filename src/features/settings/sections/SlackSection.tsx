import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  clearSlackToken,
  detectSlackCredentials,
  errorText,
  getSlackStatus,
  setSlackCredentials,
  testSlackConnection,
} from "@/lib/commands";
import { clearSlackQueries } from "@/lib/queries";
import { SectionHeader } from "../SectionHeader";

export function SlackSection() {
  const qc = useQueryClient();
  const [slackInput, setSlackInput] = useState("");
  const [slackCookieInput, setSlackCookieInput] = useState("");
  const [slackManualOpen, setSlackManualOpen] = useState(false);
  const [slackSaving, setSlackSaving] = useState(false);
  const invalidateSlackStatus = () => qc.invalidateQueries({ queryKey: ["slack-status"] });
  const { data: slackStatus } = useQuery({ queryKey: ["slack-status"], queryFn: getSlackStatus });

  const slackDetectMut = useMutation({
    mutationFn: () => detectSlackCredentials(),
    onSuccess: (s) => {
      clearSlackQueries(qc);
      if (s.state === "connected") gooeyToast.success(`Connected as ${s.userName}`);
      invalidateSlackStatus();
    },
    onError: (err) =>
      gooeyToast.error("Couldn't detect Slack", {
        description: "Make sure the Slack desktop app is installed and signed in. " + errorText(err),
      }),
  });

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

  const slackBusy = slackSaving || slackTestMut.isPending || slackClearMut.isPending || slackDetectMut.isPending;

  const handleSlackSave = async (e: FormEvent) => {
    e.preventDefault();
    if (slackBusy) return;
    const token = slackInput.trim();
    if (!token) return;
    const cookie = slackCookieInput.trim() || null;
    setSlackInput(""); setSlackCookieInput("");
    setSlackSaving(true);
    try {
      await setSlackCredentials(token, cookie);
      clearSlackQueries(qc);
      gooeyToast.success("Slack credentials saved");
      invalidateSlackStatus();
    } catch (err) {
      clearSlackQueries(qc);
      gooeyToast.error("Could not save", { description: errorText(err) });
    } finally {
      setSlackSaving(false);
    }
  };

  return (
    <>
      <SectionHeader title="Slack" description="Read-only catch-up on your Slack conversations." />
      <Card className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {slackStatus === undefined
            ? "Checking…"
            : slackStatus.state === "connected"
              ? `Connected as ${slackStatus.userName}${slackStatus.workspaceName ? ` · ${slackStatus.workspaceName}` : ""}`
              : slackStatus.state === "unverified"
                ? "Credentials saved — not verified"
                : "Not connected"}
        </p>
        <div className="flex flex-col gap-3">
          <Button type="button" disabled={slackBusy} onClick={() => slackDetectMut.mutate()}>
            Detect from Slack app
          </Button>
          <p className="text-xs text-muted-foreground">
            Reads your signed-in Slack desktop app. macOS may ask to allow keychain access once. Uses your Slack session (xoxc/xoxd) — against Slack's API terms and possibly your employer's policy; read-only.
          </p>
          <button
            type="button"
            className="w-fit text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => setSlackManualOpen((o) => !o)}
          >
            {slackManualOpen ? "Hide manual entry" : "Enter manually"}
          </button>
          {slackManualOpen && (
            <form className="flex flex-col gap-3" onSubmit={handleSlackSave}>
              <Label htmlFor="slack-token">xoxc token</Label>
              <Input id="slack-token" type="password" autoComplete="off" placeholder="xoxc-…" value={slackInput} onChange={(e) => setSlackInput(e.currentTarget.value)} disabled={slackBusy} />
              <Label htmlFor="slack-cookie">xoxd cookie</Label>
              <Input id="slack-cookie" type="password" autoComplete="off" placeholder="xoxd-…" value={slackCookieInput} onChange={(e) => setSlackCookieInput(e.currentTarget.value)} disabled={slackBusy} />
              <div className="flex gap-2">
                <Button type="submit" disabled={slackBusy}>Save credentials</Button>
                <Button type="button" variant="secondary" disabled={slackBusy} onClick={() => slackTestMut.mutate()}>Test connection</Button>
                <Button type="button" variant="ghost" disabled={slackBusy} onClick={() => slackClearMut.mutate()}>Clear credentials</Button>
              </div>
            </form>
          )}
        </div>
      </Card>
    </>
  );
}
