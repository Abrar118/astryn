import {
  wrapInHeadingCommand,
  turnIntoTextCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  insertHrCommand,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  insertTableCommand,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";
import type { Ctx } from "@milkdown/kit/ctx";
import { callCommand } from "@milkdown/kit/utils";
import {
  SlashProvider,
  slashFactory,
} from "@milkdown/kit/plugin/slash";
import {
  TooltipProvider,
  tooltipFactory,
} from "@milkdown/kit/plugin/tooltip";
import type { EditorState, PluginView } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { editorViewCtx } from "@milkdown/kit/core";
import { findParentNode } from "@milkdown/prose";
import { selectionUrlKind, runPreviewToggle, togglePreviewLabel } from "./previewToggle";

// ---------------------------------------------------------------------------
// Slash command catalog
// ---------------------------------------------------------------------------

export type SlashCommand = {
  id: string;
  label: string;
  keywords: string;
  run: (ctx: Ctx) => void;
};

/**
 * After wrapping in a bullet list, find the enclosing list_item node and set
 * its `checked` attribute to `false` so GFM serializes it as `- [ ]`.
 */
function applyTaskListChecked(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const found = findParentNode(
    (node) => node.type.name === "list_item",
  )(state.selection);
  if (!found) return;
  const { pos, node } = found;
  const tr = state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    checked: false,
  });
  view.dispatch(tr);
}

export const slashCommands: SlashCommand[] = [
  {
    id: "text",
    label: "Text",
    keywords: "paragraph plain",
    run: (ctx) => {
      callCommand(turnIntoTextCommand.key)(ctx);
    },
  },
  {
    id: "h1",
    label: "Heading 1",
    keywords: "head header h1 h2 h3",
    run: (ctx) => {
      callCommand(wrapInHeadingCommand.key, 1)(ctx);
    },
  },
  {
    id: "h2",
    label: "Heading 2",
    keywords: "head header h1 h2 h3",
    run: (ctx) => {
      callCommand(wrapInHeadingCommand.key, 2)(ctx);
    },
  },
  {
    id: "h3",
    label: "Heading 3",
    keywords: "head header h1 h2 h3",
    run: (ctx) => {
      callCommand(wrapInHeadingCommand.key, 3)(ctx);
    },
  },
  {
    id: "bullet",
    label: "Bullet List",
    keywords: "list unordered ul",
    run: (ctx) => {
      callCommand(wrapInBulletListCommand.key)(ctx);
    },
  },
  {
    id: "ordered",
    label: "Ordered List",
    keywords: "list numbered ol",
    run: (ctx) => {
      callCommand(wrapInOrderedListCommand.key)(ctx);
    },
  },
  {
    id: "task",
    label: "Task List",
    keywords: "todo checklist checkbox task",
    run: (ctx) => {
      // Create a bullet list first, then set checked: false on the list_item
      // so GFM serializes it as `- [ ] …` (a real task-list item).
      callCommand(wrapInBulletListCommand.key)(ctx);
      applyTaskListChecked(ctx);
    },
  },
  {
    id: "quote",
    label: "Quote",
    keywords: "blockquote citation",
    run: (ctx) => {
      callCommand(wrapInBlockquoteCommand.key)(ctx);
    },
  },
  {
    id: "code",
    label: "Code Block",
    keywords: "codeblock fence pre",
    run: (ctx) => {
      callCommand(createCodeBlockCommand.key)(ctx);
    },
  },
  {
    id: "divider",
    label: "Divider",
    keywords: "hr horizontal rule line separator",
    run: (ctx) => {
      callCommand(insertHrCommand.key)(ctx);
    },
  },
  {
    id: "table",
    label: "Table",
    keywords: "grid columns rows",
    run: (ctx) => {
      callCommand(insertTableCommand.key, { row: 3, col: 3 })(ctx);
    },
  },
];

/**
 * Pure, case-insensitive filter over `label + " " + keywords`.
 */
export function filterSlashCommands(query: string): SlashCommand[] {
  if (!query) return slashCommands;
  const q = query.toLowerCase();
  return slashCommands.filter((cmd) =>
    `${cmd.label} ${cmd.keywords}`.toLowerCase().includes(q),
  );
}

// ---------------------------------------------------------------------------
// Inline (tooltip) command catalog
// ---------------------------------------------------------------------------

export type InlineCommand = {
  id: string;
  label: string;
  run: (ctx: Ctx) => void;
};

export const inlineCommands: InlineCommand[] = [
  {
    id: "bold",
    label: "Bold",
    run: (ctx) => {
      callCommand(toggleStrongCommand.key)(ctx);
    },
  },
  {
    id: "italic",
    label: "Italic",
    run: (ctx) => {
      callCommand(toggleEmphasisCommand.key)(ctx);
    },
  },
  {
    id: "strike",
    label: "Strikethrough",
    run: (ctx) => {
      callCommand(toggleStrikethroughCommand.key)(ctx);
    },
  },
  {
    id: "code",
    label: "Inline Code",
    run: (ctx) => {
      callCommand(toggleInlineCodeCommand.key)(ctx);
    },
  },
  {
    id: "link",
    label: "Link",
    run: (ctx) => {
      callCommand(toggleLinkCommand.key, { href: "" })(ctx);
    },
  },
];

