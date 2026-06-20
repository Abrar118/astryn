import type { DetailReaction } from "@/lib/commands";

export type AggregatedReaction = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  reactionIdByMe: string | null;
  names: string[];
};

/** Collapse a comment's reactions into per-emoji pills (first-seen emoji order). */
export function aggregateReactions(
  reactions: DetailReaction[],
  meId: string | null,
): AggregatedReaction[] {
  const order: string[] = [];
  const byEmoji = new Map<string, AggregatedReaction>();
  for (const reaction of reactions) {
    let agg = byEmoji.get(reaction.emoji);
    if (!agg) {
      agg = { emoji: reaction.emoji, count: 0, reactedByMe: false, reactionIdByMe: null, names: [] };
      byEmoji.set(reaction.emoji, agg);
      order.push(reaction.emoji);
    }
    agg.count += 1;
    if (reaction.userName) agg.names.push(reaction.userName);
    if (meId != null && reaction.userId === meId) {
      agg.reactedByMe = true;
      agg.reactionIdByMe = reaction.id;
    }
  }
  return order.map((emoji) => byEmoji.get(emoji) as AggregatedReaction);
}
