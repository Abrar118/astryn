import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConnectionReadout, SettingsPanel } from "../SettingsPanel";
import {
  clearBitbucketCredentials,
  errorText,
  getBitbucketStatus,
  setBitbucketCredentials,
  testBitbucketConnection,
} from "@/lib/commands";
import { clearBitbucketQueries } from "@/lib/bitbucketQueries";
import { SectionHeader } from "../SectionHeader";

export function BitbucketSection() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const invalidateStatus = () => qc.invalidateQueries({ queryKey: ["bitbucket-status"] });
  const { data: status } = useQuery({ queryKey: ["bitbucket-status"], queryFn: getBitbucketStatus });

  const testMut = useMutation({
    mutationFn: () => testBitbucketConnection(),
    onSuccess: (s) => {
      if (s.state === "connected") gooeyToast.success(`Connected as ${s.login}`);
      invalidateStatus();
    },
    onError: (err) => gooeyToast.error("Bitbucket connection failed", { description: errorText(err) }),
  });

  const clearMut = useMutation({
    mutationFn: () => clearBitbucketCredentials(),
    onSuccess: () => {
      clearBitbucketQueries(qc);
      gooeyToast.success("Bitbucket credentials cleared");
      invalidateStatus();
    },
    onError: (err) => {
      clearBitbucketQueries(qc);
      gooeyToast.error("Could not clear the credentials", { description: errorText(err) });
    },
  });

  const busy = saving || testMut.isPending || clearMut.isPending;

  // A direct async call, not a mutation: mutation `variables` would cache the token.
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const account = email.trim();
    const secret = token.trim();
    if (!account || !secret) return;
    setToken(""); // clear the secret from component state immediately
    setSaving(true);
    try {
      await setBitbucketCredentials(account, secret);
      setEmail("");
      clearBitbucketQueries(qc);
      gooeyToast.success("Bitbucket credentials saved");
      invalidateStatus();
    } catch (err) {
      clearBitbucketQueries(qc);
      gooeyToast.error("Could not save the credentials", { description: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionHeader title="Bitbucket" description="Powers Bitbucket Cloud pull requests." />
      <SettingsPanel label="Bitbucket connection">
        <ConnectionReadout
          state={status?.state}
          text={
            status === undefined
              ? "Checking…"
              : status.state === "connected"
                ? `Connected as ${status.login}`
                : status.state === "unverified"
                  ? "Credentials saved — not verified"
                  : "Not connected"
          }
          actions={
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => testMut.mutate()}>
                Test connection
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => clearMut.mutate()}>
                Clear credentials
              </Button>
            </>
          }
        />
        <form className="dash-zone grid gap-x-3 gap-y-3 px-4 py-4 sm:grid-cols-2" onSubmit={handleSave}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bitbucket-email">Atlassian account email</Label>
            <Input
              id="bitbucket-email"
              type="text"
              autoComplete="off"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bitbucket-token">API token</Label>
            <Input
              id="bitbucket-token"
              type="password"
              autoComplete="off"
              placeholder="ATATT…"
              value={token}
              onChange={(e) => setToken(e.currentTarget.value)}
              disabled={busy}
            />
          </div>
          <p className="text-[12px] text-muted-foreground sm:col-span-2">
            Create an Atlassian API token with the Bitbucket scopes <code>read:user</code>,{" "}
            <code>read:workspace</code>, <code>read:repository</code> and{" "}
            <code>read:pullrequest</code>. A legacy app password also works: enter your Bitbucket
            username instead of the email.
          </p>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>Save Bitbucket credentials</Button>
          </div>
        </form>
      </SettingsPanel>
    </>
  );
}
