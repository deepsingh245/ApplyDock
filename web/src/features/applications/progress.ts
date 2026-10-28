import type { Entry } from "@/api/types";
import { deliveryLabel, stageIsAfterApply } from "@/lib/domain";

export type StepState = "done" | "todo" | "current";

export interface ProgressStep {
  label: string;
  detail: string;
  state: StepState;
  warn: boolean;
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/** The five stages of an application, derived from data the entry already has. */
export function progressSteps(entry: Entry): ProgressStep[] {
  const analysis = entry.analysis ?? { status: "not_analyzed", label: "Not analyzed", stale: false };
  const version = entry.resume_version;
  const emailDone = ["gmail_draft", "gmail_schedule_pending", "gmail_scheduled"].includes(entry.delivery_mode) || ["approved", "sending", "sent"].includes(entry.status);
  const sent = entry.status === "sent" || stageIsAfterApply(entry.application_stage);
  const raw = [
    { label: "Captured", detail: entry.created_at ? dayLabel(entry.created_at) : "", done: true, warn: false },
    {
      label: "Analyzed",
      detail: analysis.status === "complete" ? (analysis.stale ? "Needs rerun" : `${Number(analysis.overall_score).toFixed(1)} / 100`) : analysis.label || "Not analyzed",
      done: analysis.status === "complete" && !analysis.stale,
      warn: analysis.stale || ["failed", "plan_limit", "extraction_limited"].includes(analysis.status),
    },
    { label: "Resume", detail: version ? `v${version.version_number}${version.pinned ? " · pinned" : ""}` : "Missing", done: Boolean(version), warn: !version },
    {
      label: "Email",
      detail: entry.apply_method === "email" ? deliveryLabel(entry) : entry.apply_method === "external_form" ? "External form" : "Route not set",
      done: emailDone || entry.apply_method === "external_form",
      warn: false,
    },
    {
      label: "Applied",
      detail: entry.submission ? `Submitted ${dayLabel(entry.submission.submitted_at)}` : entry.application_stage || (entry.status === "sent" ? "Sent" : "Not yet"),
      done: sent || Boolean(entry.submission),
      warn: false,
    },
  ];
  let current = false;
  return raw.map(({ done, ...step }) => {
    let state: StepState = done ? "done" : "todo";
    if (!done && !current) {
      state = "current";
      current = true;
    }
    return { ...step, state, warn: step.warn && !done };
  });
}
