import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { ChevronRight, Copy, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IndicatorLamp, type Lamp } from "@/components/IndicatorLamp";
import { cn } from "@/lib/utils";
import { errorText, getLlmConfig, type ReportKind } from "@/lib/commands";
import { dailyWindow, weeklyWindow } from "@/lib/reportWindow";
import { generate, setDraft, useReportSlot } from "@/lib/reportsStore";
import { useWorkdays } from "@/lib/workweek";
import { useWorkspace } from "@/lib/tabs";
import { requestSettingsSection } from "@/features/settings/settingsSection";

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

export function ReportsPage() {
  const { setActiveView } = useWorkspace();
  const workdays = useWorkdays();
  const { data: llmCfg } = useQuery({ queryKey: ["llm-config"], queryFn: getLlmConfig });

  // Which kind is shown; the generated text itself lives in reportsStore (keyed
  // by kind) so it survives this component unmounting when you switch tabs.
  const [kind, setKind] = useState<ReportKind>("daily");
  const slot = useReportSlot(kind);
  const outputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest streamed tokens in view.
  useEffect(() => {
    if (slot.phase !== "generating") return;
    const ta = outputRef.current;
    if (ta) ta.scrollTop = ta.scrollHeight;
  }, [slot.draft, slot.phase]);

  const win = kind === "daily" ? dailyWindow(workdays) : weeklyWindow();

  const runGenerate = async () => {
    if (slot.phase === "generating") return;
    const window = kind === "daily" ? dailyWindow(workdays) : weeklyWindow();
    try {
      const res = await generate(kind, window);
      if (res?.llmError) {
        gooeyToast.error("AI pass failed — showing plain facts", { description: res.llmError });
      }
    } catch (err) {
      gooeyToast.error("Could not generate the report", { description: errorText(err) });
    }
  };

  const streaming = slot.phase === "generating";
  const status: { tone: Lamp; label: string } =
    slot.phase === "idle"
      ? { tone: "off", label: "Not generated yet" }
      : streaming
        ? { tone: "info", label: slot.draft ? "Streaming…" : "Assembling facts…" }
        : slot.result?.llmError
          ? { tone: "warning", label: "Facts (AI pass failed)" }
          : slot.result?.llmText
            ? { tone: "success", label: `Draft · ${slot.result.model}` }
            : { tone: "neutral", label: "Facts (no AI pass)" };

  const outline = kind === "daily"
    ? ["done since your last workday", "in progress", "blocked", "pull request activity"]
    : ["completed this week", "carried over", "new work", "pull request activity"];

  return (
    <main className="drawer-scrollbar h-full overflow-y-auto">
      {/* A reading column, centred like a document; pb-28 clears the floating dock. */}
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 pt-8 pb-28">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Reports</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Standup-ready updates from your tasks and pull requests.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div role="tablist" aria-label="Report type" className="flex gap-0.5 rounded-lg border border-border bg-sidebar p-0.5">
              {KINDS.map(({ kind: k, label }) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "dash-control rounded-md px-3 py-1 text-[13px] transition-colors",
                    kind === k
                      ? "bg-card font-medium text-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button onClick={() => void runGenerate()} disabled={streaming}>
              {streaming ? (
                <>
                  <Loader2 className="animate-spin" /> Generating…
                </>
              ) : slot.phase === "done" ? (
                <>
                  <RefreshCw /> Regenerate
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </div>
        </header>

        <dl className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-y border-border py-2.5 text-[12px]">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">{kind === "daily" ? "covers work since" : "week of"}</dt>
            <dd className="text-foreground">{win.sinceLabel} · Asia/Dhaka</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">ai endpoint</dt>
            <dd className="flex items-center gap-1.5 text-foreground">
              <IndicatorLamp tone={llmCfg ? "success" : "off"} />
              {llmCfg === undefined ? (
                "checking…"
              ) : llmCfg ? (
                llmCfg.model
              ) : (
                <span>
                  none —{" "}
                  <button
                    type="button"
                    onClick={() => {
                      requestSettingsSection("ai");
                      setActiveView("settings");
                    }}
                    className="dash-control rounded-sm underline decoration-muted-foreground underline-offset-4 hover:decoration-foreground"
                  >
                    configure one
                  </button>{" "}
                  for prose, or generate plain facts
                </span>
              )}
            </dd>
          </div>
        </dl>

        {slot.result?.llmError && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 px-4 py-3 text-[12px] text-foreground">
            <IndicatorLamp tone="warning" className="mt-1" />
            <span>AI pass failed — this is the deterministic fact sheet. {slot.result.llmError}</span>
          </p>
        )}

        <article aria-label="Report" className="dash-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-2.5">
            <span role="status" className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <IndicatorLamp tone={status.tone} />
              {status.label}
            </span>
            {slot.phase !== "idle" && (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Copy report as Markdown"
                disabled={!slot.draft}
                onClick={() => void copyText(slot.draft)}
              >
                <Copy /> Copy
              </Button>
            )}
          </div>

          {slot.phase === "idle" ? (
            <div className="px-6 py-6">
              <p className="text-[14px] text-foreground">
                {kind === "daily" ? "Your scrum update will cover:" : "Your weekly review will cover:"}
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {outline.map((line) => (
                  <li key={line} className="flex items-center gap-2.5 text-[14px] text-muted-foreground">
                    <IndicatorLamp tone="off" />
                    {line}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[12px] text-muted-foreground">
                Generate to draft it from your cached tasks and pull requests. You can edit the draft before copying.
              </p>
            </div>
          ) : (
            <textarea
              ref={outputRef}
              value={slot.draft}
              onChange={(e) => setDraft(kind, e.currentTarget.value)}
              readOnly={streaming}
              spellCheck={false}
              aria-label="Generated report (editable)"
              placeholder={streaming ? "" : "Nothing generated yet."}
              className="block min-h-[420px] w-full resize-y bg-transparent px-6 py-5 text-[15px] leading-[1.65] text-foreground outline-none placeholder:text-muted-foreground focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]"
            />
          )}
        </article>

        {slot.result?.llmText && (
          <details className="group">
            <summary className="dash-control flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-[12px] text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" />
              Source facts
            </summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-border px-4 py-3 font-mono text-[12px] leading-relaxed text-muted-foreground">
              {slot.result.factSheet}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}
