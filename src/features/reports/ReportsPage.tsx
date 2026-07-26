import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { gooeyToast } from "goey-toast";
import { Copy, Loader2, NotebookPen, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  errorText,
  generateReport,
  getLlmConfig,
  type ReportKind,
  type ReportResult,
  type ReportTokenEvent,
} from "@/lib/commands";
import { dailyWindow, weeklyWindow } from "@/lib/reportWindow";
import { useWorkdays } from "@/lib/workweek";
import { useWorkspace } from "@/lib/tabs";

const KINDS: { kind: ReportKind; label: string }[] = [
  { kind: "daily", label: "Daily Scrum" },
  { kind: "weekly", label: "Weekly Review" },
];

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // WKWebView clipboard can be flaky; fall back to execCommand.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      ta.remove();
    }
  }
  gooeyToast.success("Report copied");
}

type Phase = "idle" | "generating" | "done";

export function ReportsPage() {
  const { setActiveView } = useWorkspace();
  const workdays = useWorkdays();
  const { data: llmCfg } = useQuery({ queryKey: ["llm-config"], queryFn: getLlmConfig });

  const [kind, setKind] = useState<ReportKind>("daily");
  const [phase, setPhase] = useState<Phase>("idle");
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);
  // The id of the generation this screen is showing; events/results from any
  // other id are stale (superseded by a newer Generate or a tab switch).
  const genIdRef = useRef(0);
  const outputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const un = listen<ReportTokenEvent>("report:token", (e) => {
      if (e.payload.genId !== genIdRef.current) return;
      setDraft((d) => d + e.payload.token);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // Keep the newest streamed tokens in view.
  useEffect(() => {
    if (phase !== "generating") return;
    const ta = outputRef.current;
    if (ta) ta.scrollTop = ta.scrollHeight;
  }, [draft, phase]);

  const win = kind === "daily" ? dailyWindow(workdays) : weeklyWindow();

  const switchKind = (k: ReportKind) => {
    if (k === kind) return;
    genIdRef.current = 0; // orphan any in-flight stream
    setKind(k);
    setPhase("idle");
    setDraft("");
    setResult(null);
  };

  const generate = async () => {
    if (phase === "generating") return;
    const window = kind === "daily" ? dailyWindow(workdays) : weeklyWindow();
    const genId = Date.now();
    genIdRef.current = genId;
    setDraft("");
    setResult(null);
    setPhase("generating");
    try {
      const res = await generateReport(window, genId);
      if (genIdRef.current !== genId) return; // superseded
      setResult(res);
      setDraft(res.llmText ?? res.factSheet);
      setPhase("done");
      if (res.llmError) {
        gooeyToast.error("AI pass failed — showing plain facts", { description: res.llmError });
      }
    } catch (err) {
      if (genIdRef.current !== genId) return;
      setPhase("idle");
      gooeyToast.error("Could not generate the report", { description: errorText(err) });
    }
  };

  const streaming = phase === "generating";
  const statusLabel = streaming
    ? draft
      ? "Streaming…"
      : "Assembling facts…"
    : result?.llmText
      ? `Draft · ${result.model}`
      : "Facts (no AI pass)";

  return (
    <main className="h-full overflow-y-auto">
      {/* pb-28 keeps the last block clear of the floating dock */}
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-10 pt-10 pb-28">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Standup-ready updates from your Linear issues and GitHub PRs.
          </p>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Report type"
            className="flex w-fit gap-0.5 rounded-lg bg-card p-0.5 ring-1 ring-border"
          >
            {KINDS.map(({ kind: k, label }) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => switchKind(k)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  kind === k
                    ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button className="gap-2" onClick={() => void generate()} disabled={streaming}>
            {streaming ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Generating…
              </>
            ) : phase === "done" ? (
              <>
                <RefreshCw className="size-4" /> Regenerate
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Generate
              </>
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {kind === "daily"
            ? `Covers work since ${win.sinceLabel} · Asia/Dhaka`
            : `Week of ${win.sinceLabel} · Asia/Dhaka`}
          {" · "}
          {llmCfg === undefined ? (
            "checking AI endpoint…"
          ) : llmCfg ? (
            llmCfg.model
          ) : (
            <>
              no AI endpoint —{" "}
              <button
                type="button"
                onClick={() => setActiveView("settings")}
                className="cursor-pointer underline underline-offset-2 hover:text-foreground"
              >
                configure one
              </button>{" "}
              for prose, or generate plain facts
            </>
          )}
        </p>

        {phase === "idle" ? (
          <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
            <NotebookPen className="size-8 text-muted-foreground/40" />
            <p className="max-w-sm text-sm text-muted-foreground">
              {kind === "daily"
                ? "Done / in-progress / blocked since your last workday, plus PR activity — written up as a scrum update."
                : "Completed, carried-over and new work for this week — written up as a weekly review."}
            </p>
          </Card>
        ) : (
          <Card className="gap-0 overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-xs font-medium text-muted-foreground">{statusLabel}</span>
              <button
                type="button"
                aria-label="Copy report as Markdown"
                disabled={!draft}
                onClick={() => void copyText(draft)}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground ring-1 ring-border transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Copy className="size-3.5" /> Copy
              </button>
            </div>
            <textarea
              ref={outputRef}
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              readOnly={streaming}
              spellCheck={false}
              aria-label="Generated report (editable)"
              placeholder={streaming ? "" : "Nothing generated yet."}
              className="min-h-[380px] w-full resize-y bg-transparent px-4 py-3 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </Card>
        )}

        {result?.llmError && (
          <p className="text-xs text-amber-400">
            AI pass failed — this is the deterministic fact sheet. {result.llmError}
          </p>
        )}

        {result?.llmText && (
          <details>
            <summary className="w-fit cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
              Source facts
            </summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-card px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground">
              {result.factSheet}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}
