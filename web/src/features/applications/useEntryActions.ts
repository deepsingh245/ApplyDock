import { useCallback, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useNavigate } from "react-router";
import { useLoadedState, useReloadState } from "@/api/state";
import type { Entry } from "@/api/types";
import { useDialogs } from "@/components/ui/confirm";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";
import { useOpenResumeEditor, useRunAnalysis } from "./actions";
import { draftPrompt, entryPatch, type EntryForm } from "./form";

export type EntryAction =
  | "ats-run"
  | "ats-view"
  | "optimize-resume"
  | "record-submission"
  | "gmail-draft"
  | "gmail-prepare"
  | "gmail-scheduled"
  | "approve"
  | "unapprove"
  | "ai-draft"
  | "ai-copy"
  | "local-delete";

const DONE_MESSAGES: Partial<Record<EntryAction, string>> = {
  approve: "Approved for the selected local 9 AM send.",
  unapprove: "Local approval removed.",
  "gmail-draft": "Gmail draft saved with your resume attached.",
  "gmail-scheduled": "Marked as scheduled in Gmail.",
};

/**
 * Everything the inspector and editor can do to one application. Actions that send or attach first save the
 * form, so the helper acts on what the user sees.
 */
export function useEntryActions(entry: Entry | null, form: UseFormReturn<EntryForm>, openSubmission: (channel: string) => void) {
  const state = useLoadedState();
  const reload = useReloadState();
  const navigate = useNavigate();
  const { confirm } = useDialogs();
  const runAnalysis = useRunAnalysis();
  const openEditor = useOpenResumeEditor();
  const [busy, setBusy] = useState<EntryAction | null>(null);
  const [aiNotes, setAiNotes] = useState("");

  const save = useCallback(async () => {
    if (!entry) throw new Error("Select an application first.");
    await api(`/api/entries/${entry.id}`, "PATCH", entryPatch(form.getValues(), entry));
    form.reset(form.getValues());
  }, [entry, form]);

  const saveIfDirty = useCallback(async () => {
    if (form.formState.isDirty) await save();
  }, [form, save]);

  const perform = useCallback(
    async (action: EntryAction) => {
      if (!entry) return;
      const id = entry.id;
      if (action === "ats-view" && entry.analysis?.id) return navigate(`/analysis/${entry.analysis.id}`);
      if (action === "optimize-resume") return openEditor(entry, "optimize", state.resumes, saveIfDirty);
      if (action === "record-submission") return openSubmission(entry.delivery_mode.startsWith("gmail") ? "gmail" : "external");
      if (action === "ats-run") {
        setBusy(action);
        await runAnalysis(entry, saveIfDirty);
        setBusy(null);
        return;
      }
      if (action === "ai-copy") {
        try {
          await navigator.clipboard.writeText(draftPrompt(entry, form.getValues(), state.candidate_profile));
          notify("Prompt copied. Paste it into this Codex chat.");
        } catch {
          notify("Could not copy the prompt. Check clipboard permission.", true);
        }
        return;
      }
      if (action === "local-delete") {
        const ok = await confirm({
          title: "Remove this application?",
          message: "Remove this item from ApplyDock? Its Notion page and any Gmail draft or schedule will stay unchanged.",
          confirmLabel: "Remove",
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/api/entries/${id}`, "DELETE");
          form.reset();
          navigate("/");
          await reload();
          notify("Removed locally. The Notion page was not changed.");
        } catch (error) {
          notify(errorMessage(error), true);
        }
        return;
      }
      if (["approve", "gmail-draft", "gmail-prepare"].includes(action) && !form.getValues("resume_id")) {
        notify("Resume Missing. Choose a resume from the library before continuing.", true);
        return;
      }
      if (
        action === "approve" &&
        !(await confirm({ message: "Approve this application for the selected 9:00 AM send with the chosen resume attached?", confirmLabel: "Approve" }))
      )
        return;
      // Opened synchronously from the click, before any await, so the browser does not block it as a popup.
      const gmailTab = action === "gmail-prepare" ? window.open("about:blank", "_blank") : null;
      setBusy(action);
      try {
        if (form.formState.isDirty || ["approve", "gmail-draft", "gmail-prepare", "ai-draft"].includes(action)) await save();
        if (action === "approve" || action === "unapprove") await api(`/api/entries/${id}`, "PATCH", { approved: action === "approve" });
        else if (action === "gmail-draft" || action === "gmail-prepare" || action === "gmail-scheduled") await api(`/api/entries/${id}/${action}`, "POST");
        else if (action === "ai-draft") {
          const result = await api<{ draft: { subject: string; body: string; notes?: string } }>(`/api/entries/${id}/ai-draft`, "POST");
          form.setValue("subject", result.draft.subject, { shouldDirty: true });
          form.setValue("body", result.draft.body, { shouldDirty: true });
          setAiNotes(result.draft.notes || "Review and save this suggestion.");
          notify("AI suggestion ready. Review and save it before approval.");
          return;
        }
        await reload();
        if (action === "gmail-prepare") {
          if (gmailTab) gmailTab.location.replace("https://mail.google.com/mail/#drafts");
          else window.location.assign("https://mail.google.com/mail/#drafts");
          notify("Choose Schedule send in Gmail, then confirm it here.");
        } else notify(DONE_MESSAGES[action] ?? "Updated.");
      } catch (error) {
        gmailTab?.close();
        notify(errorMessage(error), true);
      } finally {
        setBusy(null);
      }
    },
    [entry, form, state, navigate, openEditor, openSubmission, runAnalysis, saveIfDirty, confirm, reload, save],
  );

  return { perform, busy, aiNotes, clearAiNotes: () => setAiNotes(""), save, saveIfDirty };
}
