import type { Components } from "react-markdown";
import { LinearMarkdownImage } from "./LinearMarkdownImage";

/** Extract a Linear issue identifier (e.g. "PRO-153") from a link href, if any. */
export function issueIdentifierFromHref(href: string): string | null {
  const m = href.match(/\/issue\/([A-Za-z0-9]+-\d+)/);
  return m ? m[1].toUpperCase() : null;
}

/** A cached issue a mention can resolve to, for the pill's status dot + tooltip. */
export type MentionTarget = { stateColor: string; title: string };

/** Resolve an issue identifier to a cached issue (undefined if not cached). */
export type MentionResolver = (identifier: string) => MentionTarget | undefined;

/**
 * `react-markdown` overrides shared by the read-only description fallback and the
 * activity comments / resource modal:
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
      const ident = href ? issueIdentifierFromHref(href) : null;
      const target = ident ? opts.resolveMention(ident) : undefined;
      if (href && ident && target) {
        return (
          <button
            type="button"
            title={target.title}
            onClick={() => opts.onActivateLink(href)}
            className="mx-px inline-flex items-center gap-1 rounded-md border border-border bg-secondary/70 px-1.5 py-0.5 align-baseline text-[0.85em] font-medium text-foreground no-underline transition-colors hover:bg-accent"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: target.stateColor || "#6b7280" }}
            />
            {ident}
          </button>
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
  };
}
