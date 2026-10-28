// Draft autosave: debounced, one request at a time, and never overwrites a newer revision (409 → conflict).
import { api, ApiError, pairingKey } from "@/lib/api";
import { editor } from "./store";
import type { Draft } from "./types";

export const SAVE_DELAY = 900;

export class DraftSaver {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> | null = null;
  private pending = false;
  private disposed = false;
  readonly resumeId: string;

  constructor(resumeId: string) {
    this.resumeId = resumeId;
  }

  schedule() {
    clearTimeout(this.timer);
    if (!this.disposed) this.timer = setTimeout(() => void this.save(), SAVE_DELAY);
  }

  save(): Promise<void> {
    clearTimeout(this.timer);
    const state = editor();
    if (this.disposed || state.conflict || !state.content || state.resumeId !== this.resumeId) return Promise.resolve();
    if (this.saving) {
      this.pending = true;
      return this.saving;
    }
    const sent = state.content;
    state.beginSave();
    this.saving = (async () => {
      try {
        const result = await api<{ draft: Draft }>(`/api/resumes/${this.resumeId}/draft`, "PATCH", { content: sent, expected_revision: state.revision });
        if (!this.disposed) editor().saveSucceeded(result.draft, sent);
      } catch (error) {
        if (this.disposed) return;
        if (error instanceof ApiError && error.status === 409) editor().setConflict(error.payload.draft as Draft);
        else editor().saveFailed(error instanceof Error ? error.message : String(error));
      } finally {
        this.saving = null;
      }
      const after = editor();
      if (this.disposed || after.conflict) return;
      if (this.pending) {
        this.pending = false;
        await this.save();
      } else if (after.status === "unsaved") this.schedule();
    })();
    return this.saving;
  }

  /** Save anything outstanding now; throws when the draft cannot be saved (server actions must not run on stale content). */
  async flush() {
    clearTimeout(this.timer);
    if (this.saving) await this.saving;
    const status = editor().status;
    if (status === "unsaved" || status === "error") await this.save();
    const after = editor();
    if (after.status === "conflict") throw new Error("Resolve the editing conflict first.");
    if (after.status === "error") throw new Error(after.saveError || "The draft could not be saved.");
  }

  /** Fire-and-forget save that survives leaving the page. */
  keepalive() {
    const state = editor();
    if (!state.content || state.conflict || !["unsaved", "error"].includes(state.status) || state.resumeId !== this.resumeId) return;
    clearTimeout(this.timer);
    void fetch(`/api/resumes/${this.resumeId}/draft`, {
      method: "PATCH",
      keepalive: true,
      headers: { "X-Local-Key": pairingKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ content: state.content, expected_revision: state.revision }),
    }).catch(() => {});
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
