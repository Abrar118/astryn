import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  clearGithubToken,
  clearLinearKey,
  clearLlmConfig,
  clearSlackToken,
  detectSlackCredentials,
  errorText,
  getConnectionStatus,
  getDocsRepo,
  getGithubStatus,
  getLlmConfig,
  getSlackStatus,
  setDocsRepo,
  setGithubToken,
  setLinearKey,
  setLlmConfig,
  setSlackCredentials,
  syncIssues,
  testGithubConnection,
  testLinearConnection,
  testLlmConnection,
  testSlackConnection,
} from "@/lib/commands";
import { clearGithubQueries, clearSlackQueries, clearWorkspaceQueries, invalidateWorkspaceQueries } from "@/lib/queries";
import { DAY_LABELS, saveWorkdays, useWorkdays } from "@/lib/workweek";
import {
  APPEARANCE_RANGES,
  clampAppearance,
  DEFAULT_APPEARANCE,
  saveAppearance,
  useAppearance,
  type Appearance,
} from "@/lib/appearance";

/** A −/value%/+ stepper for one appearance scale. */
function ScaleStepper({
  label,
  hint,
  field,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  field: keyof Appearance;
  value: number;
  onChange: (v: number) => void;
}) {
  const { min, max, step } = APPEARANCE_RANGES[field];
  const bump = (dir: 1 | -1) => onChange(clampAppearance(field, value + dir * step));
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => bump(-1)}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground ring-1 ring-border transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus className="size-3.5" />
        </button>
        <span className="w-12 text-center text-sm tabular-nums text-foreground">
          {Math.round(value * 100)}%
        </span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => bump(1)}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground ring-1 ring-border transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

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

  const [docsRepoInput, setDocsRepoInput] = useState("");
  const [docsSaving, setDocsSaving] = useState(false);
  const { data: docsRepo } = useQuery({ queryKey: ["docs-repo"], queryFn: getDocsRepo });

  const handleDocsSave = async (e: FormEvent) => {
    e.preventDefault();
    if (docsSaving) return;
    const url = docsRepoInput.trim();
    if (!url) return;
    setDocsSaving(true);
    try {
      const saved = await setDocsRepo(url);
      setDocsRepoInput("");
      // Origin changed → the cache was cleared backend-side; drop the cached docs
      // views and re-arm the on-mount sync so the Docs page refetches the new repo.
      for (const key of [["docs-repo"], ["docs-status"], ["docs-tree"], ["doc-content"], ["docs-sync"]]) {
        qc.invalidateQueries({ queryKey: key });
      }
      gooeyToast.success(`Docs repository set to ${saved.owner}/${saved.repo}`);
    } catch (err) {
      gooeyToast.error("Could not set the docs repository", { description: errorText(err) });
    } finally {
      setDocsSaving(false);
    }
  };

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

  // AI endpoint (report generators). URL/model prefill from the saved config
  // (null local state = "not edited yet"); the API key is paste-once like the
  // other secrets — cleared from state immediately and never echoed back.
  const { data: llmCfg } = useQuery({ queryKey: ["llm-config"], queryFn: getLlmConfig });
  const [llmUrl, setLlmUrl] = useState<string | null>(null);
  const [llmModel, setLlmModel] = useState<string | null>(null);
  const [llmKeyInput, setLlmKeyInput] = useState("");
  const [llmSaving, setLlmSaving] = useState(false);
  const invalidateLlm = () => qc.invalidateQueries({ queryKey: ["llm-config"] });

  const llmTestMut = useMutation({
    mutationFn: () => testLlmConnection(),
    onSuccess: (models) =>
      gooeyToast.success(`Endpoint OK — ${models.length} model${models.length === 1 ? "" : "s"} available`),
    onError: (err) => gooeyToast.error("Endpoint test failed", { description: errorText(err) }),
  });
  const llmClearMut = useMutation({
    mutationFn: () => clearLlmConfig(),
    onSuccess: () => {
      setLlmUrl(null);
      setLlmModel(null);
      gooeyToast.success("AI endpoint cleared");
      invalidateLlm();
    },
    onError: (err) => gooeyToast.error("Could not clear the endpoint", { description: errorText(err) }),
  });
  const llmBusy = llmSaving || llmTestMut.isPending || llmClearMut.isPending;

  // Direct async (not a TanStack mutation) so the key never enters the mutation cache.
  const handleLlmSave = async (e: FormEvent) => {
    e.preventDefault();
    if (llmBusy) return;
    const baseUrl = (llmUrl ?? llmCfg?.baseUrl ?? "").trim();
    const model = (llmModel ?? llmCfg?.model ?? "").trim();
    if (!baseUrl || !model) return;
    const key = llmKeyInput.trim() || null;
    setLlmKeyInput(""); // clear the secret from component state immediately
    setLlmSaving(true);
    try {
      await setLlmConfig(baseUrl, model, key);
      gooeyToast.success("AI endpoint saved");
      invalidateLlm();
    } catch (err) {
      gooeyToast.error("Could not save the endpoint", { description: errorText(err) });
    } finally {
      setLlmSaving(false);
    }
  };

  const appearance = useAppearance();
  const setScale = (field: keyof Appearance) => (v: number) =>
    saveAppearance({ ...appearance, [field]: v });

  const workdays = useWorkdays();
  const toggleWorkday = (day: number) => {
    if (workdays.includes(day)) {
      // Never allow an empty week — FullCalendar can't render all-days-hidden.
      if (workdays.length === 1) return;
      saveWorkdays(workdays.filter((d) => d !== day));
    } else {
      saveWorkdays([...workdays, day]);
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
    <main className="h-full overflow-y-auto">
      {/* pb-28 keeps the last card clear of the floating dock that overlaps the bottom */}
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-10 pt-10 pb-28">
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
          {docsRepo === undefined
            ? "Checking…"
            : docsRepo === null
              ? "No documentation repository set"
              : `Reading from ${docsRepo.owner}/${docsRepo.repo} · ${docsRepo.branch}`}
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleDocsSave}>
          <Label htmlFor="docs-repo">Documentation repository</Label>
          <Input
            id="docs-repo"
            type="text"
            autoComplete="off"
            placeholder="https://github.com/owner/repo"
            value={docsRepoInput}
            onChange={(e) => setDocsRepoInput(e.currentTarget.value)}
            disabled={docsSaving}
          />
          <p className="text-xs text-muted-foreground">
            Paste a GitHub repo URL (optionally <code>/tree/&lt;branch&gt;</code>; defaults to{" "}
            <code>main</code>). Fetched with your GitHub token. Changing it clears the cached docs.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={docsSaving}>Save repository</Button>
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
                ? "Credentials saved — not verified"
                : "Not connected"}
        </p>
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            disabled={slackBusy}
            onClick={() => slackDetectMut.mutate()}
          >
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

      <Card className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {llmCfg === undefined
            ? "Checking…"
            : llmCfg === null
              ? "No AI endpoint — reports show plain facts"
              : `${llmCfg.model} @ ${llmCfg.baseUrl}${llmCfg.hasApiKey ? " · key saved" : ""}`}
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleLlmSave}>
          <Label htmlFor="llm-url">AI endpoint (OpenAI-compatible)</Label>
          <Input
            id="llm-url"
            type="text"
            autoComplete="off"
            placeholder="http://localhost:11434"
            value={llmUrl ?? llmCfg?.baseUrl ?? ""}
            onChange={(e) => setLlmUrl(e.currentTarget.value)}
            disabled={llmBusy}
          />
          <Label htmlFor="llm-model">Model</Label>
          <Input
            id="llm-model"
            type="text"
            autoComplete="off"
            placeholder="phi4-mini-reasoning:latest"
            value={llmModel ?? llmCfg?.model ?? ""}
            onChange={(e) => setLlmModel(e.currentTarget.value)}
            disabled={llmBusy}
          />
          <Label htmlFor="llm-key">API key (optional)</Label>
          <Input
            id="llm-key"
            type="password"
            autoComplete="off"
            placeholder="Not needed for Ollama"
            value={llmKeyInput}
            onChange={(e) => setLlmKeyInput(e.currentTarget.value)}
            disabled={llmBusy}
          />
          <p className="text-xs text-muted-foreground">
            Powers the Reports generators (Ollama, LM Studio, vLLM, OpenAI…). The key is stored in
            the system keychain and never shown again.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={llmBusy}>Save endpoint</Button>
            <Button type="button" variant="secondary" disabled={llmBusy} onClick={() => llmTestMut.mutate()}>
              Test connection
            </Button>
            <Button type="button" variant="ghost" disabled={llmBusy} onClick={() => llmClearMut.mutate()}>
              Clear
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <Label>Appearance</Label>
          <p className="text-sm text-muted-foreground">Scale the interface to taste.</p>
        </div>
        <ScaleStepper
          label="App font size"
          hint="Zooms the whole interface — text, icons and layout."
          field="appZoom"
          value={appearance.appZoom}
          onChange={setScale("appZoom")}
        />
        <ScaleStepper
          label="Icon size"
          hint="Scales icons on top of the app size."
          field="iconScale"
          value={appearance.iconScale}
          onChange={setScale("iconScale")}
        />
        <ScaleStepper
          label="Editor font size"
          hint="Description and comment editors, and rendered markdown."
          field="editorScale"
          value={appearance.editorScale}
          onChange={setScale("editorScale")}
        />
        {(appearance.appZoom !== DEFAULT_APPEARANCE.appZoom ||
          appearance.iconScale !== DEFAULT_APPEARANCE.iconScale ||
          appearance.editorScale !== DEFAULT_APPEARANCE.editorScale) && (
          <button
            type="button"
            onClick={() => saveAppearance({ ...DEFAULT_APPEARANCE })}
            className="w-fit text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Reset to defaults
          </button>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <Label>Week days</Label>
          <p className="text-sm text-muted-foreground">
            Days shown on the calendar. Unselected days are hidden so the rest get more space.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {DAY_LABELS.map((label, day) => {
            const active = workdays.includes(day);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                onClick={() => toggleWorkday(day)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  active
                    ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                    : "text-muted-foreground ring-1 ring-border hover:bg-accent hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Card>
      </div>
    </main>
  );
}
