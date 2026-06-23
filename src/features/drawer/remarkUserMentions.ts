import type { User } from "@/lib/commands";
import { USER_MENTION_PREFIX } from "./comments/milkdownUserMention";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Linear's Markdown `body` flattens a `suggestion_userMentions` rich-text node
 * to plain `@displayName`. Convert only handles present in the cached user list
 * to our existing mention links so the shared link renderer can resolve by id.
 */
export function createUserMentionRemarkPlugin(users: User[]) {
  const usersByHandle = new Map(
    users
      .filter((user): user is User & { displayName: string } => Boolean(user.displayName))
      .map((user) => [user.displayName.toLowerCase(), user]),
  );
  const handles = [...usersByHandle.keys()].sort((a, b) => b.length - a.length);
  const pattern = handles.length
    ? new RegExp(
        `(^|[^A-Za-z0-9_@.])@(${handles.map(escapeRegExp).join("|")})(?![A-Za-z0-9_.-])`,
        "gi",
      )
    : null;

  return () => (tree: MarkdownNode) => {
    if (!pattern) return;

    const transform = (node: MarkdownNode) => {
      if (!node.children || node.type === "link" || node.type === "linkReference") return;

      const nextChildren: MarkdownNode[] = [];
      for (const child of node.children) {
        if (child.type !== "text" || typeof child.value !== "string") {
          transform(child);
          nextChildren.push(child);
          continue;
        }

        pattern.lastIndex = 0;
        let cursor = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(child.value)) !== null) {
          const prefix = match[1];
          const handle = match[2];
          const mentionStart = match.index + prefix.length;
          const user = usersByHandle.get(handle.toLowerCase());
          if (!user) continue;

          if (mentionStart > cursor) {
            nextChildren.push({ type: "text", value: child.value.slice(cursor, mentionStart) });
          }
          nextChildren.push({
            type: "link",
            url: `${USER_MENTION_PREFIX}${user.id}`,
            children: [{ type: "text", value: `@${handle}` }],
          });
          cursor = mentionStart + handle.length + 1;
        }

        if (cursor === 0) {
          nextChildren.push(child);
        } else if (cursor < child.value.length) {
          nextChildren.push({ type: "text", value: child.value.slice(cursor) });
        }
      }
      node.children = nextChildren;
    };

    transform(tree);
  };
}
