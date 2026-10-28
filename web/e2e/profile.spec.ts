import type { Page } from "@playwright/test";
import { expect, setupSandbox, test } from "./fixtures";

setupSandbox();
// Each step builds on the profile the previous one saved.
test.describe.configure({ mode: "serial" });

const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();

interface ProfileResponse {
  profile: { items: { id: string; kind: string; label: string; data: { achievements?: { text: string; verified: boolean }[] } }[] };
}

let projectId = "";

test("import fills the profile from the resume, and a second import adds nothing", async ({ app, open }) => {
  await open("/settings/profile");
  const personal = app.getByRole("form", { name: "Personal details" });
  await expect(personal).toBeVisible();
  await app.locator('[data-profile-action="import"]').click();
  await expect(toast(app, "Imported")).toBeVisible();
  await expect(personal.getByLabel("Full name")).not.toHaveValue("");
  await app.locator('[data-profile-action="import"]').click();
  await expect(toast(app, "Nothing new")).toBeVisible();
  await expect(app.getByRole("link", { name: "Manage resumes" })).toHaveAttribute("href", /\/resumes$/);
});

test("personal details save and survive a reload", async ({ app, open }) => {
  await open("/settings/profile/personal");
  const personal = app.getByRole("form", { name: "Personal details" });
  await personal.getByLabel("Professional headline").fill("Senior Frontend Engineer");
  await personal.getByRole("button", { name: "Save personal details" }).click();
  await expect(toast(app, "Personal details saved.")).toBeVisible();
  await app.reload();
  await expect(app.getByRole("form", { name: "Personal details" }).getByLabel("Professional headline")).toHaveValue("Senior Frontend Engineer");
});

test("skills are compact cells, several per row", async ({ app, open }) => {
  await open("/settings/profile");
  await app.getByRole("tab", { name: /Skills & achievements/ }).click();
  await expect(app).toHaveURL(/\/settings\/profile\/skills$/);
  const cells = app.locator(".pf-skill-grid .pf-card");
  await expect(cells.nth(1)).toBeVisible();
  const [first, second] = await Promise.all([cells.nth(0).boundingBox(), cells.nth(1).boundingBox()]);
  expect(Math.round(first!.y)).toBe(Math.round(second!.y));
});

test("add a project with a claim, then verify the claim", async ({ app, open, api }) => {
  await open("/settings/profile/projects");
  await app.getByRole("button", { name: "Add project" }).click();
  const form = app.getByRole("form", { name: "Add project" });
  await form.getByLabel("Project name").fill("Auth service");
  await form.getByLabel("Short description").fill("OAuth sign-in service for my Node.js apps.");
  await form.getByLabel("Technology stack").fill("Node.js, OAuth, Firebase");
  await form.getByLabel("Live application URL").fill("https://auth.example.com");
  await form.getByLabel("Source code URL").fill("https://github.com/me/broken-repo");
  await form.getByRole("combobox", { name: /^Verification/ }).selectOption("verified");
  await form.getByRole("button", { name: "Add bullet" }).click();
  await form.getByLabel("Achievement bullet").fill("Shipped OAuth login with refresh tokens.");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(toast(app, "Saved to your Master Profile.")).toBeVisible();

  const card = app.locator(".pf-card").filter({ hasText: "Auth service" });
  await expect(card).toBeVisible();
  projectId = (await card.getAttribute("id"))!.replace("pf-item-", "");
  const [cardBox, listBox] = await Promise.all([card.boundingBox(), app.locator(".pf-list").first().boundingBox()]);
  expect(Math.round(cardBox!.width)).toBeGreaterThanOrEqual(Math.round(listBox!.width) - 1);

  let saved = await api<ProfileResponse>("/api/profile");
  expect(saved.profile.items.find((item) => item.id === projectId)!.data.achievements).toEqual([
    expect.objectContaining({ text: "Shipped OAuth login with refresh tokens.", verified: false }),
  ]);

  await card.getByRole("button", { name: "Edit" }).click();
  const edit = app.getByRole("form", { name: "Edit project" });
  await edit.getByRole("checkbox", { name: "Verified" }).check();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(toast(app, "Saved to your Master Profile.")).toBeVisible();
  saved = await api<ProfileResponse>("/api/profile");
  expect(saved.profile.items.find((item) => item.id === projectId)!.data.achievements![0]!.verified).toBe(true);
});

test("verify links shows a chip per link", async ({ app, open }) => {
  await open("/settings/profile/projects");
  const card = app.locator(`#pf-item-${projectId}`);
  await card.getByRole("button", { name: "Verify links" }).click();
  await expect(toast(app, "links checked")).toBeVisible();
  await expect(card.locator(".link-check")).toHaveCount(2);
  await expect(card.locator(".link-check").first()).not.toContainText("Not checked");
});

test("record your own functional test on the verification tab", async ({ app, open }) => {
  await open("/settings/profile/verification");
  await app.locator(`[data-functional="${projectId}"]`).selectOption("working");
  await expect(toast(app, "test result was recorded")).toBeVisible();
  await expect(app.getByText(/^Recorded /).first()).toBeVisible();
});

test("?item= deep link opens the right section and highlights the card", async ({ app, open }) => {
  await open(`/settings/profile?item=${projectId}`);
  await expect(app).toHaveURL(new RegExp(`/settings/profile/projects\\?item=${projectId}$`));
  const card = app.locator(`#pf-item-${projectId}`);
  await expect(card).toHaveClass(/pf-highlight/);
  await expect(card.getByRole("button", { name: "Edit" })).toBeFocused();
});

test("archive hides an entry until Show archived is ticked", async ({ app, open }) => {
  await open("/settings/profile/projects");
  const card = app.locator(`#pf-item-${projectId}`);
  await card.getByRole("button", { name: "Archive" }).click();
  await expect(card).toBeHidden();
  await app.getByLabel("Show archived").check();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Restore" }).click();
  await app.getByLabel("Show archived").uncheck();
  await expect(card).toBeVisible();
});
