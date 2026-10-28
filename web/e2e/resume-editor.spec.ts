// Resume editor, ported from tests/ui/flow-resume-workflow.mjs and the editor parts of flow-design-and-tabs.mjs and
// flow-master-profile.mjs. The tests run in order and share one sandbox: the master is reviewed and versioned first,
// then tailored for the seeded Initech application.
import type { Page } from "@playwright/test";
import { expect, setupSandbox, test } from "./fixtures";

setupSandbox();
test.describe.configure({ mode: "serial" });

interface Ids {
  masterId: string;
  entryId: string;
  tailoredId?: string;
}
const ids: Ids = { masterId: "", entryId: "" };

const saveStatus = (page: Page) => page.getByTestId("save-status");
const pageStatus = (page: Page) => page.getByTestId("page-status");
const sideTab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();
const confirmDialog = (page: Page) => page.getByTestId("confirm-dialog");
const sectionOrder = (page: Page) => page.locator('[data-testid="section-order"] [data-order-section]').evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.orderSection).join(","));

/** Set a range input the way a user drag would: through the native setter plus an input event. */
async function setRange(page: Page, name: string, value: number) {
  await page.locator(`[data-layout="${name}"]`).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("master: autosave, undo/redo, review, save a version", async ({ app, api, open }) => {
  const state = await api<{ resumes: { id: string; kind: string }[]; entries: { id: string }[] }>("/api/state");
  ids.masterId = state.resumes.find((resume) => resume.kind === "master")!.id;
  ids.entryId = state.entries[0]!.id;
  await open(`/resumes/${ids.masterId}/edit`);
  await expect(app.getByRole("heading", { level: 1 })).toContainText("Frontend master");
  await expect(app.getByTestId("review-banner")).toContainText("Review the imported content");
  await expect(app.locator('[data-target="basics"][data-field="name"]')).not.toHaveValue("");
  await expect(app.locator('[data-testid="preview-frame"] iframe')).toBeVisible({ timeout: 30_000 });
  await expect(pageStatus(app)).toHaveText(/1 page/);

  const label = app.locator('[data-target="basics"][data-field="label"]');
  const original = await label.inputValue();
  await label.fill("Senior Frontend Engineer");
  await expect(saveStatus(app)).toHaveText("All changes saved");
  await app.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(label).toHaveValue(original);
  await app.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(label).toHaveValue("Senior Frontend Engineer");

  await app.getByRole("button", { name: "I have reviewed the content" }).click();
  await expect(app.getByTestId("review-banner")).toHaveCount(0);
  await expect(saveStatus(app)).toHaveText("All changes saved");
  await app.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(toast(app, "Saved version")).toBeVisible();
  await sideTab(app, "Versions").click();
  await expect(app.getByTestId("version-title").first()).toBeVisible();
  await expect(app.getByTestId("versions")).toContainText("Current");
});

test("design: sliders move the page count, Fit brings it back, drag and arrow keys reorder sections", async ({ app, open }) => {
  await open(`/resumes/${ids.masterId}/edit`);
  await expect(pageStatus(app)).toHaveText(/1 page/, { timeout: 30_000 });
  await app.getByRole("tab", { name: "Design" }).click();
  await expect(app.getByTestId("design-panel")).toBeVisible();

  await setRange(app, "margin_x", 30);
  await expect(app.locator('[data-layout-value="margin_x"]')).toHaveText("30 mm");
  await setRange(app, "margin_y", 25);
  await app.locator('[data-layout-choice="font"][data-value="Libertinus Serif"]').click();
  await expect(app.locator('[data-layout-choice="font"][data-value="Libertinus Serif"]')).toHaveAttribute("aria-pressed", "true");

  await setRange(app, "font_size", 13);
  await setRange(app, "section_gap", 2.5);
  await app.locator('[data-meta="page_limit"]').selectOption("1");
  await expect(pageStatus(app)).toHaveText(/2 pages/, { timeout: 20_000 });
  await app.getByRole("button", { name: "Fit to 1 page" }).click();
  await expect(toast(app, /fit|Still/)).toBeVisible({ timeout: 30_000 });
  await expect(pageStatus(app)).toHaveText(/1 page/, { timeout: 20_000 });
  // Fit tightens spacing first; one undo restores the design from before it.
  await expect(app.locator('[data-layout-value="section_gap"]')).not.toHaveText("2.5 em");
  await app.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(app.locator('[data-layout-value="section_gap"]')).toHaveText("2.5 em");
  await expect(pageStatus(app)).toHaveText(/2 pages/, { timeout: 20_000 });

  // Drag the first section below the third with a real mouse, then move it back with the keyboard.
  const before = await sectionOrder(app);
  const rows = app.locator('[data-testid="section-order"] [data-order-section]');
  await rows.first().scrollIntoViewIfNeeded();
  const first = (await rows.nth(0).boundingBox())!;
  const third = (await rows.nth(2).boundingBox())!;
  await app.mouse.move(first.x + 60, first.y + first.height / 2);
  await app.mouse.down();
  for (let y = first.y + first.height / 2; y <= third.y + third.height - 2; y += 6) await app.mouse.move(first.x + 60, y);
  await app.mouse.up();
  await expect.poll(() => sectionOrder(app)).not.toBe(before);
  const dragged = (await sectionOrder(app)).split(",");
  expect(dragged[2]).toBe(before.split(",")[0]);

  const moved = before.split(",")[0]!;
  await app.locator(`[data-drag-section="${moved}"]`).focus();
  await app.keyboard.press("ArrowUp");
  await app.keyboard.press("ArrowUp");
  await expect.poll(() => sectionOrder(app)).toBe(before);
  expect(await app.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.dragSection)).toBe(moved);
  await expect(saveStatus(app)).toHaveText("All changes saved");

  await app.getByRole("tab", { name: "Content" }).click();
  await sideTab(app, "Preview").click();
  await app.getByRole("button", { name: "Run checks" }).click();
  await expect(app.getByTestId("validation").locator('[data-testid^="check-"]').first()).toBeVisible({ timeout: 20_000 });
});

