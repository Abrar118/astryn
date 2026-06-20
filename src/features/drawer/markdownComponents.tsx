import { isValidElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { defaultUrlTransform } from "react-markdown";
import { LinearMarkdownImage } from "./LinearMarkdownImage";
import { MermaidDiagram } from "./MermaidDiagram";
import { USER_MENTION_PREFIX, userMentionFromHref } from "./comments/milkdownUserMention";
import { IssueMentionPill } from "./comments/IssueMentionPill";

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
}): Components {
  return {
    a: ({ href, children }) => {
      // ── User-mention pill ─────────────────────────────────────────────────
      const userId = href ? userMentionFromHref(href) : null;
      if (href && userId) {
        return (
          <span
            data-mention-pill="user"
            className="mx-px inline-flex items-center rounded-md border border-border bg-secondary/70 px-1.5 py-0.5 align-baseline text-[0.85em] font-medium text-foreground"
          >
            {children}
          </span>
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
