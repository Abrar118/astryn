import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IndicatorLamp } from "@/components/IndicatorLamp";
import { ConnectionReadout, SettingsPanel, SettingsZone } from "../SettingsPanel";
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
      <SettingsPanel label="Slack connection">
        <ConnectionReadout
          state={slackStatus?.state}
          text={
            slackStatus === undefined
              ? "Checking…"
              : slackStatus.state === "connected"
                ? `Connected as ${slackStatus.userName}`
                : slackStatus.state === "unverified"
                  ? "Credentials saved — not verified"
                  : "Not connected"
          }
          detail={slackStatus?.state === "connected" ? slackStatus.workspaceName ?? undefined : undefined}
          actions={
            <>
              <Button type="button" variant="outline" size="sm" disabled={slackBusy} onClick={() => slackTestMut.mutate()}>Test connection</Button>
              <Button type="button" variant="ghost" size="sm" disabled={slackBusy} onClick={() => slackClearMut.mutate()}>Clear credentials</Button>
            </>
          }
        />
        <SettingsZone
          title="Detect from the desktop app"
          hint="Reads your signed-in Slack desktop app. macOS may ask to allow keychain access once."
          aside={
            <Button type="button" disabled={slackBusy} onClick={() => slackDetectMut.mutate()}>
              Detect from Slack app
            </Button>
          }
        >
          <p className="flex items-start gap-2 text-[12px] text-muted-foreground">
            <IndicatorLamp tone="warning" className="mt-1" />
            Uses your Slack session (xoxc/xoxd) — against Slack's API terms and possibly your employer's policy; read-only.
          </p>
        </SettingsZone>
        <div className="dash-zone flex flex-col gap-3 px-4 py-3">
          <button
            type="button"
            aria-expanded={slackManualOpen}
            className="dash-control w-fit rounded-sm text-[12px] text-muted-foreground underline decoration-muted-foreground underline-offset-4 hover:text-foreground"
            onClick={() => setSlackManualOpen((o) => !o)}
          >
            {slackManualOpen ? "Hide manual entry" : "Enter manually"}
          </button>
          {slackManualOpen && (
            <form className="grid gap-x-3 gap-y-2 sm:grid-cols-2" onSubmit={handleSlackSave}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="slack-token">xoxc token</Label>
                <Input id="slack-token" type="password" autoComplete="off" placeholder="xoxc-…" value={slackInput} onChange={(e) => setSlackInput(e.currentTarget.value)} disabled={slackBusy} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="slack-cookie">xoxd cookie</Label>
                <Input id="slack-cookie" type="password" autoComplete="off" placeholder="xoxd-…" value={slackCookieInput} onChange={(e) => setSlackCookieInput(e.currentTarget.value)} disabled={slackBusy} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={slackBusy}>Save credentials</Button>
              </div>
            </form>
          )}
        </div>
      </SettingsPanel>
    </>
  );
}
