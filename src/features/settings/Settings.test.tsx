// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const cmd = vi.hoisted(() => ({
  getConnectionStatus: vi.fn().mockResolvedValue({ state: "not_configured" }),
  getGithubStatus: vi.fn().mockResolvedValue({ state: "not_configured" }),
  getSlackStatus: vi.fn().mockResolvedValue({ state: "not_configured" }),
  addDocsSource: vi.fn().mockResolvedValue({
    id: "acme/docs@main", name: "docs", owner: "acme", repo: "docs", branch: "main",
    url: "https://github.com/acme/docs/tree/main", lastSyncedAt: null, fileCount: 0, truncated: false,
  }),
  renameDocsSource: vi.fn(),
  removeDocsSource: vi.fn().mockResolvedValue(undefined),
  setGithubToken: vi.fn().mockResolvedValue(undefined),
  clearGithubToken: vi.fn(),
  testGithubConnection: vi.fn(),
  setLinearKey: vi.fn(), clearLinearKey: vi.fn(), testLinearConnection: vi.fn(),
  setSlackCredentials: vi.fn().mockResolvedValue(undefined),
  detectSlackCredentials: vi.fn().mockResolvedValue({ state: "not_configured" }),
  clearSlackToken: vi.fn(),
  testSlackConnection: vi.fn(),
  getLlmConfig: vi.fn().mockResolvedValue(null),
  setLlmConfig: vi.fn().mockResolvedValue({ baseUrl: "http://localhost:11434", model: "phi4", hasApiKey: false }),
  clearLlmConfig: vi.fn(),
  testLlmConnection: vi.fn(),
  syncIssues: vi.fn(), errorText: (e: unknown) => String(e),
}));
vi.mock("@/lib/commands", () => cmd);

const queries = vi.hoisted(() => ({
  docsSources: [] as unknown[],
  docsStatus: { tokenPresent: true, sourceCount: 0 },
}));
vi.mock("@/lib/queries", () => ({
  clearWorkspaceQueries: vi.fn(), invalidateWorkspaceQueries: vi.fn(), clearGithubQueries: vi.fn(),
  clearSlackQueries: vi.fn(),
  useDocsSources: () => ({ data: queries.docsSources }),
  useDocsStatus: () => ({ data: queries.docsStatus }),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { success: vi.fn(), error: vi.fn() } }));

import { Settings } from "./Settings";
import { requestSettingsSection } from "./settingsSection";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** Render Settings and navigate to a section via the sidebar. */
function renderAt(section: string) {
  render(<Settings />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: section }));
}

afterEach(cleanup);

describe("Settings navigation", () => {
  it("opens on Linear and shows only that section", () => {
    render(<Settings />, { wrapper });
    expect(screen.getByLabelText(/linear personal api key/i)).toBeTruthy();
    // Another section's fields are not merely hidden — they aren't mounted.
    expect(screen.queryByLabelText(/github personal access token/i)).toBeNull();
  });

  it("switches sections from the sidebar", () => {
    renderAt("GitHub");
    expect(screen.getByLabelText(/github personal access token/i)).toBeTruthy();
    expect(screen.queryByLabelText(/linear personal api key/i)).toBeNull();
  });

  it("honours a deep-linked section and consumes it", () => {
    // Docs' "Add a repository" empty state sends the user straight here.
    requestSettingsSection("documentation");
    render(<Settings />, { wrapper });
    expect(screen.getByLabelText(/add a repository/i)).toBeTruthy();

    // The request is one-shot: a later visit opens on the default section.
    cleanup();
    render(<Settings />, { wrapper });
    expect(screen.getByLabelText(/linear personal api key/i)).toBeTruthy();
  });
});

