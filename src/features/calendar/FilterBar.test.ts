import { describe, expect, it } from "vitest";
import { assigneeChoices } from "./FilterBar";
import { ME } from "@/lib/tracker";

describe("assigneeChoices", () => {
  it("folds every tracker's viewer into one leading Me entry", () => {
    const users = [
      { id: "u1", name: "Ada", avatarUrl: "a.png" },
      { id: "u2", name: "Grace" },
    ];
    const choices = assigneeChoices(users, ["u1", "local-me"], null);
    expect(choices.map((u) => u.id)).toEqual([ME, "u2"]);
    expect(choices[0]).toMatchObject({ name: "Ada", avatarUrl: "a.png" });
  });

  it("prefers the viewer's display name", () => {
    expect(assigneeChoices([], [], "Abrar")[0]).toMatchObject({ id: ME, name: "Abrar" });
  });
});
