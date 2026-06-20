export const REACTION_GLYPH: Record<string, string> = {
  "+1": "👍",
  "thumbsup": "👍",
  "-1": "👎",
  "thumbsdown": "👎",
  "heart": "❤️",
  "tada": "🎉",
  "hooray": "🎉",
  "smile": "😄",
  "smiley": "😄",
  "laughing": "😄",
  "joy": "😂",
  "confused": "😕",
  "thinking": "🤔",
  "eyes": "👀",
  "rocket": "🚀",
  "fire": "🔥",
  "clap": "👏",
  "raised_hands": "🙌",
  "white_check_mark": "✅",
  "x": "❌",
  "question": "❓",
  "warning": "⚠️",
  "100": "💯",
};

export function emojiGlyph(name: string): string {
  if (REACTION_GLYPH[name]) return REACTION_GLYPH[name];
  if (/[^\x00-\x7F]/.test(name)) return name;
  return `:${name}:`;
}

export const QUICK_REACTIONS: { name: string; glyph: string }[] = [
  { name: "+1", glyph: "👍" },
  { name: "tada", glyph: "🎉" },
  { name: "heart", glyph: "❤️" },
  { name: "smile", glyph: "😄" },
  { name: "confused", glyph: "😕" },
  { name: "eyes", glyph: "👀" },
  { name: "rocket", glyph: "🚀" },
  { name: "-1", glyph: "👎" },
];
