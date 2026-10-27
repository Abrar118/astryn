// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/modules", async (orig) => ({
  ...(await orig<typeof import("@/lib/modules")>()),
  useModules: () => ({ isActive: (id: string) => id === "github", hasCapability: () => false, ready: true }),
}));

import { SettingsNav } from "./SettingsNav";

afterEach(cleanup);

describe("SettingsNav module gating", () => {
  it("hides sections of inactive modules and keeps core ones", () => {
    render(<SettingsNav active="github" onSelect={() => {}} />);
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.queryByText("Slack")).toBeNull();
    expect(screen.queryByText("AI")).toBeNull();
    expect(screen.queryByText("Linear")).toBeNull();
  });
});
