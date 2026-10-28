import { useJob } from "@/api/drafts";
import { Button } from "@/components/ui/button";
import { BackButton, Eyebrow } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { useCtl } from "./controller";
import { useEditor } from "./store";

const STATUS_LABELS = { saved: "All changes saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save failed — retrying when you edit", conflict: "Changed elsewhere" };

export function EditorHeader() {
  const { data, entry, back } = useCtl();
  const resume = data.resume;
  const status = useEditor((state) => state.status);
  const pageCount = useEditor((state) => state.preview.pageCount);
  const limit = useEditor((state) => Number(state.content?.meta.page_limit || 0));
  const over = Boolean(limit && pageCount && pageCount > limit);
  const contextLine =
    resume.kind === "tailored"
      ? `Tailored copy for ${data.entry ? `${data.entry.title || "an application"}${data.entry.company ? ` at ${data.entry.company}` : ""}` : "an application"}${
          data.parent ? ` · based on ${data.parent.name}${data.parent.deleted ? " (master deleted)" : ""}` : ""
        }`
      : "Master resume · editing never changes resumes already tailored for applications";
  return (
    <div className="grid gap-2">
      <div>
        <BackButton onClick={() => void back()}>{entry ? "Back to application" : "Back to resume library"}</BackButton>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Resume editor</Eyebrow>
          <h1 className="m-0 flex flex-wrap items-center gap-2 text-xl font-semibold text-ink">
            <span className="min-w-0 truncate">{resume.name}</span>
            <Pill tone={resume.kind === "tailored" ? "success" : "neutral"} data-testid="resume-kind" data-kind={resume.kind}>
              {resume.kind === "tailored" ? "Tailored" : "Master"}
            </Pill>
          </h1>
          <p className="m-0 mt-0.5 text-sm text-ink-2">{contextLine}</p>
        </div>
        <div className="flex items-center gap-2" aria-live="polite">
          <Pill tone={status === "saved" ? "success" : status === "error" || status === "conflict" ? "danger" : "neutral"} data-testid="save-status" data-status={status}>
            {STATUS_LABELS[status]}
          </Pill>
          <Pill tone={over ? "danger" : "outline"} data-testid="page-status" className="tabular">
            {pageCount ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}${limit ? ` of ${limit}` : ""}` : "Preview pending"}
          </Pill>
        </div>
      </div>
    </div>
  );
}

export function EditorToolbar() {
  const ctl = useCtl();
  const canUndo = useEditor((state) => state.undo.length > 0);
  const canRedo = useEditor((state) => state.redo.length > 0);
  const undo = useEditor((state) => state.undoEdit);
  const redo = useEditor((state) => state.redoEdit);
  return (
    <div role="toolbar" aria-label="Resume editor actions" className="flex flex-wrap items-center gap-1.5 border-b border-line pb-3" data-testid="editor-toolbar">
      <Button variant="quiet" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        Undo
      </Button>
      <Button variant="quiet" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
        Redo
      </Button>
      <Button variant="quiet" onClick={() => void ctl.reset()}>
        Reset unsaved edits
      </Button>
      <span className="flex-1" />
      <Button variant="quiet" onClick={() => void ctl.download()}>
        Download PDF
      </Button>
      {ctl.entry ? (
        <>
          <Button title="Score the current draft, including accepted suggestions, against this job — no version is saved" onClick={() => void ctl.checkScore(false)}>
            Check score
          </Button>
          <Button variant="quiet" onClick={() => void ctl.saveVersion(true)}>
            Save &amp; new analysis
          </Button>
        </>
      ) : null}
      <Button variant="primary" onClick={() => void ctl.saveVersion(false)}>
        Save version
      </Button>
    </div>
  );
}

const IMPORT_SOURCES: Record<string, string> = { heuristic: "ApplyDock's local reader", codex: "Codex", empty: "an empty template", version: "a saved version" };

export function EditorBanners() {
  const ctl = useCtl();
  const conflict = useEditor((state) => state.conflict);
  const meta = useEditor((state) => state.meta);
  const importJobId = ctl.data.import.job?.id ?? "";
  const { data: importJob } = useJob(importJobId);
  const job = importJob ?? ctl.data.import.job;
  const running = Boolean(job && ["pending", "running"].includes(job.status));
  const warnings = meta?.import_warnings ?? [];
  return (
    <div className="grid gap-2 empty:hidden" data-testid="editor-banners">
      {conflict ? (
        <Note tone="danger" className="grid gap-2" data-testid="conflict-banner">
          <strong>This resume was changed in another tab.</strong>
          <span>Load the latest draft (your recent edits here are discarded) or keep this version (it replaces the other changes).</span>
          <div className="flex flex-wrap gap-2">
            <Button onClick={ctl.conflictLoad}>Load latest</Button>
            <Button variant="quiet" onClick={() => void ctl.conflictKeep()}>
              Keep mine
            </Button>
          </div>
        </Note>
      ) : null}
      {meta?.needs_review ? (
        <Note tone="warn" className="grid gap-2" data-testid="review-banner">
          <strong>Review the imported content</strong>
          <span>
            The fields were filled from your original file by {IMPORT_SOURCES[meta.import_source ?? ""] ?? "the uploaded file"}. Check names, dates, titles and every bullet before saving — the original PDF
            stays unchanged.
          </span>
          {warnings.length ? (
            <ul className="m-0 pl-5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {running && job ? (
            <p className="m-0 text-ink-2">
              Codex import: {job.message || "waiting"} ({job.percent}%)
            </p>
          ) : null}
          {job?.status === "failed" ? <p className="m-0 text-danger">Codex import failed: {job.error_message}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void ctl.markReviewed()}>
              I have reviewed the content
            </Button>
            {ctl.data.import.extraction_status === "ready" && meta.import_source !== "codex" ? (
              <Button disabled={running} onClick={() => void ctl.reimport("codex")}>
                Re-import with Codex
              </Button>
            ) : null}
            <Button variant="quiet" onClick={() => void ctl.reimport("heuristic")}>
              {meta.import_source === "codex" ? "Use local import instead" : "Re-run local import"}
            </Button>
            <Button variant="quiet" onClick={() => void ctl.compareOriginal()}>
              View original PDF
            </Button>
          </div>
        </Note>
      ) : null}
      {ctl.data.resume.kind === "tailored" && ctl.data.parent?.deleted ? (
        <Note tone="neutral">The master resume this copy came from was deleted. This tailored resume keeps working on its own.</Note>
      ) : null}
    </div>
  );
}

export function MobileTabs() {
  const tab = useEditor((state) => state.mobileTab);
  const set = useEditor((state) => state.set);
  return (
    <div className="flex gap-1 md:hidden" role="tablist" aria-label="Edit or preview">
      {(["edit", "preview"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          onClick={() => set({ mobileTab: value })}
          className={cn("h-8 flex-1 cursor-pointer rounded-sm border border-line-strong text-sm font-medium", tab === value ? "bg-ink text-canvas" : "bg-surface text-ink-2")}
        >
          {value === "edit" ? "Edit" : "Preview"}
        </button>
      ))}
    </div>
  );
}
