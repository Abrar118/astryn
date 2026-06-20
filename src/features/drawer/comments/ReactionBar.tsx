import { SmilePlus } from "lucide-react";
import { Popover } from "@/components/Popover";
import { aggregateReactions, type AggregatedReaction } from "./reactions";
import { emojiGlyph, QUICK_REACTIONS } from "./reactionEmoji";
import type { DetailReaction } from "@/lib/commands";

export function ReactionBar({
  reactions, meId, onToggle, onAdd,
}: {
  reactions: DetailReaction[];
  meId: string | null;
  onToggle: (agg: AggregatedReaction) => void;
  onAdd: (emoji: string) => void;
}) {
  const aggregated = aggregateReactions(reactions, meId);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {aggregated.map((agg) => (
        <button
          key={agg.emoji}
          type="button"
          title={agg.names.join(", ")}
          onClick={() => onToggle(agg)}
          className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
            agg.reactedByMe ? "border-primary/50 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          <span>{emojiGlyph(agg.emoji)}</span>
          <span className="tabular-nums">{agg.count}</span>
        </button>
      ))}
      <Popover
        align="start"
        buttonTitle="Add reaction"
        buttonClassName="flex size-6 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        button={<SmilePlus className="size-3.5" />}
        panelClassName="flex gap-1 rounded-lg border border-border bg-popover p-1 shadow-2xl"
      >
        {(close) => (
          <>
            {QUICK_REACTIONS.map((r) => (
              <button key={r.name} type="button" onClick={() => { onAdd(r.name); close(); }}
                className="rounded-md px-1.5 py-1 text-base hover:bg-accent">
                {r.glyph}
              </button>
            ))}
          </>
        )}
      </Popover>
    </div>
  );
}
