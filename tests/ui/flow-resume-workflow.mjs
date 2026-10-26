import { launch } from "./cdp.mjs";

const BASE = process.env.UI_BASE || "http://127.0.0.1:8799/";
const b = await launch();
const log = (...args) => console.log(...args);
try {
  await b.size(1440, 1000);
  await b.goto(BASE);
  await b.eval(`localStorage.setItem("pairingKey", "sandbox-key"); true`);
  await b.goto(BASE);
  await b.waitFor(`!document.getElementById("app-view").hidden`);
  log("app loaded");

  // 1. Resume library -> import & edit the master
  await b.click("#settings-button");
  await b.click("#settings-resume-library");
  await b.waitFor(`document.querySelector("[data-open-resume-editor]")`);
  await b.shot("01-library");
  await b.click("[data-open-resume-editor]");
  await b.waitFor(`!document.getElementById("resume-editor-view").hidden && document.querySelector("#re-form .re-section")`);
  await b.waitFor(`document.querySelector("#re-preview-frame iframe")`, 20000);
  await b.sleep(800);
  await b.shot("02-editor-import-review");
  log("banner:", await b.eval(`document.querySelector(".re-banner.review strong")?.textContent`));
  log("name field:", await b.eval(`document.querySelector('[data-target="basics"][data-field="name"]').value`));
  log("page status:", await b.eval(`document.getElementById("re-page-status").textContent`));

  // 2. Edit a field -> autosave
  await b.eval(`(() => { const el = document.querySelector('[data-target="basics"][data-field="label"]'); el.value = "Senior Frontend Engineer"; el.dispatchEvent(new Event("input", {bubbles: true})); return true; })()`);
  await b.waitFor(`document.getElementById("re-save-status").textContent === "All changes saved"`, 8000);
  log("autosaved:", await b.eval(`document.getElementById("re-save-status").textContent`));
  // undo
  await b.click('[data-re="undo"]');
  await b.waitFor(`document.querySelector('[data-target="basics"][data-field="label"]').value === "Frontend Engineer"`);
  log("undo ok");
  await b.click('[data-re="redo"]');
  await b.waitFor(`document.querySelector('[data-target="basics"][data-field="label"]').value === "Senior Frontend Engineer"`);
  log("redo ok");

  // 3. Mark reviewed, save version (confirm dialogs auto-accepted)
  await b.eval(`window.confirm = () => true; window.prompt = (m, v) => v; true`);
  await b.click('[data-re="mark-reviewed"]');
  await b.waitFor(`!document.querySelector(".re-banner.review")`);
  await b.waitFor(`document.getElementById("re-save-status").textContent === "All changes saved"`, 8000);
  await b.click('[data-re="save-version"]');
  await b.waitFor(`document.getElementById("notice").textContent.includes("Saved version")`, 15000);
  log("notice:", await b.eval(`document.getElementById("notice").textContent`));
  await b.click('[data-side="versions"]');
  await b.sleep(300);
  await b.shot("03-versions");
  log("versions:", await b.eval(`[...document.querySelectorAll(".re-version strong")].map(e => e.textContent).join(" | ")`));

  // 4. Back to the application, optimize for this job (creates tailored copy)
  await b.click("#applications-button");
  await b.waitFor(`!document.getElementById("queue-view").hidden`);
  await b.waitFor(`document.querySelector('[data-entry-resume="optimize"]')`);
  await b.shot("04-application");
  log("version line:", await b.eval(`document.getElementById("resume-version-line").textContent`));
  await b.click('[data-entry-resume="optimize"]');
  await b.waitFor(`!document.getElementById("resume-editor-view").hidden && document.querySelector(".re-kind.tailored")`, 20000);
  log("tailored opened:", await b.eval(`document.querySelector(".re-title h1").textContent`));

  // 5. Job match panel -> suggestions
  await b.click('[data-side="analysis"]');
  await b.waitFor(`document.querySelector('[data-re="suggest"]')`);
  await b.click('[data-re="suggest"]');
  await b.waitFor(`document.querySelectorAll(".re-suggestion").length >= 2`, 20000);
  await b.sleep(500);
  await b.eval(`document.querySelector(".re-suggestion").scrollIntoView({block: "center"}); true`);
  await b.shot("05-suggestions");
  log("suggestions:", await b.eval(`document.querySelectorAll(".re-suggestion").length`), "verify badges:", await b.eval(`document.querySelectorAll(".re-verify").length`));
  log("first card:", await b.eval(`document.querySelector(".re-suggestion").innerText.slice(0, 400)`));

  // 6. Accept the safe one, accept the flagged one (confirm), check content
  const safeId = await b.eval(`[...document.querySelectorAll(".re-suggestion")].find(c => c.querySelector(".re-safe") && c.querySelector('[data-sugg="accept"]'))?.dataset.suggestion`);
  if (safeId) {
    await b.click(`[data-suggestion="${safeId}"] [data-sugg="accept"]`);
    await b.waitFor(`document.querySelector('[data-suggestion="${safeId}"]')?.classList.contains("applied")`, 10000);
    log("safe suggestion applied");
  }
  const flaggedId = await b.eval(`[...document.querySelectorAll(".re-suggestion")].find(c => c.querySelector(".re-verify") && c.querySelector('[data-sugg="accept"]'))?.dataset.suggestion`);
  await b.click(`[data-suggestion="${flaggedId}"] [data-sugg="accept"]`);
  await b.waitFor(`document.querySelector('[data-suggestion="${flaggedId}"]')?.classList.contains("applied")`, 10000);
  log("flagged suggestion applied after confirmation");
  await b.click(`[data-suggestion="${flaggedId}"] [data-sugg="revert"]`);
  await b.waitFor(`!document.querySelector('[data-suggestion="${flaggedId}"]')?.classList.contains("applied")`, 10000);
  log("revert ok");
  await b.sleep(1500);
  await b.shot("06-after-accept");

  // 7. Compare with master
  await b.click('[data-side="compare"]');
  await b.waitFor(`document.querySelector('[data-re="compare-select"]')`);
  const masterOption = await b.eval(`[...document.querySelector('[data-re="compare-select"]').options].find(o => o.value.startsWith("p:"))?.value`);
  await b.eval(`(() => { const s = document.querySelector('[data-re="compare-select"]'); s.value = ${JSON.stringify(masterOption)}; s.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
  await b.waitFor(`document.querySelector(".re-diff, .re-check.ok")`, 10000);
  await b.shot("07-compare-master");
  log("diff rows:", await b.eval(`document.querySelectorAll(".re-diff-row").length`));

  // 8. Save & re-analyze, then use for application
  await b.click('[data-re="save-version"]');
  await b.waitFor(`document.getElementById("notice").textContent.includes("version")`, 15000);
  log("tailored save:", await b.eval(`document.getElementById("notice").textContent`));
  await b.click('[data-side="analysis"]');
  await b.waitFor(`document.querySelector('[data-re="use-for-application"]')`);
  await b.click('[data-re="use-for-application"]');
  await b.waitFor(`document.getElementById("notice").textContent.includes("exactly")`, 10000);
  log("pinned:", await b.eval(`document.getElementById("notice").textContent`));
  await b.click('[data-re="back"]');
  await b.waitFor(`!document.getElementById("queue-view").hidden`);
  await b.sleep(500);
  log("entry version line:", await b.eval(`document.getElementById("resume-version-line").textContent`));
  await b.shot("08-application-pinned");

  // 9. Mobile + dark
  await b.eval(`document.documentElement.dataset.theme = "dark"; true`);
  await b.size(390, 844, true);
  await b.click('[data-entry-resume="optimize"]');
  await b.waitFor(`!document.getElementById("resume-editor-view").hidden`, 10000);
  await b.sleep(800);
  await b.shot("09-mobile-dark-edit");
  await b.click('[data-re-tab="preview"]');
  await b.sleep(800);
  await b.shot("10-mobile-dark-preview");
  log("horizontal overflow:", await b.eval(`document.documentElement.scrollWidth > window.innerWidth`));
  log("console errors:", JSON.stringify(b.consoleErrors));
} catch (error) {
  console.error("FAILED:", error.message);
  await b.shot("failure");
  console.error("console errors:", JSON.stringify(b.consoleErrors));
  process.exitCode = 1;
} finally {
  b.close();
}
