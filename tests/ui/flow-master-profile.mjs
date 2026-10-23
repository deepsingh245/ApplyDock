// Master Profile end to end: build the profile, verify links, analyze a job against resume + profile,
// add a profile project to a tailored resume, record the submission, and find the exact file again.
import { launch } from "./cdp.mjs";

const BASE = process.env.UI_BASE || "http://127.0.0.1:8799/";
const b = await launch();
const log = (...args) => console.log(...args);
const setValue = (selector, value) => b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event("input", {bubbles: true})); el.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
const noticeIncludes = text => b.waitFor(`document.getElementById("notice").textContent.includes(${JSON.stringify(text)})`, 15000);
try {
  await b.size(1440, 1000);
  await b.goto(BASE);
  await b.eval(`localStorage.setItem("pairingKey", "sandbox-key"); true`);
  await b.goto(BASE);
  await b.waitFor(`!document.getElementById("app-view").hidden`);
  await b.eval(`window.confirm = () => true; window.prompt = (m, v) => v; true`);

  // 1. Settings → Master Profile, import from the existing resume
  await b.click("#settings-button");
  await b.click('[data-settings-tab="profile"]');
  await b.waitFor(`document.querySelector('[data-profile-form="personal"]')`);
  await b.click('[data-profile-action="import"]');
  await noticeIncludes("Imported");
  log("import:", await b.eval(`document.getElementById("notice").textContent`));
  log("personal name:", await b.eval(`document.querySelector('[data-profile-form="personal"] [name="name"]').value`));
  await b.click('[data-profile-action="import"]');
  await noticeIncludes("Nothing new");
  log("second import is a no-op");

  // 2. Register a project with links, then verify them
  await b.click('[data-profile-tab="projects"]');
  await b.click('[data-profile-action="new"][data-kind="project"]');
  await setValue('[data-profile-form="project"] [name="name"]', "Auth service");
  await setValue('[data-profile-form="project"] [name="summary"]', "OAuth sign-in service for my Node.js apps.");
  await setValue('[data-profile-form="project"] [name="technologies"]', "Node.js, OAuth, Firebase");
  await setValue('[data-profile-form="project"] [name="live_url"]', "https://auth.example.com");
  await setValue('[data-profile-form="project"] [name="repo_url"]', "https://github.com/me/broken-repo");
  await setValue('[data-profile-form="project"] [name="__verification"]', "verified");
  await b.click('[data-profile-form="project"] [data-profile-action="add-claim"]');
  await setValue('[data-profile-form="project"] .pf-claim input:not([type=checkbox])', "Shipped OAuth login with refresh tokens.");
  await b.click('[data-profile-form="project"] [data-claim-verified]');
  await b.click('[data-profile-form="project"] [type="submit"]');
  await noticeIncludes("Saved to your Master Profile");
  const projectId = await b.eval(`[...document.querySelectorAll(".pf-card")].find(card => card.textContent.includes("Auth service")).id.replace("pf-item-", "")`);
  await b.click(`#pf-item-${projectId} [data-profile-action="verify-links"]`);
  await noticeIncludes("links checked");
  log("link checks:", await b.eval(`[...document.querySelectorAll("#pf-item-${projectId} .link-check")].map(el => el.textContent).join(" | ")`));
  await b.shot("p1-projects");

  // 3. Record a personal functional test
  await b.click('[data-profile-tab="verification"]');
  await setValue(`[data-functional="${projectId}"]`, "working");
  await noticeIncludes("test result was recorded");
  log("functional:", await b.eval(`document.querySelector('[data-functional="${projectId}"]').closest("label").querySelector(".field-help").textContent`));
  await b.shot("p2-verification");

  // 4. Analyze the job against resume + profile
  await b.click("#applications-button");
  await b.waitFor(`document.querySelector('[data-action="ats-run"], [data-action="ats-view"]')`);
  await b.eval(`(async () => { const entry = window.ApplyDock.state().entries[0]; await window.ApplyDock.api("/api/entries/" + entry.id + "/analyses", "POST", {}); await window.ApplyDock.load(true); return true; })()`);
  await b.waitFor(`(() => { const a = window.ApplyDock.state().entries[0].analysis; return a.status === "complete" && !a.stale && a.overall_score != null; })()`, 20000).catch(async () => {
    await b.eval(`window.ApplyDock.load(true).then(() => true)`); await b.sleep(3000);
  });
  await b.eval(`window.ApplyDock.load(true).then(() => true)`);
  await b.sleep(500);
  const analysisId = await b.eval(`window.ApplyDock.state().entries[0].analysis.id`);
  await b.eval(`window.ApplyDock.openAnalysis(${JSON.stringify(analysisId)}).then(() => true)`);
  await b.waitFor(`document.querySelector(".coverage-chip.profile_only")`, 15000);
  log("coverage:", await b.eval(`[...document.querySelectorAll(".requirement-card .coverage-chip")].map(el => el.textContent).join(" | ")`));
  log("potential:", await b.eval(`document.querySelector(".score-potential")?.textContent || "none"`));
  await b.shot("p3-analysis");
  await b.eval(`document.querySelector('.requirement-card[data-requirement-coverage="profile_only"]').open = true; true`);
  await b.click('.requirement-card[data-requirement-coverage="profile_only"] [data-profile-item]');
  await b.waitFor(`document.querySelector(".pf-card.pf-highlight")`);
  log("view source ->", await b.eval(`document.querySelector(".pf-card.pf-highlight strong").textContent`));

  // 5. Tailor, get profile-based suggestions, add the project to the resume
  await b.click("#resumes-button");
  await b.click("[data-open-resume-editor]");
  await b.waitFor(`!document.getElementById("resume-editor-view").hidden && document.querySelector("#re-form .re-section")`, 20000);
  await b.sleep(500);
  if (await b.eval(`!!document.querySelector('[data-re="mark-reviewed"]')`)) {
    await b.click('[data-re="mark-reviewed"]');
    await b.waitFor(`!document.querySelector(".re-banner.review")`);
    await b.waitFor(`document.getElementById("re-save-status").textContent === "All changes saved"`, 8000);
    await b.click('[data-re="save-version"]');
    await noticeIncludes("Saved version");
  }
  await b.click("#applications-button");
  await b.waitFor(`document.querySelector('[data-entry-resume="optimize"]')`);
  await b.click('[data-entry-resume="optimize"]');
  await b.waitFor(`!document.getElementById("resume-editor-view").hidden && document.querySelector(".re-kind.tailored")`, 20000);
  await b.click('[data-side="analysis"]');
  await b.waitFor(`document.querySelector('[data-re="suggest"]')`);
  await b.click('[data-re="suggest"]');
  await b.waitFor(`[...document.querySelectorAll(".re-suggestion")].some(card => card.querySelector(".re-suggestion-source"))`, 20000);
  const profileCard = await b.eval(`[...document.querySelectorAll(".re-suggestion")].find(card => card.querySelector(".re-suggestion-project")).dataset.suggestion`);
  log("profile suggestion:", await b.eval(`document.querySelector('[data-suggestion="${profileCard}"]').innerText.replace(/\\s+/g, " ").slice(0, 300)`));
  await b.eval(`document.querySelector('[data-suggestion="${profileCard}"]').scrollIntoView({block: "center"}); true`);
  await b.shot("p4-profile-suggestion");
  await b.click(`[data-suggestion="${profileCard}"] [data-sugg="accept"]`);
  await b.waitFor(`document.querySelector('[data-suggestion="${profileCard}"]')?.classList.contains("applied")`, 10000);
  log("project added to draft:", await b.eval(`[...document.querySelectorAll('[data-field="name"]')].some(el => el.value === "Auth service")`));
  await b.click('[data-re="save-version"]');
  await noticeIncludes("Saved version");
  await b.click('[data-re="use-for-application"]');
  await b.sleep(800);

  // 6. Record the submission and open the exact file
  await b.click("#applications-button");
  await b.click('[data-editor-tab="resume"]');
  await b.waitFor(`document.querySelector('[data-submission="change"]')`);
  await b.click('[data-submission="change"]');
  await b.waitFor(`document.getElementById("submission-version")`);
  log("version choices:", await b.eval(`[...document.getElementById("submission-version").options].map(o => o.textContent).join(" | ")`));
  await b.click('[data-submission="save"]');
  await noticeIncludes("Submission recorded");
  await b.waitFor(`document.querySelector("#submission-card .submission-kv")`);
  log("submitted card:", await b.eval(`document.querySelector("#submission-card").innerText.replace(/\\s+/g, " ").slice(0, 260)`));
  const fileStatus = await b.eval(`fetch(document.querySelector('#submission-card a[target="_blank"]').href).then(r => r.status + " " + r.headers.get("content-type"))`);
  log("submitted file:", fileStatus);
  if (!fileStatus.startsWith("200 application/pdf")) throw new Error("Submitted PDF not served");
  await b.shot("p5-submission");
  log("progress applied:", await b.eval(`[...document.querySelectorAll("#editor-progress .step")].pop().className`));

  // 7. The library shows where the resume was used
  await b.click("#resumes-button");
  const tailoredRow = await b.eval(`[...document.querySelectorAll("[data-resume-select]")].find(row => row.classList.contains("tailored-row"))?.dataset.resumeSelect`);
  await b.click(`[data-resume-select="${tailoredRow}"]`);
  await b.eval(`(() => { const d = document.querySelector("[data-resume-usage]"); d.open = true; d.dispatchEvent(new Event("toggle")); return true; })()`);
  await b.waitFor(`document.querySelector(".resume-usage-list li")`, 10000);
  log("usage:", await b.eval(`document.querySelector(".resume-usage-list").innerText.replace(/\\s+/g, " ").slice(0, 200)`));

  // 8. Mobile layout of the profile
  await b.size(375, 812, true);
  await b.click("#settings-button");
  await b.click('[data-settings-tab="profile"]');
  await b.click('[data-profile-tab="projects"]');
  await b.sleep(400);
  await b.shot("p6-mobile-projects");
  log("horizontal overflow:", await b.eval(`document.documentElement.scrollWidth > window.innerWidth`));
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
