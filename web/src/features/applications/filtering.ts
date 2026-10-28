import type { Entry } from "@/api/types";
import { activeEntries, isRejected, stageIsAfterApply } from "@/lib/domain";

export type ListFilter = "all" | "to_apply" | "review" | "applied" | "scheduled" | "rejected";
export type AnalysisFilter = "all" | "complete" | "stale" | "failed" | "not_analyzed";
export type ScoreFilter = "all" | "high" | "medium" | "low";
export type SortOrder = "newest" | "score_desc" | "score_asc" | "analyzed";

export interface ListOptions {
  filter: ListFilter;
  analysis: AnalysisFilter;
  score: ScoreFilter;
  sort: SortOrder;
  query: string;
}

export const DEFAULT_LIST: ListOptions = { filter: "all", analysis: "all", score: "all", sort: "newest", query: "" };

const FAILED = new Set(["failed", "plan_limit", "insufficient_jd", "extraction_limited"]);
const lower = (value: unknown) => String(value ?? "").trim().toLowerCase();

/** The entries a filter starts from. "Applied" and "Rejected" are history views that also include sent items. */
export function filterSource(entries: Entry[], filter: ListFilter): Entry[] {
  if (filter === "rejected") return entries.filter(isRejected);
  return (filter === "applied" ? entries : activeEntries(entries)).filter((entry) => !isRejected(entry));
}

export function listCounts(entries: Entry[]) {
  return {
    active: activeEntries(entries).filter((entry) => !isRejected(entry)).length,
    rejected: entries.filter(isRejected).length,
  };
}

export function visibleEntries(entries: Entry[], options: ListOptions): Entry[] {
  const { filter, analysis: analysisFilter, score: scoreFilter, sort } = options;
  const query = options.query.trim().toLowerCase();
  const shown = filterSource(entries, filter).filter((entry) => {
    if (filter === "to_apply" && !["initiated", "to apply"].includes(lower(entry.application_stage))) return false;
    if (filter === "review" && (!entry.needs_review || stageIsAfterApply(entry.application_stage)) && entry.status !== "failed") return false;
    if (filter === "applied" && !stageIsAfterApply(entry.application_stage) && entry.status !== "sent" && !entry.submission) return false;
    if (filter === "scheduled" && (entry.apply_method !== "email" || !["gmail_schedule_pending", "gmail_scheduled"].includes(entry.delivery_mode))) return false;
    const analysis = entry.analysis ?? { status: "not_analyzed", stale: false };
    const score = analysis.overall_score;
    if (analysisFilter === "complete" && analysis.status !== "complete") return false;
    if (analysisFilter === "stale" && !analysis.stale) return false;
    if (analysisFilter === "failed" && !FAILED.has(analysis.status)) return false;
    if (analysisFilter === "not_analyzed" && analysis.status !== "not_analyzed") return false;
    if (scoreFilter === "high" && !(score != null && score >= 75)) return false;
    if (scoreFilter === "medium" && !(score != null && score >= 50 && score < 75)) return false;
    if (scoreFilter === "low" && !(score != null && score >= 0 && score < 50)) return false;
    if (!query) return true;
    return [entry.title, entry.company, entry.platform, entry.application_stage, entry.recipient, entry.post_details, ...(entry.contact_emails ?? [])].some((value) =>
      lower(value).includes(query),
    );
  });
  if (sort === "score_desc") shown.sort((a, b) => (b.analysis?.overall_score ?? -1) - (a.analysis?.overall_score ?? -1));
  if (sort === "score_asc") shown.sort((a, b) => (a.analysis?.overall_score ?? 101) - (b.analysis?.overall_score ?? 101));
  if (sort === "analyzed") shown.sort((a, b) => String(b.analysis?.analyzed_at ?? "").localeCompare(String(a.analysis?.analyzed_at ?? "")));
  return shown;
}
