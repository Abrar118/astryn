import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IndicatorLamp } from "@/components/IndicatorLamp";
import {
  addClickupDocsSource,
  addDocsSource,
  addLocalDocsSource,
  errorText,
  removeDocsSource,
  renameDocsSource,
  type DocsSource,
} from "@/lib/commands";
import { useDocsSources, useDocsStatus } from "@/lib/queries";
import { useModules } from "@/lib/modules";
import { timeAgo } from "@/features/drawer/timeAgo";
import { sourceDetail, unavailableReason } from "@/features/docs/docSource";
import { SourceKindIcon } from "@/features/docs/SourceKindIcon";
import { SectionHeader } from "../SectionHeader";
import { SettingsPanel, SettingsZone } from "../SettingsPanel";

/** "12 files · synced 3m ago", or the not-yet state, per source kind. */
function freshness(source: DocsSource): string {
  const verb = source.kind === "local" ? "scanned" : "synced";
  if (!source.lastSyncedAt) return `not ${verb} yet`;
  const files = `${source.fileCount} file${source.fileCount === 1 ? "" : "s"}`;
  return `${files} · ${verb} ${timeAgo(source.lastSyncedAt)}`;
}

/** Everything that changes when the set of sources changes. */
function refreshSources(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ["docs-sources"] });
  qc.invalidateQueries({ queryKey: ["docs-status"] });
}

