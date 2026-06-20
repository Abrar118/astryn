// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { filterSlashCommands, slashCommands } from "./milkdownMenus";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  serializerCtx,
  editorViewCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { applyDescriptionConfig } from "./milkdownEditor";

describe("filterSlashCommands", () => {
  it("returns all commands for an empty query", () => {
    expect(filterSlashCommands("")).toHaveLength(slashCommands.length);
  });
  it("matches label and keywords case-insensitively", () => {
    expect(filterSlashCommands("HEAD").map((c) => c.id)).toEqual(["h1", "h2", "h3"]);
    expect(filterSlashCommands("todo").map((c) => c.id)).toContain("task");
  });
  it("returns nothing for an unmatched query", () => {
    expect(filterSlashCommands("zzz")).toHaveLength(0);
  });
});

describe("task slash command", () => {
  it("produces a task-list item (- [ ]) in the serialized markdown", async () => {
    const root = document.createElement("div");
    // Start with an empty paragraph so wrapInBulletList has something to wrap.
    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, "todo item");
        applyDescriptionConfig(ctx);
      })
      .use(commonmark)
      .use(gfm)
      .create();

    // Find and run the "task" slash command against the live editor ctx.
    const taskCmd = slashCommands.find((c) => c.id === "task");
    expect(taskCmd).toBeDefined();

    editor.action((ctx) => {
      taskCmd!.run(ctx);
    });

    let markdown = "";
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      markdown = ctx.get(serializerCtx)(view.state.doc);
    });

    await editor.destroy();

    // A real task-list item serializes as `- [ ] …` or `* [ ] …`.
    expect(markdown).toMatch(/[-*] \[ \]/);
  });
});
