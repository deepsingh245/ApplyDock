import type { AnalysisHistoryItem } from "@/api/analyses";
import type { Analysis, Coverage, MatchStatus, Requirement } from "@/api/types";

const STAGES: Record<string, string> = {
  queued: "Queued",
  validation: "Checking inputs",
  preparing: "Preparing files",
  resume_parse: "Parsing resume",
  jd_requirements: "Job requirements",
  job_comparison: "Comparing job",
  jd_match: "Comparing job",
  evidence_validation: "Validating evidence",
  scoring: "Calculating score",
  result_ready: "Preparing result",
  notion_sync: "Syncing Notion",
  complete: "Complete",
  plan_limit: "Plan limit reached",
  auth: "Sign-in required",
  codex_log: "Codex CLI",
  codex_missing: "Codex unavailable",
  cli_options: "Codex update needed",
  model_unavailable: "Model unavailable",
  schema_rejected: "Schema rejected",
  local_permissions: "Local access failed",
  sandbox_failed: "Sandbox failed",
  connection_failed: "Connection ended",
  invalid_output: "Invalid response",
  timeout: "Codex timed out",
  codex_failed: "Codex stopped",
  insufficient_jd: "Job description incomplete",
  interrupted: "Interrupted",
  failed: "Analysis failed",
};

export const stageLabel = (stage?: string | null) => STAGES[String(stage ?? "")] ?? (String(stage || "Processing").replaceAll("_", " ") || "Processing");

export const CATEGORY_NAMES: [string, string][] = [
  ["required_skills", "Required technical skills"],
  ["experience", "Relevant work experience"],
  ["responsibilities", "Responsibilities and projects"],
  ["preferred_skills", "Preferred skills"],
  ["education", "Education and qualifications"],
];

export interface CategoryScore {
  earned: number;
  possible: number;
  score: number | null;
}

/** Categories the job never asks for are not scored (score null) and are left out of the breakdown. */
export function categoryRows(scores: Record<string, unknown> | undefined) {
  return CATEGORY_NAMES.flatMap(([key, label]) => {
    const value = scores?.[key] as CategoryScore | undefined;
    if (value && value.score === null) return [];
    return [{ key, label, score: value ?? { earned: 0, possible: 0, score: 0 } }];
  });
}

export type StatusGroup = "matched" | "partial" | "missing";

export const statusGroup = (status: MatchStatus | string): StatusGroup =>
  status === "demonstrated" ? "matched" : status === "partial" || status === "listed" ? "partial" : "missing";

export function matchCounts(requirements: Requirement[]) {
  const counts = { matched: 0, partial: 0, missing: 0 };
  for (const item of requirements) counts[statusGroup(item.status)] += 1;
  return counts;
}

const STATUS_RANK: Record<string, number> = { missing: 0, uncertain: 0, listed: 1, partial: 2, demonstrated: 3 };

/** Direction of a requirement's status change since the previous run. */
export function statusChange(item: Requirement): "up" | "down" | "same" | null {
  if (!item.previous_status || item.previous_status === item.status) return null;
  const now = STATUS_RANK[item.status] ?? 0;
  const before = STATUS_RANK[item.previous_status] ?? 0;
  return now > before ? "up" : now < before ? "down" : "same";
}

export type RequirementFilter = "all" | StatusGroup | "profile_only";

export function requirementVisible(item: Requirement, filter: RequirementFilter, query: string) {
  const group = statusGroup(item.status);
  if (filter !== "all" && group !== filter && item.coverage !== filter) return false;
  const needle = query.trim().toLowerCase();
  return !needle || item.requirement.toLowerCase().includes(needle);
}

export const isAddressed = (analysis: Pick<Analysis, "checklist">, item: Requirement) => analysis.checklist?.[item.id] === "addressed";

const COVERAGE_ORDER: Partial<Record<Coverage, number>> = { profile_only: 0, weak: 1, unsupported: 2 };

/** Gaps the profile can fill come first: they are the changes that are both truthful and new to the resume. */
export function priorityItems(open: Requirement[]) {
  return open
    .filter((item) => item.recommendation && item.status !== "demonstrated")
    .sort((a, b) => (COVERAGE_ORDER[a.coverage] ?? 1) - (COVERAGE_ORDER[b.coverage] ?? 1))
    .slice(0, 3);
}

/** The earlier complete run in this application's history, if any (history is newest first). */
export function previousRun(history: AnalysisHistoryItem[], currentId: string) {
  const index = history.findIndex((item) => item.id === currentId);
  return history.slice(index + 1).find((item) => item.status === "complete") ?? null;
}

/**
 * The run this one is compared against. Runs on the same job description share one requirement checklist, so their
 * scores are comparable; a run scored by an older method rebuilt its requirement list and is not.
 */
export function comparisonBaseline(analysis: Analysis, previous: AnalysisHistoryItem | null) {
  const resultPrevious = analysis.result?.previous ?? null;
  const baseline: { overall_score: number | null; resume_version?: number } | null =
    resultPrevious ?? (previous && previous.scoring_version === analysis.scoring_version ? previous : null);
  const olderMethod = !baseline && Boolean(previous) && previous!.scoring_version !== analysis.scoring_version;
  const delta =
    baseline?.overall_score == null || analysis.overall_score == null ? null : Math.round((analysis.overall_score - baseline.overall_score) * 10) / 10;
  return { baseline, olderMethod, delta };
}

const MATCHED = new Set(["demonstrated", "partial", "listed"]);
const key = (value: string) => String(value).toLowerCase();

/** What changed between the previous run's result and this one. */
export function compareRuns(current: Analysis, previous: Analysis) {
  const requirements = current.result?.requirements ?? [];
  const prior = previous.result?.requirements ?? [];
  const priorByText = new Map(prior.map((item) => [key(item.requirement), item]));
  const newlyMatched = requirements.filter((item) => MATCHED.has(item.status) && !MATCHED.has(priorByText.get(key(item.requirement))?.status ?? ""));
  const remainingGaps = requirements.filter((item) => item.status === "missing" || item.status === "uncertain");
  const resolved = prior.filter(
    (item) =>
      item.recommendation &&
      (item.status === "missing" || item.status === "uncertain") &&
      MATCHED.has(requirements.find((now) => key(now.requirement) === key(item.requirement))?.status ?? ""),
  );
  const oldWarnings = new Set(previous.result?.warnings ?? []);
  const newWarnings = (current.result?.warnings ?? []).filter((value) => !oldWarnings.has(value));
  return { newlyMatched, remainingGaps, resolved, newWarnings };
}

export const signed = (value: number) => (value > 0 ? `+${value}` : String(value));
