import { expect, setupSandbox, test } from "./fixtures";

setupSandbox();

test("agent-facing routes keep named controls, unique IDs, titles, and stable selectors", async ({ app, api, open }) => {
  const state = await api<{
    entries: { id: string; analysis?: { id?: string } }[];
    resumes: { id: string }[];
  }>("/api/state");
  const entry = state.entries[0]!;
  const resume = state.resumes[0]!;
  const routes = [
    "/",
    "/applications",
    `/applications/${entry.id}`,
    ...(entry.analysis?.id ? [`/analysis/${entry.analysis.id}`] : []),
    "/outreach",
    "/resumes",
    `/resumes/${resume.id}/edit`,
    "/settings/connections",
  ];
  const titles = new Set<string>();
  const agentIds = ["application.run-analysis", "application.approve", "resume.save-version", "resume.tailor", "job.cancel"];

  for (const route of routes) {
    await open(route);
    await expect(app.locator("#app-view")).toBeVisible();
    await expect(app).toHaveTitle(/ · ApplyDock$/);
    const audit = await app.evaluate(() => {
      const duplicateIds = [...document.querySelectorAll("[id]")]
        .map((element) => (element as HTMLElement).id)
        .filter((id, index, all) => all.indexOf(id) !== index);
      const controls = [...document.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, [role=button]")]
        .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true")
        .filter((element) => {
          const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
          const nativeLabels = (element as HTMLInputElement).labels ? [...(element as HTMLInputElement).labels!].map((label) => label.textContent || "").join(" ") : "";
          return ![element.getAttribute("aria-label"), labelledBy, nativeLabels, element.innerText, element.getAttribute("title"), element.getAttribute("placeholder"), element.getAttribute("alt")]
            .some((name) => name?.trim());
        })
        .map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`);
      const agentCounts = Object.fromEntries(["application.run-analysis", "application.approve", "resume.save-version", "resume.tailor", "job.cancel"]
        .map((id) => [id, document.querySelectorAll(`[data-agent-id="${id}"]`).length]));
      const clickableNonsemantic = [...document.querySelectorAll("[onclick]:not([role])")].map((element) => element.tagName.toLowerCase());
      return { title: document.title, duplicateIds, controls, agentCounts, clickableNonsemantic };
    });
    expect(audit.title).toBeTruthy();
    titles.add(audit.title);
    expect(audit.duplicateIds, `${route}: duplicate ids`).toEqual([]);
    expect(audit.controls, `${route}: unnamed controls`).toEqual([]);
    expect(audit.clickableNonsemantic, `${route}: clickable controls without a role`).toEqual([]);
    for (const id of agentIds) expect(audit.agentCounts[id], `${route}: ${id} must not be duplicated`).toBeLessThanOrEqual(1);
    if (route.endsWith("/edit")) expect(audit.agentCounts["resume.save-version"]).toBe(1);
  }
  expect(titles.size).toBeGreaterThan(1);
});
