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

  // 0. Layout: no sidebar, settings gear last in the top bar, the workspace spans the window
  const layout = await b.eval(`(() => { const actions = document.querySelector(".topbar-actions"); const w = document.querySelector(".workspace").getBoundingClientRect();
    return {sidebar: !!document.querySelector(".global-sidebar"), gearLast: actions.lastElementChild.id === "settings-button", left: Math.round(w.left), width: Math.round(w.width), viewport: document.documentElement.clientWidth}; })()`);
  log("layout:", JSON.stringify(layout));
  if (layout.sidebar || !layout.gearLast || layout.left !== 0 || layout.width < layout.viewport - 1) throw new Error("Layout is not the sidebar-free full-width workspace");

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
  // Skills are compact cells (several per row); the job-details form fills the middle pane (checked later)
  await b.click('[data-profile-tab="skills"]');
  await b.waitFor(`document.querySelectorAll(".pf-skill-grid .pf-card").length >= 2`);
  const skillRow = await b.eval(`(() => { const [a, c] = document.querySelectorAll(".pf-skill-grid .pf-card"); return Math.round(a.getBoundingClientRect().top) === Math.round(c.getBoundingClientRect().top); })()`);
  log("skills share a row:", skillRow);
  if (!skillRow) throw new Error("Skills are not laid out as cells");

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
  const projectWide = await b.eval(`(() => { const card = document.querySelector(".pf-list .pf-card"); return Math.round(card.getBoundingClientRect().width) >= Math.round(card.parentElement.getBoundingClientRect().width) - 1; })()`);
  if (!projectWide) throw new Error("Project cards are not full width");
  log("link checks:", await b.eval(`[...document.querySelectorAll("#pf-item-${projectId} .link-check")].map(el => el.textContent).join(" | ")`));
  await b.shot("p1-projects");

  // 3. Record a personal functional test
  await b.click('[data-profile-tab="verification"]');
  await setValue(`[data-functional="${projectId}"]`, "working");
  await noticeIncludes("test result was recorded");
  log("functional:", await b.eval(`document.querySelector('[data-functional="${projectId}"]').closest("label").querySelector(".field-help").textContent`));
  await b.shot("p2-verification");

  // Job details: the form uses the whole middle pane
  await b.click("#applications-button");
  await b.waitFor(`document.querySelector('[data-editor-tab="details"]')`);
  await b.click('[data-editor-tab="details"]');
  const detailsWidth = await b.eval(`(() => { const pane = document.querySelector('[data-pane="details"]').getBoundingClientRect(), box = document.querySelector('#editor-form [name="excerpt"]').getBoundingClientRect(), surface = document.querySelector(".editor-surface").getBoundingClientRect(); return {pane: Math.round(pane.width), textarea: Math.round(box.width), surface: Math.round(surface.width)}; })()`);
  log("job details width:", JSON.stringify(detailsWidth));
  if (detailsWidth.textarea < detailsWidth.surface - 80) throw new Error("Job details do not use the full width");
  await b.click('[data-editor-tab="overview"]');

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
  // Marking a recommendation "addressed" moves it out of the open list (and priority list); Reopen brings it back
  const openBefore = await b.eval(`document.querySelectorAll(".requirements-list .requirement-card").length`);
  await b.eval(`(() => { const s = document.querySelector('.requirement-card[data-requirement-coverage="unsupported"] [data-recommendation]'); s.value = "addressed"; s.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
  await b.waitFor(`document.querySelector(".addressed-requirements")`, 10000);
  const addressedState = await b.eval(`({open: document.querySelectorAll(".requirements-list .requirement-card").length, addressed: document.querySelectorAll(".addressed-row").length,
    inPriority: [...document.querySelectorAll(".priority-improvements article strong")].some(el => el.textContent.includes("Kubernetes"))})`);
  log("addressed:", openBefore, "->", JSON.stringify(addressedState));
  if (addressedState.open !== openBefore - 1 || addressedState.addressed !== 1 || addressedState.inPriority) throw new Error("Addressed requirement was not moved out of the open list");
  await b.eval(`document.querySelector(".addressed-requirements").open = true; true`);
  await b.click("[data-reopen]");
  await b.waitFor(`!document.querySelector(".addressed-requirements") && document.querySelectorAll(".requirements-list .requirement-card").length === ${openBefore}`, 10000);
  log("reopened");
  await b.eval(`document.querySelector('.requirement-card[data-requirement-coverage="profile_only"]').open = true; true`);
  await b.click('.requirement-card[data-requirement-coverage="profile_only"] [data-profile-item]');
  await b.waitFor(`document.querySelector(".pf-card.pf-highlight")`);
  log("view source ->", await b.eval(`document.querySelector(".pf-card.pf-highlight strong").textContent`));

  // 5. Tailor, get profile-based suggestions, add the project to the resume
  await b.click("#settings-button");
  await b.click("#settings-resume-library");
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
  // From profile tab: add a project straight from the profile (no AI), then undo it
  await b.click('[data-side="profile"]');
  await b.waitFor(`document.querySelector('.re-profile-entry [data-profile-add]')`, 10000);
  const authKey = await b.eval(`[...document.querySelectorAll(".re-profile-entry")].find(row => row.textContent.includes("Auth service")).querySelector("[data-profile-add]").dataset.profileAdd`);
  await b.click(`[data-profile-add="${authKey}"]`);
  await noticeIncludes("Added");
  log("from profile added:", await b.eval(`[...document.querySelectorAll('#re-form [data-field="name"]')].some(el => el.value === "Auth service")`),
    "marked in resume:", await b.eval(`[...document.querySelectorAll(".re-profile-entry")].find(row => row.textContent.includes("Auth service")).textContent.includes("In resume")`));
  await b.shot("p3b-from-profile");
  await b.click('[data-re="undo"]');
  await b.waitFor(`![...document.querySelectorAll('#re-form [data-field="name"]')].some(el => el.value === "Auth service")`, 5000);
  await b.waitFor(`document.getElementById("re-save-status").textContent === "All changes saved"`, 8000);
  log("undo removed it");
  // "Add a section": empty sections are offered as chips
  const chip = await b.eval(`document.querySelector("[data-reveal-section]")?.dataset.revealSection || ""`);
  if (chip) {
    await b.click(`[data-reveal-section="${chip}"]`);
    log("revealed section:", chip, await b.eval(`!!document.querySelector('#re-form details[data-section="${chip}"]')`));
  }
  await b.click("#applications-button");
  await b.waitFor(`document.querySelector('[data-entry-resume="optimize"]')`);
  await b.click('[data-entry-resume="optimize"]');
  await b.waitFor(`!document.getElementById("resume-editor-view").hidden && document.querySelector(".re-kind.tailored")`, 20000);
  await b.click('[data-side="profile"]');
  await b.waitFor(`document.querySelector('[data-re="recommend-profile"]')`, 10000);
  await b.click('[data-re="recommend-profile"]');
  await b.waitFor(`[...document.querySelectorAll(".re-suggestion")].some(card => card.querySelector(".re-suggestion-source"))`, 30000);
  log("recommend from profile produced", await b.eval(`document.querySelectorAll(".re-suggestion").length`), "suggestion cards");
  // The form and the side panel scroll independently (the page itself does not scroll)
  const scroll = await b.eval(`(() => { const f = document.querySelector(".re-form-panel"), p = document.querySelector(".re-side-panel"); p.scrollTop = 0; f.scrollTop = 400;
    return {form: f.scrollTop, side: p.scrollTop, page: Math.round(window.scrollY), formScrolls: f.scrollHeight > f.clientHeight}; })()`);
  log("independent scroll:", JSON.stringify(scroll));
  if (!scroll.formScrolls || scroll.form === 0 || scroll.side !== 0 || scroll.page !== 0) throw new Error("Editor panels do not scroll independently");
  await b.eval(`document.querySelector(".re-form-panel").scrollTop = 0; true`);
  await b.click('[data-side="analysis"]');
  const profileCard = await b.eval(`[...document.querySelectorAll(".re-suggestion")].find(card => card.querySelector(".re-suggestion-project")).dataset.suggestion`);
  log("profile suggestion:", await b.eval(`document.querySelector('[data-suggestion="${profileCard}"]').innerText.replace(/\\s+/g, " ").slice(0, 300)`));
  await b.eval(`document.querySelector('[data-suggestion="${profileCard}"]').scrollIntoView({block: "center"}); true`);
  await b.shot("p4-profile-suggestion");
  await b.click(`[data-suggestion="${profileCard}"] [data-sugg="accept"]`);
  await b.waitFor(`document.querySelector('[data-suggestion="${profileCard}"]')?.classList.contains("applied")`, 10000);
  log("project added to draft:", await b.eval(`[...document.querySelectorAll('[data-field="name"]')].some(el => el.value === "Auth service")`));
  // Check score: re-scores the edits against this analysis without adding to the analysis history
  const historyBefore = await b.eval(`(async () => { const e = window.ApplyDock.state().entries[0]; return (await window.ApplyDock.api("/api/entries/" + e.id + "/analyses")).analyses.length; })()`);
  await b.click('[data-side="analysis"]');
  await b.waitFor(`document.querySelector('[data-re="check-score"]')`, 10000);
  await b.click('[data-re="check-score"]');
  await b.waitFor(`document.querySelector(".re-score-check strong")`, 20000);
  const historyAfter = await b.eval(`(async () => { const e = window.ApplyDock.state().entries[0]; return (await window.ApplyDock.api("/api/entries/" + e.id + "/analyses")).analyses.length; })()`);
  log("score check:", await b.eval(`document.querySelector(".re-score-check").innerText.replace(/\s+/g, " ").slice(0, 160)`), "| history", historyBefore, "->", historyAfter);
  if (historyAfter !== historyBefore) throw new Error("Check score added an analysis to the history");
  const checked = await b.eval(`document.querySelector(".re-checked-what").textContent`);
  log("checked:", checked);
  if (!checked.includes("current draft (not saved as a version)") || !checked.includes("accepted suggestion")) throw new Error("Score check does not say it checked the draft");
  await b.click('[data-re="check-score-full"]');
  await b.waitFor(`document.querySelector(".re-score-check") && document.querySelector(".re-score-check").textContent.includes("Re-checked every requirement")`, 20000);
  const historyFull = await b.eval(`(async () => { const e = window.ApplyDock.state().entries[0]; return (await window.ApplyDock.api("/api/entries/" + e.id + "/analyses")).analyses.length; })()`);
  log("full re-check rows:", await b.eval(`document.querySelectorAll(".re-check-changes li").length`), "| history", historyFull);
  if (historyFull !== historyBefore) throw new Error("Full re-check added an analysis to the history");
  const toolbarCheck = await b.eval(`!!document.querySelector('.re-toolbar [data-re="check-score"]')`);
  if (!toolbarCheck) throw new Error("Check score is missing from the editor toolbar");
  await b.shot("p4c-score-check");
  // Full analysis from the editor opens as a dialog; closing it returns to the editor (not the home page)
  await b.click('[data-re="open-analysis"]');
  await b.waitFor(`document.getElementById("analysis-dialog").open && document.querySelector("#analysis-dialog .analysis-hero")`, 15000);
  const inDialog = await b.eval(`({view: window.ApplyDock.currentView(), inside: !!document.querySelector("#analysis-dialog #analysis-view"), editorVisible: !document.getElementById("resume-editor-view").hidden})`);
  log("analysis dialog:", JSON.stringify(inDialog));
  if (inDialog.view !== "resume-editor" || !inDialog.inside || !inDialog.editorVisible) throw new Error("Full analysis did not open as a dialog over the editor");
  await b.shot("p4d-analysis-dialog");
  await b.send("Input.dispatchKeyEvent", {type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27});
  await b.send("Input.dispatchKeyEvent", {type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27});
  await b.waitFor(`!document.getElementById("analysis-dialog").open`, 5000);
  const afterClose = await b.eval(`({view: window.ApplyDock.currentView(), editorVisible: !document.getElementById("resume-editor-view").hidden,
    restored: !!document.querySelector(".workspace-content > #analysis-view"), analysisHidden: document.getElementById("analysis-view").hidden})`);
  log("after Esc:", JSON.stringify(afterClose));
  if (afterClose.view !== "resume-editor" || !afterClose.editorVisible || !afterClose.restored || !afterClose.analysisHidden) throw new Error("Closing the analysis dialog did not return to the editor");
  await b.click('[data-re="open-analysis"]');
  await b.waitFor(`document.getElementById("analysis-dialog").open`, 10000);
  await b.click("#analysis-dialog-close");
  await b.waitFor(`!document.getElementById("analysis-dialog").open && !document.getElementById("resume-editor-view").hidden`, 5000);
  // Re-analyze the unsaved draft (no version is created)
  const versionsBefore = await b.eval(`document.querySelectorAll('[data-side="versions"]').length && window.ApplyDock.state().resumes.find(r => r.kind === "tailored").version_count`);
  await b.click('[data-re="analyze-draft"]');
  await b.waitFor(`document.querySelector(".re-score span")?.textContent.includes("Draft check") && !/Analyzing/.test(document.querySelector(".re-analysis").textContent)`, 20000);
  await b.eval(`window.ApplyDock.load(true).then(() => true)`);
  log("draft check:", await b.eval(`document.querySelector(".re-score").innerText.replace(/\\s+/g, " ").slice(0, 80)`),
    "versions unchanged:", (await b.eval(`window.ApplyDock.state().resumes.find(r => r.kind === "tailored").version_count`)) === versionsBefore);
  await b.shot("p4b-draft-check");
  await b.click('[data-re="save-version"]');
  await noticeIncludes("Saved version");
  await b.click('[data-re="use-for-application"]');
  await noticeIncludes("will attach version");

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

  // 6b. Rejected applications leave every list except the Rejected filter
  await b.eval(`(() => { const s = document.querySelector('#editor-form [name="application_stage"]'); s.value = "Rejected"; s.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
  await b.click("#save-button");
  await b.waitFor(`document.getElementById("active-count").textContent === "0"`, 10000);
  log("all list after rejecting:", await b.eval(`document.querySelectorAll("#entry-list .queue-item").length`), "rejected count:", await b.eval(`document.getElementById("rejected-count").textContent`));
  await b.click('[data-filter="rejected"]');
  await b.waitFor(`document.querySelectorAll("#entry-list .queue-item").length === 1`, 5000);
  await b.shot("p5b-rejected");
  await b.eval(`(() => { const s = document.querySelector('#editor-form [name="application_stage"]'); s.value = "Applied"; s.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
  await b.click("#save-button");
  await b.click('[data-filter="all"]');
  await b.waitFor(`document.querySelectorAll("#entry-list .queue-item").length === 1`, 10000);
  log("back in All after un-rejecting");
  // Home: with nothing left to do, no application is opened and the empty state says so
  await b.goto(BASE);
  await b.waitFor(`!document.getElementById("app-view").hidden`);
  const home = await b.eval(`document.querySelector("#empty-editor h2").textContent + " | editor hidden: " + document.getElementById("editor-view").hidden`);
  log("home:", home);
  if (!home.startsWith("No active applications | editor hidden: true")) throw new Error("Home did not show the empty state");
  await b.shot("p5c-home-empty");

  // 7. The library shows where the resume was used
  await b.click("#settings-button");
  await b.click("#settings-resume-library");
  const tailoredRow = await b.eval(`[...document.querySelectorAll("[data-resume-select]")].find(row => row.classList.contains("tailored-row"))?.dataset.resumeSelect`);
  await b.click(`[data-resume-select="${tailoredRow}"]`);
  await b.eval(`(() => { const d = document.querySelector("[data-resume-usage]"); d.open = true; d.dispatchEvent(new Event("toggle")); return true; })()`);
  await b.waitFor(`document.querySelector(".resume-usage-list li")`, 10000);
  log("usage:", await b.eval(`document.querySelector(".resume-usage-list").innerText.replace(/\\s+/g, " ").slice(0, 200)`));

  // 7b. Settings uses the full width on a large screen
  await b.size(1920, 1080);
  await b.click("#settings-button");
  await b.sleep(300);
  await b.click('[data-settings-tab="connections"]');
  const settingsWidth = await b.eval(`Math.round(document.querySelector(".settings-layout").getBoundingClientRect().width)`);
  log("settings width at 1920:", settingsWidth);
  if (settingsWidth <= 1200) throw new Error("Settings is still a narrow centered column");
  await b.shot("p6a-settings-1920");

  // 8. Mobile layout of the profile
  await b.size(375, 812, true);
  await b.click("#settings-button");
  await b.click('[data-settings-tab="profile"]');
  await b.waitFor(`document.querySelector('[data-profile-tab="projects"]')`, 10000);
  await b.click('[data-profile-tab="projects"]');
  await b.sleep(400);
  await b.shot("p6-mobile-projects");
  log("horizontal overflow:", await b.eval(`document.documentElement.scrollWidth > window.innerWidth`));
  log("console errors:", JSON.stringify(b.consoleErrors));
  if (b.consoleErrors.length) throw new Error("Console errors");
} catch (error) {
  console.error("FAILED:", error.message);
  console.error("last notice:", await b.eval(`document.getElementById("notice").textContent`).catch(() => ""));
  await b.shot("failure");
  console.error("console errors:", JSON.stringify(b.consoleErrors));
  process.exitCode = 1;
} finally {
  b.close();
}
