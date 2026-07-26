import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  addDocsSource,
  errorText,
  removeDocsSource,
  renameDocsSource,
  type DocsSource,
} from "@/lib/commands";
import { useDocsSources, useDocsStatus } from "@/lib/queries";
import { timeAgo } from "@/features/drawer/timeAgo";
import { SectionHeader } from "../SectionHeader";

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
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Name for ${source.owner}/${source.repo}`}
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
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onRemove}>
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
      <p className="text-xs text-muted-foreground">
        {source.owner}/{source.repo} · {source.branch}
        {" — "}
        {source.lastSyncedAt
          ? `${source.fileCount} file${source.fileCount === 1 ? "" : "s"} · synced ${timeAgo(source.lastSyncedAt)}`
          : "not synced yet"}
        {source.truncated && " · tree truncated"}
      </p>
    </Card>
  );
}

export function DocsSection() {
  const qc = useQueryClient();
  const { data: sources } = useDocsSources();
  const { data: status } = useDocsStatus();

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

  const busy = addMut.isPending || renameMut.isPending || removeMut.isPending;

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const url = urlInput.trim();
    if (!url) return;
    addMut.mutate({ url, name: nameInput });
  };

  return (
    <>
      <SectionHeader
        title="Documentation"
        description="Repositories the Docs page reads from. Switch between them in the Docs header."
      />

      {status && !status.tokenPresent && (
        <p className="text-sm text-amber-400">
          Connect a GitHub token first — docs are fetched with it.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Label>Sources</Label>
        {sources === undefined ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documentation repositories yet.</p>
        ) : (
          sources.map((s) => (
            <SourceRow
              // Name in the key so a confirmed rename — or a revert after a failed
              // one — remounts the row with the stored name as its draft.
              key={`${s.id}:${s.name}`}
              source={s}
              busy={busy}
              onRename={(name) => renameMut.mutate({ id: s.id, name })}
              onRemove={() => removeMut.mutate(s.id)}
            />
          ))
        )}
      </div>

      <Card className="flex flex-col gap-4 p-6">
        <form className="flex flex-col gap-3" onSubmit={handleAdd}>
          <Label htmlFor="docs-repo">Add a repository</Label>
          <Input
            id="docs-repo"
            type="text"
            autoComplete="off"
            placeholder="https://github.com/owner/repo"
            value={urlInput}
            onChange={(e) => setUrlInput(e.currentTarget.value)}
            disabled={busy}
          />
          <Label htmlFor="docs-repo-name">Display name (optional)</Label>
          <Input
            id="docs-repo-name"
            type="text"
            autoComplete="off"
            placeholder="Defaults to the repository name"
            value={nameInput}
            onChange={(e) => setNameInput(e.currentTarget.value)}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            Paste a GitHub repo URL (optionally <code>/tree/&lt;branch&gt;</code>; defaults to{" "}
            <code>main</code>). Each repo is cached separately and synced the first time you view it.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>Add source</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