// ---------------------------------------------------------------------------
// Slash plugin — plain DOM view using SlashProvider
// ---------------------------------------------------------------------------

export const descriptionSlash = slashFactory("DESCRIPTION_SLASH");

class SlashView implements PluginView {
  readonly #content: HTMLElement;
  readonly #list: HTMLElement;
  readonly #provider: SlashProvider;
  readonly #ctx: Ctx;
  #selectedIndex = 0;
  #filtered: SlashCommand[] = [];
  #isOpen = false;
  /** Absolute document position of the leading `/` character. -1 when unknown. */
  #triggerFrom = -1;

  constructor(ctx: Ctx, view: EditorView) {
    this.#ctx = ctx;

    const wrapper = document.createElement("div");
    wrapper.className = "md-slash-menu";
    wrapper.setAttribute("data-md-menu", "");
    wrapper.style.display = "none";

    const list = document.createElement("ul");
    list.style.cssText = "list-style:none;margin:0;padding:0;";
    wrapper.appendChild(list);
    this.#list = list;
    this.#content = wrapper;
    document.body.appendChild(wrapper);

    // oxlint-disable-next-line ts/no-this-alias
    const self = this;

    this.#provider = new SlashProvider({
      content: this.#content,
      debounce: 50,
      shouldShow(this: SlashProvider, v: EditorView) {
        const text = this.getContent(v, (node) =>
          ["paragraph"].includes(node.type.name),
        );
        if (text == null) return false;
        if (!text.startsWith("/")) return false;
        const query = text.slice(1);
        const filtered = filterSlashCommands(query);
        if (filtered.length === 0) return false;
        // Record the absolute position of the `/` trigger character.
        // getContent returns the text from paragraph start up to the cursor,
        // so the `/` sits at (cursor pos) - (text length).
        const { $from } = v.state.selection;
        self.#triggerFrom = $from.pos - text.length;
        self.#filtered = filtered;
        self.#selectedIndex = 0;
        self.#render();
        return true;
      },
      offset: 8,
    });

    this.#provider.onShow = () => {
      this.#isOpen = true;
      this.#content.style.display = "block";
    };
    this.#provider.onHide = () => {
      this.#isOpen = false;
      this.#content.style.display = "none";
      this.#triggerFrom = -1;
    };

    this.update(view);
  }

  /**
   * Called from the plugin's `props.handleKeyDown` while the slash menu is
   * open. Returns `true` when the key is consumed (preventing ProseMirror
   * from handling it), `false` otherwise.
   */
  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.#isOpen || this.#filtered.length === 0) return false;
    if (e.key === "ArrowDown") {
      this.#selectedIndex = Math.min(
        this.#selectedIndex + 1,
        this.#filtered.length - 1,
      );
      this.#render();
      return true;
    }
    if (e.key === "ArrowUp") {
      this.#selectedIndex = Math.max(this.#selectedIndex - 1, 0);
      this.#render();
      return true;
    }
    if (e.key === "Enter") {
      const cmd = this.#filtered[this.#selectedIndex];
      if (cmd) this.#run(cmd);
      return true;
    }
    if (e.key === "Escape") {
      this.#provider.hide();
      return true;
    }
    return false;
  }

  #render() {
    this.#list.innerHTML = "";
    this.#filtered.forEach((cmd, i) => {
      const li = document.createElement("li");
      li.setAttribute("data-id", cmd.id);
      if (i === this.#selectedIndex) {
        li.setAttribute("data-selected", "true");
      }
      li.textContent = cmd.label;
      li.addEventListener("mouseenter", () => {
        this.#selectedIndex = i;
        this.#render();
      });
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.#run(cmd);
      });
      this.#list.appendChild(li);
    });
  }

  /**
   * Delete the `/query` trigger text from the document then execute the
   * command. The trigger range is from `#triggerFrom` (the `/`) to the
   * current cursor position, which covers `/` + whatever query the user typed.
   */
  #run(cmd: SlashCommand) {
    const view = this.#ctx.get(editorViewCtx);
    const { state } = view;
    const cursorPos = state.selection.from;
    // Delete from the `/` position to the cursor before running the command
    // so the trigger text doesn't end up in the document (e.g. `- [ ] /task`).
    if (this.#triggerFrom >= 0 && this.#triggerFrom < cursorPos) {
      const tr = state.tr.delete(this.#triggerFrom, cursorPos);
      view.dispatch(tr);
    }
    cmd.run(this.#ctx);
    this.#provider.hide();
  }

  update = (view: EditorView, prevState?: EditorState) => {
    this.#provider.update(view, prevState);
  };

  destroy = () => {
    this.#provider.destroy();
    this.#content.remove();
  };
}

