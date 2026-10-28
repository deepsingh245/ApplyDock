import { expect, setupSandbox, test } from "./fixtures";

setupSandbox();

const TITLE = "Senior Frontend Engineer";

test("opens the first application that needs action in a full-width three-pane workspace", async ({ app }) => {
  await expect(app.locator("#editor-title")).toHaveText(TITLE);
  const workspace = await app.locator(".workspace").boundingBox();
  expect(workspace?.x).toBe(0);
  expect(workspace?.width).toBe(1440);
  await expect(app.locator("#inspector")).toBeVisible();
  await expect(app.locator("#editor-progress .step")).toHaveCount(5);
  await expect(app.locator("#active-count")).toHaveText("1");
  await expect(app.getByTestId("email-preview")).toContainText("Application: Senior Frontend Engineer");
});

test("the email preview follows the form, and edits save", async ({ app }) => {
  await app.locator('[data-editor-tab="email"]').click();
  await app.getByLabel("Subject").fill("Hello from the test");
  await expect(app.getByTestId("email-preview")).toContainText("Hello from the test");
  await app.locator('[data-editor-tab="overview"]').click();
  await app.getByLabel("Company").fill("Initech Labs");
  await app.locator("#save-button").click();
  await expect(app.getByText("Changes saved.")).toBeVisible();
  await app.reload();
  await expect(app.getByLabel("Company")).toHaveValue("Initech Labs");
  await app.locator('[data-editor-tab="email"]').click();
  await expect(app.getByLabel("Subject")).toHaveValue("Hello from the test");
});

test("a required field on a hidden tab brings its tab forward instead of failing silently", async ({ app, api }) => {
  await app.getByLabel("Role or post title").fill("");
  await app.locator('[data-editor-tab="details"]').click();
  await expect(app.locator('[data-pane="overview"]')).toBeHidden();
  let patched = false;
  app.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/api/entries/")) patched = true;
  });
  await app.keyboard.press("Control+s");
  await expect(app.locator('[data-pane="overview"]')).toBeVisible();
  await expect(app.getByText("Add a title.")).toBeVisible();
  expect(patched).toBe(false);
  const state = await api<{ entries: { title: string }[] }>("/api/state");
  expect(state.entries[0]?.title).toBe(TITLE);
});

test("leaving with unsaved edits asks first", async ({ app }) => {
  await app.getByLabel("Company").fill("Unsaved Co");
  await app.locator("#settings-button").click();
  await expect(app.getByTestId("confirm-dialog")).toContainText("Discard unsaved changes");
  await app.getByRole("button", { name: "Cancel" }).click();
  await expect(app).toHaveURL(/:\d+\/$/);
  await expect(app.getByLabel("Company")).toHaveValue("Unsaved Co");
  await app.locator("#settings-button").click();
  await app.getByRole("button", { name: "Discard" }).click();
  await expect(app).toHaveURL(/settings/);
});

test("rejected applications are hidden unless the Rejected filter is chosen", async ({ app }) => {
  await app.getByLabel("Application stage").selectOption("Rejected");
  await app.locator("#save-button").click();
  await expect(app.getByText("Changes saved.")).toBeVisible();
  await expect(app.locator("#active-count")).toHaveText("0");
  await app.locator("#applications-button").click();
  await expect(app.locator("#entry-list .queue-item")).toHaveCount(0);
  await expect(app.locator("#empty-editor")).toHaveText("No active applications");
  await expect(app.locator("#rejected-count")).toHaveText("1");
  await app.getByTestId("filters").locator('[data-value="rejected"]').click();
  await expect(app.locator("#entry-list .queue-item")).toHaveCount(1);
  await app.locator("#entry-list .queue-item").click();
  await app.getByLabel("Application stage").selectOption("To apply");
  await app.locator("#save-button").click();
  await expect(app.getByText("Changes saved.")).toBeVisible();
  await app.getByTestId("filters").locator('[data-value="all"]').click();
  await expect(app.locator("#entry-list .queue-item")).toHaveCount(1);
});

