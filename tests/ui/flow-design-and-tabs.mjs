import { launch } from "./cdp.mjs";

const BASE = process.env.UI_BASE || "http://127.0.0.1:8799/";
const b = await launch();
const log = (...args) => console.log(...args);
const setRange = (key, value) => b.eval(`(() => { const el = document.querySelector('[data-layout="${key}"]'); el.value = "${value}"; el.dispatchEvent(new Event("input", {bubbles: true})); return el.value; })()`);
try {
  await b.size(1640, 900);
  await b.goto(BASE);
  await b.eval(`localStorage.setItem("pairingKey", "sandbox-key"); localStorage.setItem("applydock-theme", "dark"); true`);
  await b.goto(BASE);
  await b.waitFor(`!document.getElementById("app-view").hidden`);
  await b.eval(`window.confirm = () => true; true`);

  // Application editor tabs
  await b.waitFor(`document.querySelector('[data-editor-tab="details"]')`);
  log("visible panes:", await b.eval(`[...document.querySelectorAll("#editor-form [data-pane]")].filter(p => !p.hidden).map(p => p.dataset.pane).join(",")`));
  log("overview page height:", await b.eval(`document.documentElement.scrollHeight`));
  await b.shot("t1-app-overview");
  for (const tab of ["details", "resume", "email"]) {
    await b.click(`[data-editor-tab="${tab}"]`);
    log(tab, "->", await b.eval(`[...document.querySelectorAll("#editor-form [data-pane]")].filter(p => !p.hidden).map(p => p.dataset.pane).join(",")`), "height", await b.eval(`document.documentElement.scrollHeight`));
  }
  await b.shot("t2-app-email");
  // invalid required field on a hidden tab switches to it
  await b.eval(`document.querySelector('[name="title"]').value = ""; document.getElementById("editor-form").requestSubmit(); true`);
  await b.sleep(300);
  log("after invalid submit tab:", await b.eval(`document.querySelector("[data-editor-tab].active").dataset.editorTab`));
  await b.eval(`document.querySelector('[name="title"]').value = "Senior Frontend Engineer"; true`);

  // Resume editor full width + design
  await b.click('[data-editor-tab="resume"]');
  await b.click('[data-entry-resume="edit"]');
  await b.waitFor(`document.querySelector("#re-preview-frame iframe")`, 20000);
  const widths = await b.eval(`(() => { const v = document.getElementById("resume-editor-view").getBoundingClientRect(); const c = document.querySelector(".workspace-content").getBoundingClientRect(); return [Math.round(v.width), Math.round(c.width)]; })()`);
  log("editor width vs content area:", widths);
  await b.shot("t3-editor-wide");
  await b.click('[data-left="design"]');
  await b.waitFor(`!document.getElementById("re-design").hidden`);
  await b.shot("t4-design");
  await setRange("margin_x", "30");
  await setRange("margin_y", "25");
  await b.click('[data-layout-choice="font"][data-value="Libertinus Serif"]');
  await b.click('[data-layout-choice="accent"][data-value="#7a1f2b"]');
  await b.eval(`(() => { const el = document.querySelector('[data-layout="accent_headings"]'); el.checked = true; el.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
  await b.click('[data-layout-choice="header_align"][data-value="left"]');
  await b.waitFor(`document.getElementById("re-save-status").textContent === "All changes saved"`, 10000);
  await b.sleep(1500);
  await b.shot("t5-design-applied");
    log("margin output:", await b.eval(`document.querySelector('[data-layout-value="margin_x"]').textContent`));
  // fit: set page limit 1 after enlarging fonts to force 2 pages
  await setRange("font_size", "13");
  await setRange("section_gap", "2.5");
  await b.eval(`(() => { const s = document.querySelector('#re-design [data-meta="page_limit"]'); s.value = "1"; s.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
  await b.waitFor(`/2 pages/.test(document.getElementById("re-page-status").textContent)`, 15000);
  log("before fit:", await b.eval(`document.getElementById("re-page-status").textContent`));
  await b.click('[data-re="fit"]');
  await b.waitFor(`document.getElementById("notice").textContent.includes("fit") || document.getElementById("notice").textContent.includes("Still")`, 30000);
  log("fit notice:", await b.eval(`document.getElementById("notice").textContent`));
  await b.waitFor(`/1 page/.test(document.getElementById("re-page-status").textContent)`, 15000);
  log("after fit:", await b.eval(`document.getElementById("re-page-status").textContent`), "font:", await b.eval(`document.querySelector('[data-layout-value="font_size"]').textContent`));
  await b.click('[data-re="undo"]');
  await b.sleep(400);
  log("undo fit font:", await b.eval(`document.querySelector('[data-layout-value="font_size"]').textContent`));
  await b.shot("t6-fit");
  // validate checks with custom design
  await b.click('[data-left="content"]');
  await b.click('[data-side="preview"]');
  await b.click('[data-re="validate"]');
  await b.waitFor(`document.querySelector(".re-check")`, 10000);
  log("checks:", await b.eval(`document.querySelector(".re-check").textContent.slice(0, 120)`));
  await b.size(390, 844, true);
  await b.click('[data-left="design"]');
  await b.sleep(500);
  await b.shot("t7-mobile-design");
  log("overflow:", await b.eval(`document.documentElement.scrollWidth > window.innerWidth`));
  log("console errors:", JSON.stringify(b.consoleErrors));
} catch (error) {
  console.error("FAILED:", error.message);
  await b.shot("failure");
  console.error("console errors:", JSON.stringify(b.consoleErrors));
  process.exitCode = 1;
} finally { b.close(); }
