// Extension side panel (extension/, served by the sandbox under /__extension/): design parity with the web app,
// the same application rules, capture, and opening the web app on one application. The `chrome` APIs are
// stubbed; nothing leaves the sandbox.
import { expect, sandboxBase, setupSandbox, test } from "./fixtures";
import { SANDBOX_KEY } from "./sandbox";

setupSandbox();

const CHROME_STUB = (key: string) => {
  const target = window as unknown as Record<string, unknown>;
  target.__opened = [];
  target.__scripts = [];
  const store: Record<string, unknown> = { pairingKey: key };
  target.chrome = {
    storage: {
      local: { get: async () => ({ ...store }), set: async (value: Record<string, unknown>) => Object.assign(store, value) },
      session: { get: async () => ({}), remove: async () => undefined },
    },
    tabs: {
      query: async () => [{ id: 1, url: "https://jobs.lever.co/acme/backend-2", title: "Backend Engineer" }],
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
      create: async (options: { url: string }) => {
        (target.__opened as string[]).push(options.url);
        return { id: 7 };
      },
      get: async () => ({ status: "complete" }),
    },
    runtime: { onMessage: { addListener() {} } },
    permissions: { contains: async () => true, request: async () => true },
    scripting: {
      executeScript: async (options: { args?: unknown[] }) => {
        (target.__scripts as unknown[]).push(options.args ?? null);
        return [
          {
            result: {
              url: "https://jobs.lever.co/acme/backend-2",
              kind: "job",
              title: "Backend Engineer",
              company: "Acme",
              excerpt: "Build Node.js APIs with OAuth and PostgreSQL. ".repeat(12),
              post_details: "",
              contact_emails: [],
              apply_url: "",
              recipient: "",
              apply_method: "unknown",
              needs_review: true,
            },
          },
        ];
      },
    },
  };
  // The panel talks to the real helper port; in the sandbox the API is served from this same origin.
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, options) => realFetch(String(url).replace("http://127.0.0.1:8765", location.origin), options);
};

test("side panel matches the web app, follows its rules, captures, and opens the web app", async ({ page, consoleErrors }) => {
  void consoleErrors;
  await page.setViewportSize({ width: 400, height: 900 });
  await page.addInitScript(CHROME_STUB, SANDBOX_KEY);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(sandboxBase() + "/__extension/sidepanel.html");
  await expect(page.locator("#list .entry").first()).toBeVisible();

  // Design parity
  await expect(page.locator(".brand h1")).toHaveText("ApplyDock");
  await expect(page.locator(".header-actions > *").last()).toHaveAttribute("id", "settings-open");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => document.fonts.check("13px 'Plex Sans'") && getComputedStyle(document.body).fontFamily.includes("Plex Sans"))).toBe(true);
  await expect(page.locator("#theme-toggle")).toHaveCount(0);
  await expect(page.locator(".entry-head .entry-delete")).toHaveCount(0);
  await expect(page.locator(".entry.open")).toHaveCount(1);
  await expect(page.locator(".entry-summary .score-figure strong")).toHaveText("64.5");

  // Open the web app on this application's analysis
  const entryId = await page.locator(".entry-toggle").first().getAttribute("data-id");
  await page.locator('[data-web-action="analysis"]').first().click();
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as unknown as { __scripts: unknown[][] }).__scripts.at(-1)?.[1]))).toContain('"action":"analysis"');
  expect(await page.evaluate(() => JSON.stringify((window as unknown as { __scripts: unknown[][] }).__scripts.at(-1)?.[1]))).toContain(entryId!);

  // Theme follows the icon button
  await page.locator("#theme-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#theme-button")).toHaveAttribute("aria-label", "Switch to light mode");

  // Rejected applications leave the list unless the Rejected filter is selected
  await page.evaluate(
    async ({ id, key }) => {
      await fetch(`http://127.0.0.1:8765/api/entries/${id}`, {
        method: "PATCH",
        headers: { "X-Local-Key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ application_stage: "Rejected" }),
      });
      await (window as unknown as { load: () => Promise<void> }).load();
    },
    { id: entryId!, key: SANDBOX_KEY },
  );
  await expect(page.locator("#list .entry")).toHaveCount(0);
  await page.locator('[data-filter="rejected"]').click();
  await expect(page.locator("#list .entry")).toHaveCount(1);
  await page.locator('[data-filter="all"]').click();

  // Settings: the gear stays, cards collapse behind Configure, the Master Profile opens in the web app
  await page.locator("#settings-open").click();
  await expect(page.locator("#settings-open")).toHaveClass(/active/);
  expect(await page.locator("#settings-screen .settings-card.collapsible:not(.expanded)").count()).toBeGreaterThanOrEqual(4);
  await expect(page.locator("#settings-screen .settings-card").first()).not.toHaveClass(/collapsible/);
  await page.locator("#settings-screen .settings-card", { hasText: "Master Profile" }).getByRole("button", { name: "Configure" }).click();
  await page.locator("#master-profile-open").click();
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as unknown as { __scripts: unknown[][] }).__scripts.at(-1)?.[1]))).toContain('"profile"');
  await page.locator("#settings-open").click();

  // Capture still works end to end
  await page.locator("#capture").click();
  await expect(page.locator("#capture-preview")).toBeVisible();
  await page.locator("#preview-form [type=submit]").click();
  await expect(page.locator(".entry-title", { hasText: "Backend Engineer" })).toBeVisible();

  // The web app honours "open this application" requests for the captured job
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(sandboxBase() + "/");
  await expect(page.getByTestId("pair-screen")).toBeVisible();
  await page.evaluate((key) => {
    sessionStorage.setItem("pairingKey", key);
    window.dispatchEvent(new Event("applydock-paired"));
  }, SANDBOX_KEY);
  await expect(page.getByTestId("connection-state")).toHaveText("Local helper connected");
  const backend = await page.evaluate(async (key) => {
    const state = await (await fetch("/api/state", { headers: { "X-Local-Key": key } })).json();
    return state.entries.find((entry: { title: string }) => entry.title === "Backend Engineer").id as string;
  }, SANDBOX_KEY);
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent("applydock-open", { detail: { entryId: id, action: "submission" } })), backend);
  await expect(page.locator("#editor-title")).toHaveText("Backend Engineer");
  await expect(page.getByTestId("submission-form")).toBeVisible();
});
