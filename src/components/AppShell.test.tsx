// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModuleId, ModulesView } from "@/lib/commands";

const IDS: ModuleId[] = ["linear", "github", "slack", "llm", "docs", "reports", "link-previews"];
let view: ModulesView;

vi.mock("@/lib/commands", async (orig) => ({
  ...(await orig<typeof import("@/lib/commands")>()),
  listModules: vi.fn(async () => view),
  setEnabledModules: vi.fn(async () => view),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/queries", () => ({ useSyncLoop: () => ({ isSyncing: false, refresh: vi.fn() }) }));
vi.mock("@/lib/tabs", () => ({
  WorkspaceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useWorkspace: () => ({ active: { view: "dashboard" }, setActiveView: vi.fn(), addTab: vi.fn() }),
}));
vi.mock("@/components/SplitLayout", () => ({ SplitLayout: () => <div data-testid="split" /> }));
vi.mock("@/features/drawer/TaskDrawer", () => ({ TaskDrawer: () => null }));
vi.mock("@/features/issues/IssueContextMenu", () => ({
  IssueMenuProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/features/command/CommandPalette", () => ({
  CommandPaletteProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { AppShell } from "./AppShell";

function mk(onboarded: boolean): ModulesView {
  return {
    onboarded,
    modules: IDS.map((id) => ({ id, kind: "feature", enabled: false, available: true, missing: [] })),
  };
}

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("AppShell", () => {
  it("shows the picker instead of the workspace when not onboarded", async () => {
    view = mk(false);
    renderIt();
    expect(await screen.findByRole("heading", { name: /choose your tools/i })).toBeTruthy();
    expect(screen.queryByTestId("split")).toBeNull();
    expect(screen.queryByRole("button", { name: "Dashboard" })).toBeNull();
  });

  it("with nothing enabled offers only Dashboard and Settings", async () => {
    view = mk(true);
    renderIt();
    expect(await screen.findByTestId("split")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /choose your tools/i })).toBeNull();
    const labels = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Dashboard", "Settings", "Refresh"]);
  });
});
