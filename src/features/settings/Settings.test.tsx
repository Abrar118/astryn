// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const cmd = vi.hoisted(() => ({
  getConnectionStatus: vi.fn().mockResolvedValue({ state: "not_configured" }),
  getGithubStatus: vi.fn().mockResolvedValue({ state: "not_configured" }),
  getSlackStatus: vi.fn().mockResolvedValue({ state: "not_configured" }),
  getDocsRepo: vi.fn().mockResolvedValue(null),
  setDocsRepo: vi.fn().mockResolvedValue({ owner: "o", repo: "r", branch: "main", url: "" }),
  setGithubToken: vi.fn().mockResolvedValue(undefined),
  clearGithubToken: vi.fn(),
  testGithubConnection: vi.fn(),
  setLinearKey: vi.fn(), clearLinearKey: vi.fn(), testLinearConnection: vi.fn(),
  setSlackCredentials: vi.fn().mockResolvedValue(undefined),
  detectSlackCredentials: vi.fn().mockResolvedValue({ state: "not_configured" }),
  clearSlackToken: vi.fn(),
  testSlackConnection: vi.fn(),
  syncIssues: vi.fn(), errorText: (e: unknown) => String(e),
}));
vi.mock("@/lib/commands", () => cmd);
vi.mock("@/lib/queries", () => ({
  clearWorkspaceQueries: vi.fn(), invalidateWorkspaceQueries: vi.fn(), clearGithubQueries: vi.fn(),
  clearSlackQueries: vi.fn(),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { success: vi.fn(), error: vi.fn() } }));

import { Settings } from "./Settings";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(cleanup);

describe("Settings GitHub card", () => {
  it("saves the GitHub token and clears the input", async () => {
    render(<Settings />, { wrapper });
    const input = screen.getByPlaceholderText(/ghp_/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ghp_secret" } });
    fireEvent.click(screen.getByRole("button", { name: /save github token/i }));
    await waitFor(() => expect(cmd.setGithubToken).toHaveBeenCalledWith("ghp_secret"));
    expect(input.value).toBe("");
  });
});

describe("Settings docs repository card", () => {
  it("saves the docs repo URL and clears the input", async () => {
    render(<Settings />, { wrapper });
    const input = screen.getByLabelText(/documentation repository/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://github.com/acme/docs" } });
    fireEvent.click(screen.getByRole("button", { name: /save repository/i }));
    await waitFor(() =>
      expect(cmd.setDocsRepo).toHaveBeenCalledWith("https://github.com/acme/docs")
    );
    expect(input.value).toBe("");
  });
});

describe("Settings Slack card", () => {
  it("calls detectSlackCredentials when the Detect button is clicked", async () => {
    render(<Settings />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: /detect from slack app/i }));
    await waitFor(() => expect(cmd.detectSlackCredentials).toHaveBeenCalled());
  });

  it("manual fallback: calls setSlackCredentials with typed values and clears both inputs", async () => {
    render(<Settings />, { wrapper });
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
