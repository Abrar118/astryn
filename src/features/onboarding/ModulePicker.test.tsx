// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModuleId, ModulesView } from "@/lib/commands";

const IDS: ModuleId[] = ["linear", "github", "bitbucket", "slack", "llm", "docs", "reports", "link-previews"];
let view: ModulesView;

vi.mock("@/lib/commands", async (orig) => ({
  ...(await orig<typeof import("@/lib/commands")>()),
  listModules: vi.fn(async () => view),
  setEnabledModules: vi.fn(async () => view),
}));
vi.mock("goey-toast", () => ({ gooeyToast: { success: vi.fn(), error: vi.fn() } }));

import * as commands from "@/lib/commands";
import { CAPABILITY_PROVIDERS, previewMissing } from "@/lib/modules";
import { ModulePicker } from "./ModulePicker";

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
    expect(previewMissing("docs", none)).toEqual(["docs-source"]);
    expect(previewMissing("docs", new Set<ModuleId>(["github"]))).toEqual([]);
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
    expect(boxes.length).toBe(8);
    expect(document.activeElement).toBe(boxes[0]);
  });

  it("shows the Needs hint for Docs until GitHub is also checked", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^docs/i }));
    const hint = new RegExp(`Needs ${CAPABILITY_PROVIDERS["docs-source"]}`);
    expect(screen.getByText(hint)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /^github/i }));
    expect(screen.queryByText(hint)).toBeNull();
  });

  it("Continue with nothing selected sends an empty list", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    await waitFor(() => expect(commands.setEnabledModules).toHaveBeenCalledWith([]));
  });

  it("submits selected ids on Enter", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^linear/i }));
    fireEvent.submit(screen.getByRole("button", { name: /continue/i }).closest("form")!);
    await waitFor(() => expect(commands.setEnabledModules).toHaveBeenCalledWith(["linear"]));
  });
});
