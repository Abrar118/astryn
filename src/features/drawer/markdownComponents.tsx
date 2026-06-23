import { isValidElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { defaultUrlTransform } from "react-markdown";
import { FileAttachmentCard } from "./FileAttachmentCard";
import { LinearMarkdownImage } from "./LinearMarkdownImage";
import { MermaidDiagram } from "./MermaidDiagram";
import { USER_MENTION_PREFIX, userMentionFromHref } from "./comments/milkdownUserMention";
import { IssueMentionPill } from "./comments/IssueMentionPill";
import { MentionHoverCard } from "./comments/MentionHoverCard";
import type { User } from "@/lib/commands";

/**
 * `urlTransform` for ReactMarkdown that preserves `mention://user/…` hrefs
 * (which react-markdown's default transform would strip as an unsafe scheme)
 * while delegating all other URLs to the default safe-protocol check.
 *
 * Pass this as `urlTransform={mentionAwareUrlTransform}` on every ReactMarkdown
 * instance that may render user-mention pills.
 */
export function mentionAwareUrlTransform(url: string): string {
  if (url.startsWith(USER_MENTION_PREFIX)) return url;
  return defaultUrlTransform(url);
}

/** Flatten a react-markdown link's children to its plain text (for "@" detection). */
function nodeText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return "";
}

/** True for links to an uploaded file on Linear's storage (rendered as a card).
 *  Images arrive via the `img` renderer, so any such `<a>` is a non-image file. */
export function isUploadAttachment(href: string): boolean {
  try {
    return new URL(href).hostname === "uploads.linear.app";
  } catch {
    return false;
  }
}

/** Extract a Linear issue identifier (e.g. "PRO-153") from a link href, if any. */
export function issueIdentifierFromHref(href: string): string | null {
  const m = href.match(/\/issue\/([A-Za-z0-9]+-\d+)/);
  return m ? m[1].toUpperCase() : null;
}

/** A cached issue a mention can resolve to, for the pill's status dot + tooltip. */
export type MentionTarget = {
  identifier: string;
  title: string;
  stateType: string;
  stateColor: string;
  stateName: string | null;
  projectName: string | null;
  priority: number;
  assigneeName: string | null;
};

/** Resolve an issue identifier to a cached issue (undefined if not cached). */
export type MentionResolver = (identifier: string) => MentionTarget | undefined;

/**
 * `react-markdown` overrides shared by the read-only description fallback and the
 * activity comments / resource modal:
 * - A link to a *cached* Linear user mention renders as a non-navigating @Name pill.
 * - A link to a *cached* Linear issue renders as a highlighted, clickable pill.
 * - All link activation goes through `onActivateLink` (the drawer's `handleLink`):
 *   an in-app issue link opens the drawer; other links open in the system
 *   browser; the webview never navigates.
 * - Images go through the Rust proxy.
 */
export function createMarkdownComponents(opts: {
  onActivateLink: (href: string) => void;
  resolveMention: MentionResolver;
  /** Resolve a user mention (by our `mention://user/<id>` or by "@Name" text) to
   * a cached user, for the hover profile card. Omit to render a plain pill. */
  resolveUser?: (key: { id: string | null; name: string }) => User | undefined;
}): Components {
  return {
    a: ({ href, children, title }) => {
      // ── User-mention pill ─────────────────────────────────────────────────
      // Match our own `mention://user/…` links AND Linear-returned mentions
      // (which come back with a profile/permalink href, not our scheme). Both
      // always render their label as "@Name", so the leading "@" is the reliable
      // cross-platform signal — keying off the href alone misses Linear's form.
      const mentionId = href ? userMentionFromHref(href) : null;
      const text = nodeText(children).trim();
      const isUserMention = (href != null && mentionId != null) || /^@\S/.test(text);
      if (href && isUserMention) {
        // Strip the leading "@" so the handle/name matches the cached user list.
        const user = opts.resolveUser?.({ id: mentionId, name: text.replace(/^@/, "") });
        // Linear-authored mentions come back as the user's handle (e.g.
        // "@jakob.schwarz"); show the full display name once resolved so our
        // and Linear's mentions read identically.
        const label = user ? `@${user.name}` : children;
        const pill = (
          <span
            data-mention-pill="user"
            className="mx-px inline-flex items-center rounded bg-secondary/60 px-1 py-0.5 align-baseline text-[0.95em] font-medium text-foreground"
          >
            {label}
          </span>
        );
        return user ? <MentionHoverCard user={user}>{pill}</MentionHoverCard> : pill;
      }

      // ── Uploaded-file card ────────────────────────────────────────────────
      // A link to Linear storage is an attached file; render Linear's card (icon
      // + name + size) instead of a bare link. Size rides in the link title when
      // we attached it; Linear-attached files have none, so it's just hidden.
      if (href && isUploadAttachment(href)) {
        return (
          <FileAttachmentCard
            filename={text}
            size={title}
            title={href}
            onOpen={() => opts.onActivateLink(href)}
          />
        );
      }

      // ── Issue-mention pill ────────────────────────────────────────────────
      const ident = href ? issueIdentifierFromHref(href) : null;
      const target = ident ? opts.resolveMention(ident) : undefined;
      if (href && ident && target) {
        return (
          <IssueMentionPill target={target} href={href} onActivate={opts.onActivateLink} />
        );
      }
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) opts.onActivateLink(href);
          }}
          className="cursor-pointer text-primary hover:underline"
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => <LinearMarkdownImage src={src ?? ""} alt={alt ?? ""} />,
    // A ```mermaid fenced block renders as <pre><code class="language-mermaid">.
    // Detect it here and swap the whole <pre> for a rendered diagram; every other
    // code block falls through to a normal <pre>. Overriding `pre` (not `code`)
    // keeps the diagram out of a nested, bordered code box.
    pre: ({ children }) => {
      const child = Array.isArray(children) ? children[0] : children;
      const props = isValidElement(child)
        ? (child.props as { className?: string; children?: ReactNode })
        : null;
      if (props && /\blanguage-mermaid\b/.test(props.className ?? "")) {
        return <MermaidDiagram code={String(props.children ?? "").replace(/\n$/, "")} />;
      }
      return <pre>{children}</pre>;
    },
  };
}