test("tailored copy: suggestions accept and revert, compare with master, attach to the application", async ({ app, open }) => {
  await open(`/resumes/${ids.masterId}/edit?entry=${ids.entryId}`);
  await sideTab(app, "Job match").click();
  await app.getByRole("button", { name: "Create tailored copy" }).click();
  await expect(app.getByTestId("resume-kind")).toHaveAttribute("data-kind", "tailored", { timeout: 20_000 });
  ids.tailoredId = /\/resumes\/([a-f0-9-]+)\/edit/.exec(app.url())![1]!;
  expect(ids.tailoredId).not.toBe(ids.masterId);

  await sideTab(app, "Job match").click();
  await app.getByRole("button", { name: "Suggest improvements" }).click();
  await expect.poll(() => app.getByTestId("suggestion").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  const safe = app.getByTestId("suggestion").filter({ has: app.getByTestId("supported") }).filter({ has: app.getByRole("button", { name: "Accept" }) }).first();
  const safeId = await safe.getAttribute("data-suggestion");
  await safe.getByRole("button", { name: "Accept" }).click();
  await expect(app.locator(`[data-suggestion="${safeId}"]`)).toHaveAttribute("data-applied", "true");

  const flagged = app.getByTestId("suggestion").filter({ has: app.getByTestId("needs-verification") }).filter({ has: app.getByRole("button", { name: "Accept" }) }).first();
  const flaggedId = await flagged.getAttribute("data-suggestion");
  await flagged.getByRole("button", { name: "Accept" }).click();
  await confirmDialog(app).getByRole("button", { name: "Apply" }).click();
  await expect(app.locator(`[data-suggestion="${flaggedId}"]`)).toHaveAttribute("data-applied", "true");
  await app.locator(`[data-suggestion="${flaggedId}"]`).getByRole("button", { name: "Revert" }).click();
  await expect(app.locator(`[data-suggestion="${flaggedId}"]`)).toHaveAttribute("data-applied", "false");

  await sideTab(app, "Compare").click();
  const select = app.getByTestId("compare-select");
  const masterOption = await select.locator("option").evaluateAll((options) => (options as HTMLOptionElement[]).find((option) => option.value.startsWith("p:"))?.value);
  await select.selectOption(masterOption!);
  await expect(app.locator('[data-testid="diff"], [data-testid="no-differences"]').first()).toBeVisible({ timeout: 15_000 });

  await app.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(toast(app, "Saved version 2")).toBeVisible();
  await sideTab(app, "Job match").click();
  await app.getByRole("button", { name: "Use current version for this application" }).click();
  await expect(toast(app, "exactly")).toBeVisible();
});

test("Check score scores the unsaved draft without adding to the history; full re-check; dialog closes back to the editor", async ({ app, api, open }) => {
  const history = async () => (await api<{ analyses: unknown[] }>(`/api/entries/${ids.entryId}/analyses`)).analyses.length;
  await open(`/resumes/${ids.tailoredId}/edit?entry=${ids.entryId}`);
  await expect(app.getByTestId("editor-toolbar").getByRole("button", { name: "Check score" })).toBeVisible();
  await sideTab(app, "Job match").click();
  // An unsaved edit: Check score must include it without creating a version.
  await app.getByRole("tab", { name: "Content" }).click();
  await app.locator('[data-target="basics"][data-field="label"]').fill("Senior Frontend Engineer, React performance");
  const before = await history();
  await app.getByTestId("job-match").getByRole("button", { name: "Check score" }).click();
  await expect(app.getByTestId("score-check-value")).toBeVisible({ timeout: 30_000 });
  await expect(app.getByTestId("checked-what")).toContainText("current draft (not saved as a version)");
  expect(await history()).toBe(before);

  await app.getByRole("button", { name: "Re-check all requirements" }).click();
  await expect(app.getByTestId("score-check")).toContainText("Re-checked every requirement", { timeout: 30_000 });
  expect(await app.getByTestId("rechecked").locator("li").count()).toBeGreaterThan(0);
  expect(await history()).toBe(before);

  await app.getByRole("button", { name: "Open full analysis" }).click();
  const dialog = app.getByRole("dialog", { name: "Full analysis" });
  await expect(dialog).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(app.getByTestId("resume-editor")).toBeVisible();
  expect(app.url()).toContain(`/resumes/${ids.tailoredId}/edit`);
  await app.getByRole("button", { name: "Open full analysis" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close full analysis" }).click();
  await expect(dialog).toHaveCount(0);

  await app.getByRole("button", { name: "New analysis", exact: true }).click();
  await expect(app.getByTestId("analysis-label")).toContainText("Draft check", { timeout: 30_000 });
});

test("From profile: add and undo, Add a section, recommend from profile, independent scrolling", async ({ app, api, open }) => {
  await api("/api/profile/items", "POST", {
    kind: "project",
    verification: "verified",
    data: { name: "Auth service", technologies: ["Node.js", "OAuth"], summary: "OAuth sign-in service for my Node.js apps.", achievements: [{ text: "Built OAuth sign-in with refresh tokens.", verified: true }] },
  });
  await open(`/resumes/${ids.tailoredId}/edit?entry=${ids.entryId}`);
  await sideTab(app, "From profile").click();
  const row = app.getByTestId("profile-entry").filter({ hasText: "Auth service" });
  await row.getByRole("button", { name: "Add to resume" }).click();
  await expect(row).toContainText("In resume");
  await expect.poll(() => app.locator('[data-field="name"]').evaluateAll((inputs) => (inputs as HTMLInputElement[]).some((input) => input.value === "Auth service"))).toBe(true);
  await app.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => app.locator('[data-field="name"]').evaluateAll((inputs) => (inputs as HTMLInputElement[]).some((input) => input.value === "Auth service"))).toBe(false);
  await expect(saveStatus(app)).toHaveText("All changes saved");

  const chip = app.locator("[data-reveal-section]").first();
  if (await chip.count()) {
    const section = await chip.getAttribute("data-reveal-section");
    await chip.click();
    await expect(app.locator(`details[data-section="${section}"]`)).toBeVisible();
  }

  // Analyze with the profile in place (as the classic flow did), then recommend from it.
  await sideTab(app, "Job match").click();
  await app.getByRole("button", { name: "New analysis", exact: true }).click();
  await expect(app.getByTestId("analysis-label")).toContainText("Draft check", { timeout: 30_000 });
  await expect(app.getByTestId("analyzing")).toHaveCount(0, { timeout: 30_000 });
  await sideTab(app, "From profile").click();
  await app.getByRole("button", { name: "Recommend from my profile for this job" }).click();
  await expect.poll(() => app.getByTestId("suggestion").filter({ has: app.getByTestId("suggestion-source") }).count(), { timeout: 60_000 }).toBeGreaterThan(0);

  const scroll = await app.evaluate(() => {
    const form = document.querySelector<HTMLElement>('[data-testid="form-panel"]')!;
    const side = document.querySelector<HTMLElement>('[data-testid="side-panel"]')!;
    side.scrollTop = 0;
    form.scrollTop = 400;
    return { form: form.scrollTop, side: side.scrollTop, page: window.scrollY, formScrolls: form.scrollHeight > form.clientHeight };
  });
  expect(scroll.formScrolls).toBe(true);
  expect(scroll.form).toBeGreaterThan(0);
  expect(scroll.side).toBe(0);
  expect(scroll.page).toBe(0);
});

test("back returns to the application the editor was opened from", async ({ app, open }) => {
  await open(`/resumes/${ids.tailoredId}/edit?entry=${ids.entryId}`);
  await app.getByRole("button", { name: "Back to application" }).click();
  await expect(app).toHaveURL(new RegExp(`/applications/${ids.entryId}$`));
});
