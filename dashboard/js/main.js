// View switching, loading /api/state, event wiring, and startup. Loaded last (after all feature scripts);
// exposes window.ApplyDock for resume-editor.js.

const $ = id => document.getElementById(id);

function showPair() {
  $("pair-screen").hidden = false;
  $("app-view").hidden = true;
  $("connection-state").classList.remove("connected");
  $("connection-label").textContent = "Pairing needed";
}

function showView(name, scrollToTop = true) {
  if (dirty && name !== currentView && !window.confirm("Discard unsaved changes in this application?")) return;
  if (name !== "analysis") clearTimeout(analysisPollTimer);
  dirty = false;
  currentView = name;
  $("queue-view").hidden = name !== "queue";
  $("create-view").hidden = name !== "create";
  $("resumes-view").hidden = name !== "resumes";
  $("analysis-view").hidden = name !== "analysis";
  $("settings-view").hidden = name !== "settings";
  $("resume-editor-view").hidden = name !== "resume-editor";
  if (name !== "resume-editor") window.ResumeEditor?.beforeLeave();
  const navView = name === "create" ? "queue" : name === "resume-editor" ? "resumes" : name;
  const labels = {queue: "Applications", create: "Applications", resumes: "Resume Library", analysis: "ATS Analysis", settings: "Settings", "resume-editor": "Resume Editor"};
  $("breadcrumb-current").textContent = labels[name] || "Applications";
  // No sidebar: the brand returns to Applications and the gear opens Settings.
  $("settings-button").classList.toggle("active", navView === "settings");
  if (navView === "settings") $("settings-button").setAttribute("aria-current", "page");
  else $("settings-button").removeAttribute("aria-current");
  if (scrollToTop) window.scrollTo(0, 0);
}

function render(preserveScroll = false) {
  $("pair-screen").hidden = true;
  $("app-view").hidden = false;
  $("connection-state").classList.add("connected");
  $("connection-label").textContent = "Local helper connected";
  // Keep an explicit choice; otherwise open the first application that still needs action, or none
  // (the "No active applications" screen) when everything is applied, sent, or rejected.
  if (!(state.entries || []).some(entry => entry.id === selectedId))
    selectedId = activeEntries().find(needsAction)?.id || "";
  renderList();
  renderEditor();
  renderInspector();
  renderSettings();
  renderResumeLibrary();
  if (analysisDetail) renderAnalysis();
  showView(currentView, !preserveScroll);
}

async function load(preserveScroll = false) {
  state = await api("/api/state");
  if (sessionStorage.getItem("pairingKey")) {
    localStorage.setItem("pairingKey", sessionStorage.getItem("pairingKey"));
    sessionStorage.removeItem("pairingKey");
  }
  render(preserveScroll);
}

$("pair-form").addEventListener("submit", async event => {
  event.preventDefault();
  sessionStorage.setItem("pairingKey", $("pair-key").value.trim());
  try { await load(); notify("Connected to your local workspace."); }
  catch (error) { sessionStorage.removeItem("pairingKey"); showPair(); notify(error.message, true); }
});

$("theme-button").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

$("appearance-select").addEventListener("change", event => setTheme(event.target.value));

$("notifications-toggle").addEventListener("change", event => localStorage.setItem("applydock-notifications", event.target.checked ? "on" : "off"));

$("default-resume-select").addEventListener("change", event => {
  if (event.target.value) manageResume(event.target.value, "default", event.target);
});

$("applications-button").addEventListener("click", () => showView("queue"));

$("settings-button").addEventListener("click", () => showView("settings"));

$("settings-resume-library").addEventListener("click", () => showView("resumes"));

$("resume-upload-toggle").addEventListener("click", () => {
  const form = $("resume-upload-form");
  form.hidden = !form.hidden;
  $("resume-upload-toggle").textContent = form.hidden ? "＋ Upload resume" : "Close upload";
});

for (const button of document.querySelectorAll("[data-editor-tab]")) button.addEventListener("click", async () => {
  const entry = selectedEntry();
  if (!entry) return;
  if (button.dataset.editorTab === "analysis") {
    if (entry.analysis?.id) await openAnalysis(entry.analysis.id);
    else await runAnalysis(entry);
    return;
  }
  setEditorTab(button.dataset.editorTab);
});

