// Design-rule pass over every screen: both themes, phone to wide desktop. Checks what DESIGN.md promises
// (no text under 12px, no horizontal page scroll, WCAG AA via axe) and saves screenshots for review.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, setupSandbox, test } from "./fixtures";

setupSandbox();

const WIDTHS = [375, 768, 1440, 1920];

async function screens(api: <T>(path: string) => Promise<T>) {
  const state = await api<{ entries: { id: string; analysis: { id?: string } }[]; resumes: { id: string }[] }>("/api/state");
  const entry = state.entries[0]!;
  return [
    { name: "applications", path: `/applications/${entry.id}` },
    { name: "create", path: "/applications/new" },
    { name: "analysis", path: `/analysis/${entry.analysis.id}` },
    { name: "settings", path: "/settings/connections" },
    { name: "profile", path: "/settings/profile" },
    { name: "library", path: `/resumes/${state.resumes[0]!.id}` },
    { name: "editor", path: `/resumes/${state.resumes[0]!.id}/edit?entry=${entry.id}&analysis=${entry.analysis.id}` },
  ];
}

async function smallText(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      if (!element || !node.textContent?.trim() || !element.checkVisibility()) continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < 12) offenders.push(`${size}px: ${node.textContent.trim().slice(0, 40)}`);
    }
    return offenders;
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`every screen follows the design rules (${theme})`, async ({ app, open, api }) => {
    test.setTimeout(240_000);
    await app.emulateMedia({ colorScheme: theme });
    await app.evaluate((value) => localStorage.setItem("applydock-theme", value), theme);
    for (const screen of await screens(api)) {
      for (const width of WIDTHS) {
        await app.setViewportSize({ width, height: 900 });
        await open(screen.path);
        await expect(app.locator("#applications-button")).toBeVisible();
        await app.waitForLoadState("networkidle");
        await expect(app.getByText("Loading…").filter({ visible: true })).toHaveCount(0);
        const where = `${screen.name} @${width} ${theme}`;
        expect(await app.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${where}: horizontal scroll`).toBeLessThanOrEqual(0);
        expect(await smallText(app), `${where}: text under 12px`).toEqual([]);
        if (width === 1440 || width === 375) {
          await app.screenshot({ path: `test-results/visual/${screen.name}-${width}-${theme}.png`, fullPage: false });
          // The PDF preview is a browser viewer whose internals axe cannot judge.
          const results = await new AxeBuilder({ page: app }).withTags(["wcag2a", "wcag2aa"]).exclude("iframe").analyze();
          const problems = results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).slice(0, 3).join(" | ")}`);
          expect(problems, `${where}: accessibility`).toEqual([]);
        }
      }
    }
  });
}
