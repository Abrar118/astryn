export type PrDiffRowKind =
  | "hunk"
  | "context"
  | "addition"
  | "deletion"
  | "metadata";

export type PrDiffRow = {
  key: string;
  kind: PrDiffRowKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedPatch(patch: string): PrDiffRow[] {
  if (!patch) return [];
  const lines = patch.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let oldLine = 0;
  let newLine = 0;

  return lines.map((line, index) => {
    const hunk = line.match(HUNK_HEADER);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return {
        key: `${index}-hunk`,
        kind: "hunk",
        oldLine: null,
        newLine: null,
        text: line,
      };
    }
    if (line.startsWith("+")) {
      const row = {
        key: `${index}-addition`,
        kind: "addition" as const,
        oldLine: null,
        newLine,
        text: line.slice(1),
      };
      newLine += 1;
      return row;
    }
    if (line.startsWith("-")) {
      const row = {
        key: `${index}-deletion`,
        kind: "deletion" as const,
        oldLine,
        newLine: null,
        text: line.slice(1),
      };
      oldLine += 1;
      return row;
    }
    if (line.startsWith(" ")) {
      const row = {
        key: `${index}-context`,
        kind: "context" as const,
        oldLine,
        newLine,
        text: line.slice(1),
      };
      oldLine += 1;
      newLine += 1;
      return row;
    }
    return {
      key: `${index}-metadata`,
      kind: "metadata",
      oldLine: null,
      newLine: null,
      text: line,
    };
  });
}

/**
 * Replace long runs of unchanged context with a single collapsed marker,
 * keeping `padding` rows of context on each side of every change.
 *
 * Large patches are mostly context; rendering all of it pushes the actual
 * change off screen and makes the virtualized list do needless work.
 */
export function collapseContext(rows: PrDiffRow[], padding = 3): PrDiffRow[] {
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.kind === "context") return;
    for (let near = index - padding; near <= index + padding; near += 1) {
      if (near >= 0 && near < rows.length) keep.add(near);
    }
  });

  const marker = (key: string, hidden: number): PrDiffRow => ({
    key,
    kind: "metadata",
    oldLine: null,
    newLine: null,
    text: `\u22ef ${hidden} unchanged ${hidden === 1 ? "line" : "lines"}`,
  });

  const out: PrDiffRow[] = [];
  let hidden = 0;
  rows.forEach((row, index) => {
    if (!keep.has(index)) {
      hidden += 1;
      return;
    }
    if (hidden > 0) {
      out.push(marker(`${index}-collapsed`, hidden));
      hidden = 0;
    }
    out.push(row);
  });
  if (hidden > 0) out.push(marker(`${rows.length}-collapsed`, hidden));

  return out;
}
