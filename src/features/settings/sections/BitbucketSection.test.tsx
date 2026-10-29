// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const cmd = vi.hoisted(() => ({
  getBitbucketStatus: vi.fn(async () => ({ state: "not_configured" })),
  setBitbucketCredentials: vi.fn(async () => undefined),
  clearBitbucketCredentials: vi.fn(async () => undefined),
  testBitbucketConnection: vi.fn(),
  errorText: (e: unknown) => String(e),
}));
vi.mock("@/lib/commands", () => cmd);
vi.mock("@/lib/bitbucketQueries", () => ({ clearBitbucketQueries: vi.fn() }));
vi.mock("goey-toast", () => ({ gooeyToast: { success: vi.fn(), error: vi.fn() } }));

import { BitbucketSection } from "./BitbucketSection";

afterEach(() => cleanup());

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BitbucketSection />
    </QueryClientProvider>,
  );
}

describe("BitbucketSection", () => {
  it("saves trimmed credentials and clears the token field immediately", async () => {
    renderIt();
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    const email = screen.getByLabelText("Atlassian account email") as HTMLInputElement;
    const token = screen.getByLabelText("API token") as HTMLInputElement;
    fireEvent.change(email, { target: { value: " me@acme.io " } });
    fireEvent.change(token, { target: { value: " secret " } });
    fireEvent.click(screen.getByRole("button", { name: "Save Bitbucket credentials" }));
    expect(token.value).toBe("");
    await waitFor(() => expect(cmd.setBitbucketCredentials).toHaveBeenCalledWith("me@acme.io", "secret"));
    await waitFor(() => expect(email.value).toBe(""));
  });

  it("offers test and clear only once credentials are saved", async () => {
    renderIt();
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear credentials" })).toBeNull();

    cleanup();
    cmd.getBitbucketStatus.mockResolvedValueOnce({ state: "unverified" });
    renderIt();
    expect(await screen.findByText("Credentials saved — not verified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear credentials" })).toBeInTheDocument();
  });

  it("does not submit without both parts", () => {
    cmd.setBitbucketCredentials.mockClear();
    renderIt();
    fireEvent.change(screen.getByLabelText("API token"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Bitbucket credentials" }));
    expect(cmd.setBitbucketCredentials).not.toHaveBeenCalled();
  });
});