// A required field on a hidden tab would block saving silently; show its tab instead.

$("editor-form").addEventListener("invalid", event => {
  const pane = event.target.closest("[data-pane]");
  if (pane && pane.hidden) setEditorTab(pane.dataset.pane);
}, true);

$("manage-resumes-inline").addEventListener("click", () => showView("resumes"));

$("editor-form").addEventListener("click", async event => {
  const button = event.target.closest("[data-entry-resume]");
  const entry = selectedEntry();
  if (!button || !entry) return;
  event.preventDefault();
  if (button.dataset.entryResume === "unpin") {
    try { await api("/api/entries/" + entry.id, "PATCH", {resume_version_id: ""}); await load(true); notify("This application now follows the resume's current version."); }
    catch (error) { notify(error.message, true); }
    return;
  }
  await openResumeEditorForEntry(entry, button.dataset.entryResume);
});

$("email-section-toggle").addEventListener("click", () => {
  const form = $("editor-form");
  const opening = !emailPanelOpen;
  if (opening && form.elements.apply_method.value !== "email") {
    form.elements.apply_method.value = "email";
    dirty = true;
  }
  setEmailPanel(opening);
});

$("apply-link-open").addEventListener("click", event => {
  if (!usableLink($("editor-form").elements.apply_url.value)) event.preventDefault();
});

$("new-item-button").addEventListener("click", () => showView("create"));

$("create-email-toggle").addEventListener("click", () => {
  const opening = !createEmailOpen;
  if (opening && $("create-method").value !== "email") $("create-method").value = "email";
  setCreateEmail(opening);
});

$("create-method").addEventListener("change", event => setCreateEmail(event.target.value === "email"));

$("create-kind").addEventListener("change", updateCreateKind);

$("create-apply-link").addEventListener("input", updateCreateLink);

$("create-apply-open").addEventListener("click", event => { if (!usableLink($("create-apply-link").value)) event.preventDefault(); });

for (const button of document.querySelectorAll("[data-back]")) button.addEventListener("click", () => showView("queue"));

$("search-input").addEventListener("input", renderList);

document.addEventListener("keydown", event => {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    if (currentView !== "queue") showView("queue", false);
    document.body.classList.remove("detail-open");
    $("search-input").focus();
  }
});

// Arrow keys move between tabs in any tablist (WAI-ARIA tabs pattern); activation follows focus.
document.addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tab = event.target.closest?.('[role="tab"]');
  const list = tab?.closest('[role="tablist"]');
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')].filter(item => !item.hidden && !item.disabled);
  const index = tabs.indexOf(tab);
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
});

$("notice").addEventListener("click", () => { $("notice").hidden = true; });

// Small screens show the list or one application at a time.
for (const button of document.querySelectorAll("[data-mobile-back]")) button.addEventListener("click", () => {
  document.body.classList.remove("detail-open");
  window.scrollTo(0, 0);
});

for (const button of $("filters").querySelectorAll("[data-filter]")) button.addEventListener("click", () => { filter = button.dataset.filter; renderList(); });

$("analysis-filter").addEventListener("change", event => { analysisFilter = event.target.value; renderList(); });

$("score-filter").addEventListener("change", event => { scoreFilter = event.target.value; renderList(); });

$("analysis-sort").addEventListener("change", event => { analysisSort = event.target.value; renderList(); });

$("editor-form").addEventListener("input", event => { if (event.target.closest("#submission-card")) return; dirty = true; if (event.target.name === "apply_url") updateApplyLinkButton(); updatePreview(); });

$("editor-form").addEventListener("change", event => {
  if (event.target.closest("#submission-card")) return;  // the submission form saves on its own
  dirty = true;
  if (event.target.name === "apply_method") setEmailPanel(event.target.value === "email");
  if (event.target.name === "application_stage" && stageIsAfterApply(event.target.value))
    $("editor-form").elements.needs_review.checked = false;
  updatePreview();
});

$("editor-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("save-button");
  button.disabled = true;
  try { await saveForm(); await load(); notify("Changes saved."); }
  catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});

