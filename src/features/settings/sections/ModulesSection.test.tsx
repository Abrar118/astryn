// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModuleId, ModulesView } from "@/lib/commands";

const IDS: ModuleId[] = ["linear", "github", "slack", "llm", "docs", "reports", "link-previews"];
let view: ModulesView;

vi.mock("@/lib/commands", async (orig) => ({
  ...(await orig<typeof import("@/lib/commands")>()),
  listModules: vi.fn(async () => view),
  setEnabledModules: vi.fn(async () => view),
  setDisabledScreens: vi.fn(async () => view),
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
    disabledScreens: [],
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

  it("a toggle refreshes every cache that joins the tracker", async () => {
    view = mk(["linear", "github", "slack"]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    render(
      <QueryClientProvider client={qc}>
        <ModulesSection />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("switch", { name: /slack/i }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["bitbucket-prs"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["github-prs"] });
  });

  it("shows the missing-capability hint", async () => {
    view = mk(["linear", "docs"], { docs: ["docs-source"] });
    renderIt();
    expect(await screen.findByText(new RegExp(`Needs ${CAPABILITY_PROVIDERS["docs-source"]}`))).toBeTruthy();
  });

  it("nests screen switches under an enabled module and saves the disabled set", async () => {
    view = { ...mk(["linear"]), disabledScreens: ["graph"] };
    renderIt();
    const screens = await screen.findByRole("list", { name: /linear screens/i });
    const labels = within(screens).getAllByRole("switch").map((s) => s.getAttribute("aria-label"));
    expect(labels).toEqual(["Issues", "This Week", "Dependencies", "Inbox"]);
    expect((within(screens).getByRole("switch", { name: "Dependencies" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("switch", { name: "Calendar" })).toBeNull();
    fireEvent.click(within(screens).getByRole("switch", { name: "Inbox" }));
    await waitFor(() => expect(commands.setDisabledScreens).toHaveBeenCalledWith(["graph", "inbox"]));
    expect(commands.setEnabledModules).not.toHaveBeenCalled();
  });

  it("hides screen switches while their module is off", async () => {
    view = mk(["github"]);
    renderIt();
    await screen.findByRole("switch", { name: /slack/i });
    expect(screen.queryByRole("list", { name: /linear screens/i })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Inbox" })).toBeNull();
  });

  it("offers a retry when modules fail to load", async () => {
    vi.mocked(commands.listModules).mockRejectedValueOnce("Internal error.");
    view = mk(["slack"]);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("switch", { name: /slack/i })).toBeTruthy();
    expect(screen.queryByText(/couldn't load modules/i)).toBeNull();
  });

  it("locks the switches while module data is being removed", async () => {
    let finish: () => void = () => {};
    vi.mocked(commands.removeModuleData).mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
    view = mk(["linear"]);
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /remove slack data/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect((screen.getByRole("switch", { name: /slack/i }) as HTMLInputElement).disabled).toBe(true));
    finish();
    await waitFor(() => expect((screen.getByRole("switch", { name: /slack/i }) as HTMLInputElement).disabled).toBe(false));
  });

  it("offers data removal only for disabled modules, behind a confirmation", async () => {
    view = mk(["linear", "github"]);
    renderIt();
    await screen.findByRole("switch", { name: /slack/i });
    expect(screen.queryAllByRole("button", { name: /remove slack data/i }).length).toBe(1);
    expect(screen.queryByRole("button", { name: /remove linear data/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove reports data/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /remove slack data/i }));
    expect(screen.getByText(/token/i)).toBeTruthy();
    expect(screen.getByText(/cached Slack messages/i)).toBeTruthy();
    expect(commands.removeModuleData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(commands.removeModuleData).toHaveBeenCalledWith("slack"));
  });
});
