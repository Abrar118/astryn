// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModuleId, ModulesView } from "@/lib/commands";

const IDS: ModuleId[] = ["linear", "github", "slack", "llm", "docs", "reports", "link-previews"];
let view: ModulesView;

vi.mock("@/lib/commands", async (orig) => ({
  ...(await orig<typeof import("@/lib/commands")>()),
  listModules: vi.fn(async () => view),
  setEnabledModules: vi.fn(async () => view),
  removeModuleData: vi.fn(async () => undefined),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { success: vi.fn(), error: vi.fn() } }));

import * as commands from "@/lib/commands";
import { CAPABILITY_PROVIDERS } from "@/lib/modules";
import { ModulesSection } from "./ModulesSection";

function mk(enabled: ModuleId[], missing: Partial<Record<ModuleId, ModulesView["modules"][0]["missing"]>> = {}): ModulesView {
  return {
    onboarded: true,
    modules: IDS.map((id) => ({
      id,
      kind: "feature",
      enabled: enabled.includes(id),
      available: !missing[id]?.length,
      missing: missing[id] ?? [],
    })),
  };
}

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ModulesSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("ModulesSection", () => {
  it("toggling Slack off sends every other enabled id", async () => {
    view = mk(["linear", "github", "slack"]);
    renderIt();
    fireEvent.click(await screen.findByRole("switch", { name: /slack/i }));
    await waitFor(() => expect(commands.setEnabledModules).toHaveBeenCalledWith(["linear", "github"]));
  });

  it("shows the missing-capability hint", async () => {
    view = mk(["linear", "docs"], { docs: ["docs-source"] });
    renderIt();
    expect(await screen.findByText(new RegExp(`Needs ${CAPABILITY_PROVIDERS["docs-source"]}`))).toBeTruthy();
  });

  it("offers data removal only for disabled modules, behind a confirmation", async () => {
    view = mk(["linear", "github"]);
    renderIt();
    await screen.findByRole("switch", { name: /slack/i });
    expect(screen.queryAllByRole("button", { name: /remove slack data/i }).length).toBe(1);
    expect(screen.queryByRole("button", { name: /remove linear data/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /remove slack data/i }));
    expect(screen.getByText(/cached/i)).toBeTruthy();
    expect(commands.removeModuleData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(commands.removeModuleData).toHaveBeenCalledWith("slack"));
  });
});
