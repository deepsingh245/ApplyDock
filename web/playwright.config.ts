import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Use the installed Chrome, else Edge, so no browser download is needed.
const chromePaths = [
  `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const channel = process.env.PW_CHANNEL ?? (chromePaths.some((path) => existsSync(path)) ? "chrome" : "msedge");

export default defineConfig({
  testDir: "./e2e",
  // Each spec file starts its own sandbox helper with temporary data (e2e/sandbox.ts), so files run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    channel,
    headless: !process.env.HEADED,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
