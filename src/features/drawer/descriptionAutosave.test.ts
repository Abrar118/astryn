import { afterEach, describe, expect, it, vi } from "vitest";
import { DescriptionAutosave } from "./descriptionAutosave";

afterEach(() => vi.useRealTimers());

describe("DescriptionAutosave", () => {
  it("debounces and saves the newest draft", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const queue = new DescriptionAutosave("old", save, 750);
    queue.update("a");
    queue.update("ab");
    await vi.advanceTimersByTimeAsync(749);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledWith("ab");
  });

  it("coalesces edits made during an in-flight save", async () => {
    let finish!: () => void;
    const first = new Promise<void>((resolve) => { finish = resolve; });
    const save = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const queue = new DescriptionAutosave("old", save, 0);
    queue.update("one");
    const pending = queue.flush();
    queue.update("three");
    finish();
    await pending;
    await queue.settled();
    expect(save.mock.calls).toEqual([["one"], ["three"]]);
  });

  it("keeps a failed draft and retries only after another edit", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const queue = new DescriptionAutosave("old", save, 0);
    queue.update("draft");
    await expect(queue.flush()).rejects.toThrow("offline");
    expect(queue.status).toBe("error");
    expect(queue.acceptExternal("old server value")).toBe(false);
    queue.update("draft again");
    await queue.flush();
    expect(save).toHaveBeenLastCalledWith("draft again");
  });

  it("retries a previously-failed save when flushed with force, but not on a plain flush", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const queue = new DescriptionAutosave("old", save, 0);
    queue.update("draft");
    await expect(queue.flush()).rejects.toThrow("offline");
    expect(queue.status).toBe("error");
    // A plain flush (e.g. a debounce tick) must NOT retry — it would hammer the API.
    await queue.flush();
    expect(save).toHaveBeenCalledTimes(1);
    // A forced flush (an explicit user blur) retries the same draft and persists it,
    // so leaving the field after a failure can't silently discard the draft.
    await queue.flush(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("draft");
    expect(queue.status).toBe("saved");
  });

  it("accepts external content only when no local draft is pending", async () => {
    const queue = new DescriptionAutosave("one", vi.fn().mockResolvedValue(undefined), 750);
    expect(queue.acceptExternal("two")).toBe(true);
    queue.update("local");
    expect(queue.acceptExternal("three")).toBe(false);
  });
});
