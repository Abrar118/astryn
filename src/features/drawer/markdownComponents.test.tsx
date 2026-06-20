// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createMarkdownComponents, issueIdentifierFromHref, mentionAwareUrlTransform } from "./markdownComponents";

const mermaidRender = vi.fn();
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: (...args: unknown[]) => mermaidRender(...args) },
}));

afterEach(() => {
  cleanup();
  mermaidRender.mockReset();
});

describe("mentionAwareUrlTransform", () => {
  it("passes through mention://user/<id> URLs unchanged", () => {
    expect(mentionAwareUrlTransform("mention://user/u1")).toBe("mention://user/u1");
  });
  it("blocks javascript: scheme by delegating to defaultUrlTransform", () => {
    const result = mentionAwareUrlTransform("javascript:alert(1)");
    expect(result).toBe("");
  });
  it("passes through normal https:// URLs unchanged", () => {
    expect(mentionAwareUrlTransform("https://example.com/x")).toBe("https://example.com/x");
  });
});

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
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents(opts)} urlTransform={mentionAwareUrlTransform}>
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
        id === "PRO-153"
          ? {
              identifier: "PRO-153",
              title: "Decouple tenancy",
              stateType: "started",
              stateColor: "#22c55e",
              stateName: "In Progress",
              projectName: "Health",
              priority: 2,
              assigneeName: "Alice",
            }
          : undefined,
    });
    const pill = screen.getByRole("button", { name: /PRO-153/ });
    // Title is now embedded inline in the pill text, not as a title attribute
    expect(pill.textContent).toContain("Decouple tenancy");
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

  it("renders a ```mermaid fenced block as a diagram, not a code block", async () => {
    mermaidRender.mockResolvedValue({ svg: "<svg data-testid='diagram'/>" });
    renderMarkdown("```mermaid\ngraph TD; A-->B\n```", {
      onActivateLink: vi.fn(),
      resolveMention: () => undefined,
    });
    await waitFor(() => expect(screen.getByTestId("diagram")).toBeTruthy());
    expect(mermaidRender).toHaveBeenCalledWith(expect.any(String), "graph TD; A-->B");
    // It must NOT have fallen through to a plain code block.
    expect(document.querySelector("code.language-mermaid")).toBeNull();
  });

  it("leaves a non-mermaid code block as a normal <pre><code>", () => {
    renderMarkdown("```ts\nconst x = 1;\n```", {
      onActivateLink: vi.fn(),
      resolveMention: () => undefined,
    });
    expect(document.querySelector("pre code")?.textContent).toContain("const x = 1;");
    expect(mermaidRender).not.toHaveBeenCalled();
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

  it("renders a user mention as a non-navigating pill (not an <a>), never calling onActivateLink", () => {
    const onActivateLink = vi.fn();
    renderMarkdown("cc [@Jakob](mention://user/u2)", {
      onActivateLink,
      resolveMention: () => undefined,
    });
    const pill = document.querySelector("[data-mention-pill='user']");
    expect(pill).not.toBeNull();
    expect(pill?.tagName.toLowerCase()).not.toBe("a");
    expect(pill?.textContent).toContain("@Jakob");
    // Clicking a non-<a> span cannot reach onActivateLink.
    (pill as HTMLElement)?.click();
    expect(onActivateLink).not.toHaveBeenCalled();
  });
});
