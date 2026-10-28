// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const commands = vi.hoisted(() => ({
  listBitbucketPrs: vi.fn(),
  syncBitbucketPrs: vi.fn(),
  getBitbucketPrDetail: vi.fn(),
  getBitbucketPrDiff: vi.fn(),
  listBitbucketRepositories: vi.fn(),
  setBitbucketRepoFavorite: vi.fn(),
  getBitbucketStatus: vi.fn(),
  errorText: (err: unknown) => String(err),
}));
const active = vi.hoisted(() => ({ on: true }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/commands", () => commands);
vi.mock("./commands", () => commands);
vi.mock("./queries", () => ({ isModuleOff: () => false }));
vi.mock("./modules", () => ({
  useModules: () => ({ isActive: (id: string) => id === "bitbucket" && active.on }),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { error: toastError, success: vi.fn() } }));

import { useBitbucketPrDiff, useBitbucketPrs, useBitbucketSync } from "./bitbucketQueries";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("Bitbucket query hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    active.on = true;
  });

  it("do nothing while the module is off", async () => {
    active.on = false;
    renderHook(() => { useBitbucketPrs(); return useBitbucketSync(true); }, { wrapper });
    await Promise.resolve();
    expect(commands.listBitbucketPrs).not.toHaveBeenCalled();
    expect(commands.syncBitbucketPrs).not.toHaveBeenCalled();
  });

  it("sync runs only with credentials and names failed scopes", async () => {
    commands.listBitbucketPrs.mockResolvedValue({ prs: [], meta: [], favoriteRepos: [] });
    commands.syncBitbucketPrs.mockResolvedValue([
      { bucket: "repo:acme/api", ok: false, truncated: false, reason: "rate limited" },
    ]);
    renderHook(() => useBitbucketSync(false), { wrapper });
    await Promise.resolve();
    expect(commands.syncBitbucketPrs).not.toHaveBeenCalled();

    renderHook(() => { useBitbucketPrs(); return useBitbucketSync(true); }, { wrapper });
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Some Bitbucket scopes couldn't refresh",
        expect.objectContaining({ description: "acme/api — rate limited" }),
      ),
    );
  });

  it("the diff stays lazy until requested", async () => {
    commands.getBitbucketPrDiff.mockResolvedValue({ files: [] });
    const { rerender } = renderHook(({ on }) => useBitbucketPrDiff("acme/api", 7, on), {
      wrapper,
      initialProps: { on: false },
    });
    await Promise.resolve();
    expect(commands.getBitbucketPrDiff).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(commands.getBitbucketPrDiff).toHaveBeenCalledWith("acme/api", 7));
  });
});
