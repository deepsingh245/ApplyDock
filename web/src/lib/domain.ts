import type { AnalysisSummary, AppState, Coverage, Entry, Resume } from "@/api/types";

export const FALLBACK_APPLICATION_STAGES = ["Initiated", "To apply", "No Answer", "Applied", "Offer", "Rejected"];
const STAGES_AFTER_APPLY = new Set(["applied", "no answer", "offer", "rejected"]);

const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase();

export const stageIsAfterApply = (value: unknown) => STAGES_AFTER_APPLY.has(normalized(value));

/** Rejected applications stay out of every list except the Rejected filter. */
export const isRejected = (entry?: Pick<Entry, "application_stage"> | null) => normalized(entry?.application_stage) === "rejected";

/** Still needs work from you: not sent, not submitted, not past the Applied stage, not rejected. */
export const needsAction = (entry: Entry) =>
  entry.status !== "sent" && !entry.submission && !isRejected(entry) && !stageIsAfterApply(entry.application_stage);

export function stageOptions(state: Pick<AppState, "application_stage_options"> | undefined, selected = ""): string[] {
  const values = [...(state?.application_stage_options?.length ? state.application_stage_options : FALLBACK_APPLICATION_STAGES)];
  if (selected && !values.some((value) => value.toLowerCase() === selected.toLowerCase())) values.push(selected);
  return values;
}

/** Resumes offered for one application: masters, plus the tailored copy that belongs to it. */
export function resumeChoices(resumes: Resume[], entryId = "", selectedId = "") {
  return resumes
    .filter((resume) => resume.kind !== "tailored" || resume.entry_id === entryId || resume.id === selectedId)
    .map((resume) => ({
      resume,
      label:
        resume.name +
        (resume.kind === "tailored" ? " · Tailored for this job" : " · " + resume.category) +
        (resume.is_default ? " · Default" : "") +
        (!resume.available ? " · Missing file" : ""),
    }));
}

const COVERAGE_LABELS: Record<Coverage, string> = {
  represented: "Already represented",
  weak: "Weakly described",
  profile_only: "In your profile, not the resume",
  unsupported: "Missing from both",
};

export const coverageLabel = (value?: string) => COVERAGE_LABELS[value as Coverage] ?? "";

/** True when the Master Profile changed after this analysis ran, so re-running would use newer evidence. */
export function profileChangedSince(analysis: Pick<AnalysisSummary, "status" | "profile_hash"> | null | undefined, profileHash: string | undefined) {
  return Boolean(analysis && analysis.status === "complete" && profileHash !== undefined && (analysis.profile_hash || "") !== (profileHash || ""));
}

export type ScoreTone = "strong" | "medium" | "weak" | "neutral";

export function scoreTone(score?: number | null): ScoreTone {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return "neutral";
  return score >= 75 ? "strong" : score >= 50 ? "medium" : "weak";
}

/** Sent applications leave the working list (they stay in Notion and in the Applied/Rejected history views). */
export const activeEntries = (entries: Entry[]) => entries.filter((entry) => entry.status !== "sent");

/** The application status shown on list rows and the editor badge. */
export function deliveryLabel(entry: Pick<Entry, "delivery_mode" | "status">): string {
  if (entry.delivery_mode === "gmail_scheduled") return "Scheduled in Gmail";
  if (entry.delivery_mode === "gmail_schedule_pending") return "Schedule in Gmail";
  if (entry.delivery_mode === "gmail_draft") return "Gmail draft";
  return ({ approved: "Approved for 9 AM", sending: "Sending", failed: "Needs attention", draft: "Draft" } as Record<string, string>)[entry.status] ?? entry.status;
}

/** The tone key used to color a delivery badge (local deliveries use the status, Gmail ones the mode). */
export const deliveryCategory = (entry: Pick<Entry, "delivery_mode" | "status">) => (entry.delivery_mode === "local" ? entry.status : entry.delivery_mode);
