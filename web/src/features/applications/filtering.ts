import type { Entry } from "@/api/types";
import { stageIsAfterApply } from "@/lib/domain";

/**
 * Two tabs that split every application: Review (not applied yet: everything still in progress) and Applied (applied,
 * sent or submitted, including those later rejected, which keep their Rejected stage tag).
 */
export type ListFilter = "review" | "applied";
export const LIST_FILTERS: ListFilter[] = ["review", "applied"];
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

export const DEFAULT_LIST: ListOptions = { filter: "review", analysis: "all", score: "all", sort: "newest", query: "" };

/** The filter the Applications screen opens with. */
export const DEFAULT_FILTER: ListFilter = "review";

/** A filter from the URL; old links (?filter=all, rejected, …) fall back to Review. */
export const parseFilter = (value: string | null): ListFilter => (LIST_FILTERS.includes(value as ListFilter) ? (value as ListFilter) : DEFAULT_FILTER);

const FAILED = new Set(["failed", "plan_limit", "insufficient_jd", "extraction_limited"]);
const lower = (value: unknown) => String(value ?? "").trim().toLowerCase();

/** Applied: sent, a submission recorded, or a stage past applying (Applied, No Answer, Offer, Rejected). */
export const isApplied = (entry: Entry) => entry.status === "sent" || Boolean(entry.submission) || stageIsAfterApply(entry.application_stage);

export function filterSource(entries: Entry[], filter: ListFilter): Entry[] {
  return entries.filter((entry) => (filter === "applied") === isApplied(entry));
}

export function listCounts(entries: Entry[]) {
  const applied = entries.filter(isApplied).length;
  return { review: entries.length - applied, applied };
}

export function visibleEntries(entries: Entry[], options: ListOptions): Entry[] {
  const { filter, analysis: analysisFilter, score: scoreFilter, sort } = options;
  const query = options.query.trim().toLowerCase();
  const shown = filterSource(entries, filter).filter((entry) => {
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