// Wire the spec: the view factory is set on the ctx key before the plugin runs.
// Consumers must call `ctx.set(descriptionSlash.key, { view: (view) => new SlashView(ctx, view) })`
// via an `editor.config(...)` callback. We export a helper that does this.
export function configureDescriptionSlash(ctx: Ctx) {
  // Keep a reference to the current SlashView instance so the plugin's
  // handleKeyDown prop can delegate to it. The view is created/replaced on
  // each call to the view factory.
  let currentSlashView: SlashView | null = null;

  ctx.set(descriptionSlash.key, {
    view: (editorView) => {
      currentSlashView = new SlashView(ctx, editorView);
      return currentSlashView;
    },
    props: {
      handleKeyDown(_editorView: EditorView, event: KeyboardEvent): boolean {
        return currentSlashView?.handleKeyDown(event) ?? false;
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tooltip plugin — plain DOM view using TooltipProvider
// ---------------------------------------------------------------------------

export const descriptionTooltip = tooltipFactory("DESCRIPTION_TOOLTIP");

class TooltipView implements PluginView {
  readonly #content: HTMLElement;
  readonly #buttons: HTMLElement;
  readonly #linkInput: HTMLInputElement;
  readonly #provider: TooltipProvider;
  readonly #ctx: Ctx;
  readonly #toggleBtn: HTMLButtonElement;

  constructor(ctx: Ctx, view: EditorView) {
    this.#ctx = ctx;

    const wrapper = document.createElement("div");
    wrapper.className = "md-tooltip";
    wrapper.setAttribute("data-md-menu", "");
    wrapper.style.display = "none";

    // Button row
    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;flex-direction:row;align-items:center;gap:2px;";

    for (const cmd of inlineCommands) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", cmd.label);
      btn.title = cmd.label;
      btn.textContent = cmd.label.slice(0, 1);
      if (cmd.id === "link") {
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.#showLinkInput();
        });
      } else {
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          cmd.run(this.#ctx);
        });
      }
      buttons.appendChild(btn);
    }

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "md-tooltip-preview-toggle";
    toggleBtn.style.display = "none";
    toggleBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      runPreviewToggle(this.#ctx);
      this.#provider.hide();
      this.#refocusEditor();
    });
    buttons.appendChild(toggleBtn);
    this.#toggleBtn = toggleBtn;

    wrapper.appendChild(buttons);
    this.#buttons = buttons;

    // Link URL input (hidden by default)
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Paste or type a URL…";
    input.style.display = "none";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.#applyLink(input.value.trim());
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.#hideLinkInput();
        this.#provider.hide();
        // Return focus to the editor so the edit session continues normally.
        this.#refocusEditor();
      }
    });
    // Prevent tooltip from hiding when input is focused
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    wrapper.appendChild(input);
    this.#linkInput = input;

    this.#content = wrapper;
    document.body.appendChild(wrapper);

    this.#provider = new TooltipProvider({
      content: this.#content,
      debounce: 50,
      shouldShow: (v: EditorView) => {
        if (!v.editable) return false;
        const { selection } = v.state;
        if (selection instanceof TextSelection && !selection.empty) return true;
        // Also show for a caret inside a standalone-URL paragraph (toggle only).
        return selectionUrlKind(v) !== "none";
      },
      offset: 8,
    });

    this.#provider.onShow = () => {
      this.#content.style.display = "flex";
    };
    this.#provider.onHide = () => {
      this.#content.style.display = "none";
      this.#hideLinkInput();
    };

    this.update(view);
  }

  #showLinkInput() {
    this.#buttons.style.display = "none";
    this.#linkInput.value = "";
    this.#linkInput.style.display = "block";
    this.#linkInput.focus();
  }

  #hideLinkInput() {
    this.#linkInput.style.display = "none";
    this.#buttons.style.display = "flex";
  }

  /** Refocus the ProseMirror editor so a real subsequent blur behaves normally. */
  #refocusEditor() {
    try {
      this.#ctx.get(editorViewCtx).focus();
    } catch {
      // Editor may have been destroyed; silently ignore.
    }
  }

  #applyLink(href: string) {
    if (href) {
      callCommand(toggleLinkCommand.key, { href })(this.#ctx);
    } else {
      // Empty URL: toggle off the existing link mark (removeMark via toggleMark)
      callCommand(toggleLinkCommand.key)(this.#ctx);
    }
    this.#hideLinkInput();
    this.#provider.hide();
    // Return focus to the editor so a subsequent real blur triggers handleBlur
    // correctly instead of leaving focus orphaned in the (now-hidden) input.
    this.#refocusEditor();
  }

  update = (view: EditorView, prevState?: EditorState) => {
    // Use the view ProseMirror passes (always valid); never re-fetch from ctx
    // here — it can be undefined mid-update and throwing breaks editing. The
    // toggle only applies while editable.
    const kind = view.editable ? selectionUrlKind(view) : "none";
    const label = togglePreviewLabel(kind);
    if (label) {
      this.#toggleBtn.textContent = label;
      this.#toggleBtn.style.display = "inline-block";
    } else {
      this.#toggleBtn.style.display = "none";
    }
    this.#provider.update(view, prevState);
  };

  destroy = () => {
    this.#provider.destroy();
    this.#content.remove();
  };
}

export function configureDescriptionTooltip(ctx: Ctx) {
  ctx.set(descriptionTooltip.key, {
    view: (view) => new TooltipView(ctx, view),
  });
}
