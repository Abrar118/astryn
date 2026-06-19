// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createMarkdownComponents, issueIdentifierFromHref } from "./markdownComponents";

afterEach(cleanup);

describe("issueIdentifierFromHref", () => {
  it("extracts the identifier from a Linear issue URL", () => {
    expect(issueIdentifierFromHref("https://linear.app/gam/issue/PRO-153/slug")).toBe("PRO-153");
  });
  it("returns null for non-issue links", () => {
    expect(issueIdentifierFromHref("https://example.com/docs")).toBeNull();
  });
});

function renderMarkdown(md: string, opts: Parameters<typeof createMarkdownComponents>[0]) {
  return render(
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents(opts)}>
      {md}
    </ReactMarkdown>,
  );
}

describe("createMarkdownComponents", () => {
  it("renders a cached issue mention as a clickable pill that activates in-app", () => {
    const onActivateLink = vi.fn();
    renderMarkdown("done ([PRO-153](https://linear.app/gam/issue/PRO-153/decouple))", {
      onActivateLink,
      resolveMention: (id) =>
        id === "PRO-153" ? { stateColor: "#22c55e", title: "Decouple tenancy" } : undefined,
    });
    const pill = screen.getByRole("button", { name: /PRO-153/ });
    expect(pill.getAttribute("title")).toBe("Decouple tenancy");
    pill.click();
    expect(onActivateLink).toHaveBeenCalledWith("https://linear.app/gam/issue/PRO-153/decouple");
  });

  it("renders an uncached issue link as a plain link (no pill)", () => {
    const onActivateLink = vi.fn();
    renderMarkdown("see [PRO-999](https://linear.app/gam/issue/PRO-999/x)", {
      onActivateLink,
      resolveMention: () => undefined,
    });
    expect(screen.queryByRole("button")).toBeNull();
    screen.getByText("PRO-999").click();
    expect(onActivateLink).toHaveBeenCalledWith("https://linear.app/gam/issue/PRO-999/x");
  });

  it("routes a normal external link through onActivateLink (never the webview)", () => {
    const onActivateLink = vi.fn();
    renderMarkdown("[docs](https://example.com)", {
      onActivateLink,
      resolveMention: () => undefined,
    });
    screen.getByText("docs").click();
    expect(onActivateLink).toHaveBeenCalledWith("https://example.com");
  });
});
