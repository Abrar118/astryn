import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  cancelTeamsSignIn,
  clearTeamsAccount,
  errorText,
  getTeamsStatus,
  pollTeamsSignIn,
  startTeamsSignIn,
  testTeamsConnection,
  type TeamsDeviceCode,
} from "@/lib/commands";
import { clearTeamsQueries } from "@/lib/queries";
import { SectionHeader } from "../SectionHeader";

/** Sanitized poll errors worth retrying: the pending sign-in is still alive in Rust. */
const TRANSIENT_POLL_ERRORS = new Set([
  "Could not reach Microsoft Teams.",
  "Rate limit reached. Try again shortly.",
]);

/**
 * Microsoft Teams sign-in via the OAuth device-code flow: the user supplies
 * their own app registration's client ID, Rust requests a code, the user enters
 * it at Microsoft's sign-in page, and Rust polls until the grant arrives. Tokens
 * never reach the webview.
 */
export function TeamsSection() {
  const qc = useQueryClient();
  const [clientId, setClientId] = useState("");
  const [tenant, setTenant] = useState("");
  const [starting, setStarting] = useState(false);
  const [pending, setPending] = useState<TeamsDeviceCode | null>(null);
  const { data: status } = useQuery({ queryKey: ["teams-status"], queryFn: getTeamsStatus });
  const invalidateStatus = () => qc.invalidateQueries({ queryKey: ["teams-status"] });

  // Poll the token endpoint (through Rust) at the interval Microsoft asks for.
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (seconds: number) => {
      timer = setTimeout(async () => {
        try {
          const r = await pollTeamsSignIn();
          if (cancelled) return;
          if (r.state === "connected") {
            setPending(null);
            setClientId("");
            setTenant("");
            clearTeamsQueries(qc);
            gooeyToast.success(`Connected as ${r.userName}`);
            void invalidateStatus();
          } else {
            schedule(r.interval);
          }
        } catch (err) {
          if (cancelled) return;
          // Network blips and rate limits leave the sign-in pending; the code's
          // expiry turns into a terminal error from Rust.
          if (TRANSIENT_POLL_ERRORS.has(errorText(err))) {
            schedule(pending.interval);
            return;
          }
          setPending(null);
          gooeyToast.error("Teams sign-in failed", { description: errorText(err) });
        }
      }, Math.max(1, seconds) * 1000);
    };
    schedule(pending.interval);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  // Leaving the section mid-sign-in abandons it, so drop the pending code in Rust too.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(
    () => () => {
      if (pendingRef.current) cancelTeamsSignIn().catch(() => {});
    },
    [],
  );

  const testMut = useMutation({
    mutationFn: () => testTeamsConnection(),
    onSuccess: (s) => {
      if (s.state === "connected") gooeyToast.success(`Connected as ${s.userName}`);
      void invalidateStatus();
    },
    onError: (err) => gooeyToast.error("Teams connection failed", { description: errorText(err) }),
  });

  const clearMut = useMutation({
    mutationFn: () => clearTeamsAccount(),
    onSuccess: () => { clearTeamsQueries(qc); gooeyToast.success("Signed out of Teams"); void invalidateStatus(); },
    onError: (err) => { clearTeamsQueries(qc); gooeyToast.error("Could not sign out", { description: errorText(err) }); },
  });

  const busy = starting || testMut.isPending || clearMut.isPending;

  const handleStart = async (e: FormEvent) => {
    e.preventDefault();
    const id = clientId.trim();
    if (busy || !id) return;
    setStarting(true);
    try {
      setPending(await startTeamsSignIn(id, tenant.trim() || null));
    } catch (err) {
      gooeyToast.error("Couldn't start Teams sign-in", { description: errorText(err) });
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    setPending(null);
    try {
      await cancelTeamsSignIn();
    } catch {
      /* nothing pending is fine */
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      gooeyToast.success("Code copied");
    } catch {
      gooeyToast.error("Couldn't copy the code");
    }
  };

  const signedIn = status?.state === "connected" || status?.state === "unverified";

  return (
    <>
      <SectionHeader title="Microsoft Teams" description="Read-only catch-up on your unread Teams chats." />
      <Card className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {status === undefined
            ? "Checking…"
            : status.state === "connected"
              ? `Connected as ${status.userName}`
              : status.state === "unverified"
                ? "Signed in — not verified"
                : "Not connected"}
        </p>

        {pending ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            <p className="text-sm text-foreground">
              Open the Microsoft sign-in page and enter this code:
            </p>
            <code className="w-fit rounded-md border border-border bg-muted/50 px-3 py-1.5 font-mono text-lg tracking-widest text-foreground select-all">
              {pending.userCode}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void openUrl(pending.verificationUri)}>Open sign-in page</Button>
              <Button type="button" variant="secondary" onClick={() => void copyCode(pending.userCode)}>Copy code</Button>
              <Button type="button" variant="ghost" onClick={() => void handleCancel()}>Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground">Waiting for you to finish signing in…</p>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={handleStart}>
            <Label htmlFor="teams-client-id">Application (client) ID</Label>
            <Input
              id="teams-client-id"
              autoComplete="off"
              spellCheck={false}
              placeholder="00000000-0000-0000-0000-000000000000"
              value={clientId}
              onChange={(e) => setClientId(e.currentTarget.value)}
              disabled={busy}
            />
            <Label htmlFor="teams-tenant">Tenant (optional)</Label>
            <Input
              id="teams-tenant"
              autoComplete="off"
              spellCheck={false}
              placeholder="organizations"
              value={tenant}
              onChange={(e) => setTenant(e.currentTarget.value)}
              disabled={busy}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !clientId.trim()}>
                {signedIn ? "Sign in again" : "Sign in with Microsoft"}
              </Button>
              {signedIn && (
                <>
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => testMut.mutate()}>Test connection</Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => clearMut.mutate()}>Sign out</Button>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Uses your own Microsoft Entra app registration: enable “Allow public client flows” and add the delegated
              Microsoft Graph permissions User.Read and Chat.Read. Astryn only reads chats; channels aren’t covered.
              Signing in again with another account replaces the cached Teams data.
            </p>
          </form>
        )}
      </Card>
    </>
  );
}
