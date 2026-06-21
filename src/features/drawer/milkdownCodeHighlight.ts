import { createElement, Fragment, type ReactNode } from "react";
import { createLowlight, common } from "lowlight";

const lowlight = createLowlight(common);

/**
 * Fence-language aliases → highlight.js grammar names. `mermaid` is excluded
 * on purpose (it renders as a diagram, not highlighted code).
 */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  js: "javascript",
  jsx: "javascript",
  javascript: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  rs: "rust",
  rust: "rust",
  py: "python",
  python: "python",
  json: "json",
  html: "xml",
  xml: "xml",
  css: "css",
  md: "markdown",
  markdown: "markdown",
  sql: "sql",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  toml: "ini",
  diff: "diff",
};

/** Resolve a fence language/alias to a registered grammar, or null. */
export function resolveLanguage(lang: string | undefined): string | null {
  if (!lang) return null;
  const key = lang.trim().toLowerCase();
  if (!key || key === "mermaid") return null;
  const grammar = ALIASES[key] ?? key;
  return lowlight.registered(grammar) ? grammar : null;
}

/** hast node shapes lowlight emits (narrowed locally to avoid a hast dep). */
type HastText = { type: "text"; value: string };
type HastElement = {
  type: "element";
  tagName: string;
  properties?: { className?: string[] | string };
  children: (HastText | HastElement)[];
};
type HastNode = HastText | HastElement;

function renderNodes(nodes: HastNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === "text") return node.value;
    const className = Array.isArray(node.properties?.className)
      ? node.properties?.className.join(" ")
      : node.properties?.className;
    return createElement(
      node.tagName,
      { key, className },
      ...renderNodes(node.children, key),
    );
  });
}

/**
 * Highlight `code` for `lang` into React elements built from lowlight tokens.
 * Falls back to plain text for unsupported languages or on any failure — never
 * throws, never injects raw HTML.
 */
export function highlightToReact(code: string, lang: string | undefined): ReactNode {
  const grammar = resolveLanguage(lang);
  if (!grammar) return code;
  try {
    const tree = lowlight.highlight(grammar, code) as { children: HastNode[] };
    return createElement(Fragment, null, ...renderNodes(tree.children, "hl"));
  } catch {
    return code;
  }
}
