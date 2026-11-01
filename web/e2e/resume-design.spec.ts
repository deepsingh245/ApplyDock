// Settings → Resume design: a default design for new resumes, edited and previewed in Settings or taken from the
// editor, and the application following its tailored copy.
import { expect, setupSandbox, test } from "./fixtures";

setupSandbox();
test.describe.configure({ mode: "serial" });

type Meta = { template: string; layout: Record<string, unknown>; section_order: string[] };
type DraftResponse = { draft: { content: { meta: Meta } & Record<string, unknown>; revision: number } };
const ids = { masterId: "", entryId: "", tailoredId: "" };

test("set a default design in Settings, with a live preview", async ({ app, api, open }) => {
  const state = await api<{ resumes: { id: string; kind: string }[]; entries: { id: string }[] }>("/api/state");
  ids.masterId = state.resumes.find((resume) => resume.kind === "master")!.id;
  ids.entryId = state.entries[0]!.id;
  // Review the imported master once (tailoring needs reviewed content); this also gives the preview real text.
  const opened = await api<DraftResponse>(`/api/resumes/${ids.masterId}/draft`);
  const reviewed = await api<{ draft: { revision: number } }>(`/api/resumes/${ids.masterId}/draft`, "PATCH", {
    content: opened.draft.content,
    expected_revision: opened.draft.revision,
    reviewed: true,
  });
  await api(`/api/resumes/${ids.masterId}/versions/from-draft`, "POST", { expected_revision: reviewed.draft.revision });

  await open("/settings/design");
  const panel = app.getByTestId("resume-design-settings");
  await expect(panel.locator('[data-mode="last"]')).toHaveAttribute("aria-checked", "true");
  await expect(panel.locator('[data-mode="default"]')).toBeDisabled();
  await expect(panel.getByText("Not saved yet")).toBeVisible();
  await expect(panel.getByTestId("design-preview")).toBeVisible({ timeout: 30_000 });

  await panel.locator('[data-preset="compact"]').click();
  await panel.locator('[data-layout-choice="accent"][data-value="#7a1f2b"]').click();
  await panel.getByRole("button", { name: /Move Skills up/ }).click();
  await panel.getByRole("button", { name: "Save as default design" }).click();
  await expect(app.getByText("Default design saved.")).toBeVisible();
  await expect(panel.locator('[data-mode="default"]')).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByText("In use")).toBeVisible();

  await app.reload();
  await expect(panel.locator('[data-preset="compact"]')).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator('[data-layout-choice="accent"][data-value="#7a1f2b"]')).toHaveAttribute("aria-pressed", "true");
});

test("a new tailored resume starts with the default design, and the application switches to it", async ({ api }) => {
  const tailored = await api<{ resume: { id: string } }>(`/api/entries/${ids.entryId}/tailor`, "POST", { base_resume_id: ids.masterId });
  ids.tailoredId = tailored.resume.id;
  const meta = (await api<DraftResponse>(`/api/resumes/${ids.tailoredId}/draft`)).draft.content.meta;
  expect(meta.template).toBe("compact");
  expect(meta.layout.accent).toBe("#7a1f2b");
  const settings = await api<{ default: Meta }>("/api/resume-design");
  expect(meta.section_order).toEqual(settings.default.section_order);
  // The master keeps its own design; the application now follows the tailored copy.
  expect((await api<DraftResponse>(`/api/resumes/${ids.masterId}/draft`)).draft.content.meta.template).toBe("ats-classic");
  const state = await api<{ entries: { id: string; resume_id: string }[] }>("/api/state");
  expect(state.entries.find((entry) => entry.id === ids.entryId)!.resume_id).toBe(ids.tailoredId);
});

test("the editor shows the default and can make a resume's design the new default", async ({ app, api, open }) => {
  await open(`/resumes/${ids.tailoredId}/edit?entry=${ids.entryId}`);
  await app.getByRole("tab", { name: "Design" }).click();
  await expect(app.getByTestId("is-default-design")).toBeVisible();
  await app.locator('[data-layout-choice="accent"][data-value="#0f766e"]').click();
  await expect(app.getByTestId("save-status")).toHaveText("All changes saved");
  await app.getByRole("button", { name: "Make this my default design" }).click();
  await expect(app.getByText("Saved as your default design.")).toBeVisible();
  await expect(app.getByTestId("is-default-design")).toBeVisible();
  expect((await api<{ default: Meta; mode: string }>("/api/resume-design")).default.layout.accent).toBe("#0f766e");

  await app.getByRole("link", { name: "Resume design settings" }).click();
  await expect(app).toHaveURL(/\/settings\/design$/);
  await app.locator('[data-mode="last"]').click();
  await expect(app.getByText("New resumes now follow the last design you edited.")).toBeVisible();
  expect((await api<{ mode: string }>("/api/resume-design")).mode).toBe("last");
});
