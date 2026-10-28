// Cross-screen actions that start from an application: run its analysis, open its resume in the editor.
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router";
import { keys, useReloadState } from "@/api/state";
import type { Analysis, Entry, Resume } from "@/api/types";
import { useDialogs } from "@/components/ui/confirm";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";

export function tailoredFor(entry: Entry, resumes: Resume[]): Resume | null {
  if (entry.resume?.kind === "tailored") return entry.resume;
  return resumes.find((resume) => resume.kind === "tailored" && resume.entry_id === entry.id && resume.parent_resume_id === entry.resume_id) ?? null;
}

export interface EditorLinkOptions {
  entryId?: string;
  analysisId?: string;
  panel?: string;
  compareVersionId?: string;
}

export function editorPath(resumeId: string, options: EditorLinkOptions = {}) {
  const params = new URLSearchParams();
  if (options.entryId) params.set("entry", options.entryId);
  if (options.analysisId) params.set("analysis", options.analysisId);
  if (options.panel) params.set("panel", options.panel);
  if (options.compareVersionId) params.set("compare", options.compareVersionId);
  const query = params.toString();
  return `/resumes/${resumeId}/edit${query ? `?${query}` : ""}`;
}

/** Queue (or reuse) an analysis for an application and open it. */
export function useRunAnalysis() {
  const navigate = useNavigate();
  const reload = useReloadState();
  const client = useQueryClient();
  return useCallback(
    async (entry: Entry, beforeRun?: () => Promise<void>) => {
      try {
        await beforeRun?.();
        const result = await api<{ analysis: Analysis; cached: boolean }>(`/api/entries/${entry.id}/analyses`, "POST", {
          retry: entry.analysis?.status === "plan_limit",
        });
        client.setQueryData(keys.analysis(result.analysis.id), result.analysis);
        await reload();
        navigate(`/analysis/${result.analysis.id}`);
        notify(result.cached ? "Loaded the unchanged analysis from ApplyDock's cache." : "Analysis queued using your ChatGPT Plus Codex allowance.");
      } catch (error) {
        notify(errorMessage(error), true);
      }
    },
    [navigate, reload, client],
  );
}

/**
 * Open the resume editor for an application. "optimize" opens its tailored copy, creating one from the master
 * (after confirmation) when none exists; "edit" opens the assigned resume itself.
 */
export function useOpenResumeEditor() {
  const navigate = useNavigate();
  const reload = useReloadState();
  const { confirm } = useDialogs();
  return useCallback(
    async (entry: Entry, mode: "optimize" | "edit", resumes: Resume[], beforeOpen?: () => Promise<void>) => {
      try {
        await beforeOpen?.();
        let resumeId = entry.resume_id;
        if (mode === "optimize") {
          const existing = tailoredFor(entry, resumes);
          if (existing) resumeId = existing.id;
          else {
            const master = entry.resume?.kind === "master" ? entry.resume : null;
            if (!master) throw new Error("Choose a master resume for this application first.");
            const ok = await confirm({
              title: "Create a tailored copy?",
              message: `Create a tailored copy of ‘${master.name}’ for this application? The master resume will not change.`,
              confirmLabel: "Create tailored copy",
            });
            if (!ok) return;
            try {
              const result = await api<{ resume: Resume }>(`/api/entries/${entry.id}/tailor`, "POST", { base_resume_id: master.id });
              resumeId = result.resume.id;
              await reload();
              notify("Tailored copy created. The master resume is unchanged.");
            } catch (error) {
              if (!/review the imported content/i.test(errorMessage(error))) throw error;
              notify(`First review the imported content of ‘${master.name}’. Opening it now.`, true);
              resumeId = master.id;
            }
          }
        }
        navigate(editorPath(resumeId, { entryId: entry.id, analysisId: entry.analysis?.id }));
      } catch (error) {
        notify(errorMessage(error), true);
      }
    },
    [navigate, reload, confirm],
  );
}
