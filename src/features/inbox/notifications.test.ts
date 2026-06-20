import { describe, expect, it } from "vitest";
import type { Notification } from "@/lib/commands";
import { notificationLabel, relativeTime } from "./notifications";

function notif(over: Partial<Notification>): Notification {
  return {
    id: "n1",
    kind: "issueMention",
    createdAt: "2026-06-20T08:00:00Z",
    read: false,
    actorName: "Jakob Schwarz",
    issueId: "i1",
    issueIdentifier: "PSY-410",
    issueTitle: "Product Decision",
    issueStateType: "unstarted",
    issueStateColor: "#aaa",
    issueProjectName: "Psycloud Therapy",
    ...over,
  };
}

describe("notificationLabel", () => {
  it("phrases mentions, comments, assignment and added-to-project", () => {
    expect(notificationLabel(notif({ kind: "issueMention" }))).toBe("Jakob Schwarz mentioned you");
    expect(notificationLabel(notif({ kind: "issueNewComment" }))).toBe("Jakob Schwarz commented");
    expect(notificationLabel(notif({ kind: "issueAssignedToYou" }))).toBe("Jakob Schwarz assigned this to you");
    expect(notificationLabel(notif({ kind: "issueAddedToView" }))).toBe("Issue added to Psycloud Therapy");
  });

  it("uses the issue state for status-change phrasing", () => {
    expect(notificationLabel(notif({ kind: "issueStatusChanged", issueStateType: "completed" }))).toBe(
      "Marked as completed by Jakob Schwarz",
    );
    expect(notificationLabel(notif({ kind: "issueStatusChanged", issueStateType: "started" }))).toBe(
      "Jakob Schwarz changed the status",
    );
  });

  it("falls back to a humanized kind and tolerates a missing actor", () => {
    expect(notificationLabel(notif({ kind: "issueBlocking", actorName: null }))).toBe("Blocking");
    expect(notificationLabel(notif({ kind: "", actorName: null }))).toBe("Notification");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-06-20T12:00:00Z");
  it("buckets seconds → minutes → hours → days → weeks", () => {
    expect(relativeTime("2026-06-20T11:59:30Z", now)).toBe("now");
    expect(relativeTime("2026-06-20T11:45:00Z", now)).toBe("15m");
    expect(relativeTime("2026-06-20T09:00:00Z", now)).toBe("3h");
    expect(relativeTime("2026-06-18T12:00:00Z", now)).toBe("2d");
    expect(relativeTime("2026-06-06T12:00:00Z", now)).toBe("2w");
  });
  it("returns empty string for an unparseable timestamp", () => {
    expect(relativeTime("not-a-date", now)).toBe("");
  });
});
