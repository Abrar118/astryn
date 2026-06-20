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
import type { PluginView } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

// ---------------------------------------------------------------------------
// Slash command catalog
// ---------------------------------------------------------------------------

export type SlashCommand = {
  id: string;
  label: string;
  keywords: string;
  run: (ctx: Ctx) => void;
};

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
      // GFM task lists use the bullet list command + the input-rule trigger.
      // There is no standalone insertTaskListCommand in the preset; the standard
      // approach is to wrap in a bullet list then let the user apply the
      // checkbox via input rule. For slash-menu purposes we wrap in bullet list.
      callCommand(wrapInBulletListCommand.key)(ctx);
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
  #query = "";

  constructor(ctx: Ctx, view: EditorView) {
    this.#ctx = ctx;

    const wrapper = document.createElement("div");
    wrapper.className = "md-slash-menu";
    wrapper.style.cssText =
      "background:#1e1e2e;border:1px solid #3b3b5c;border-radius:6px;" +
      "padding:4px 0;min-width:180px;max-height:280px;overflow-y:auto;" +
      "box-shadow:0 4px 12px rgba(0,0,0,.5);z-index:9999;display:none;";

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
        self.#query = text.slice(1);
        self.#filtered = filterSlashCommands(self.#query);
        self.#selectedIndex = 0;
        self.#render();
        return self.#filtered.length > 0;
      },
      offset: 8,
    });

    this.#provider.onShow = () => {
      this.#content.style.display = "block";
    };
    this.#provider.onHide = () => {
      this.#content.style.display = "none";
    };

    wrapper.addEventListener("keydown", this.#onKeyDown);
    this.update(view);
  }

  #render() {
    this.#list.innerHTML = "";
    this.#filtered.forEach((cmd, i) => {
      const li = document.createElement("li");
      li.setAttribute("data-id", cmd.id);
      li.style.cssText =
        "padding:6px 12px;cursor:pointer;font-size:13px;color:#e0e0ff;" +
        (i === this.#selectedIndex ? "background:#2d2d50;" : "");
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

  #run(cmd: SlashCommand) {
    cmd.run(this.#ctx);
    this.#provider.hide();
  }

  #onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.#selectedIndex = Math.min(
        this.#selectedIndex + 1,
        this.#filtered.length - 1,
      );
      this.#render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.#selectedIndex = Math.max(this.#selectedIndex - 1, 0);
      this.#render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = this.#filtered[this.#selectedIndex];
      if (cmd) this.#run(cmd);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.#provider.hide();
    }
  };

  update = (view: EditorView) => {
    this.#provider.update(view);
  };

  destroy = () => {
    this.#provider.destroy();
    this.#content.removeEventListener("keydown", this.#onKeyDown);
    this.#content.remove();
  };
}

// Wire the spec: the view factory is set on the ctx key before the plugin runs.
// Consumers must call `ctx.set(descriptionSlash.key, { view: (view) => new SlashView(ctx, view) })`
// via an `editor.config(...)` callback. We export a helper that does this.
export function configureDescriptionSlash(ctx: Ctx) {
  ctx.set(descriptionSlash.key, {
    view: (view) => new SlashView(ctx, view),
  });
}

// ---------------------------------------------------------------------------
// Tooltip plugin — plain DOM view using TooltipProvider
// ---------------------------------------------------------------------------

export const descriptionTooltip = tooltipFactory("DESCRIPTION_TOOLTIP");

class TooltipView implements PluginView {
  readonly #content: HTMLElement;
  readonly #provider: TooltipProvider;
  readonly #ctx: Ctx;

  constructor(ctx: Ctx, view: EditorView) {
    this.#ctx = ctx;

    const wrapper = document.createElement("div");
    wrapper.className = "md-tooltip";
    wrapper.style.cssText =
      "display:none;background:#1e1e2e;border:1px solid #3b3b5c;" +
      "border-radius:6px;padding:2px 4px;gap:2px;z-index:9999;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.5);flex-direction:row;align-items:center;";

    for (const cmd of inlineCommands) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", cmd.label);
      btn.title = cmd.label;
      btn.textContent = cmd.label.slice(0, 1);
      btn.style.cssText =
        "background:none;border:none;color:#e0e0ff;cursor:pointer;" +
        "padding:4px 8px;border-radius:4px;font-size:12px;";
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        cmd.run(this.#ctx);
      });
      wrapper.appendChild(btn);
    }

    this.#content = wrapper;
    document.body.appendChild(wrapper);

    this.#provider = new TooltipProvider({
      content: this.#content,
      debounce: 50,
      shouldShow(v: EditorView) {
        const { selection } = v.state;
        if (!(selection instanceof TextSelection)) return false;
        if (selection.empty) return false;
        if (!v.editable) return false;
        return true;
      },
      offset: 8,
    });

    this.#provider.onShow = () => {
      this.#content.style.display = "flex";
    };
    this.#provider.onHide = () => {
      this.#content.style.display = "none";
    };

    this.update(view);
  }

  update = (view: EditorView, prevState?: Parameters<PluginView["update"] extends undefined ? never : NonNullable<PluginView["update"]>>[1]) => {
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
