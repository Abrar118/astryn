export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export class DescriptionAutosave {
  status: SaveStatus = "idle";
  private draft: string;
  private acknowledged: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private failed = false;
  private listeners = new Set<(status: SaveStatus) => void>();

  constructor(
    initial: string,
    private readonly save: (markdown: string) => Promise<void>,
    private readonly delay = 750,
  ) {
    this.draft = initial;
    this.acknowledged = initial;
  }

  subscribe(listener: (status: SaveStatus) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private setStatus(status: SaveStatus) {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }

  update(markdown: string): void {
    this.draft = markdown;
    this.failed = false;
    this.setStatus(markdown === this.acknowledged ? "saved" : "dirty");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => undefined);
    }, this.delay);
  }

  /**
   * Persist the current draft. `force` clears the failed-latch so an explicit
   * user action (e.g. blurring the editor) retries a previously-failed save
   * instead of resolving as a no-op — otherwise leaving the field after a
   * failure would let the caller exit edit mode and discard the unsaved draft.
   * A plain (non-forced) flush from the debounce timer still no-ops while
   * failed, so a persistent error can't hammer the API.
   */
  async flush(force = false): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) return this.inFlight;
    if (force) this.failed = false;
    if (this.failed || this.draft === this.acknowledged) return;
    const saving = this.draft;
    this.setStatus("saving");
    this.inFlight = this.save(saving)
      .then(() => {
        this.acknowledged = saving;
        this.setStatus(this.draft === saving ? "saved" : "dirty");
      })
      .catch((error: unknown) => {
        this.failed = true;
        this.setStatus("error");
        throw error;
      })
      .finally(() => { this.inFlight = null; });
    try {
      await this.inFlight;
    } finally {
      if (!this.failed && this.draft !== this.acknowledged) await this.flush();
    }
  }

  async settled() {
    while (this.inFlight) await this.inFlight;
  }

  acceptExternal(markdown: string): boolean {
    if (this.inFlight || this.timer || this.failed || this.draft !== this.acknowledged) return false;
    this.draft = markdown;
    this.acknowledged = markdown;
    this.setStatus("idle");
    return true;
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
