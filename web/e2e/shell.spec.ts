import { expect, sandboxBase, setupSandbox, test } from "./fixtures";
import { SANDBOX_KEY } from "./sandbox";

setupSandbox();

test("asks for the pairing key, rejects a wrong one, and remembers a right one", async ({ page, open }) => {
  await open("/");
  await expect(page.getByTestId("pair-screen")).toBeVisible();
  await page.getByLabel("Pairing key").fill("wrong-key");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("That pairing key was not accepted")).toBeVisible();
  await page.getByLabel("Pairing key").fill(SANDBOX_KEY);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("connection-state")).toHaveText("Local helper connected");
  expect(await page.evaluate(() => localStorage.getItem("pairingKey"))).toBe(SANDBOX_KEY);
  await page.reload();
  await expect(page.getByTestId("connection-state")).toHaveText("Local helper connected");
});

test("top bar: brand goes home, gear is the last action and opens Settings", async ({ app }) => {
  const actions = app.locator(".topbar-actions > *");
  await expect(actions.last()).toHaveAttribute("id", "settings-button");
  await app.locator("#settings-button").click();
  await expect(app).toHaveURL(/:\d+\/settings\/connections$/);
  await expect(app.locator("#settings-button")).toHaveAttribute("aria-current", "page");
  await app.locator("#applications-button").click();
  await expect(app).toHaveURL(/:\d+\/$/);
});

test("theme toggle persists the explicit choice", async ({ app }) => {
  await app.emulateMedia({ colorScheme: "light" });
  await app.evaluate(() => localStorage.removeItem("applydock-theme"));
  await app.reload();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "light");
  await app.locator("#theme-button").click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await app.evaluate(() => localStorage.getItem("applydock-theme"))).toBe("dark");
  await app.reload();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("extension pairing and deep links: profile", async ({ page }) => {
  // Mimic extension/sidepanel.js openWebWorkspace: key into sessionStorage, then the two events.
  await page.goto(sandboxBase() + "/");
  await expect(page.getByTestId("pair-screen")).toBeVisible();
  await page.evaluate((key) => {
    sessionStorage.setItem("pairingKey", key);
    window.dispatchEvent(new Event("applydock-paired"));
    window.dispatchEvent(new CustomEvent("applydock-open", { detail: { action: "profile" } }));
  }, SANDBOX_KEY);
  await expect(page).toHaveURL(/:\d+\/settings\/profile/);
  await expect(page.getByTestId("connection-state")).toHaveText("Local helper connected");
});

test("unknown routes show a not-found page with a way back", async ({ app, open }) => {
  await open("/nowhere");
  await expect(app.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
