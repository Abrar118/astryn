import {
  Editor,
  rootCtx,
  defaultValueCtx,
  serializerCtx,
  editorViewCtx,
  remarkStringifyOptionsCtx,
} from "@milkdown/kit/core";
import {
  commonmark,
  imageSchema,
  bulletListSchema,
  orderedListSchema,
  listItemSchema,
} from "@milkdown/kit/preset/commonmark";
import { gfm, extendListItemSchemaForTask } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import type { Ctx } from "@milkdown/ctx";
import type { NodeSchema } from "@milkdown/transformer";
import { descriptionImageView } from "./milkdownImageNode";
import { descriptionCodeBlockView } from "./milkdownCodeBlock";
import {
  descriptionSlash,
  descriptionTooltip,
} from "./milkdownMenus";

/**
 * Plugins shared by the live editor and the headless round-trip helper.
 * `descriptionImageView` overrides only the DOM rendering of image nodes;
 * the commonmark schema + markdown serializer are unchanged, so the original
 * URL round-trips correctly in `roundtripMarkdown` (which uses commonmark+gfm
 * directly and does not instantiate node views in headless mode).
 *
 * `descriptionSlash` and `descriptionTooltip` are UI-only plugins; they have
 * no effect in headless mode (no DOM, no view instantiation) so they are safe
 * to include here without affecting `roundtripMarkdown`.
 *
 * `descriptionCodeBlockView` renders a read-only `mermaid` block as a diagram
 * (and leaves the editable `<pre><code>` untouched otherwise); like the image
 * view it overrides only DOM rendering, so the markdown round-trips unchanged.
 *
 * NOTE: `descriptionPreviewView` (standalone bare-URL preview cards) is NOT in
 * this shared list. By design it is registered ONLY on the read-only display
 * editor (see DescriptionEditor's `.use(editable ? [] : …)`): previews are a
 * display affordance, and keeping the editable instance on stock paragraphs
 * avoids re-rendering/re-fetching the embed on every keystroke while a URL is
 * being typed.
 */
export const descriptionPlugins: unknown[] = [
  commonmark,
  gfm,
  history, // undo/redo (cmd/ctrl+z, shift+cmd/ctrl+z) — not in the commonmark preset
  descriptionImageView,
  descriptionCodeBlockView,
  ...descriptionSlash,
  ...descriptionTooltip,
];

/**
 * Patch a schema factory so that the `spread` attribute runner coerces
 * the remark AST node's `spread` value to a real boolean before storing it.
 * The commonmark preset parsers stringify spread to "true"/"false" instead of
 * passing the boolean directly, which causes doc.check() to throw when the
 * schema attr has `validate: "boolean"`.
 */
function patchSpreadRunner(
  prev: (ctx: Ctx) => NodeSchema,
): (ctx: Ctx) => NodeSchema {
  return (ctx) => {
    const spec = prev(ctx);
    return {
      ...spec,
      parseMarkdown: {
        ...spec.parseMarkdown,
        runner: (state, node, type) => {
          const spread = node.spread === true || node.spread === "true";
          state.openNode(type, { spread }).next(node.children as never).closeNode();
        },
      },
    };
  };
}

/**
 * Patch the task-list-item schema factory (GFM extension of listItemSchema)
 * so that both regular and task list items coerce `spread` to boolean.
 * The GFM runner delegates to the base runner for non-task items — which has
 * the same string-spread bug — so we replace both paths here.
 */
function patchTaskListItemRunner(
  prev: (ctx: Ctx) => NodeSchema,
): (ctx: Ctx) => NodeSchema {
  return (ctx) => {
    const spec = prev(ctx);
    return {
      ...spec,
      parseMarkdown: {
        ...spec.parseMarkdown,
        runner: (state, node, type) => {
          const label = node.label != null ? `${node.label as string}.` : "•";
          const listType = node.label != null ? "ordered" : "bullet";
          const spread = node.spread === true || node.spread === "true";
          const checked =
            node.checked != null ? Boolean(node.checked) : null;
          state.openNode(type, { label, listType, spread, checked });
          state.next(node.children as never);
          state.closeNode();
        },
      },
    };
  };
}

