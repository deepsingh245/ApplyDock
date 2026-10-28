import { expect, sandboxBase, setupSandbox, test } from "./fixtures";
import { SANDBOX_KEY } from "./sandbox";

setupSandbox();

const toast = (page: import("@playwright/test").Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });

test("tabs live in the URL and the layout uses the full width", async ({ app, open }) => {
  await app.setViewportSize({ width: 1920, height: 1000 });
  await open("/settings");
  await expect(app).toHaveURL(/\/settings\/connections$/);
  const width = await app.getByTestId("settings-layout").evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(1200);
  await app.getByRole("tab", { name: "Master Profile" }).click();
  await expect(app).toHaveURL(/\/settings\/profile$/);
  await expect(app.getByRole("form", { name: "Personal details" })).toBeVisible();
  await app.getByRole("tab", { name: "Connections" }).click();
  await expect(app).toHaveURL(/\/settings\/connections$/);
});

test("connection cards open with Configure and save like before", async ({ app, open }) => {
  await open("/settings/connections");
  const notion = app.getByRole("region", { name: "Notion" });
  const toggle = notion.getByRole("button", { name: "Configure" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(notion.getByLabel("Data source ID")).toBeHidden();
  await toggle.click();
  await expect(notion.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true");
  await expect(notion.getByLabel("Data source ID")).toBeVisible();

  const background = app.getByRole("region", { name: "AI writing background" });
  await background.getByRole("button", { name: "Configure" }).click();
  await background.getByLabel("Your background").fill("Frontend engineer. React and TypeScript.");
  await background.getByRole("button", { name: "Save background" }).click();
  await expect(toast(app, "Your background was saved locally.")).toBeVisible();
  await expect(background.getByTestId("status-chip")).toHaveText("Saved");

  const codex = app.getByRole("region", { name: "ATS analysis with Codex" });
  await expect(codex.getByTestId("status-chip")).toHaveText("Connected");
});

test("preferences: appearance follows the select; resume library opens", async ({ app, open }) => {
  await open("/settings/connections");
  await app.getByLabel("Appearance").selectOption("dark");
  await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
  await app.getByLabel("Appearance").selectOption("light");
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  const notifications = app.getByRole("switch", { name: "Notifications" });
  await notifications.click();
  expect(await app.evaluate(() => localStorage.getItem("applydock-notifications"))).toBe("off");
  await app.locator("#settings-resume-library").click();
  await expect(app).toHaveURL(/:\d+\/resumes$/);
});

test("maintenance runs the connection checks", async ({ app, open }) => {
  await open("/settings/connections");
  await app.getByRole("button", { name: "Run connection checks" }).click();
  await expect(toast(app, "Connection checks completed.")).toBeVisible();
});

test("the extension's profile deep link lands on the Master Profile", async ({ page }) => {
  await page.goto(sandboxBase() + "/");
  // The extension injects after the tab finishes loading; wait for the unpaired app like it does.
  await expect(page.getByTestId("pair-screen")).toBeVisible();
  await page.evaluate((key) => {
    sessionStorage.setItem("pairingKey", key);
    window.dispatchEvent(new Event("applydock-paired"));
    window.dispatchEvent(new CustomEvent("applydock-open", { detail: { action: "profile" } }));
  }, SANDBOX_KEY);
  await expect(page).toHaveURL(/\/settings\/profile/);
  await expect(page.getByRole("form", { name: "Personal details" })).toBeVisible();
});
