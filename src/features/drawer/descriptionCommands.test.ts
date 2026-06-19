import { describe, expect, it } from "vitest";
import { filterSlashCommands, slashCommands } from "./descriptionCommands";

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