$("create-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const fields = Object.fromEntries(new FormData(form).entries());
    fields.needs_review = form.elements.needs_review.checked;
    const result = await api("/api/capture", "POST", fields);
    selectedId = result.entry.id;
    form.reset();
    setCreateEmail(false);
    updateCreateKind();
    updateCreateLink();
    await load();
    showView("queue");
    notify(result.duplicate ? "Already captured. Opened the existing item." : "Saved locally and synced to Notion when available.");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});

$("resume-upload-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const payload = await filePayload(form.elements.file.files[0]);
    payload.display_name = form.elements.display_name.value;
    payload.category = form.elements.category.value;
    payload.is_default = form.elements.is_default.checked;
    await api("/api/resumes", "POST", payload);
    form.reset();
    await load(true);
    notify("Resume saved to your private local library.");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});

$("notion-form").addEventListener("submit", event => saveSettings(event, "/api/settings/notion", "Notion connection saved and queue synced."));

$("smtp-form").addEventListener("submit", event => saveSettings(event, "/api/settings/smtp", "Email sign-in verified. No message was sent."));

$("profile-form").addEventListener("submit", event => saveSettings(event, "/api/settings/profile", "Your background was saved locally."));

$("gmail-client-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const file = form.elements.client.files[0];
    if (!file || file.size > 50_000) throw new Error("Choose a Google OAuth Desktop app client JSON file.");
    await api("/api/settings/gmail/client", "POST", JSON.parse(await file.text()));
    form.reset();
    await load();
    notify("OAuth client saved locally. Connect Gmail next.");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});

$("gmail-connect-button").addEventListener("click", async () => {
  try { const result = await api("/api/settings/gmail/connect", "POST", {}); window.location.assign(result.authorization_url); }
  catch (error) { notify(error.message, true); }
});

$("gmail-refresh-button").addEventListener("click", () => load().then(() => notify("Gmail status refreshed.")).catch(error => notify(error.message, true)));

$("codex-check-button").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api("/api/settings/codex/check", "POST", {});
    state.codex = result.codex; state.ats_usage = result.usage;
    renderSettings();
    notify(result.codex.connected ? "Connected to ChatGPT Plus through Codex." : result.codex.message, !result.codex.connected);
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});

$("connection-checks-button").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const [codexResult] = await Promise.all([api("/api/settings/codex/check", "POST", {}), api("/api/sync", "POST", {})]);
    state.codex = codexResult.codex;
    state.ats_usage = codexResult.usage;
    await load(true);
    notify("Connection checks completed.");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});

$("editor-delete").addEventListener("click", event => performAction("local-delete", event.currentTarget));

$("refresh-button").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await api("/api/sync", "POST", {});
    await load();
    notify(result.reconciliation?.error ? "Notion check needs attention: " + result.reconciliation.error : "Notion changes refreshed. Imported " + (result.reconciliation?.updated || 0) + " update(s) and removed " + (result.reconciliation?.removed || 0) + " trashed item(s) locally.");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});

$("sync-button").addEventListener("click", async () => {
  try { const result = await api("/api/sync", "POST", {}); await load(); notify(result.reconciliation?.error ? "Notion check needs attention: " + result.reconciliation.error : "Notion sync complete. Imported " + (result.reconciliation?.updated || 0) + " update(s) and removed " + (result.reconciliation?.removed || 0) + " trashed item(s) locally."); }
  catch (error) { notify(error.message, true); }
});

document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && currentView === "queue" && selectedEntry()) {
    event.preventDefault();
    $("editor-form").requestSubmit();
  }
});

window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });

window.addEventListener("applydock-paired", () => load().catch(error => { showPair(); notify(error.message, true); }));

window.ApplyDock = {
  api, notify, load, esc, showView, dateLabel, openAnalysis, openProfileItem, coverageLabel, profileChangedSince,
  state: () => state,
  currentView: () => currentView,
  selectEntry: id => { selectedId = id; render(true); },
};

initializeSettingsDisclosures();
initializeProfile();
initializeSubmissionCard();

// Follow the operating system until the user picks a theme explicitly.
setTheme(localStorage.getItem("applydock-theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"), Boolean(localStorage.getItem("applydock-theme")));

if (key()) load().catch(error => { showPair(); notify(error.message, true); });

else showPair();

setInterval(() => {
  if (key() && currentView === "queue" && !dirty && !document.activeElement?.matches("input, textarea, select"))
    load(true).catch(error => notify(error.message, true));
}, 60_000);
