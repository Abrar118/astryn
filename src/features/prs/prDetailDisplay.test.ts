import { describe, expect, it } from "vitest";
import type { GithubPrDetail } from "@/lib/commands";
import {
  PR_DRAWER_WIDTH_KEY,
  detailTimeline,
  loadDrawerWidth,
  saveDrawerWidth,
} from "./prDetailDisplay";

const detail = {
  comments: [
    {
      id: "comment",
      body: "Done",
      createdAt: "2026-07-26T12:03:00Z",
      url: "https://x/comment",
      authorLogin: "sam",
      authorAvatar: null,
    },
  ],
  reviews: [
    {
      id: "review",
      body: "",
      state: "approved",
      submittedAt: "2026-07-26T12:02:00Z",
      url: "https://x/review",
      authorLogin: "lee",
      authorAvatar: null,
    },
  ],
  commits: [
    {
      oid: "abc123",
      headline: "Start",
      committedAt: "2026-07-26T12:01:00Z",
      url: "https://x/commit",
      authorName: "Alex",
      authorLogin: "alex",
      authorAvatar: null,
    },
  ],
} as GithubPrDetail;

describe("pr detail display helpers", () => {
  it("merges comments, reviews, and commits chronologically", () => {
    expect(detailTimeline(detail).map((event) => event.kind)).toEqual([
      "commit",
      "review",
      "comment",
    ]);
  });

  it("keeps a stable source order for invalid or identical timestamps", () => {
    const tied = {
      ...detail,
      comments: [{ ...detail.comments[0], createdAt: "" }],
      reviews: [{ ...detail.reviews[0], submittedAt: "" }],
      commits: [{ ...detail.commits[0], committedAt: "" }],
    };
    expect(detailTimeline(tied).map((event) => event.kind)).toEqual([
      "comment",
      "review",
      "commit",
    ]);
  });

  it("defaults and clamps drawer width", () => {
    const storage = new MapStorage();
    expect(loadDrawerWidth(storage, 1440)).toBe(1008);
    storage.setItem(PR_DRAWER_WIDTH_KEY, "2000");
    expect(loadDrawerWidth(storage, 1440)).toBe(1180);
    expect(loadDrawerWidth(storage, 600)).toBe(576);
  });

  it("persists a rounded, clamped drawer width", () => {
    const storage = new MapStorage();
    expect(saveDrawerWidth(900.6, storage, 1440)).toBe(901);
    expect(storage.getItem(PR_DRAWER_WIDTH_KEY)).toBe("901");
  });
});

class MapStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
