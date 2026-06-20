import { describe, expect, it } from "vitest";
import { filterUsers, formatUserMention, userMentionFromHref } from "./milkdownUserMention";
import type { User } from "@/lib/commands";

const users: User[] = [
  { id: "u1", name: "Abrar Mahir Esam" },
  { id: "u2", name: "Jakob Schwarz" },
  { id: "u3", name: "Abdullah Khan" },
];

describe("user mention helpers", () => {
  it("filters case-insensitively by name, empty query returns all", () => {
    expect(filterUsers(users, "").length).toBe(3);
    expect(filterUsers(users, "ab").map((u) => u.id)).toEqual(["u1", "u3"]);
    expect(filterUsers(users, "schwarz").map((u) => u.id)).toEqual(["u2"]);
  });

  it("formats and round-trips a mention href to the user id", () => {
    const md = formatUserMention(users[0]);
    expect(md).toBe("[@Abrar Mahir Esam](mention://user/u1)");
    expect(userMentionFromHref("mention://user/u1")).toBe("u1");
    expect(userMentionFromHref("https://example.com")).toBeNull();
  });
});
