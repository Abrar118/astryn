// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// jsdom doesn't implement scrollIntoView — stub it so palette effects don't throw.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const ws = vi.hoisted(() => ({ openIssueInRightSplit: vi.fn(), setActiveView: vi.fn(), addTab: vi.fn() }));
const setParams = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tabs", () => ({ useWorkspace: () => ws }));
vi.mock("@/lib/queries", () => ({
  invalidateWorkspaceQueries: vi.fn(),
  useIssues: () => ({ data: [{ id: "iss-1", identifier: "AB-1", title: "First", url: "u", stateColor: "#fff", labels: [] }] }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(), setParams] }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./CreateIssueModal", () => ({ CreateIssueModal: () => null }));

import { CommandPaletteProvider, useCommandPalette } from "./CommandPalette";

function Opener() {
  const { openPalette } = useCommandPalette();
  return <button onClick={openPalette}>open</button>;
}

afterEach(() => {
  cleanup();
  ws.openIssueInRightSplit.mockReset();
  ws.setActiveView.mockReset();
  ws.addTab.mockReset();
  setParams.mockReset();
});

function openPalette() {
  render(
    <CommandPaletteProvider>
      <Opener />
    </CommandPaletteProvider>,
  );
  fireEvent.click(screen.getByText("open"));
}

describe("CommandPalette right-split sub-mode", () => {
  it("routes a picked issue to openIssueInRightSplit after choosing the command", () => {
    openPalette();
    fireEvent.click(screen.getByText("Open issue in right split"));
    fireEvent.click(screen.getByText("First"));
    expect(ws.openIssueInRightSplit).toHaveBeenCalledWith("iss-1");
    expect(setParams).not.toHaveBeenCalled(); // did NOT open the drawer
  });

  it("first Escape exits the sub-mode without closing the palette", () => {
    openPalette();
    fireEvent.click(screen.getByText("Open issue in right split"));
    const input = screen.getByPlaceholderText(/pick an issue/i);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByPlaceholderText(/type a command/i)).toBeTruthy(); // back to normal mode
  });

  it("the visible Back control exits the sub-mode", () => {
    openPalette();
    fireEvent.click(screen.getByText("Open issue in right split"));
    fireEvent.click(screen.getByLabelText("Back"));
    expect(screen.getByPlaceholderText(/type a command/i)).toBeTruthy();
  });

  it("a second Escape closes the palette", () => {
    openPalette();
    fireEvent.click(screen.getByText("Open issue in right split"));
    fireEvent.keyDown(screen.getByPlaceholderText(/pick an issue/i), { key: "Escape" }); // -> normal mode
    fireEvent.keyDown(screen.getByPlaceholderText(/type a command/i), { key: "Escape" }); // -> closed
    expect(screen.queryByPlaceholderText(/type a command/i)).toBeNull();
  });
});

describe("CommandPalette navigation + shortcuts", () => {
  it("the 'Go to Inbox' command switches the view and closes", () => {
    openPalette();
    fireEvent.click(screen.getByText("Go to Inbox"));
    expect(ws.setActiveView).toHaveBeenCalledWith("inbox");
    expect(screen.queryByPlaceholderText(/type a command/i)).toBeNull(); // closed
  });

  it("Cmd/Ctrl+T opens a new calendar tab from anywhere", () => {
    render(
      <CommandPaletteProvider>
        <div>app</div>
      </CommandPaletteProvider>,
    );
    fireEvent.keyDown(document, { key: "t", ctrlKey: true });
    expect(ws.addTab).toHaveBeenCalledWith("calendar");
  });
});