/**
 * Patch the orderedListSchema parseDOM + toMarkdown runner.
 *
 * parseDOM bug: the native Milkdown orderedListSchema.parseDOM returns
 * `{ spread: dom.dataset.spread }` — a raw string ("true", "false", or
 * undefined) — but the schema attr has `validate: "boolean"`, so
 * doc.check() throws for DOM-parsed (pasted) content.
 * Fix: normalize to `dom.dataset.spread === "true"` (boolean) here.
 *
 * toMarkdown bug: the native runner does `spread: node.attrs.spread === "true"`
 * (string compare). When our parseMarkdown runner correctly stores a real
 * boolean, this always yields false — loose ordered lists collapse to tight.
 * Fix: use `spread === true || spread === "true"` to accept both forms.
 */
function patchOrderedListToMarkdown(
  prev: (ctx: Ctx) => NodeSchema,
): (ctx: Ctx) => NodeSchema {
  return (ctx) => {
    const spec = prev(ctx);
    return {
      ...spec,
      parseDOM: spec.parseDOM?.map((rule) => ({
        ...rule,
        getAttrs: (dom: HTMLElement | string): false | Record<string, unknown> | null => {
          const base = rule.getAttrs?.(dom as never);
          // false = reject this rule; null = accept with no attrs; undefined = no getAttrs
          if (base === false) return false;
          if (base == null || typeof base !== "object") return null;
          const raw = (base as Record<string, unknown>).spread;
          return {
            ...(base as Record<string, unknown>),
            spread: raw === true || raw === "true",
          };
        },
      })),
      toMarkdown: {
        ...spec.toMarkdown,
        runner: (state, node) => {
          const spread =
            node.attrs.spread === true || node.attrs.spread === "true";
          state
            .openNode("list", undefined, {
              ordered: true,
              start: (node.attrs.order as number | undefined) ?? 1,
              spread,
            })
            .next(node.content as never)
            .closeNode();
        },
      },
    };
  };
}

/**
 * Patch the task-list-item parseDOM + toMarkdown runner.
 *
 * parseDOM bug: the GFM extendListItemSchemaForTask parseDOM entry for
 * `<li data-item-type="task">` returns `{ spread: dom.dataset.spread }` — a
 * raw string — but the schema attr has `validate: "boolean"`, so doc.check()
 * throws for DOM-parsed (pasted) task list items.
 * Fix: normalize spread to a boolean in every parseDOM rule.
 *
 * toMarkdown bug: the native task-item runner uses `spread === "true"` (string
 * compare) and our stored value is a real boolean after the parseMarkdown fix,
 * so it always yields false. Fix: accept both true and "true".
 */
function patchTaskListItemToMarkdown(
  prev: (ctx: Ctx) => NodeSchema,
): (ctx: Ctx) => NodeSchema {
  return (ctx) => {
    const spec = prev(ctx);
    const baseToMarkdown = spec.toMarkdown;
    return {
      ...spec,
      parseDOM: spec.parseDOM?.map((rule) => ({
        ...rule,
        getAttrs: (dom: HTMLElement | string): false | Record<string, unknown> | null => {
          const base = rule.getAttrs?.(dom as never);
          if (base === false) return false;
          if (base == null || typeof base !== "object") return null;
          const raw = (base as Record<string, unknown>).spread;
          return {
            ...(base as Record<string, unknown>),
            spread: raw === true || raw === "true",
          };
        },
      })),
      toMarkdown: {
        ...baseToMarkdown,
        runner: (state, node) => {
          if ((node.attrs.checked as boolean | null) == null) {
            // Non-task items: delegate to the underlying listItem toMarkdown runner
            baseToMarkdown.runner(state, node);
            return;
          }
          const spread =
            node.attrs.spread === true || node.attrs.spread === "true";
          state
            .openNode("listItem", undefined, {
              label: node.attrs.label as string,
              listType: node.attrs.listType as string,
              spread,
              checked: node.attrs.checked as boolean | null,
            })
            .next(node.content as never)
            .closeNode();
        },
      },
    };
  };
}

