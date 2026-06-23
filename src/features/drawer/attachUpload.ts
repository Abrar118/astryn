// Native file picker → Rust upload → insert the result into a Milkdown editor.
// The picker AND the file read happen in Rust; no path crosses the webview, so
// only files the user selected this call are read. We embed the returned asset
// URL as markdown.
import { gooeyToast } from "goey-toast";
import type { EditorView } from "@milkdown/kit/prose/view";
import { errorText, uploadFiles, type UploadedAsset } from "@/lib/commands";

/** Open the native picker (in Rust), upload the chosen files, return the assets. */
export async function pickAndUploadFiles(): Promise<UploadedAsset[]> {
  let outcome: { assets: UploadedAsset[]; skipped: number };
  try {
    outcome = await uploadFiles();
  } catch (err) {
    gooeyToast.error("Couldn't attach file", { description: errorText(err) });
    return [];
  }
  const { assets, skipped } = outcome;
  if (assets.length > 0) {
    gooeyToast.success(assets.length === 1 ? "File attached" : `${assets.length} files attached`);
  }
  // Some selected files failed (too large, unreadable, …) while others succeeded.
  if (skipped > 0) {
    gooeyToast.warning(skipped === 1 ? "1 file was skipped" : `${skipped} files were skipped`);
  }
  return assets;
}

/** Format a byte count like Linear ("8.14 KB"). Empty string for 0/unknown. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 ? value : value.toFixed(2)} ${units[i]}`;
}

/** Insert uploaded assets at the editor's selection: images as image nodes, other
 *  files as a link carrying the filename. Re-reads state per asset so several
 *  chain correctly (separated by a space), then restores focus.
 *
 *  Guards the selection context: if the cursor is somewhere the node isn't valid
 *  (a code block, etc.), the asset is dropped into a new paragraph after the
 *  enclosing block instead of producing an invalid transaction. */
export function insertAssetsIntoView(view: EditorView, assets: UploadedAsset[]): void {
  for (const a of assets) {
    const { state } = view;
    const { schema } = state;
    // For files, carry the human-readable size in the link title so the read-only
    // renderer can show it on the file card (round-trips through saved markdown).
    const node =
      a.isImage && schema.nodes.image
        ? schema.nodes.image.create({ src: a.url, alt: a.filename })
        : schema.text(
            a.filename,
            schema.marks.link ? [schema.marks.link.create({ href: a.url, title: formatBytes(a.size) })] : undefined,
          );
    const { $from, from, to } = state.selection;
    const parent = $from.parent;
    const canInline =
      parent.inlineContent &&
      !parent.type.spec.code &&
      parent.canReplaceWith($from.index(), $from.index(), node.type);
    if (canInline) {
      view.dispatch(state.tr.replaceWith(from, to, [node, schema.text(" ")]).scrollIntoView());
    } else if (schema.nodes.paragraph) {
      const pos = $from.after($from.depth);
      view.dispatch(state.tr.insert(pos, schema.nodes.paragraph.create(null, node)).scrollIntoView());
    }
  }
  if (assets.length > 0) view.focus();
}
