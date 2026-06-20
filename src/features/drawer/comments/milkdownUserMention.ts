// Format: [@Name](mention://user/<id>) — pending live-Linear verification (Step 7).
import type { Ctx } from "@milkdown/kit/ctx";
import type { MilkdownPlugin } from "@milkdown/ctx";
import { editorViewCtx } from "@milkdown/kit/core";
import { SlashProvider, slashFactory } from "@milkdown/kit/plugin/slash";
import type { EditorState, PluginView } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { User } from "@/lib/commands";

export const USER_MENTION_PREFIX = "mention://user/";

/** Markdown for a user mention: a standard link so it round-trips through commonmark. */
export function formatUserMention(user: User): string {
  return `[@${user.name}](${USER_MENTION_PREFIX}${user.id})`;
}

/** Recover the user id from a mention href, or null if the href isn't a user mention. */
export function userMentionFromHref(href: string): string | null {
  return href.startsWith(USER_MENTION_PREFIX) ? href.slice(USER_MENTION_PREFIX.length) : null;
}

/** Case-insensitive name filter; empty query returns all users. */
export function filterUsers(users: User[], query: string): User[] {
  if (!query) return users;
  const q = query.toLowerCase();
  return users.filter((u) => u.name.toLowerCase().includes(q));
}

export const userMentionSlash = slashFactory("COMMENT_USER_MENTION");

class UserMentionView implements PluginView {
  readonly #content: HTMLElement;
  readonly #list: HTMLElement;
  readonly #provider: SlashProvider;
  readonly #ctx: Ctx;
  readonly #users: User[];
  #selectedIndex = 0;
  #filtered: User[] = [];
  #isOpen = false;
  #triggerFrom = -1;

  constructor(ctx: Ctx, view: EditorView, users: User[]) {
    this.#ctx = ctx;
    this.#users = users;
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
        const text = this.getContent(v, (node) => node.type.name === "paragraph");
        if (text == null) return false;
        const at = text.lastIndexOf("@");
        if (at < 0) return false;
        const query = text.slice(at + 1);
        if (/\s/.test(query)) return false; // mention token ends at whitespace
        const filtered = filterUsers(self.#users, query);
        if (filtered.length === 0) return false;
        const { $from } = v.state.selection;
        // `getContent` returns paragraph-start..cursor text; the `@` sits at
        // index `at`, so its doc position is cursor - (chars from `@` to cursor).
        self.#triggerFrom = $from.pos - (text.length - at);
        self.#filtered = filtered;
        self.#selectedIndex = 0;
        self.#render();
        return true;
      },
      offset: 8,
    });
    this.#provider.onShow = () => { this.#isOpen = true; this.#content.style.display = "block"; };
    this.#provider.onHide = () => { this.#isOpen = false; this.#content.style.display = "none"; this.#triggerFrom = -1; };
    this.update(view);
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.#isOpen || this.#filtered.length === 0) return false;
    if (e.key === "ArrowDown") { this.#selectedIndex = Math.min(this.#selectedIndex + 1, this.#filtered.length - 1); this.#render(); return true; }
    if (e.key === "ArrowUp") { this.#selectedIndex = Math.max(this.#selectedIndex - 1, 0); this.#render(); return true; }
    if (e.key === "Enter") { const u = this.#filtered[this.#selectedIndex]; if (u) this.#run(u); return true; }
    if (e.key === "Escape") { this.#provider.hide(); return true; }
    return false;
  }

  #render() {
    this.#list.innerHTML = "";
    this.#filtered.forEach((u, i) => {
      const li = document.createElement("li");
      li.setAttribute("data-id", u.id);
      if (i === this.#selectedIndex) li.setAttribute("data-selected", "true");
      li.textContent = u.name;
      li.addEventListener("mouseenter", () => { this.#selectedIndex = i; this.#render(); });
      li.addEventListener("mousedown", (e) => { e.preventDefault(); this.#run(u); });
      this.#list.appendChild(li);
    });
  }

  #run(user: User) {
    const view = this.#ctx.get(editorViewCtx);
    const { state } = view;
    const cursorPos = state.selection.from;
    const mention = `${formatUserMention(user)} `;
    let tr = state.tr;
    if (this.#triggerFrom >= 0 && this.#triggerFrom < cursorPos) {
      // Delete the `@query` trigger, then insert AT the trigger position
      // explicitly (after the delete, `#triggerFrom` is where the range started).
      tr = tr.delete(this.#triggerFrom, cursorPos).insertText(mention, this.#triggerFrom);
    } else {
      tr = tr.insertText(mention);
    }
    view.dispatch(tr);
    this.#provider.hide();
  }

  update = (view: EditorView, prevState?: EditorState) => { this.#provider.update(view, prevState); };
  destroy = () => { this.#provider.destroy(); this.#content.remove(); };
}

export function configureUserMention(ctx: Ctx, users: User[]) {
  let current: UserMentionView | null = null;
  ctx.set(userMentionSlash.key, {
    view: (editorView) => { current = new UserMentionView(ctx, editorView, users); return current; },
    props: { handleKeyDown: (_v: EditorView, e: KeyboardEvent) => current?.handleKeyDown(e) ?? false },
  });
}

/** Plugin array to `.use(...)` in the composer; pass the cached teammate list. */
export function userMentionTypeahead(): MilkdownPlugin[] {
  return [userMentionSlash as unknown as MilkdownPlugin];
}