/**
 * Apply remark stringify options + node-attr fixes to the editor context.
 *
 * Stringify options: bullet "-", emphasis "*", strong "*" (= double-asterisk),
 * fenced code, horizontal rule "-", no setext headings — matches Linear's
 * Markdown style and ensures idempotent round-trips.
 *
 * Node-attr fixes so doc.check() accepts parsed content:
 * - image.title: parser emits null when no title; schema expected "string" →
 *   change validate to "string|null" and default to null.
 * - bullet_list.spread, ordered_list.spread, list_item.spread,
 *   task list item spread: parsers stringify the boolean to "true"/"false"
 *   before storing it; patch their parseMarkdown runners to coerce to boolean.
 * - ordered_list.parseDOM, task list_item.parseDOM: the native Milkdown rules
 *   return raw `dom.dataset.spread` (a string) instead of a boolean; patch to
 *   normalize to boolean so doc.check() passes for DOM-parsed (pasted) content.
 * - ordered_list.toMarkdown, task list_item.toMarkdown: the default serializer
 *   uses `spread === "true"` (string compare) which fails for our stored boolean;
 *   patch to accept `=== true || === "true"` so loose lists stay loose on save.
 */
export function applyDescriptionConfig(ctx: Ctx): void {
  // --- Remark stringify options ---
  // `strong` takes the marker character ('*' or '_'), not '**'.
  ctx.set(remarkStringifyOptionsCtx, {
    bullet: "-",
    emphasis: "*",
    strong: "*",
    fence: "`",
    fences: true,
    rule: "-",
    setext: false,
  });

  // --- Fix image.title: accept null (parser emits null when title is absent) ---
  ctx.update(imageSchema.key, (prev) => (ctx2) => {
    const spec = prev(ctx2);
    return {
      ...spec,
      attrs: {
        ...spec.attrs,
        title: {
          default: null,
          validate: "string|null",
        },
      },
    };
  });

  // --- Fix spread attrs: coerce string to boolean in parseMarkdown runners ---
  ctx.update(bulletListSchema.key, (prev) => patchSpreadRunner(prev));
  ctx.update(orderedListSchema.key, (prev) => patchSpreadRunner(prev));
  ctx.update(listItemSchema.key, (prev) => patchSpreadRunner(prev));
  ctx.update(
    extendListItemSchemaForTask.key,
    (prev) => patchTaskListItemRunner(prev),
  );

  // --- Fix spread serialization + DOM parsing for ordered/task lists.
  //     toMarkdown: treat spread loose only when `=== true || === "true"` (NOT
  //     Boolean(), since Boolean("false") is true → would force loose).
  //     parseDOM: ordered_list stores a raw string spread; normalize to boolean
  //     so a pasted tight list passes doc.check() and stays tight. ---
  ctx.update(orderedListSchema.key, (prev) => patchOrderedListToMarkdown(prev));
  ctx.update(
    extendListItemSchemaForTask.key,
    (prev) => patchTaskListItemToMarkdown(prev),
  );
}

/**
 * Build a headless editor, parse the given Markdown into a ProseMirror doc,
 * validate the doc, serialize back to Markdown, and return the result.
 *
 * Returns `{ markdown, valid: true }` when doc.check() passes, or
 * `{ markdown, valid: false, error }` with the validation error message.
 */
export async function roundtripMarkdown(
  markdown: string,
): Promise<{ markdown: string; valid: boolean; error?: string }> {
  const root = document.createElement("div");
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      applyDescriptionConfig(ctx);
    })
    .use(commonmark)
    .use(gfm)
    .create();

  let out = "";
  let valid = false;
  let error: string | undefined;

  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    try {
      view.state.doc.check();
      valid = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    out = ctx.get(serializerCtx)(view.state.doc);
  });

  await editor.destroy();
  return { markdown: out.trimEnd(), valid, error };
}
