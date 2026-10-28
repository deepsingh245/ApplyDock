import type { Page } from "@playwright/test";
import { expect, setupSandbox, test as base } from "./fixtures";
import { SANDBOX_KEY } from "./sandbox";

setupSandbox();

// The library embeds the resume PDF in an iframe. The shared fixture pairs with an init script, which also runs in
// that iframe, where storage is unavailable and throws; so this spec pairs through storage once instead.
const test = base.extend<{ app: Page }>({
  app: async ({ page, open }, use) => {
    await open("/");
    await page.evaluate((key) => localStorage.setItem("pairingKey", key), SANDBOX_KEY);
    await open("/");
    await expect(page.getByTestId("connection-state")).toHaveText("Local helper connected");
    await use(page);
  },
});

interface Resume {
  id: string;
  name: string;
  file_url: string;
}
interface Entry {
  id: string;
  resume_version: { id: string } | null;
}

/** The library is reached from Settings; fall back to the URL while Settings is still being ported. */
async function openLibrary(page: Page, open: (path?: string) => Promise<void>) {
  await page.locator("#settings-button").click();
  const button = page.locator("#settings-resume-library").or(page.getByRole("button", { name: "Open resume library" }));
  if (await button.first().isVisible().catch(() => false)) await button.first().click();
  else await open("/resumes");
  await expect(page.getByRole("heading", { name: "Resumes", level: 1 })).toBeVisible();
}

test("library: select, rename, upload, make default, delete, open editor", async ({ app, api, open }) => {
  await openLibrary(app, open);
  const { resumes } = await api<{ resumes: Resume[] }>("/api/state");
  const master = resumes[0]!;
  const row = app.locator(`[data-resume-select="${master.id}"]`);
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect(app.getByTestId("resume-detail")).toContainText("Frontend master");
  await expect(app.getByTitle("Preview of Frontend master")).toBeVisible();

  // Rename
  const details = app.getByRole("form", { name: "Document details" });
  await details.getByLabel("Name").fill("Frontend master v2");
  await details.getByRole("button", { name: "Save details" }).click();
  await expect(app.getByText("Resume details saved")).toBeVisible();
  await expect(row).toContainText("Frontend master v2");

  // Upload a copy of the same PDF as a second resume
  const pdf = await app.request.get(master.file_url);
  await app.getByRole("button", { name: "Upload resume" }).click();
  const upload = app.getByRole("form", { name: "Upload a resume" });
  await upload.getByLabel("Resume name").fill("Backend copy");
  await upload.getByLabel("Category").fill("Backend Developer");
  await upload.getByLabel("PDF or DOCX file").setInputFiles({ name: "backend.pdf", mimeType: "application/pdf", buffer: await pdf.body() });
  await upload.getByRole("button", { name: "Upload resume" }).click();
  await expect(app.getByText("Resume saved to your private local library.")).toBeVisible();
  const copyRow = app.locator("[data-resume-select]").filter({ hasText: "Backend copy" });
  await expect(copyRow).toBeVisible();

  // Make it the default, then delete it (confirm dialog)
  await copyRow.click();
  await app.getByRole("button", { name: "Make default" }).click();
  await expect(app.getByText("Default resume updated.")).toBeVisible();
  await expect(copyRow).toContainText("Default");
  await app.getByTestId("resume-detail").getByRole("button", { name: "Delete" }).click();
  const dialog = app.getByTestId("confirm-dialog");
  await expect(dialog).toContainText("Delete ‘Backend copy’");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(app.getByText(/Resume deleted locally/)).toBeVisible();
  await expect(copyRow).toHaveCount(0);

  // Edit opens the resume editor
  await row.click();
  await app.getByTestId("resume-detail").getByRole("button", { name: /Edit in ApplyDock|Import & edit/ }).click();
  await expect(app).toHaveURL(new RegExp(`/resumes/${master.id}/edit`));
});

test("usage list shows where a resume was submitted", async ({ app, api, open }) => {
  const { entries, resumes } = await api<{ entries: Entry[]; resumes: Resume[] }>("/api/state");
  const entry = entries[0]!;
  const today = new Date().toISOString().slice(0, 10);
  await api(`/api/entries/${entry.id}/submissions`, "POST", { resume_version_id: entry.resume_version!.id, channel: "external", submitted_at: `${today}T12:00:00`, note: "" });
  await open(`/resumes/${resumes[0]!.id}`);
  const usage = app.getByTestId("resume-usage");
  await expect(usage).toContainText("Submitted to 1 application");
  await usage.locator("summary").click();
  const list = app.getByTestId("resume-usage-list");
  await expect(list.getByRole("link", { name: "Initech — Senior Frontend Engineer" })).toBeVisible();
  await expect(list).toContainText("Company site");
});
