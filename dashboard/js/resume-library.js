// Resume Library view: table, preview, rename/replace/default/delete. Uses core.js.

function renderResumeLibrary() {
  const library = state.resumes || [];
  $("resume-library-count").textContent = library.length + " saved";
  const createSelect = $("create-form").elements.resume_id;
  const currentCreateResume = createSelect.value;
  createSelect.innerHTML = resumeOptions(currentCreateResume);
  if (!currentCreateResume) createSelect.value = library.find(resume => resume.is_default && resume.available)?.id || "";
  if (!library.some(resume => resume.id === selectedResumeId)) selectedResumeId = library[0]?.id || "";
  const selected = library.find(resume => resume.id === selectedResumeId);
  const totals = '<div class="resume-stats"><span><strong>' + library.length + '</strong> ' + plural(library.length, "resume") + '</span><span><strong>' + (state.entries || []).filter(entry => entry.resume_id).length + '</strong> linked ' + plural((state.entries || []).filter(entry => entry.resume_id).length, "application") + '</span></div>';
  const ordered = library.filter(resume => resume.kind !== "tailored").flatMap(master => [master, ...library.filter(resume => resume.kind === "tailored" && resume.parent_resume_id === master.id)])
    .concat(library.filter(resume => resume.kind === "tailored" && !library.some(master => master.id === resume.parent_resume_id)));
  const rows = ordered.map(resume => {
    const assigned = (state.entries || []).filter(entry => entry.resume_id === resume.id).length;
    const extension = String(resume.original_filename || "").split(".").pop().toUpperCase() || "FILE";
    const updated = resume.updated_at || resume.created_at;
    const date = updated ? new Date(updated).toLocaleDateString([], {year: "numeric", month: "short", day: "numeric"}) : "—";
    const tailoredEntry = resume.kind === "tailored" ? (state.entries || []).find(entry => entry.id === resume.entry_id) : null;
    const subtitle = resume.kind === "tailored" ? "Tailored · " + (tailoredEntry ? (tailoredEntry.company || tailoredEntry.title) : "application removed") : resume.original_filename;
    return '<button class="resume-table-row' + (resume.id === selectedResumeId ? ' selected' : '') + (resume.kind === "tailored" ? ' tailored-row' : '') + '" type="button" data-resume-select="' + esc(resume.id) + '">' +
      '<span class="resume-name-cell"><b class="file-type ' + esc(extension.toLowerCase()) + '">' + esc(extension === "DOCX" ? "DOC" : extension) + '</b><span><strong>' + esc(resume.name) + '</strong><small>' + esc(subtitle) + '</small></span></span>' +
      '<span>' + esc(resume.category) + '</span><span>v' + esc(resume.current_version_number || 1) + '</span><span>' + esc(date) + '</span><span>' + assigned + ' application' + (assigned === 1 ? '' : 's') + (resume.submission_count ? ' · ' + resume.submission_count + ' sent' : '') + '</span><span>' + (resume.is_default ? '<i class="default-pill">Default</i>' : '—') + '</span><span aria-hidden="true">•••</span></button>';
  }).join("");
  let details = "";
  if (selected) {
    const assigned = (state.entries || []).filter(entry => entry.resume_id === selected.id).length;
    const fileUrl = esc(selected.file_url);
    const previewUrl = esc(selected.preview_url || selected.file_url);
    const isPdf = String(selected.original_filename || "").toLowerCase().endsWith(".pdf");
    details = '<div class="resume-detail-grid"><article class="resume-preview-card"><div class="resume-preview-heading"><div><h2>' + esc(selected.name) + ' ' + (selected.is_default ? '<i class="default-pill">Default</i>' : '') + '</h2><small>Document preview · ' + esc(bytesLabel(selected.size_bytes)) + ' · ' + esc(isPdf ? "PDF" : "DOCX") + '</small></div><div><button class="button primary" type="button" data-open-resume-editor="' + esc(selected.id) + '">' + (selected.has_draft ? "Edit in ApplyDock" : "Import &amp; edit") + '</button><a class="button secondary" href="' + previewUrl + '" target="_blank" rel="noreferrer">Preview</a><a class="button secondary" href="' + fileUrl + '&download=1" download>Download</a></div></div>' +
      (isPdf ? '<iframe class="resume-preview-frame" src="' + previewUrl + '#toolbar=0&navpanes=0" title="Preview of ' + esc(selected.name) + '"></iframe>' : '<div class="resume-docx-preview"><b>DOC</b><strong>' + esc(selected.original_filename) + '</strong><span>Open Preview to inspect this DOCX file.</span></div>') + '</article>' +
      '<aside class="resume-detail-card"><form class="resume-edit-form" data-resume-id="' + esc(selected.id) + '"><h2>Document details</h2>' +
      '<p class="subtle">Version ' + esc(selected.current_version_number || 1) + ' · ' + esc(isPdf ? "PDF" : "DOCX") + ' · used by ' + assigned + ' ' + plural(assigned, "application") + '</p>' +
      '<details class="resume-usage" data-resume-usage="' + esc(selected.id) + '"><summary>Submitted to ' + (selected.submission_count || 0) + ' ' + plural(selected.submission_count || 0, "application") + ' — show where</summary><div class="resume-usage-list"><p class="subtle">Loading…</p></div></details>' +
      (selected.extraction_status !== "ready" ? '<p class="inline-alert resume-extraction">' + esc(selected.extraction_error || "Resume text extraction needs attention.") + '</p>' : '') +
      '<label>Name<input name="name" value="' + esc(selected.name) + '" maxlength="120" required></label><label>Category<input name="category" list="resume-categories" value="' + esc(selected.category) + '" maxlength="80" required></label>' +
      '<label>Replace file <span class="field-help">Optional PDF or DOCX, up to 8 MB</span><input name="file" type="file" accept=".pdf,.docx"></label>' +
      '<div class="resume-card-actions"><button class="button secondary" type="submit">Save details</button>' + (selected.is_default ? '' : '<button class="button quiet-button" type="button" data-resume-action="default">Make default</button>') + '<button class="button danger-button" type="button" data-resume-action="delete">Delete</button></div></form></aside></div>';
  }
  $("resume-library").innerHTML = library.length ? totals + '<div class="resume-table"><div class="resume-table-head"><span>Resume</span><span>Category</span><span>Version</span><span>Last updated</span><span>Usage</span><span>Default</span><span></span></div>' + rows + '</div>' + details : '<div class="queue-empty resume-empty"><strong>No resumes saved yet.</strong><p>Use Upload resume to add a reusable PDF or DOCX.</p></div>';
  for (const button of $("resume-library").querySelectorAll("[data-resume-select]")) button.addEventListener("click", () => { selectedResumeId = button.dataset.resumeSelect; renderResumeLibrary(); });
  for (const button of $("resume-library").querySelectorAll("[data-open-resume-editor]")) button.addEventListener("click", () => {
    const resume = (state.resumes || []).find(item => item.id === button.dataset.openResumeEditor);
    window.ResumeEditor.open(button.dataset.openResumeEditor, {entryId: resume?.entry_id || ""}).catch(error => notify(error.message, true));
  });
  for (const details of $("resume-library").querySelectorAll("[data-resume-usage]"))
    details.addEventListener("toggle", () => { if (details.open) loadResumeUsage(details); });
  for (const form of $("resume-library").querySelectorAll(".resume-edit-form")) {
    form.addEventListener("submit", saveResumeChanges);
    for (const button of form.querySelectorAll("[data-resume-action]"))
      button.addEventListener("click", () => manageResume(form.dataset.resumeId, button.dataset.resumeAction, button));
  }
}

