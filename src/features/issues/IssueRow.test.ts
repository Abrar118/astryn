import { describe, expect, it } from "vitest";
import { compareIssues } from "./IssueRow";
import type { IssueListItem } from "@/lib/commands";

const mk = (over: Partial<IssueListItem>): IssueListItem =>
  ({ id: "i", identifier: "X-1", title: "t", priority: 0, stateType: "started", stateColor: "#fff",
     stateName: "S", dueDate: null, assigneeId: null, assigneeName: null, teamId: null, teamKey: null,
     projectId: null, projectName: null, labels: [], estimate: null, cycleName: null, cycleNumber: null,
     milestoneName: null, linkCount: 0, prCount: 0, attachmentsTruncated: false, url: "", description: null,
     stateId: null, parentId: null, createdAt: "", updatedAt: "", ...over }) as IssueListItem;

describe("compareIssues", () => {
  it("orders by due date ascending, nulls last", () => {
    const a = mk({ dueDate: "2026-06-20" });
    const b = mk({ dueDate: null });
    expect(compareIssues(a, b, "dueDate")).toBeLessThan(0);
  });
  it("orders by priority using the priority order", () => {
    const urgent = mk({ priority: 1 });
    const low = mk({ priority: 4 });
    expect(compareIssues(urgent, low, "priority")).toBeLessThan(0);
  });
});