describe("Settings GitHub section", () => {
  it("saves the GitHub token and clears the input", async () => {
    renderAt("GitHub");
    const input = screen.getByPlaceholderText(/ghp_/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ghp_secret" } });
    fireEvent.click(screen.getByRole("button", { name: /save github token/i }));
    await waitFor(() => expect(cmd.setGithubToken).toHaveBeenCalledWith("ghp_secret"));
    expect(input.value).toBe("");
  });
});

describe("Settings documentation section", () => {
  it("adds a source from a URL and clears both inputs", async () => {
    queries.docsSources = [];
    renderAt("Documentation");
    fireEvent.change(screen.getByLabelText(/add a repository/i), {
      target: { value: "https://github.com/acme/docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add source/i }));
    await waitFor(() =>
      expect(cmd.addDocsSource).toHaveBeenCalledWith("https://github.com/acme/docs", undefined)
    );
    expect((screen.getByLabelText(/add a repository/i) as HTMLInputElement).value).toBe("");
  });

  it("passes a display name through when one is given", async () => {
    queries.docsSources = [];
    renderAt("Documentation");
    fireEvent.change(screen.getByLabelText(/add a repository/i), {
      target: { value: "acme/docs" },
    });
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "  Core docs  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /add source/i }));
    await waitFor(() => expect(cmd.addDocsSource).toHaveBeenCalledWith("acme/docs", "Core docs"));
  });

  it("requires confirmation before removing a source", async () => {
    queries.docsSources = [
      {
        id: "acme/docs@main", name: "Core docs", owner: "acme", repo: "docs", branch: "main",
        url: "", lastSyncedAt: null, fileCount: 3, truncated: false,
      },
    ];
    renderAt("Documentation");
    // The first click only arms the confirm — removing a source drops its cache.
    fireEvent.click(screen.getByRole("button", { name: /remove core docs/i }));
    expect(cmd.removeDocsSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() => expect(cmd.removeDocsSource).toHaveBeenCalledWith("acme/docs@main"));
  });

  it("only renames when the name actually changed", async () => {
    queries.docsSources = [
      {
        id: "acme/docs@main", name: "Core docs", owner: "acme", repo: "docs", branch: "main",
        url: "", lastSyncedAt: null, fileCount: 0, truncated: false,
      },
    ];
    renderAt("Documentation");
    const input = screen.getByLabelText(/name for acme\/docs/i);
    // Tabbing through the list untouched must not fire a write.
    fireEvent.blur(input);
    expect(cmd.renameDocsSource).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Platform docs" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(cmd.renameDocsSource).toHaveBeenCalledWith("acme/docs@main", "Platform docs")
    );
  });
});

describe("Settings Slack section", () => {
  it("calls detectSlackCredentials when the Detect button is clicked", async () => {
    renderAt("Slack");
    fireEvent.click(screen.getByRole("button", { name: /detect from slack app/i }));
    await waitFor(() => expect(cmd.detectSlackCredentials).toHaveBeenCalled());
  });

  it("manual fallback: calls setSlackCredentials with typed values and clears both inputs", async () => {
    renderAt("Slack");
    // Open the manual entry disclosure
    fireEvent.click(screen.getByRole("button", { name: /enter manually/i }));
    const tokenInput = screen.getByLabelText(/xoxc token/i) as HTMLInputElement;
    const cookieInput = screen.getByLabelText(/xoxd cookie/i) as HTMLInputElement;
    fireEvent.change(tokenInput, { target: { value: "xoxc-test-token" } });
    fireEvent.change(cookieInput, { target: { value: "xoxd-test-cookie" } });
    fireEvent.click(screen.getByRole("button", { name: /save credentials/i }));
    await waitFor(() =>
      expect(cmd.setSlackCredentials).toHaveBeenCalledWith("xoxc-test-token", "xoxd-test-cookie")
    );
    // Both inputs must be cleared before the async call resolves (secret hygiene)
    expect(tokenInput.value).toBe("");
    expect(cookieInput.value).toBe("");
  });
});

describe("Settings AI section", () => {
  it("saves endpoint + model and clears the key input immediately", async () => {
    renderAt("AI");
    fireEvent.change(screen.getByLabelText(/ai endpoint/i), {
      target: { value: "http://localhost:11434" },
    });
    fireEvent.change(screen.getByLabelText(/^model$/i), {
      target: { value: "phi4-mini-reasoning:latest" },
    });
    const keyInput = screen.getByLabelText(/api key \(optional\)/i) as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "sk-secret" } });
    fireEvent.click(screen.getByRole("button", { name: /save endpoint/i }));
    await waitFor(() =>
      expect(cmd.setLlmConfig).toHaveBeenCalledWith(
        "http://localhost:11434",
        "phi4-mini-reasoning:latest",
        "sk-secret",
      )
    );
    // The secret leaves component state before the async save resolves.
    expect(keyInput.value).toBe("");
  });

  it("does not send a key when the key input is empty", async () => {
    renderAt("AI");
    fireEvent.change(screen.getByLabelText(/ai endpoint/i), {
      target: { value: "http://localhost:11434" },
    });
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: "phi4" } });
    fireEvent.click(screen.getByRole("button", { name: /save endpoint/i }));
    await waitFor(() =>
      expect(cmd.setLlmConfig).toHaveBeenCalledWith("http://localhost:11434", "phi4", null)
    );
  });
});
