// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const cmd = vi.hoisted(() => ({
  getTeamsStatus: vi.fn(),
  startTeamsSignIn: vi.fn(),
  pollTeamsSignIn: vi.fn(),
  cancelTeamsSignIn: vi.fn(),
  clearTeamsAccount: vi.fn(),
  testTeamsConnection: vi.fn(),
  errorText: (e: unknown) => String(e),
}));
const openUrl = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/commands", () => cmd);
vi.mock("@/lib/queries", () => ({ clearTeamsQueries: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("goey-toast", () => ({ gooeyToast: toast }));

import { TeamsSection } from "./TeamsSection";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const CID = "00001111-aaaa-2222-bbbb-3333cccc4444";
const code = {
  userCode: "ABCD1234",
  verificationUri: "https://microsoft.com/devicelogin",
  expiresIn: 900,
  interval: 1,
  message: null,
};

beforeEach(() => {
  cmd.getTeamsStatus.mockResolvedValue({ state: "not_configured" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function startSignIn() {
  render(<TeamsSection />, { wrapper });
  fireEvent.change(screen.getByLabelText(/application \(client\) id/i), { target: { value: ` ${CID} ` } });
  fireEvent.click(screen.getByRole("button", { name: /sign in with microsoft/i }));
  await screen.findByText("ABCD1234");
}

describe("TeamsSection", () => {
  it("starts the device-code sign-in and shows the code", async () => {
    cmd.startTeamsSignIn.mockResolvedValue(code);
    cmd.pollTeamsSignIn.mockResolvedValue({ state: "pending", interval: 60 });
    await startSignIn();
    expect(cmd.startTeamsSignIn).toHaveBeenCalledWith(CID, null);
    fireEvent.click(screen.getByRole("button", { name: /open sign-in page/i }));
    expect(openUrl).toHaveBeenCalledWith("https://microsoft.com/devicelogin");
  });

  it("polls until connected, then returns to the form", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    cmd.startTeamsSignIn.mockResolvedValue(code);
    cmd.pollTeamsSignIn
      .mockResolvedValueOnce({ state: "pending", interval: 1 })
      .mockResolvedValueOnce({ state: "connected", userName: "Ada" });
    await startSignIn();
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Connected as Ada"));
    expect(cmd.pollTeamsSignIn).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("ABCD1234")).toBeNull();
    expect((screen.getByLabelText(/application \(client\) id/i) as HTMLInputElement).value).toBe("");
  });

  it("cancel stops the sign-in", async () => {
    cmd.startTeamsSignIn.mockResolvedValue(code);
    cmd.cancelTeamsSignIn.mockResolvedValue(undefined);
    cmd.pollTeamsSignIn.mockResolvedValue({ state: "pending", interval: 60 });
    await startSignIn();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(cmd.cancelTeamsSignIn).toHaveBeenCalled());
    expect(screen.queryByText("ABCD1234")).toBeNull();
  });

  it("reports a rejected client ID", async () => {
    cmd.startTeamsSignIn.mockRejectedValue("That client ID or tenant isn't valid.");
    render(<TeamsSection />, { wrapper });
    fireEvent.change(screen.getByLabelText(/application \(client\) id/i), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in with microsoft/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByText("ABCD1234")).toBeNull();
  });

  it("offers test and sign-out once connected", async () => {
    cmd.getTeamsStatus.mockResolvedValue({ state: "connected", userName: "Ada" });
    cmd.clearTeamsAccount.mockResolvedValue(undefined);
    render(<TeamsSection />, { wrapper });
    expect(await screen.findByText("Connected as Ada")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(cmd.clearTeamsAccount).toHaveBeenCalled());
  });
});
