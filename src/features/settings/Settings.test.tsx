// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const cmd = vi.hoisted(() => ({
  getConnectionStatus: vi.fn().mockResolvedValue({ state: "not_configured" }),
  getGithubStatus: vi.fn().mockResolvedValue({ state: "not_configured" }),
  setGithubToken: vi.fn().mockResolvedValue(undefined),
  clearGithubToken: vi.fn(),
  testGithubConnection: vi.fn(),
  setLinearKey: vi.fn(), clearLinearKey: vi.fn(), testLinearConnection: vi.fn(),
  syncIssues: vi.fn(), errorText: (e: unknown) => String(e),
}));
vi.mock("@/lib/commands", () => cmd);
vi.mock("@/lib/queries", () => ({
  clearWorkspaceQueries: vi.fn(), invalidateWorkspaceQueries: vi.fn(), clearGithubQueries: vi.fn(),
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
