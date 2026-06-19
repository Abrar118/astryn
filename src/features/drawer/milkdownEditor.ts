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
import type { Ctx } from "@milkdown/ctx";
import type { NodeSchema } from "@milkdown/transformer";
import { descriptionImageView } from "./milkdownImageNode";

/**
 * Plugins shared by the live editor and the headless round-trip helper.
 * `descriptionImageView` overrides only the DOM rendering of image nodes;
 * the commonmark schema + markdown serializer are unchanged, so the original
 * URL round-trips correctly in `roundtripMarkdown` (which uses commonmark+gfm
 * directly and does not instantiate node views in headless mode).
 */
export const descriptionPlugins: unknown[] = [
  commonmark,
  gfm,
  descriptionImageView,
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