async function saveResumeChanges(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const data = {name: form.elements.name.value, category: form.elements.category.value};
    if (form.elements.file.files[0]) Object.assign(data, await filePayload(form.elements.file.files[0]));
    await api("/api/resumes/" + form.dataset.resumeId, "PATCH", data);
    await load(true);
    notify("Resume details saved. Assigned applications and Notion were updated.");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

async function manageResume(id, action, button) {
  const resume = (state.resumes || []).find(item => item.id === id);
  if (!resume) return;
  if (action === "delete") {
    const assigned = (state.entries || []).filter(entry => entry.resume_id === id).length;
    const warning = (assigned ? " " + assigned + " application(s) will show Resume Missing and must be reassigned." : "") +
      (resume.analysis_count ? " " + resume.analysis_count + " dependent analysis run(s) and all private resume versions will also be deleted." : " All private resume versions will also be deleted.");
    if (!window.confirm("Delete ‘" + resume.name + "’ from the local resume library?" + warning)) return;
  }
  button.disabled = true;
  try {
    const result = action === "default" ? await api("/api/resumes/" + id, "PATCH", {is_default: true}) : await api("/api/resumes/" + id, "DELETE");
    await load(true);
    notify(action === "default" ? "Default resume updated." : "Resume deleted locally. " + (result.applications_needing_resume || 0) + " application(s) need reassignment.");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

// Where a resume was actually sent (exact version per company), plus applications that currently attach it.
async function loadResumeUsage(details) {
  const list = details.querySelector(".resume-usage-list");
  try {
    const usage = await api("/api/resumes/" + details.dataset.resumeUsage + "/usage");
    const sent = usage.submissions.map(item => '<li><a href="' + esc(item.file_url) + '" target="_blank" rel="noopener noreferrer">' + esc(item.company || "Company not set") + ' — ' + esc(item.title) + '</a>' +
      '<small>v' + esc(item.version_number) + (item.resume_id !== details.dataset.resumeUsage ? " of the tailored copy" : "") + ' · ' + esc(dateLabel(item.submitted_at)) + ' · ' + esc(item.channel_label) + '</small></li>').join("");
    const linked = usage.applications.filter(item => !usage.submissions.some(sentItem => sentItem.entry_id === item.id))
      .map(item => '<li><button class="text-button" type="button" data-usage-entry="' + esc(item.id) + '">' + esc(item.company || "Company not set") + ' — ' + esc(item.title) + '</button><small>' +
        (item.version_number ? "pinned to v" + esc(item.version_number) : "follows the current version") + ' · not submitted yet</small></li>').join("");
    list.innerHTML = (sent ? '<strong>Submitted</strong><ul>' + sent + '</ul>' : '<p class="subtle">No recorded submissions yet.</p>') + (linked ? '<strong>Attached, not submitted</strong><ul>' + linked + '</ul>' : '');
    for (const button of list.querySelectorAll("[data-usage-entry]")) button.addEventListener("click", () => {
      selectedId = button.dataset.usageEntry;
      showView("queue");
      render(true);
      document.body.classList.add("detail-open");
    });
  } catch (error) { list.innerHTML = '<p class="subtle">' + esc(error.message) + '</p>'; }
}
