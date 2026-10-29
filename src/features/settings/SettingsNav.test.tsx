// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/modules", async (orig) => ({
  ...(await orig<typeof import("@/lib/modules")>()),
  useModules: () => ({ isActive: (id: string) => id === "github", hasCapability: () => false, ready: true }),
}));
vi.mock("@/lib/commands", async (orig) => ({
  ...(await orig<typeof import("@/lib/commands")>()),
  getGithubStatus: vi.fn(async () => ({ state: "connected", login: "ada" })),
}));

import { SettingsNav } from "./SettingsNav";

afterEach(cleanup);

function renderNav() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SettingsNav active="github" onSelect={() => {}} />
    </QueryClientProvider>,
  );
}

describe("SettingsNav module gating", () => {
  it("hides sections of inactive modules and keeps core ones", () => {
    renderNav();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.queryByText("Slack")).toBeNull();
    expect(screen.queryByText("AI")).toBeNull();
    expect(screen.queryByText("Linear")).toBeNull();
  });

  it("describes a connection's state on its rail button", async () => {
    renderNav();
    expect((await screen.findByTitle("GitHub: connected")).getAttribute("aria-current")).toBe("page");
  });
});