function SourceRow({
  source,
  onRename,
  onRemove,
  busy,
}: {
  source: DocsSource;
  onRename: (name: string) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(source.name);
  const [confirming, setConfirming] = useState(false);

  // Commit on blur/Enter only when the name actually changed, so tabbing through
  // the list doesn't fire a write per card.
  const commit = () => {
    const next = draft.trim();
    if (!next || next === source.name) {
      setDraft(source.name);
      return;
    }
    onRename(next);
  };

  return (
    <li className="dash-zone flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <IndicatorLamp tone={source.available ? (source.lastSyncedAt ? "success" : "off") : "warning"} />
        <Input
          aria-label={`Name for ${sourceDetail(source)}`}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setDraft(source.name);
          }}
        />
        {confirming ? (
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onRemove}>
              Remove
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${source.name}`}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      <p className="flex min-w-0 items-center gap-1.5 pl-5 text-[12px] text-muted-foreground">
        <SourceKindIcon kind={source.kind} className="size-3.5 shrink-0" />
        <span className="truncate" title={sourceDetail(source)}>
          {sourceDetail(source)}
          {" — "}
          {freshness(source)}
          {source.truncated && (source.kind === "local" ? " · too many files, list cut short" : " · tree truncated")}
          {!source.available && ` · ${unavailableReason(source.kind)}`}
        </span>
      </p>
    </li>
  );
}

export function DocsSection() {
  const qc = useQueryClient();
  const { data: sources } = useDocsSources();
  const { data: status } = useDocsStatus();
  const { isActive } = useModules();
  const githubOn = isActive("github");
  const clickupOn = isActive("clickup");

  const [urlInput, setUrlInput] = useState("");
  const [nameInput, setNameInput] = useState("");

  const addMut = useMutation({
    mutationFn: ({ url, name }: { url: string; name: string }) =>
      addDocsSource(url, name.trim() || undefined),
    onSuccess: (saved) => {
      setUrlInput("");
      setNameInput("");
      refreshSources(qc);
      gooeyToast.success(`Added ${saved.owner}/${saved.repo}`);
    },
    onError: (err) =>
      gooeyToast.error("Could not add the repository", { description: errorText(err) }),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameDocsSource(id, name),
    onSuccess: () => refreshSources(qc),
    onError: (err) => {
      refreshSources(qc); // re-read so the card falls back to the stored name
      gooeyToast.error("Could not rename the source", { description: errorText(err) });
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => removeDocsSource(id),
    onSuccess: (_v, id) => {
      // Drop the removed repo's cached tree and markdown from memory as well —
      // its query keys will never be requested again.
      for (const key of [["docs-tree", id], ["doc-content", id], ["docs-sync", id]]) {
        qc.removeQueries({ queryKey: key });
      }
      refreshSources(qc);
      gooeyToast.success("Documentation source removed");
    },
    onError: (err) =>
      gooeyToast.error("Could not remove the source", { description: errorText(err) }),
  });

  const addLocalMut = useMutation({
    // Rust opens the folder picker itself; no path crosses from the webview.
    mutationFn: () => addLocalDocsSource(),
    onSuccess: (saved) => {
      if (!saved) return; // picker cancelled
      refreshSources(qc);
      gooeyToast.success(`Added ${saved.name}`);
    },
    onError: (err) => gooeyToast.error("Could not add the folder", { description: errorText(err) }),
  });

  const [clickupUrl, setClickupUrl] = useState("");
  const [clickupName, setClickupName] = useState("");
  const addClickupMut = useMutation({
    mutationFn: ({ url, name }: { url: string; name: string }) =>
      addClickupDocsSource(url, name.trim() || undefined),
    onSuccess: (saved) => {
      setClickupUrl("");
      setClickupName("");
      refreshSources(qc);
      gooeyToast.success(`Added ${saved.name}`);
    },
    onError: (err) => gooeyToast.error("Could not add the ClickUp Doc", { description: errorText(err) }),
  });

  const busy =
    addMut.isPending ||
    addLocalMut.isPending ||
    addClickupMut.isPending ||
    renameMut.isPending ||
    removeMut.isPending;

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const url = urlInput.trim();
    if (!url) return;
    addMut.mutate({ url, name: nameInput });
  };

  const handleAddClickup = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const url = clickupUrl.trim();
    if (!url) return;
    addClickupMut.mutate({ url, name: clickupName });
  };

  const tokenWarning = (text: string) => (
    <p className="flex items-center gap-2 text-[13px] text-foreground">
      <IndicatorLamp tone="warning" />
      {text}
    </p>
  );

  return (
    <>
      <SectionHeader
        title="Documentation"
        description="GitHub repositories, ClickUp Docs and folders on this computer that the Docs page reads from. Switch between them in the Docs header."
      />

      <section aria-labelledby="docs-sources-title" className="flex flex-col gap-2">
        <h2 id="docs-sources-title" className="flex items-baseline gap-2 text-[13px] font-semibold tracking-tight text-foreground">
          Sources
          {sources && sources.length > 0 && (
            <span className="font-normal tabular-nums text-muted-foreground">{sources.length}</span>
          )}
        </h2>
        {sources === undefined ? (
          <SettingsPanel className="px-4 py-3.5 text-[13px] text-muted-foreground">Checking…</SettingsPanel>
        ) : sources.length === 0 ? (
          <SettingsPanel className="flex items-center gap-3 px-4 py-3.5">
            <IndicatorLamp tone="off" />
            <p className="text-[13px] text-muted-foreground">No documentation sources yet. Add one below.</p>
          </SettingsPanel>
        ) : (
          <ul className="dash-panel dash-face">
            {sources.map((s) => (
              <SourceRow
                // Name in the key so a confirmed rename — or a revert after a failed
                // one — remounts the row with the stored name as its draft.
                key={`${s.id}:${s.name}`}
                source={s}
                busy={busy}
                onRename={(name) => renameMut.mutate({ id: s.id, name })}
                onRemove={() => removeMut.mutate(s.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="docs-add-title" className="flex flex-col gap-2">
        <h2 id="docs-add-title" className="text-[13px] font-semibold tracking-tight text-foreground">Add a source</h2>
        <SettingsPanel>
          <SettingsZone
            title="Local folder"
            hint="Markdown, plain-text and PDF files in the folder and its subfolders are read in place — nothing is copied. Use the Docs page's rescan button after changing files."
            aside={
              <Button type="button" variant="outline" disabled={busy} onClick={() => addLocalMut.mutate()}>
                Choose folder…
              </Button>
            }
          />

          {!githubOn ? (
            <SettingsZone title="GitHub repository">
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <IndicatorLamp tone="off" />
                Turn on GitHub in Modules to add documentation repositories.
              </p>
            </SettingsZone>
          ) : (
            <form className="dash-zone grid gap-x-3 gap-y-3 px-4 py-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" onSubmit={handleAdd}>
              {status && !status.tokenPresent && (
                <div className="sm:col-span-2">{tokenWarning("Connect a GitHub token first — repositories are fetched with it.")}</div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="docs-repo" className="text-[13px]">Add a repository</Label>
                <Input
                  id="docs-repo"
                  type="text"
                  autoComplete="off"
                  placeholder="https://github.com/owner/repo"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.currentTarget.value)}
                  disabled={busy}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="docs-repo-name" className="text-[13px]">Display name (optional)</Label>
                <Input
                  id="docs-repo-name"
                  type="text"
                  autoComplete="off"
                  placeholder="Defaults to the repository name"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.currentTarget.value)}
                  disabled={busy}
                />
              </div>
              <p className="text-[12px] text-muted-foreground sm:col-span-2">
                Paste a GitHub repo URL (optionally <code>/tree/&lt;branch&gt;</code>; defaults to{" "}
                <code>main</code>). Each repo is cached separately and synced the first time you view it.
              </p>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy}>Add source</Button>
              </div>
            </form>
          )}

          {clickupOn && (
            <form className="dash-zone grid gap-x-3 gap-y-3 px-4 py-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" onSubmit={handleAddClickup}>
              {status && !status.clickupTokenPresent && (
                <div className="sm:col-span-2">{tokenWarning("Connect a ClickUp token first — Docs are checked and fetched with it.")}</div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="docs-clickup" className="text-[13px]">Add a ClickUp Doc</Label>
                <Input
                  id="docs-clickup"
                  type="text"
                  autoComplete="off"
                  placeholder="https://app.clickup.com/…/v/dc/…"
                  value={clickupUrl}
                  onChange={(e) => setClickupUrl(e.currentTarget.value)}
                  disabled={busy}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="docs-clickup-name" className="text-[13px]">ClickUp Doc name (optional)</Label>
                <Input
                  id="docs-clickup-name"
                  type="text"
                  autoComplete="off"
                  placeholder="Defaults to the Doc's name"
                  value={clickupName}
                  onChange={(e) => setClickupName(e.currentTarget.value)}
                  disabled={busy}
                />
              </div>
              <p className="text-[12px] text-muted-foreground sm:col-span-2">
                Paste the Doc's link from ClickUp. Its pages and sub-pages are cached for offline
                reading and refreshed from the Docs page.
              </p>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy}>Add ClickUp Doc</Button>
              </div>
            </form>
          )}
        </SettingsPanel>
      </section>
    </>
  );
}
