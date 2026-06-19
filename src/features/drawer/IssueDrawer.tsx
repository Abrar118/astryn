import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useIssueDetail, useUpdateIssue, useUsers } from "@/lib/queries";
import type { CalendarIssue, IssueDetailResult, LiveDetail, UpdateIssuePatch } from "@/lib/commands";
import { Button } from "@/components/ui/button";

const PRIORITY_LABELS = ["No priority", "Urgent", "High", "Medium", "Low"];

function useSeed(id: string | null): CalendarIssue | undefined {
  const qc = useQueryClient();
  if (!id) return undefined;
  for (const key of [["calendar"], ["unscheduled"]] as const) {
    for (const [, list] of qc.getQueriesData<CalendarIssue[]>({ queryKey: key })) {
      const found = list?.find((i) => i.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

export function IssueDrawer() {
  const [params, setParams] = useSearchParams();
  const id = params.get("issue");
  const seed = useSeed(id);
  const { data: result } = useIssueDetail(id, seed);
  if (!id || !result) return null;
  return <DrawerBody id={id} result={result} onClose={() => setParams({})} />;
}

function DrawerBody({
  id, result, onClose,
}: {
  id: string;
  result: IssueDetailResult;
  onClose: () => void;
}) {
  const update = useUpdateIssue();
  const users = useUsers();
  const live = result.source === "live" ? (result.detail as LiveDetail) : null;
  const editable = result.source === "live";

  // Display fields available across all branches.
  const d = result.detail;
  const identifier = d.identifier;
  const stateName = "stateName" in d ? d.stateName ?? "" : ("stateType" in d ? d.stateType : "");

  // Local edit buffers for free-text fields.
  const [title, setTitle] = useState(d.title);
  const [desc, setDesc] = useState("description" in d ? d.description ?? "" : "");
  const [showPreview, setShowPreview] = useState(true);
  useEffect(() => {
    setTitle(d.title);
    setDesc("description" in d ? d.description ?? "" : "");
  }, [id, result.source]); // re-seed when the issue or branch changes

  const patch = (p: UpdateIssuePatch) => update.mutate({ id, patch: p });

  return (
    <aside className="fixed right-0 top-0 z-20 flex h-full w-[460px] flex-col gap-4 overflow-y-auto border-l border-border bg-popover p-5 shadow-xl">
      <header className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{identifier}</span>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </header>

      {result.source !== "live" && (
        <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          {result.source === "preview" ? "Loading…" : "Offline — showing cached data. Editing is disabled."}
        </p>
      )}

      {/* Title */}
      <input
        className="rounded-md border bg-background px-2 py-1 text-base font-medium disabled:opacity-60"
        value={title}
        disabled={!editable}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => editable && title !== d.title && patch({ title })}
      />

      {/* State / Priority / Due / Assignee */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">State</span>
          <select
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-60"
            disabled={!editable}
            value={live?.stateId ?? ""}
            onChange={(e) => patch({ stateId: e.target.value })}
          >
            {!live && <option>{stateName}</option>}
            {live?.teamStates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Priority</span>
          <select
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-60"
            disabled={!editable}
            value={d.priority}
            onChange={(e) => patch({ priority: Number(e.target.value) })}
          >
            {PRIORITY_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Due date</span>
          <input
            type="date"
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-60"
            disabled={!editable}
            value={d.dueDate ?? ""}
            onChange={(e) => patch({ dueDate: e.target.value === "" ? null : e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Assignee</span>
          <select
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-60"
            disabled={!editable}
            value={d.assigneeId ?? ""}
            onChange={(e) => patch({ assigneeId: e.target.value === "" ? null : e.target.value })}
          >
            <option value="">Unassigned</option>
            {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      </div>

      {/* Description (markdown) */}
      <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Description</span>
          {editable && (
            <button className="text-xs underline" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? "Edit" : "Preview"}
            </button>
          )}
        </div>
        {showPreview || !editable ? (
          <div className="prose prose-sm prose-invert max-w-none rounded-md border p-2 text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{desc || "_No description_"}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            className="min-h-32 rounded-md border bg-background p-2 text-sm"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => patch({ description: desc === "" ? null : desc })}
          />
        )}
      </section>

      {/* Read-only rich sections (live only) */}
      {live && (
        <div className="flex flex-col gap-3 text-sm">
          {live.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {live.labels.map((l) => (
                <span key={l.id} className="rounded-full border px-2 py-0.5 text-xs"
                  style={{ borderColor: l.color ?? undefined }}>{l.name}</span>
              ))}
            </div>
          )}
          {live.projectName && <div><span className="text-muted-foreground">Project:</span> {live.projectName}</div>}
          {live.cycle && (
            <div><span className="text-muted-foreground">Cycle:</span> {live.cycle.name ?? `#${live.cycle.number ?? "?"}`}</div>
          )}
          {live.children.length > 0 && (
            <section>
              <div className="mb-1 text-xs text-muted-foreground">Sub-issues</div>
              {live.children.map((c) => (
                <div key={c.id} className="text-xs">{c.identifier} — {c.title} <span className="text-muted-foreground">({c.stateType})</span></div>
              ))}
              {live.hasMoreChildren && <div className="text-xs text-muted-foreground">Showing first 50</div>}
            </section>
          )}
          {live.relations.length > 0 && (
            <section>
              <div className="mb-1 text-xs text-muted-foreground">Relations</div>
              {live.relations.map((r, idx) => (
                <div key={idx} className="text-xs">{r.type}: {r.issue.identifier} — {r.issue.title}</div>
              ))}
              {live.hasMoreRelations && <div className="text-xs text-muted-foreground">Showing first 50</div>}
            </section>
          )}
          {live.comments.length > 0 && (
            <section>
              <div className="mb-1 text-xs text-muted-foreground">Comments</div>
              {live.comments.map((c) => (
                <div key={c.id} className="mb-2 rounded-md border p-2 text-xs">
                  <div className="text-muted-foreground">{c.userName ?? "Unknown"}</div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.body}</ReactMarkdown>
                </div>
              ))}
              {live.hasMoreComments && <div className="text-xs text-muted-foreground">Showing first 50</div>}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
