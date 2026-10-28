import { describe, expect, it } from "vitest";
import type { Analysis, Requirement } from "@/api/types";
import { categoryRows, compareRuns, comparisonBaseline, matchCounts, previousRun, priorityItems, requirementVisible, stageLabel, statusChange } from "./model";

const req = (id: string, status: Requirement["status"], extra: Partial<Requirement> = {}): Requirement => ({
  id,
  category: "required_skills",
  requirement: `Requirement ${id}`,
  mandatory: true,
  priority: "high",
  status,
  explanation: "",
  resume_evidence: [],
  recommendation: "",
  profile_evidence: [],
  coverage: "represented",
  ...extra,
});

const run = (requirements: Requirement[], extra: Partial<Analysis> = {}): Analysis =>
  ({
    id: "a",
    entry_id: "e",
    status: "complete",
    resume_version_id: "v",
    overall_score: 60,
    relevance_score: 60,
    readability_score: 90,
    missing_mandatory: 0,
    created_at: "",
    checklist: {},
    events: [],
    scoring_version: "score-v2",
    result: { summary: "", requirements, category_scores: {}, warnings: [], resume_version: 1 },
    ...extra,
  }) as Analysis;

describe("analysis model", () => {
  it("labels stages, falling back to readable text", () => {
    expect(stageLabel("jd_match")).toBe("Comparing job");
    expect(stageLabel("some_new_stage")).toBe("some new stage");
    expect(stageLabel(undefined)).toBe("Processing");
  });

  it("drops unscored categories and fills missing ones", () => {
    const rows = categoryRows({ required_skills: { earned: 3, possible: 4, score: 75 }, education: { earned: 0, possible: 0, score: null } });
    expect(rows.map((row) => row.key)).toEqual(["required_skills", "experience", "responsibilities", "preferred_skills"]);
    expect(rows[1]!.score.score).toBe(0);
  });

  it("counts and filters requirements", () => {
    const items = [req("1", "demonstrated"), req("2", "listed"), req("3", "uncertain", { coverage: "profile_only" })];
    expect(matchCounts(items)).toEqual({ matched: 1, partial: 1, missing: 1 });
    expect(items.filter((item) => requirementVisible(item, "partial", "")).map((item) => item.id)).toEqual(["2"]);
    expect(items.filter((item) => requirementVisible(item, "profile_only", "")).map((item) => item.id)).toEqual(["3"]);
    expect(items.filter((item) => requirementVisible(item, "all", "requirement 1")).map((item) => item.id)).toEqual(["1"]);
  });

  it("orders priority improvements profile-first and skips matched ones", () => {
    const items = [
      req("u", "missing", { coverage: "unsupported", recommendation: "x" }),
      req("p", "missing", { coverage: "profile_only", recommendation: "x" }),
      req("d", "demonstrated", { recommendation: "x" }),
      req("n", "missing"),
    ];
    expect(priorityItems(items).map((item) => item.id)).toEqual(["p", "u"]);
  });

  it("reports status changes and run deltas", () => {
    expect(statusChange(req("1", "demonstrated", { previous_status: "missing" }))).toBe("up");
    expect(statusChange(req("1", "missing", { previous_status: "partial" }))).toBe("down");
    expect(statusChange(req("1", "missing"))).toBeNull();
    const history = [
      { id: "a", status: "complete", label: "", overall_score: 60, created_at: "", scoring_version: "score-v2" },
      { id: "b", status: "failed", label: "", overall_score: null, created_at: "" },
      { id: "c", status: "complete", label: "", overall_score: 52.3, created_at: "", scoring_version: "score-v2" },
    ];
    const previous = previousRun(history, "a");
    expect(previous?.id).toBe("c");
    expect(comparisonBaseline(run([]), previous)).toMatchObject({ delta: 7.7, olderMethod: false });
    expect(comparisonBaseline(run([]), { ...previous!, scoring_version: "score-v1" })).toMatchObject({ delta: null, olderMethod: true });
  });

  it("compares two runs by requirement text", () => {
    const before = run([req("1", "missing", { recommendation: "add it" }), req("2", "missing")], { result: { summary: "", requirements: [req("1", "missing", { recommendation: "add it" }), req("2", "missing")], category_scores: {}, warnings: ["old"], resume_version: 1 } });
    const after = run([req("1", "demonstrated"), req("2", "missing")], { result: { summary: "", requirements: [req("1", "demonstrated"), req("2", "missing")], category_scores: {}, warnings: ["old", "new"], resume_version: 2 } });
    const changes = compareRuns(after, before);
    expect(changes.newlyMatched.map((item) => item.id)).toEqual(["1"]);
    expect(changes.remainingGaps.map((item) => item.id)).toEqual(["2"]);
    expect(changes.resolved.map((item) => item.id)).toEqual(["1"]);
    expect(changes.newWarnings).toEqual(["new"]);
  });
});
