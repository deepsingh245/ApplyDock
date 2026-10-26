// Extension side panel: design parity with the dashboard (brand, gear, Plex fonts, rows, chips, filters,
// collapsible settings), the same application rules (rejected hidden, needs-action default, submission
// record), and opening the dashboard on one application. The `chrome` APIs are stubbed; nothing leaves the sandbox.
import { launch } from "./cdp.mjs";

const BASE = process.env.UI_BASE || "http://127.0.0.1:8799/";
const PANEL = BASE + "__extension/sidepanel.html";
const b = await launch();
const log = (...args) => console.log(...args);
const CHROME_STUB = `
  window.__opened = []; window.__scripts = [];
  const store = {pairingKey: "sandbox-key"};
  window.chrome = {
    storage: {local: {get: async () => ({...store}), set: async value => Object.assign(store, value)},
              session: {get: async () => ({}), remove: async () => {}}},
    tabs: {query: async () => [{id: 1, url: "https://jobs.lever.co/acme/backend-2", title: "Backend Engineer"}],
           onActivated: {addListener() {}}, onUpdated: {addListener() {}},
           create: async options => { window.__opened.push(options.url); return {id: 7}; }, get: async () => ({status: "complete"})},
    runtime: {onMessage: {addListener() {}}},
    permissions: {contains: async () => true, request: async () => true},
    scripting: {executeScript: async options => {
      window.__scripts.push(options.args || null);
      return [{result: {url: "https://jobs.lever.co/acme/backend-2", kind: "job", title: "Backend Engineer", company: "Acme",
        excerpt: "Build Node.js APIs with OAuth and PostgreSQL. ".repeat(12), post_details: "", contact_emails: [], apply_url: "",
        recipient: "", apply_method: "unknown", needs_review: true}}];
    }},
  };
  // The panel talks to the real helper port; in the sandbox the API is served from this same origin.
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, options) => realFetch(String(url).replace("http://127.0.0.1:8765", location.origin), options);
`;
try {
  await b.size(400, 900);
  await b.send("Page.addScriptToEvaluateOnNewDocument", {source: CHROME_STUB});
  // A light system theme, so the first screen is light and the theme button must switch it to dark.
  await b.send("Emulation.setEmulatedMedia", {features: [{name: "prefers-color-scheme", value: "light"}]});
  await b.goto(PANEL);
  await b.waitFor(`document.querySelector("#list .entry")`, 15000);
  await b.sleep(400);

  // Design parity
  const design = await b.eval(`(() => ({
    brand: document.querySelector(".brand h1").textContent,
    gearLast: document.querySelector(".header-actions").lastElementChild.id === "settings-open",
    theme: document.documentElement.dataset.theme,
    plex: document.fonts.check("13px 'Plex Sans'") && getComputedStyle(document.body).fontFamily.includes("Plex Sans"),
    oldNightSwitch: !!document.getElementById("theme-toggle"),
    rowDeleteButtons: document.querySelectorAll(".entry-head .entry-delete").length,
    score: document.querySelector(".entry-score").textContent,
    open: !!document.querySelector(".entry.open"),
    summary: document.querySelector(".entry-summary .score-figure strong")?.textContent }))()`);
  log("design:", JSON.stringify(design));
  if (design.theme !== "light" || design.brand !== "ApplyDock" || !design.gearLast || !design.plex || design.oldNightSwitch || design.rowDeleteButtons || !design.open || design.summary !== "64.5")
    throw new Error("Side panel does not match the dashboard design");
  await b.shot("x1-panel-light");

  // Open the dashboard on this application's analysis
  const entryId = await b.eval(`document.querySelector(".entry-toggle").dataset.id`);
  await b.click('[data-web-action="analysis"]');
  await b.sleep(300);
  const opened = await b.eval(`JSON.stringify({opened: window.__opened.at(-1), detail: window.__scripts.at(-1)?.[1]})`);
  log("open analysis in dashboard:", opened);
  if (!opened.includes('"action":"analysis"') || !opened.includes(entryId)) throw new Error("Open analysis did not target the application");

  // Theme follows the icon button
  await b.click("#theme-button");
  const theme = await b.eval(`document.documentElement.dataset.theme + " / " + document.getElementById("theme-button").getAttribute("aria-label")`);
  log("theme:", theme);
  if (theme !== "dark / Switch to light mode") throw new Error("Theme button did not switch to dark");
  await b.shot("x2-panel-dark");

  // Rejected applications leave the list unless the Rejected filter is selected
  await b.eval(`fetch("http://127.0.0.1:8765/api/entries/${entryId}", {method: "PATCH", headers: {"X-Local-Key": "sandbox-key", "Content-Type": "application/json"}, body: JSON.stringify({application_stage: "Rejected"})}).then(() => load()).then(() => true)`);
  await b.waitFor(`document.querySelectorAll("#list .entry").length === 0`, 5000);
  log("after rejecting:", await b.eval(`document.querySelector("#list .empty").textContent + " | rejected count " + document.getElementById("rejected-count").textContent`));
  await b.click('[data-filter="rejected"]');
  await b.waitFor(`document.querySelectorAll("#list .entry").length === 1`, 5000);
  await b.click('[data-filter="all"]');

  // Settings: gear stays, cards collapse behind Configure, Master Profile opens in the dashboard
  await b.click("#settings-open");
  const settings = await b.eval(`(() => ({gearActive: document.getElementById("settings-open").classList.contains("active"),
    collapsed: [...document.querySelectorAll("#settings-screen .settings-card.collapsible:not(.expanded)")].length,
    pairingOpen: !document.querySelector("#settings-screen .settings-card").classList.contains("collapsible")}))()`);
  log("settings:", JSON.stringify(settings));
  if (!settings.gearActive || settings.collapsed < 4 || !settings.pairingOpen) throw new Error("Settings screen does not match");
  await b.click("#master-profile-open");
  await b.sleep(300);
  if (!(await b.eval(`JSON.stringify(window.__scripts.at(-1)?.[1])`)).includes('"profile"')) throw new Error("Master Profile did not open in the dashboard");
  await b.shot("x3-settings-dark");
  await b.click("#settings-open");

  // Capture still works end to end
  await b.click("#capture");
  await b.waitFor(`!document.getElementById("capture-preview").hidden`, 5000);
  await b.click("#preview-form [type=submit]");
  await b.waitFor(`[...document.querySelectorAll(".entry-title")].some(el => el.textContent === "Backend Engineer")`, 10000);
  log("captured: Backend Engineer");
  await b.shot("x4-panel-captured");

  // The dashboard honours "open this application" requests from the extension
  await b.size(1440, 900);
  await b.goto(BASE);
  await b.eval(`localStorage.setItem("pairingKey", "sandbox-key"); true`);
  await b.goto(BASE);
  await b.waitFor(`!document.getElementById("app-view").hidden`);
  const backend = await b.eval(`window.ApplyDock.state().entries.find(e => e.title === "Backend Engineer").id`);
  await b.eval(`window.dispatchEvent(new CustomEvent("applydock-open", {detail: {entryId: ${JSON.stringify(backend)}, action: "submission"}})); true`);
  await b.waitFor(`document.getElementById("editor-title").textContent === "Backend Engineer" && !!document.getElementById("submission-card")`, 10000);
  log("dashboard opened the application from the extension");
  await b.eval(`window.dispatchEvent(new CustomEvent("applydock-open", {detail: {action: "profile"}})); true`);
  await b.waitFor(`!document.getElementById("settings-view").hidden && !document.getElementById("profile-pane").hidden`, 10000);
  log("dashboard opened the Master Profile from the extension");
  log("console errors:", JSON.stringify(b.consoleErrors));
  if (b.consoleErrors.length) throw new Error("Console errors");
} catch (error) {
  console.error("FAILED:", error.message);
  await b.shot("failure");
  console.error("console errors:", JSON.stringify(b.consoleErrors));
  process.exitCode = 1;
} finally {
  b.close();
}
