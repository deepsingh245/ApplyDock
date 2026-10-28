import { test as base, expect, type Page } from "@playwright/test";
import { SANDBOX_KEY, startSandbox, type Sandbox } from "./sandbox";

interface Fixtures {
  /** A page already paired with the sandbox and opened on the app. */
  app: Page;
  /** Go to a path inside the app ("/settings/profile"). */
  open: (path?: string) => Promise<void>;
  /** Call the helper API as the paired app would. */
  api: <T = Record<string, unknown>>(path: string, method?: string, body?: unknown) => Promise<T>;
  consoleErrors: string[];
}

// One sandbox per spec file: specs change data, and a fresh helper keeps them independent.
let sandbox: Sandbox | null = null;
let starting: Promise<Sandbox> | null = null;

export const test = base.extend<Fixtures>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text());
      });
      await use(errors);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
  open: async ({ page }, use) => {
    await use(async (path = "/") => {
      await page.goto(sandbox!.base + path);
    });
  },
  app: async ({ page, open }, use) => {
    // Init scripts also run in PDF preview frames, where localStorage is unavailable.
    await page.addInitScript((key) => {
      try {
        localStorage.setItem("pairingKey", key);
      } catch {
        /* not the app document */
      }
    }, SANDBOX_KEY);
    await open("/");
    await expect(page.getByTestId("connection-state")).toHaveText("Local helper connected");
    await use(page);
  },
  api: async ({ request }, use) => {
    await use(async (path, method = "GET", body) => {
      const response = await request.fetch(sandbox!.origin + path, {
        method,
        headers: { "X-Local-Key": SANDBOX_KEY, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        data: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok()) throw new Error(`${method} ${path} → ${response.status()} ${await response.text()}`);
      return (await response.json()) as never;
    });
  },
});

/** Call once at the top of every spec file: starts a fresh sandbox for that file and stops it afterwards. */
export function setupSandbox() {
  test.beforeAll(async () => {
    starting ??= startSandbox();
    sandbox = await starting;
  });
  test.afterAll(async () => {
    await sandbox?.stop();
    sandbox = null;
    starting = null;
  });
}

export const sandboxBase = () => sandbox!.base;
export { expect };
