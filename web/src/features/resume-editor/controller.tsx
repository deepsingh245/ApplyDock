// The editing session's actions: everything that talks to the helper goes through here so it can flush the
// autosave first and turn a 409 into the conflict banner.
import { useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { draftKeys, fetchEditorState, fetchFile } from "@/api/drafts";
import { keys, useReloadState } from "@/api/state";
import { ANALYSIS_RUNNING, type Analysis, type Entry, type Resume } from "@/api/types";
import { useDialogs } from "@/components/ui/confirm";
import { notify } from "@/components/ui/toaster";
import { editorPath } from "@/features/applications/actions";
import { profileItemPath } from "@/features/profile/links";
import { api, ApiError, errorMessage } from "@/lib/api";
import { plural } from "@/lib/format";
import type { DraftSaver } from "./saver";
import { editor } from "./store";
import type { Change, Draft, EditorJob, EditorState, EditorVersion, ProfileEntry, Suggestion, Validation } from "./types";

export interface EditorController {
  resumeId: string;
  entryId: string;
  entry: Entry | null;
  data: EditorState;
  flush: () => Promise<void>;
  back: () => Promise<void>;
  reset: () => Promise<void>;
  saveVersion: (analyze?: boolean) => Promise<void>;
  analyzeDraft: () => Promise<void>;
  checkScore: (full?: boolean) => Promise<void>;
  requestSuggestions: () => Promise<void>;
  recommendFromProfile: () => Promise<void>;
  suggestionAction: (action: "accept" | "edit" | "revert" | "reject", item: Suggestion) => Promise<void>;
  addFromProfile: (entry: ProfileEntry) => Promise<void>;
  openProfileItem: (itemId: string) => Promise<void>;
  validate: () => Promise<void>;
  download: () => Promise<void>;
  downloadVersion: (version: EditorVersion) => Promise<void>;
  compareWith: (value: string) => Promise<void>;
  compareOriginal: () => Promise<void>;
  restoreVersion: (version: EditorVersion) => Promise<void>;
  loadVersion: (version: EditorVersion) => Promise<void>;
  markReviewed: () => Promise<void>;
  reimport: (mode: "codex" | "heuristic") => Promise<void>;
  applyImportJob: () => Promise<void>;
  tailor: () => Promise<void>;
  fit: () => Promise<void>;
  openAnalysis: () => Promise<void>;
  useForApplication: () => Promise<void>;
  conflictLoad: () => void;
  conflictKeep: () => Promise<void>;
  removeItemConfirmed: (message: string) => Promise<boolean>;
  showPanel: (panel: ReturnType<typeof editor>["panel"]) => void;
  hasUnsavedVersionChanges: () => boolean;
}

const Context = createContext<EditorController | null>(null);
export const EditorProvider = Context;

export function useCtl(): EditorController {
  const value = use(Context);
  if (!value) throw new Error("useCtl outside the resume editor");
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useEditorController({ resumeId, entryId, entry, data, saver }: { resumeId: string; entryId: string; entry: Entry | null; data: EditorState; saver: DraftSaver }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const reloadState = useReloadState();
  const { confirm, prompt } = useDialogs();

  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 409 && error.payload.draft) editor().setConflict(error.payload.draft as Draft);
    notify(errorMessage(error), true);
  }, []);

  /** Run a server action on saved content; any failure becomes a notice (and a conflict banner for 409s). */
  const guarded = useCallback(
    <A extends unknown[]>(run: (...args: A) => Promise<unknown>) =>
      async (...args: A) => {
        try {
          await run(...args);
        } catch (error) {
          fail(error);
        }
      },
    [fail],
  );

  return useMemo<EditorController>(() => {
    const flush = () => saver.flush();
    const versions = () => (client.getQueryData<EditorState>(keys.draft(resumeId)) ?? data).versions;
    const current = () => versions().find((version) => version.is_current);
    const hasUnsavedVersionChanges = () => {
      const state = editor();
      const base = (client.getQueryData<EditorState>(keys.draft(resumeId)) ?? data).base_content_hash;
      return !base || state.contentHash !== base || state.status !== "saved";
    };

    /** Re-read versions and import state (not the content being edited) and the app state. */
    const refreshData = async () => {
      const fresh = await fetchEditorState(resumeId);
      client.setQueryData(keys.draft(resumeId), fresh);
      const { content: _content, ...meta } = fresh.draft;
      editor().patchMeta({ needs_review: meta.needs_review, import_source: meta.import_source, import_warnings: meta.import_warnings, base_version_id: meta.base_version_id });
      await reloadState();
    };

    const invalidateSuggestions = () => client.invalidateQueries({ queryKey: ["suggestions", resumeId] });

    const fetchAnalysis = (id: string) =>
      client.fetchQuery({ queryKey: keys.analysis(id), queryFn: () => api<{ analysis: Analysis }>(`/api/analyses/${id}`).then((r) => r.analysis), staleTime: 0 });

    const analyzeDraft = async () => {
      if (!entry) return;
      await flush();
      const result = await api<{ analysis: Analysis; cached: boolean }>(`/api/resumes/${resumeId}/draft/analyze`, "POST", { entry_id: entry.id, expected_revision: editor().revision });
      client.setQueryData(keys.analysis(result.analysis.id), result.analysis);
      editor().set({ analysisId: result.analysis.id, panel: "analysis" });
      notify(result.cached ? "This exact draft was already analyzed; showing that result." : "Checking the current draft against this job…");
    };

    const requestSuggestions = async () => {
      const analysisId = editor().analysisId;
      await flush();
      const result = await api<{ job: EditorJob; reused: boolean; suggestions: Suggestion[] }>(`/api/analyses/${analysisId}/suggestions`, "POST", { resume_id: resumeId });
      client.setQueryData(draftKeys.suggestions(resumeId, analysisId), result.suggestions ?? []);
      client.setQueryData(keys.job(result.job.id), result.job);
      editor().set({ suggestionJobId: result.job.id });
      if (!["pending", "running"].includes(result.job.status)) {
        await invalidateSuggestions();
        notify(result.reused ? "Loaded suggestions already prepared for this exact draft." : "Suggestions ready.");
      }
    };

    const compareWith = async (value: string) => {
      const previous = editor().compare;
      if (previous?.pdfUrl) URL.revokeObjectURL(previous.pdfUrl);
      if (!value) return editor().set({ compare: null });
      const [kind, versionId] = value.split(":");
      const source = kind === "p" ? data.parent?.id : resumeId;
      editor().set({ compare: { value, loading: true } });
      try {
        await flush();
        const result = await api<{ changes_to_draft?: Change[] | null }>(`/api/resumes/${source}/versions/${versionId}/content?draft_of=${encodeURIComponent(resumeId)}`);
        if (result.changes_to_draft) editor().set({ compare: { value, changes: result.changes_to_draft } });
        else {
          const blob = await fetchFile(`/api/resumes/${source}/versions/${versionId}/file`);
          editor().set({ compare: { value, pdfUrl: URL.createObjectURL(blob) } });
        }
      } catch (error) {
        editor().set({ compare: { value, error: errorMessage(error) } });
      }
    };

    const downloadVersion = async (version: EditorVersion) => {
      try {
        const blob = await fetchFile(`/api/resumes/${resumeId}/versions/${version.id}/file?download=1`);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = version.original_filename || "Resume.pdf";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (error) {
        notify(errorMessage(error), true);
      }
    };

    const saveVersion = async (analyze = false) => {
      await flush();
      const result = await api<{ version_id: string; version_number: number; unchanged: boolean; validation: Validation }>(`/api/resumes/${resumeId}/versions/from-draft`, "POST", {
        expected_revision: editor().revision,
      });
      editor().set({ validation: result.validation });
      await refreshData();
      const warnings = result.validation.warnings.length;
      notify(
        result.unchanged
          ? `No changes since version ${result.version_number}.`
          : `Saved version ${result.version_number}.${warnings ? ` ${warnings} PDF check warning(s) — see Preview.` : " PDF checks passed."}`,
        warnings > 0,
      );
      if (analyze && entry) {
        const analysis = await api<{ analysis: Analysis; cached: boolean }>(`/api/entries/${entry.id}/analyses`, "POST", { resume_version_id: result.version_id });
        client.setQueryData(keys.analysis(analysis.analysis.id), analysis.analysis);
        editor().set({ analysisId: analysis.analysis.id, panel: "analysis" });
        await reloadState();
        notify(analysis.cached ? "This exact version was already analyzed; showing that result." : `Analysis queued for version ${result.version_number}.`);
      }
    };

    const acceptDraft = (draft: Draft) => editor().acceptServerDraft(draft);

    return {
      resumeId,
      entryId,
      entry,
      data,
      flush,
      hasUnsavedVersionChanges,
      showPanel: (panel) => {
        editor().set({ panel });
        if (panel === "analysis" && editor().analysisId) void client.invalidateQueries({ queryKey: keys.analysis(editor().analysisId) });
        if (panel === "profile") void client.invalidateQueries({ queryKey: draftKeys.profileEntries(resumeId) });
      },
      back: async () => {
        await flush().catch(() => {});
        navigate(entry ? `/applications/${entry.id}` : `/resumes/${resumeId}`);
      },
      reset: guarded(async () => {
        if (!(await confirm({ message: "Discard all edits since the last saved version?", confirmLabel: "Discard edits", danger: true }))) return;
        await flush();
        const result = await api<{ draft: Draft }>(`/api/resumes/${resumeId}/draft/reset`, "POST", { expected_revision: editor().revision, version_id: editor().meta?.base_version_id });
        acceptDraft(result.draft);
        editor().clearHistory();
        notify("Reset to the last saved version.");
      }),
      saveVersion: guarded(saveVersion),
      analyzeDraft: guarded(analyzeDraft),
      checkScore: guarded(async (full = false) => {
        const analysisId = editor().analysisId;
        if (!analysisId) return notify("Run an analysis for this job first; Check score compares your draft with it.", true);
        editor().set({ panel: "analysis" });
        await flush();
        const result = await api<{ job: EditorJob }>(`/api/analyses/${analysisId}/score-check`, "POST", { resume_id: resumeId, expected_revision: editor().revision, full });
        client.setQueryData(keys.job(result.job.id), result.job);
        editor().set({ scoreCheck: { analysisId, jobId: result.job.id } });
      }),
      requestSuggestions: guarded(requestSuggestions),
      recommendFromProfile: guarded(async () => {
        try {
          let analysisId = editor().analysisId;
          let analysis = analysisId ? client.getQueryData<Analysis>(keys.analysis(analysisId)) : undefined;
          if (analysis?.status !== "complete") {
            editor().set({ recommending: "Analyzing this draft against the job with your current profile…" });
            await analyzeDraft();
            editor().set({ panel: "profile" });
            analysisId = editor().analysisId;
            analysis = client.getQueryData<Analysis>(keys.analysis(analysisId));
          }
          for (let tries = 0; tries < 120 && analysis && ANALYSIS_RUNNING.has(analysis.status); tries++) {
            await sleep(1500);
            if (editor().resumeId !== resumeId) return;
            analysis = await fetchAnalysis(analysisId);
          }
          if (analysis?.status !== "complete") throw new Error((analysis?.error_message as string) || "The analysis did not finish. Open Job match for details.");
          editor().set({ recommending: "Preparing suggestions from your profile…" });
          await requestSuggestions();
        } finally {
          editor().set({ recommending: "" });
        }
      }),
      suggestionAction: guarded(async (action, item) => {
        if (action === "reject") {
          await api(`/api/resume-suggestions/${item.id}`, "PATCH", { status: "rejected" });
          await invalidateSuggestions();
          return;
        }
        await flush();
        let text: string | undefined;
        if (action === "edit") {
          const edited = await prompt({ title: "Edit suggestion", message: "Edit the suggested text before applying it:", initialValue: item.proposed_text, label: "Suggested text", confirmLabel: "Apply" });
          if (edited === null) return;
          text = edited;
        }
        let confirmVerified = false;
        if ((action === "accept" || action === "edit") && item.needs_verification) {
          const flags = (item.guard_flags ?? []).map((flag) => flag.value).join(", ");
          confirmVerified = await confirm({
            title: "Needs your verification",
            message: `This suggestion adds something not found in your resume${item.source ? " or verified profile" : ""}${flags ? ` (${flags})` : ""}. Only continue if it is accurate for your real experience. Apply it?`,
            confirmLabel: "Apply",
          });
          if (!confirmVerified) return;
        } else if (
          action === "accept" &&
          item.source &&
          !(await confirm({
            title: "Add to the draft?",
            message: (
              <>
                <p className="m-0 mb-2">{item.proposed_text}</p>
                <p className="m-0">You can revert it, and nothing is saved as a version until you choose Save version.</p>
              </>
            ),
            confirmLabel: "Add to resume",
          }))
        )
          return;
        const path = `/api/resume-suggestions/${item.id}/${action === "revert" ? "revert" : "accept"}`;
        const result = await api<{ draft: Draft }>(path, "POST", { expected_revision: editor().revision, ...(text !== undefined ? { text } : {}), confirm_verified: confirmVerified });
        acceptDraft(result.draft);
        await invalidateSuggestions();
        notify(action === "revert" ? "Suggestion reverted." : "Suggestion applied to the draft. Use Check score to see its effect — no need to save a version.");
      }),
      addFromProfile: guarded(async (profileEntry) => {
        const key = profileEntry.key;
        const personalField = key.startsWith("personal:") ? (key === "personal:summary" ? "summary" : "label") : "";
        const content = editor().content!;
        const replace = Boolean(personalField && content.basics[personalField]);
        if (
          replace &&
          !(await confirm({
            message: `Replace the resume's current ${personalField === "label" ? "headline" : "summary"} with the one from your Master Profile? You can undo this.`,
            confirmLabel: "Replace",
          }))
        )
          return;
        if (!profileEntry.verified && !(await confirm({ message: `‘${profileEntry.label}’ is not verified in your Master Profile. Only add it if it is accurate. Add it?`, confirmLabel: "Add it" })))
          return;
        await flush();
        const result = await api<{ draft: Draft; entries: ProfileEntry[] }>(`/api/resumes/${resumeId}/draft/add-from-profile`, "POST", {
          key,
          expected_revision: editor().revision,
          confirm_unverified: !profileEntry.verified,
          replace,
        });
        client.setQueryData(draftKeys.profileEntries(resumeId), result.entries);
        if (personalField === "summary") editor().reveal("summary");
        acceptDraft(result.draft);
        notify(`Added ‘${profileEntry.label}’ to the draft. Undo is available; choose Save version when you're happy.`);
      }),
      openProfileItem: async (itemId) => {
        await flush().catch(() => {});
        navigate(profileItemPath(itemId));
      },
      validate: guarded(async () => {
        const result = await api<{ validation: Validation }>(`/api/resumes/${resumeId}/draft/validate`, "POST", { content: editor().content });
        editor().set({ validation: result.validation });
      }),
      download: guarded(async () => {
        const version = current();
        if (!version) return notify("No saved version yet.", true);
        if (
          hasUnsavedVersionChanges() &&
          !(await confirm({
            message: `Download the last saved version (v${version.version_number})? Your newer edits are not in it — use Save version first to include them.`,
            confirmLabel: "Download",
          }))
        )
          return;
        await downloadVersion(version);
      }),
      downloadVersion,
      compareWith,
      compareOriginal: async () => {
        const original = versions().filter((version) => version.source === "upload").pop();
        editor().set({ panel: "compare" });
        if (original) await compareWith(`v:${original.id}`);
      },
      restoreVersion: guarded(async (version) => {
        if (!(await confirm({ message: "Make this version current? Applications that follow this resume will use it; pinned applications keep their exact file.", confirmLabel: "Make current" })))
          return;
        await api(`/api/resumes/${resumeId}/versions/${version.id}/restore`, "POST", {});
        await refreshData();
        notify("Version restored as current.");
      }),
      loadVersion: guarded(async (version) => {
        if (!(await confirm({ message: "Replace the draft with this version's content? You can undo this.", confirmLabel: "Replace draft" }))) return;
        await flush();
        const result = await api<{ draft: Draft }>(`/api/resumes/${resumeId}/draft/reset`, "POST", { expected_revision: editor().revision, version_id: version.id });
        acceptDraft(result.draft);
        notify("Draft loaded from that version.");
      }),
      markReviewed: guarded(async () => {
        await flush();
        const state = editor();
        const result = await api<{ draft: Draft }>(`/api/resumes/${resumeId}/draft`, "PATCH", { content: state.content, expected_revision: state.revision, reviewed: true });
        const { content: _content, ...meta } = result.draft;
        editor().set({ revision: result.draft.revision, contentHash: result.draft.content_hash });
        editor().patchMeta(meta);
        notify("Thanks — the imported content is marked as reviewed.");
      }),
      reimport: guarded(async (mode) => {
        if (
          !(await confirm({
            message: "Replace the current fields with a new import of the original file? Your edits since the last import will be lost (you can undo).",
            confirmLabel: "Re-import",
          }))
        )
          return;
        await flush();
        const result = await api<{ draft?: Draft; job?: EditorJob }>(`/api/resumes/${resumeId}/draft/import`, "POST", { mode, expected_revision: editor().revision });
        if (result.draft) {
          acceptDraft(result.draft);
          return notify("Import applied. Review every field.");
        }
        if (result.job) {
          const fresh = client.getQueryData<EditorState>(keys.draft(resumeId)) ?? data;
          client.setQueryData(keys.draft(resumeId), { ...fresh, import: { ...fresh.import, job: result.job } });
          client.setQueryData(keys.job(result.job.id), result.job);
        }
        notify("Codex is reading your resume. This uses your ChatGPT Plus allowance once per file.");
      }),
      applyImportJob: guarded(async () => {
        await flush();
        const applied = await api<{ draft?: Draft }>(`/api/resumes/${resumeId}/draft/import`, "POST", { mode: "codex", expected_revision: editor().revision });
        if (applied.draft) acceptDraft(applied.draft);
        notify("Codex import applied. Review every field before saving.");
      }),
      tailor: guarded(async () => {
        if (!entry) return;
        await flush();
        const result = await api<{ resume: Resume; created: boolean }>(`/api/entries/${entry.id}/tailor`, "POST", { base_resume_id: resumeId });
        await reloadState();
        notify(result.created ? "Tailored copy created. The master resume is unchanged." : "Opened this application's existing tailored copy.");
        navigate(editorPath(result.resume.id, { entryId: entry.id, analysisId: editor().analysisId }));
      }),
      fit: guarded(async () => {
        await flush();
        const content = editor().content!;
        const result = await api<{ changed: boolean; fitted: boolean; page_count: number; layout: Record<string, string | number | boolean> }>(`/api/resumes/${resumeId}/draft/fit`, "POST", {
          content,
          page_limit: content.meta.page_limit,
        });
        if (result.changed)
          editor().structural((draft) => {
            draft.meta.layout = result.layout;
          });
        notify(
          result.fitted
            ? result.changed
              ? `Adjusted spacing to fit ${result.page_count} page(s). Undo restores the previous design.`
              : "Already fits."
            : `Still ${result.page_count} pages at the smallest readable settings. Shorten the content to fit.`,
          !result.fitted,
        );
      }),
      openAnalysis: async () => {
        await flush().catch(() => {});
        editor().set({ analysisDialog: true });
      },
      useForApplication: guarded(async () => {
        if (!entry) return;
        const version = current();
        if (
          hasUnsavedVersionChanges() &&
          !(await confirm({
            message: `Your latest edits are not saved as a version. Attach the last saved version (v${version?.version_number ?? "?"}) to this application anyway?`,
            confirmLabel: "Attach saved version",
          }))
        )
          return;
        await api(`/api/entries/${entry.id}/pin-resume`, "POST", { resume_id: resumeId, resume_version_id: version?.id ?? "" });
        await reloadState();
        notify(`This application will attach version ${version?.version_number ?? ""} exactly. Update its Gmail draft if one exists.`);
      }),
      conflictLoad: () => {
        const latest = editor().conflict;
        if (latest) acceptDraft(latest);
      },
      conflictKeep: async () => {
        editor().keepMine();
        await saver.save();
      },
      removeItemConfirmed: (message) => confirm({ message, confirmLabel: "Remove", danger: true }),
    };
  }, [resumeId, entryId, entry, data, saver, client, navigate, reloadState, confirm, prompt, guarded]);
}

export const suggestionCountLabel = (count: number) => `${count} ${plural(count, "suggestion")}`;