test("records a submission with the exact resume file, which hides delivery actions", async ({ app }) => {
  await expect(app.locator('#inspector [data-action="gmail-prepare"]')).toBeVisible();
  await app.locator('[data-editor-tab="resume"]').click();
  await expect(app.locator("#resume-version-line")).toContainText("Attaches version 1");
  await app.locator('#submission-card [data-submission="change"]').click();
  await expect(app.locator("#submission-version option")).not.toHaveCount(0);
  await app.locator('[data-submission="save"]').click();
  await expect(app.getByText("Submission recorded")).toBeVisible();
  await expect(app.locator("#submission-card .submission-kv")).toContainText("Frontend master");
  await expect(app.locator('#inspector [data-action="gmail-prepare"]')).toHaveCount(0);
  await expect(app.locator("#editor-progress .step").last()).toHaveClass(/done/);
});

test("adds a job and opens it", async ({ app }) => {
  await app.getByRole("link", { name: "Add a job or post" }).click();
  await expect(app.getByRole("heading", { name: "Add a job or hiring post" })).toBeVisible();
  await app.getByRole("button", { name: "Save" }).click();
  await expect(app.getByText("Paste the posting URL.")).toBeVisible();
  await app.getByLabel("Posting URL").fill("https://jobs.lever.co/globex/platform-2");
  await app.getByLabel("Title").fill("Platform Engineer");
  await app.getByLabel("Company").fill("Globex");
  await app.getByRole("button", { name: "Save" }).click();
  await expect(app.locator("#editor-title")).toHaveText("Platform Engineer");
  await expect(app).toHaveURL(/\/applications\/[a-f0-9-]+$/);
  await expect(app.locator("#entry-list .queue-item")).toHaveCount(2);
});

test("search with the / shortcut and filter by score", async ({ app }) => {
  // The shortcut belongs to the (lazily loaded) Applications screen; wait for it before typing.
  await expect(app.locator("#entry-list")).toBeVisible();
  await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await app.keyboard.press("/");
  await expect(app.locator("#search-input")).toBeFocused();
  await app.keyboard.type("nothing-matches-this");
  await expect(app.getByText("Nothing matches this view.")).toBeVisible();
  await app.locator("#search-input").fill("initech");
  await expect(app.locator("#entry-list .queue-item")).toHaveCount(1);
  await app.getByText("Analysis filters and sort").click();
  await app.getByLabel("Score").selectOption("high");
  await expect(app.locator("#entry-list .queue-item")).toHaveCount(0);
  await expect(app).toHaveURL(/score=high/);
});

test("the Analysis tab opens the analysis page", async ({ app }) => {
  await app.locator('[data-editor-tab="analysis"]').click();
  await expect(app).toHaveURL(/\/analysis\/[a-f0-9-]+/);
});

test("extension deep link: submission opens the Resume tab with the form", async ({ app, api }) => {
  const state = await api<{ entries: { id: string }[] }>("/api/state");
  await app.evaluate((entryId) => window.dispatchEvent(new CustomEvent("applydock-open", { detail: { entryId, action: "submission" } })), state.entries[0]!.id);
  await expect(app.locator('[data-pane="resume"]')).toBeVisible();
  await expect(app.getByTestId("submission-form")).toBeVisible();
});

test("phone width shows the list, then one application with a way back", async ({ app }) => {
  await app.setViewportSize({ width: 375, height: 800 });
  await app.locator("#applications-button").click();
  await expect(app.locator("#entry-list")).toBeVisible();
  await expect(app.locator("#editor-title")).toBeHidden();
  await app.locator("#entry-list .queue-item").first().click();
  await expect(app.locator("#editor-title")).toBeVisible();
  await expect(app.locator("#entry-list")).toBeHidden();
  expect(await app.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await app.getByRole("button", { name: "Applications" }).click();
  await expect(app.locator("#entry-list")).toBeVisible();
});
