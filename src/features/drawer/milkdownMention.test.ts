// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueMentionFromUrl, descriptionMentionPlugin, makeLinkMarkView } from "./milkdownMention";
import { roundtripMarkdown } from "./milkdownEditor";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("issueMentionFromUrl", () => {
  it("extracts the identifier from a Linear issue URL", () => {
    expect(
      issueMentionFromUrl("https://linear.app/gam/issue/PRO-153/x"),
    ).toBe("PRO-153");
  });
  it("returns null for non-issue links", () => {
    expect(issueMentionFromUrl("https://example.com")).toBeNull();
  });
  it("extracts uppercase identifier regardless of input case", () => {
    expect(
      issueMentionFromUrl("https://linear.app/gam/issue/pro-42/some-title"),
    ).toBe("PRO-42");
  });
  it("returns null for a Linear URL without /issue/ segment", () => {
    expect(issueMentionFromUrl("https://linear.app/gam/team/PRO")).toBeNull();
  });
});

describe("mention round-trip", () => {
  it("a mention link survives serialization as the original markdown link", async () => {
    const md = "done ([PRO-153](https://linear.app/gam/issue/PRO-153/x))";
    const r = await roundtripMarkdown(md);
    expect(r.valid).toBe(true);
    expect(r.markdown).toContain(
      "[PRO-153](https://linear.app/gam/issue/PRO-153/x)",
    );
  });
});

describe("descriptionMentionPlugin", () => {
  it("accepts (resolveMention, onActivateLink: (href: string) => void) and returns a plugin array", () => {
    // Verify the updated signature — second param is now onActivateLink(href: string)
    const plugins = descriptionMentionPlugin(
      () => undefined,
      vi.fn<(href: string) => void>(),
    );
    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins.length).toBeGreaterThan(0);
  });

  it("shows the rich issue hover card instead of a native title tooltip", async () => {
    vi.useFakeTimers();
    const target = {
      identifier: "PSY-427",
      title: "Rethink comment field activation",
      stateType: "started",
      stateColor: "#6366f1",
      stateName: "In Progress",
      projectName: "Psycloud",
      priority: 2,
      assigneeName: "Jakob Schwarz",
    };
    const markView = makeLinkMarkView(
      () => target,
      vi.fn(),
    )(
      { attrs: { href: "https://linear.app/psy/issue/PSY-427/x" } } as never,
      {} as never,
      true,
    );
    document.body.appendChild(markView.dom);

    expect((markView.dom as HTMLElement).getAttribute("title")).toBeNull();
    markView.dom.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("In Progress");
    markView.destroy?.();
  });
});
