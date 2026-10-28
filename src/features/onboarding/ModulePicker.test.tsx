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
}));
vi.mock("goey-toast", () => ({ gooeyToast: { success: vi.fn(), error: vi.fn() } }));

import * as commands from "@/lib/commands";
import { CAPABILITY_PROVIDERS, previewMissing } from "@/lib/modules";
import { ModulePicker } from "./ModulePicker";

function mk(onboarded: boolean): ModulesView {
  return {
    onboarded,
    modules: IDS.map((id) => ({ id, kind: "feature", enabled: false, available: true, missing: [] })),
    disabledScreens: [],
  };
}

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ModulePicker />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  view = mk(false);
});
afterEach(cleanup);

describe("previewMissing", () => {
  it("matches the manifest", () => {
    const none = new Set<ModuleId>();
    expect(previewMissing("linear", none)).toEqual([]);
    // Docs reads local folders without any provider.
    expect(previewMissing("docs", none)).toEqual([]);
    expect(previewMissing("reports", none)).toEqual(["tracker"]);
    expect(previewMissing("reports", new Set<ModuleId>(["linear"]))).toEqual([]);
    expect(previewMissing("link-previews", none)).toEqual([]);
    expect(previewMissing("slack", none)).toEqual([]);
  });
});

describe("ModulePicker", () => {
  it("shows both groups and focuses the first checkbox", async () => {
    renderIt();
    expect(await screen.findByRole("heading", { name: /choose your tools/i })).toBeTruthy();
    expect(screen.getByText("Integrations")).toBeTruthy();
    expect(screen.getByText("Features")).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(7);
    expect(document.activeElement).toBe(boxes[0]);
  });

  it("shows the Needs hint for Reports until Linear is also checked", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^reports/i }));
    const hint = new RegExp(`Needs ${CAPABILITY_PROVIDERS.tracker}`);
    expect(screen.getByText(hint)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /^linear/i }));
    expect(screen.queryByText(hint)).toBeNull();
  });

  it("Continue with nothing selected sends an empty list", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    await waitFor(() => expect(commands.setEnabledModules).toHaveBeenCalledWith([]));
  });

  it("offers Linear's screens once Linear is chosen, all on by default", async () => {
    renderIt();
    await screen.findByRole("heading", { name: /choose your tools/i });
    expect(screen.queryByRole("group", { name: /linear screens/i })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /^linear/i }));
    const group = screen.getByRole("group", { name: /linear screens/i });
    const boxes = within(group).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.closest("label")?.textContent)).toEqual(["Issues", "This Week", "Dependencies", "Inbox"]);
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it("saves switched-off screens before the modules", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^linear/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^inbox/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(commands.setEnabledModules).toHaveBeenCalledWith(["linear"]));
    expect(commands.setDisabledScreens).toHaveBeenCalledWith(["inbox"]);
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0];
    expect(order(commands.setDisabledScreens)).toBeLessThan(order(commands.setEnabledModules));
  });

  it("drops screen choices of a module that ends up unselected", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^linear/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^inbox/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^linear/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(commands.setEnabledModules).toHaveBeenCalledWith([]));
    expect(commands.setDisabledScreens).toHaveBeenCalledWith([]);
  });

  it("submits selected ids on Enter", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^linear/i }));
    fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);
    await waitFor(() => expect(commands.setEnabledModules).toHaveBeenCalledWith(["linear"]));
  });
});
