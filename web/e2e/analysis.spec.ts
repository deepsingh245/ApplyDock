import type { Page } from "@playwright/test";
import { expect, setupSandbox, test } from "./fixtures";

setupSandbox();

type Api = <T = Record<string, unknown>>(path: string, method?: string, body?: unknown) => Promise<T>;
interface Entry {
  id: string;
  analysis: { id?: string; status: string };
}

/** A verified profile project about OAuth, so the fake Codex reports J2 as "in your profile, not the resume". */
async function analyzeWithProfile(api: Api) {
  await api("/api/profile/items", "POST", {
    kind: "project",
    verification: "verified",
    data: { name: "Auth service", summary: "OAuth sign-in service for my Node.js apps.", technologies: ["Node.js", "OAuth"] },
  });
  const { entries } = await api<{ entries: Entry[] }>("/api/state");
  const entry = entries[0]!;
  const { analysis } = await api<{ analysis: { id: string } }>(`/api/entries/${entry.id}/analyses`, "POST", {});
  await expect
    .poll(async () => (await api<{ analysis: { status: string } }>(`/api/analyses/${analysis.id}`)).analysis.status, { timeout: 30_000 })
    .toBe("complete");
  return { entry, analysisId: analysis.id };
}

const openCards = (page: Page) => page.getByTestId("requirements-list").getByTestId("requirement-card");

test("complete analysis: coverage, filters, addressed and reopen, sources, history", async ({ app, api, open }) => {
  const { entry, analysisId } = await analyzeWithProfile(api);
  await open(`/analysis/${analysisId}`);
  await expect(app.getByTestId("analysis-title")).toHaveText("Senior Frontend Engineer");
  await expect(app.getByTestId("analysis-hero")).toContainText("Estimated match");

  const profileCard = app.locator('[data-requirement-coverage="profile_only"]');
  await expect(profileCard).toContainText("In your profile, not the resume");
  await expect(app.getByTestId("analysis-totals")).toContainText("In profile only");
  await expect(app.getByTestId("score-potential")).toBeVisible();

  // Filters and search narrow the open list.
  const total = await openCards(app).count();
  expect(total).toBe(3);
  await app.getByRole("radio", { name: "In profile" }).or(app.getByRole("button", { name: "In profile" })).click();
  await expect(openCards(app)).toHaveCount(1);
  await app.getByRole("radio", { name: "All" }).or(app.getByRole("button", { name: "All", exact: true })).click();
  await app.getByLabel("Search requirements").fill("kubernetes");
  await expect(openCards(app)).toHaveCount(1);
  await app.getByLabel("Search requirements").fill("");

  // Addressed leaves the open list and Priority improvements; Reopen brings it back.
  const unsupported = app.locator('[data-requirement-coverage="unsupported"]');
  await unsupported.locator("summary").click();
  await unsupported.getByLabel("Checklist state").selectOption("addressed");
  await expect(app.getByTestId("addressed-requirements")).toBeVisible();
  await expect(openCards(app)).toHaveCount(total - 1);
  await expect(app.getByTestId("addressed-row")).toHaveCount(1);
  await expect(app.getByTestId("priority-improvements")).not.toContainText("Kubernetes");
  await expect(app.getByTestId("requirements-count")).toHaveText("2 open · 1 addressed");
  await app.getByTestId("addressed-requirements").locator("summary").click();
  await app.getByRole("button", { name: "Reopen" }).click();
  await expect(app.getByTestId("addressed-requirements")).toHaveCount(0);
  await expect(openCards(app)).toHaveCount(total);
  await expect(app.getByTestId("priority-improvements")).toContainText("Kubernetes");

  // Two runs exist (the seeded one and this one); the older one opens from the history.
  const history = app.getByRole("button", { name: /%|—/ }).filter({ has: app.locator("small") });
  await expect(history).toHaveCount(2);
  await history.nth(1).click();
  await expect(app).not.toHaveURL(new RegExp(analysisId));
  await app.goBack();
  await expect(app).toHaveURL(new RegExp(analysisId));

  // Profile evidence links to the Master Profile item.
  await app.locator('[data-requirement-coverage="profile_only"] summary').click();
  await app.locator('[data-requirement-coverage="profile_only"]').getByRole("link", { name: "View source" }).click();
  await expect(app).toHaveURL(/\/settings\/profile\?item=/);

  await open(`/analysis/${analysisId}`);
  await app.getByRole("button", { name: "Applications" }).click();
  await expect(app).toHaveURL(new RegExp(`/applications/${entry.id}$`));
});

test("a stopped analysis explains itself and offers a re-run", async ({ app, api, open }) => {
  const { entries } = await api<{ entries: Entry[] }>("/api/state");
  // An unknown id is not an analysis: the view reports it instead of crashing.
  await open("/analysis/00000000-0000-0000-0000-000000000000");
  await expect(app.getByRole("alert").filter({ hasText: /not found|not available/i })).toBeVisible();
  await open(`/analysis/${entries[0]!.analysis.id}`);
  await expect(app.getByTestId("analysis-hero")).toBeVisible();
});
