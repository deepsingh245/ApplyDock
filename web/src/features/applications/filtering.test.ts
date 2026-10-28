import { describe, expect, it } from "vitest";
import type { Entry } from "@/api/types";
import { needsAction } from "@/lib/domain";
import { DEFAULT_LIST, listCounts, visibleEntries } from "./filtering";
import { progressSteps } from "./progress";

const entry = (overrides: Partial<Entry>): Entry =>
  ({
    id: Math.random().toString(16).slice(2),
    title: "Engineer",
    company: "Initech",
    platform: "Linkedin",
    status: "draft",
    delivery_mode: "local",
    apply_method: "unknown",
    application_stage: "",
    needs_review: 0,
    contact_emails: [],
    submission: null,
    resume_version: null,
    created_at: "2026-10-01T10:00:00Z",
    analysis: { status: "not_analyzed", label: "Not Analyzed", stale: false },
    ...overrides,
  }) as Entry;

describe("application list filters", () => {
  const draft = entry({ title: "Draft" });
  const rejected = entry({ title: "Rejected one", application_stage: "Rejected" });
  const sent = entry({ title: "Sent one", status: "sent", application_stage: "Applied" });
  const review = entry({ title: "Review", needs_review: 1 });
  const all = [draft, rejected, sent, review];

  it("hides rejected applications from every view except Rejected", () => {
    for (const filter of ["all", "to_apply", "review", "applied", "scheduled"] as const)
      expect(visibleEntries(all, { ...DEFAULT_LIST, filter }).map((item) => item.title)).not.toContain("Rejected one");
    expect(visibleEntries(all, { ...DEFAULT_LIST, filter: "rejected" }).map((item) => item.title)).toEqual(["Rejected one"]);
  });

  it("keeps sent applications out of All but in Applied", () => {
    expect(visibleEntries(all, DEFAULT_LIST).map((item) => item.title)).toEqual(["Draft", "Review"]);
    expect(visibleEntries(all, { ...DEFAULT_LIST, filter: "applied" }).map((item) => item.title)).toEqual(["Sent one"]);
  });

  it("counts active (not rejected, not sent) and rejected separately", () => {
    expect(listCounts(all)).toEqual({ active: 2, rejected: 1 });
  });

  it("searches title, company and contact emails", () => {
    const withEmail = entry({ title: "Mail", contact_emails: ["jobs@acme.test"] });
    expect(visibleEntries([draft, withEmail], { ...DEFAULT_LIST, query: "acme" }).map((item) => item.title)).toEqual(["Mail"]);
  });

  it("filters and sorts by score", () => {
    const high = entry({ title: "High", analysis: { status: "complete", label: "", stale: false, overall_score: 80 } });
    const low = entry({ title: "Low", analysis: { status: "complete", label: "", stale: false, overall_score: 30 } });
    expect(visibleEntries([low, high, draft], { ...DEFAULT_LIST, score: "high" }).map((item) => item.title)).toEqual(["High"]);
    expect(visibleEntries([low, high], { ...DEFAULT_LIST, sort: "score_desc" }).map((item) => item.title)).toEqual(["High", "Low"]);
  });

  it("needsAction excludes sent, submitted, rejected and applied stages", () => {
    expect(needsAction(draft)).toBe(true);
    expect(needsAction(rejected)).toBe(false);
    expect(needsAction(sent)).toBe(false);
    expect(needsAction(entry({ application_stage: "Offer" }))).toBe(false);
  });
});

describe("progress steps", () => {
  it("marks the first unfinished step current and flags warnings", () => {
    const steps = progressSteps(entry({}));
    expect(steps.map((step) => step.state)).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(steps[2]?.warn).toBe(true);
  });
});
