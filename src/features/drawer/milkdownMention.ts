import type { Mark as ProseMirrorMark } from "@milkdown/prose/model";
import type { EditorView, MarkView } from "@milkdown/prose/view";
import { $view } from "@milkdown/kit/utils";
import { linkSchema } from "@milkdown/kit/preset/commonmark";
import type { MilkdownPlugin } from "@milkdown/ctx";
import {
  issueIdentifierFromHref,
  type MentionResolver,
} from "./markdownComponents";
import { userMentionFromHref } from "./comments/milkdownUserMention";

/** Re-export of `issueIdentifierFromHref` under the module-public name. */
export function issueMentionFromUrl(href: string): string | null {
  return issueIdentifierFromHref(href);
}

/** Shared inline pill style for issue and user mention pills in the Milkdown editor. */
const PILL_CSS = [
  "display:inline-flex",
  "align-items:center",
  "gap:4px",
  "border-radius:6px",
  "border:1px solid var(--border,#3f4147)",
  "background:var(--secondary,#1e2025)",
  "padding:1px 6px",
  "font-size:0.85em",
  "font-weight:500",
  "color:var(--foreground,#e2e4ea)",
  "cursor:pointer",
  "vertical-align:baseline",
  "text-decoration:none",
  "transition:background 0.15s",
].join(";");

/** Build the outer pill span + contentDOM, shared between issue and user pills. */
function makePillDom(dataMentionPill: string): { dom: HTMLSpanElement; contentDOM: HTMLSpanElement } {
  const dom = document.createElement("span");
  dom.setAttribute("data-mention-pill", dataMentionPill);
  dom.style.cssText = PILL_CSS;
  const contentDOM = document.createElement("span");
  dom.appendChild(contentDOM);
  return { dom, contentDOM };
}

/**
 * Build a ProseMirror MarkView for a `link` mark.
 *
 * - If the link's href resolves to a user mention AND `resolveUser` can provide
 *   the user name, render a non-navigating user pill.
 *
 * - If the link's href resolves to an issue identifier AND `resolveMention`
 *   can provide the cached issue, render an inline issue pill:
 *     <span> [ status-dot ] [ contentDOM ] </span>
 *   Click → preventDefault + stopPropagation + onActivateLink(href).
 *   `title` attr = the issue title.  NOT an anchor, so the webview never
 *   navigates.
 *
 * - Otherwise render a plain <a> with the href so normal links still work.
 *   (General link interception is handled elsewhere in the editor.)
 *
 * The link mark's markdown is never touched — this is rendering-only.
 */
function makeLinkMarkView(
  resolveMention: MentionResolver,
  onActivateLink: (href: string) => void,
  resolveUser?: (id: string) => { name: string } | undefined,
): (mark: ProseMirrorMark, view: EditorView, inline: boolean) => MarkView {
  return (mark: ProseMirrorMark, _view: EditorView, _inline: boolean) => {
    const attrs = mark.attrs as { href?: string; title?: string };
    const href = attrs.href ?? "";

    // ── User-mention pill ───────────────────────────────────────────────────
    const userId = userMentionFromHref(href);
    const user = userId && resolveUser ? resolveUser(userId) : undefined;
    if (userId && user) {
      const { dom, contentDOM } = makePillDom("user");
      dom.title = user.name;
      dom.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
      dom.addEventListener("mouseenter", () => { dom.style.background = "var(--accent,#2a2d35)"; });
      dom.addEventListener("mouseleave", () => { dom.style.background = "var(--secondary,#1e2025)"; });
      return { dom, contentDOM };
    }

    // ── Issue-mention pill ──────────────────────────────────────────────────
    const identifier = issueMentionFromUrl(href);
    const target = identifier ? resolveMention(identifier) : undefined;

    if (identifier && target) {
      const { dom, contentDOM } = makePillDom("");
      dom.title = target.title;

      // Status dot
      const dot = document.createElement("span");
      dot.style.cssText = [
        "display:inline-block",
        "width:8px",
        "height:8px",
        "border-radius:50%",
        "flex-shrink:0",
        `background:${target.stateColor || "#6b7280"}`,
      ].join(";");
      dom.insertBefore(dot, contentDOM);

      dom.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onActivateLink(href);
      });

      dom.addEventListener("mouseenter", () => {
        dom.style.background = "var(--accent,#2a2d35)";
      });
      dom.addEventListener("mouseleave", () => {
        dom.style.background = "var(--secondary,#1e2025)";
      });

      return { dom, contentDOM };
    }

    // ── Plain link fallback ───────────────────────────────────────────────
    const dom = document.createElement("a");
    if (href) dom.setAttribute("href", href);
    if (attrs.title) dom.setAttribute("title", attrs.title);
    dom.style.cssText = "color:var(--primary,#6366f1);cursor:pointer;";
    dom.addEventListener("click", (e) => {
      // Prevent actual browser navigation inside the webview.
      e.preventDefault();
    });

    return { dom, contentDOM: dom };
  };
}

/**
 * Milkdown plugin that installs the issue-mention and user-mention link mark views.
 *
 * Add this to the editor's plugin list AFTER `commonmark` (which registers
 * `linkSchema`). The plugin overrides only the DOM rendering of link marks;
 * the commonmark schema + serializer are untouched, so `[ID](url)` round-trips
 * unchanged through `roundtripMarkdown`.
 *
 * Designed to be added per-drawer (Task 6): the callbacks `resolveMention`,
 * `onActivateLink`, and optional `resolveUser` are closed over at construction
 * time and are not hardcoded into `descriptionPlugins`.
 */
export function descriptionMentionPlugin(
  resolveMention: MentionResolver,
  onActivateLink: (href: string) => void,
  resolveUser?: (id: string) => { name: string } | undefined,
): MilkdownPlugin[] {
  const mentionLinkView = $view(linkSchema.mark, (_ctx) =>
    makeLinkMarkView(resolveMention, onActivateLink, resolveUser),
  );
  return [mentionLinkView];
}
