// Settings → Master Profile: the user's career records, project link checks, and verification. Uses core.js.

let profileData = null;
let profileTab = "personal";
let profileEditing = "";        // an item id, or "new:<kind>"
let profileShowArchived = false;
let settingsTab = "connections";

const PROFILE_TABS = [["personal", "Personal details"], ["experience", "Experience"], ["projects", "Projects"], ["skills", "Skills & achievements"], ["verification", "Verification"]];
const VERIFICATION_LABELS = {verified: "Verified", unverified: "Unverified", needs_review: "Needs review"};
const LINK_LABELS = {reachable: "Reachable", redirected: "Redirected", auth_required: "Sign-in required", unreachable: "Unreachable", could_not_verify: "Could not verify", not_checked: "Not checked"};
const LINK_TONES = {reachable: "success", redirected: "success", auth_required: "warn", unreachable: "danger", could_not_verify: "warn", not_checked: ""};
const LINK_FIELD_LABELS = {live_url: "Live app", repo_url: "Source", docs_url: "Docs"};
const FUNCTIONAL_LABELS = {not_verified: "Not tested", working: "Tested and working", partial: "Partially working", not_working: "Not working"};
const PROJECT_STATUS_LABELS = {planning: "Planning", in_development: "In development", completed: "Completed", maintained: "Maintained", archived: "Archived"};
const SKILL_CATEGORY_LABELS = {languages: "Languages", frameworks: "Frameworks & libraries", backend: "Backend", databases: "Databases", cloud: "Cloud", devops: "DevOps & tools",
  testing: "Testing", architecture_security: "Architecture & security", domain: "Domain", other: "Other"};
const EMPLOYMENT_LABELS = {"": "Not set", full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship", freelance: "Freelance", other: "Other"};
const KIND_LABELS = {experience: "experience", project: "project", skill: "skill", achievement: "achievement", education: "education", certification: "certification"};

// [name, label, type, extra]: type is text (default), url, long, lines, list, choice (extra = labels), bool, claims, or ids (extra = kinds).
const PROFILE_FIELDS = {
  personal: [["name", "Full name"], ["headline", "Professional headline"], ["email", "Email"], ["phone", "Phone"], ["location", "Location"],
    ["website", "Portfolio website", "url"], ["github", "GitHub profile", "url"], ["linkedin", "LinkedIn profile", "url"],
    ["preferred_roles", "Preferred roles", "list", "Comma-separated, for example Backend Engineer, Full-stack Engineer"], ["summary", "Professional summary", "long"]],
  experience: [["company", "Company"], ["title", "Job title"], ["start", "Start", "text", "For example 2022-03"], ["end", "End", "text", "Leave empty if current"],
    ["employment_type", "Employment type", "choice", EMPLOYMENT_LABELS], ["location", "Location"], ["summary", "Summary", "long"],
    ["responsibilities", "Responsibilities", "lines", "One per line"], ["technologies", "Technologies used", "list", "Comma-separated"],
    ["achievements", "Achievements and results", "claims"], ["project_ids", "Projects from this role", "ids", "project"]],
  project: [["name", "Project name"], ["category", "Category", "text", "For example web app, CLI, library"], ["summary", "Short description"],
    ["status", "Status", "choice", PROJECT_STATUS_LABELS], ["description", "Detailed description", "long"], ["role", "Your role and contributions", "long"],
    ["technologies", "Technology stack", "list", "Comma-separated"], ["architecture", "Architecture and engineering highlights", "long"],
    ["features", "Features implemented", "lines", "One per line"], ["challenges", "Technical challenges solved", "long"],
    ["deployment", "Deployment", "text", "For example Vercel, Firebase Hosting, AWS ECS"], ["live_url", "Live application URL", "url"],
    ["repo_url", "Source code URL", "url"], ["docs_url", "Documentation URL", "url"], ["start", "Started", "text", "For example 2023-01"], ["end", "Completed"],
    ["experience_id", "Built during", "ids", "experience"], ["resume_ready", "Can be used in a resume", "bool"],
    ["achievements", "Achievement bullets", "claims"], ["evidence", "Evidence for technical claims", "long", "Links, metric sources, or notes that back up the claims"]],
  skill: [["name", "Skill"], ["category", "Category", "choice", SKILL_CATEGORY_LABELS], ["evidence_ids", "Demonstrated in", "ids", "project,experience"], ["notes", "Notes"]],
  achievement: [["text", "Achievement", "long"], ["date", "Date"], ["evidence", "Evidence", "long"], ["related_ids", "Related to", "ids", "project,experience"]],
  education: [["institution", "Institution"], ["degree", "Degree"], ["field", "Field of study"], ["start", "Start"], ["end", "End"], ["details", "Details", "long"]],
  certification: [["name", "Certification"], ["issuer", "Issuer"], ["date", "Date"], ["url", "Credential URL", "url"], ["credential_id", "Credential ID"]],
};

function setSettingsTab(tab) {
  settingsTab = tab;
  for (const button of document.querySelectorAll("[data-settings-tab]")) {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const pane of document.querySelectorAll("[data-settings-pane]")) pane.hidden = pane.dataset.settingsPane !== tab;
  if (tab === "profile") loadProfile();
}

async function loadProfile(force = false) {
  if (profileData && !force) return renderProfile();
  try {
    profileData = (await api("/api/profile")).profile;
    renderProfile();
  } catch (error) { notify(error.message, true); }
}

function profileItems(kind) {
  return (profileData?.items || []).filter(item => item.kind === kind && (profileShowArchived || !item.archived));
}

function verificationChip(value) {
  return '<span class="sub-status ' + (value === "verified" ? "success" : value === "needs_review" ? "warn" : "") + '">' + esc(VERIFICATION_LABELS[value] || value) + '</span>';
}

// ------------------------------------------------------------------ forms

function profileControl(kind, [name, label, type = "text", extra], data) {
  const value = data[name];
  const id = "pf-" + kind + "-" + name;
  if (type === "bool") return '<label class="check-line pf-wide"><input type="checkbox" name="' + name + '"' + ((value ?? name === "resume_ready") ? " checked" : "") + '> ' + esc(label) + '</label>';
  if (type === "claims") {
    const rows = (value || []).map(claim => claimRow(claim)).join("");
    return '<fieldset class="pf-claims pf-wide" data-claims="' + name + '"><legend>' + esc(label) + '</legend><p class="field-help">Tick “Verified” only for results you can stand behind (and back up if asked).</p>' +
      '<div data-claim-rows>' + rows + '</div><button class="button quiet-button" type="button" data-profile-action="add-claim">+ Add bullet</button></fieldset>';
  }
  if (type === "ids") {
    const kinds = String(extra).split(",");
    const options = (profileData?.items || []).filter(item => kinds.includes(item.kind) && !item.archived && item.id !== profileEditing);
    const selected = new Set(value || []);
    return '<fieldset class="pf-ids pf-wide" data-ids="' + name + '"><legend>' + esc(label) + '</legend>' + (options.length
      ? options.map(item => '<label class="check-line"><input type="checkbox" value="' + esc(item.id) + '"' + (selected.has(item.id) ? " checked" : "") + '> ' + esc(item.label) + ' <small>' + esc(KIND_LABELS[item.kind]) + '</small></label>').join("")
      : '<p class="field-help">Add ' + esc(kinds.map(value => KIND_LABELS[value]).join(" or ")) + ' entries first to link them here.</p>') + '</fieldset>';
  }
  const help = type !== "choice" && extra ? '<span class="field-help">' + esc(extra) + '</span>' : "";
  let control;
  if (type === "choice") control = '<select id="' + id + '" name="' + name + '">' + Object.entries(extra).map(([key, text]) => '<option value="' + esc(key) + '"' + (key === (value || "") ? " selected" : "") + '>' + esc(text) + '</option>').join("") + '</select>';
  else if (type === "long" || type === "lines") control = '<textarea id="' + id + '" name="' + name + '" rows="' + (type === "lines" ? 4 : 3) + '">' + esc(type === "lines" ? (value || []).join("\n") : value || "") + '</textarea>';
  else control = '<input id="' + id + '" name="' + name + '" type="' + (type === "url" ? "url" : "text") + '" value="' + esc(type === "list" ? (value || []).join(", ") : value || "") + '"' + (type === "url" ? ' placeholder="https://"' : "") + '>';
  return '<label class="' + (["long", "lines", "list"].includes(type) ? "pf-wide" : "") + '" for="' + id + '">' + esc(label) + help + control + '</label>';
}

function claimRow(claim = {}) {
  return '<div class="pf-claim" data-claim-id="' + esc(claim.id || "") + '"><input aria-label="Achievement bullet" value="' + esc(claim.text || "") + '" placeholder="What you did and the result">' +
    '<label class="check-line"><input type="checkbox" data-claim-verified' + (claim.verified ? " checked" : "") + '> Verified</label>' +
    '<button class="icon-action" type="button" data-profile-action="remove-claim" aria-label="Remove bullet" title="Remove bullet"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>';
}

function readProfileForm(form, kind) {
  const data = {};
  for (const [name, , type = "text"] of PROFILE_FIELDS[kind]) {
    if (type === "bool") data[name] = form.elements[name].checked;
    else if (type === "claims") data[name] = [...form.querySelectorAll('[data-claims="' + name + '"] .pf-claim')].map(row => ({
      id: row.dataset.claimId || undefined, text: row.querySelector("input:not([type=checkbox])").value, verified: row.querySelector("[data-claim-verified]").checked,
    })).filter(claim => claim.text.trim());
    else if (type === "ids") data[name] = [...form.querySelectorAll('[data-ids="' + name + '"] input:checked')].map(input => input.value);
    else if (type === "lines") data[name] = form.elements[name].value.split("\n");
    else data[name] = form.elements[name].value;
  }
  return data;
}

function itemForm(kind, item) {
  const data = item?.data || {};
  const verification = item?.verification || (kind === "skill" ? "verified" : "unverified");
  return '<form class="view-card pf-form" data-profile-form="' + kind + '" data-id="' + esc(item?.id || "") + '" data-revision="' + esc(item?.revision ?? "") + '">' +
    '<div class="card-heading"><h3>' + (item ? "Edit " : "Add ") + esc(KIND_LABELS[kind]) + '</h3></div><div class="pf-grid">' +
    PROFILE_FIELDS[kind].map(spec => profileControl(kind, spec, data)).join("") +
    '<label>Verification<span class="field-help">Only verified entries count as facts for AI suggestions</span><select name="__verification">' +
    Object.entries(VERIFICATION_LABELS).map(([key, text]) => '<option value="' + key + '"' + (key === verification ? " selected" : "") + '>' + text + '</option>').join("") + '</select></label></div>' +
    '<div class="stack-actions"><button class="button primary" type="submit">Save</button><button class="button quiet-button" type="button" data-profile-action="cancel">Cancel</button>' +
    (item ? '<button class="button danger-button pf-delete" type="button" data-profile-action="delete" data-id="' + esc(item.id) + '">Delete</button>' : '') + '</div></form>';
}

// ------------------------------------------------------------------ cards

function linkSummary(item) {
  const checks = profileData.link_checks?.[item.id] || {};
  const links = Object.keys(LINK_FIELD_LABELS).filter(field => item.data[field]);
  if (!links.length) return '<span class="subtle">No links</span>';
  return links.map(field => {
    const check = checks[field];
    const status = check?.status || "not_checked";
    return '<a class="link-check ' + esc(LINK_TONES[status]) + '" href="' + esc(item.data[field]) + '" target="_blank" rel="noopener noreferrer" title="' + esc((check?.detail || "Not checked yet.") + (check?.checked_at ? " Checked " + dateLabel(check.checked_at) + "." : "")) + '">' +
      esc(LINK_FIELD_LABELS[field]) + ': ' + esc(LINK_LABELS[status]) + '</a>';
  }).join("");
}

function itemActions(item) {
  return '<div class="pf-card-actions"><button class="button secondary" type="button" data-profile-action="edit" data-id="' + esc(item.id) + '">Edit</button>' +
    (item.kind === "project" ? '<button class="button quiet-button" type="button" data-profile-action="verify-links" data-id="' + esc(item.id) + '">Verify links</button>' : '') +
    (item.verification !== "verified" ? '<button class="button quiet-button" type="button" data-profile-action="mark-verified" data-id="' + esc(item.id) + '">Mark verified</button>' : '') +
    '<button class="button quiet-button" type="button" data-profile-action="archive" data-id="' + esc(item.id) + '">' + (item.archived ? "Restore" : "Archive") + '</button></div>';
}

function itemCard(item) {
  if (profileEditing === item.id) return itemForm(item.kind, item);
  const data = item.data;
  let meta = "", body = "";
  if (item.kind === "experience") {
    meta = [EMPLOYMENT_LABELS[data.employment_type] !== "Not set" ? EMPLOYMENT_LABELS[data.employment_type] : "", [data.start, data.end || (data.start ? "present" : "")].filter(Boolean).join(" – "), data.location].filter(Boolean).join(" · ");
    body = (data.technologies.length ? '<p class="pf-tags">' + data.technologies.map(tag => '<span class="mini-badge">' + esc(tag) + '</span>').join("") + '</p>' : '') +
      '<p class="subtle">' + data.achievements.length + ' achievement' + (data.achievements.length === 1 ? '' : 's') + ' (' + data.achievements.filter(claim => claim.verified).length + ' verified)</p>';
  } else if (item.kind === "project") {
    const usage = profileData.project_usage?.[item.id] || [];
    meta = [PROJECT_STATUS_LABELS[data.status], data.category, FUNCTIONAL_LABELS[data.functional_status] + (data.functional_checked_at ? " (" + dateLabel(data.functional_checked_at) + ")" : "")].filter(Boolean).join(" · ");
    body = (data.summary ? '<p>' + esc(data.summary) + '</p>' : '') +
      (data.technologies.length ? '<p class="pf-tags">' + data.technologies.map(tag => '<span class="mini-badge">' + esc(tag) + '</span>').join("") + '</p>' : '') +
      '<p class="pf-links">' + linkSummary(item) + '</p><p class="subtle">' + (usage.length ? "In " + usage.length + " resume" + (usage.length === 1 ? "" : "s") + ": " + esc(usage.map(entry => entry.name).join(", ")) : "Not in any saved resume yet") +
      (data.resume_ready ? "" : " · marked not for resumes") + ' · updated ' + esc(dateLabel(item.updated_at)) + '</p>';
  } else if (item.kind === "skill") {
    const names = (data.evidence_ids || []).map(id => profileData.items.find(other => other.id === id)?.label).filter(Boolean);
    meta = SKILL_CATEGORY_LABELS[data.category];
    body = '<p class="subtle">' + (names.length ? "Shown in " + esc(names.join(", ")) : "No linked evidence yet") + '</p>';
  } else if (item.kind === "achievement") body = data.evidence ? '<p class="subtle">Evidence: ' + esc(data.evidence) + '</p>' : '';
  else if (item.kind === "education") meta = [data.field, [data.start, data.end].filter(Boolean).join(" – ")].filter(Boolean).join(" · ");
  else if (item.kind === "certification") meta = [data.issuer, data.date].filter(Boolean).join(" · ");
  return '<article class="pf-card' + (item.archived ? " archived" : "") + '" id="pf-item-' + esc(item.id) + '"><div class="pf-card-head"><div><strong>' + esc(item.label) + '</strong>' +
    (meta ? '<span class="subtle">' + esc(meta) + '</span>' : '') + '</div>' + verificationChip(item.verification) + (item.archived ? '<span class="sub-status">Archived</span>' : '') + '</div>' +
    body + itemActions(item) + '</article>';
}

function listSection(kind, title, description) {
  const list = profileItems(kind);
  const adding = profileEditing === "new:" + kind;
  return '<section class="pf-section"><div class="card-heading"><div><h2>' + esc(title) + ' <span class="count">' + list.length + '</span></h2>' + (description ? '<p>' + esc(description) + '</p>' : '') + '</div>' +
    (adding ? '' : '<button class="button secondary" type="button" data-profile-action="new" data-kind="' + kind + '">+ Add ' + esc(KIND_LABELS[kind]) + '</button>') + '</div>' +
    (adding ? itemForm(kind, null) : '') + '<div class="pf-list' + (kind === "project" ? " pf-grid-cards" : "") + '">' +
    (list.length ? list.map(itemCard).join("") : (adding ? '' : '<p class="subtle pf-empty">Nothing here yet.</p>')) + '</div></section>';
}

// ------------------------------------------------------------------ tabs

function personalTab() {
  const personal = profileData.personal;
  const masters = (state.resumes || []).filter(resume => resume.kind === "master");
  return '<form class="view-card pf-form" data-profile-form="personal" data-revision="' + esc(personal.revision || "") + '"><div class="card-heading"><h2>Personal details</h2></div><div class="pf-grid">' +
    PROFILE_FIELDS.personal.map(spec => profileControl("personal", spec, personal.data)).join("") +
    '</div><div class="stack-actions"><button class="button primary" type="submit">Save personal details</button></div></form>' +
    '<section class="view-card pf-import"><div class="card-heading"><div><h2>Import from a resume</h2><p>Adds experience, projects, skills, education, and certifications ApplyDock does not have yet. Nothing you already entered is overwritten.</p></div></div>' +
    (masters.length ? '<div class="pf-import-row"><label>Resume<select id="profile-import-resume">' + masters.map(resume => '<option value="' + esc(resume.id) + '">' + esc(resume.name) + ' · ' + esc(resume.category) + '</option>').join("") + '</select></label>' +
      '<label class="check-line"><input id="profile-import-verified" type="checkbox" checked> Mark imported entries as verified (they come from my own resume)</label>' +
      '<button class="button secondary" type="button" data-profile-action="import">Import</button></div>' : '<p class="subtle">Upload a resume first.</p>') + '</section>';
}

function verificationTab() {
  const projects = profileItems("project").filter(item => !item.archived);
  const review = (profileData.items || []).filter(item => !item.archived && item.verification !== "verified");
  const counts = Object.fromEntries(Object.keys(VERIFICATION_LABELS).map(key => [key, (profileData.items || []).filter(item => !item.archived && item.verification === key).length]));
  return '<section class="view-card"><div class="card-heading"><div><h2>Project links</h2><p>Checks run only when you ask. A reachable link is not proof the app works — record your own test below.</p></div>' +
    (projects.some(item => Object.keys(LINK_FIELD_LABELS).some(field => item.data[field])) ? '<button class="button secondary" type="button" data-profile-action="verify-all">Verify all links</button>' : '') + '</div>' +
    (projects.length ? '<div class="pf-verify-list">' + projects.map(item => '<div class="pf-verify-row"><div><strong>' + esc(item.label) + '</strong><p class="pf-links">' + linkSummary(item) + '</p></div>' +
      '<label>Your own test<select data-functional="' + esc(item.id) + '">' + Object.entries(FUNCTIONAL_LABELS).map(([key, text]) => '<option value="' + key + '"' + (key === item.data.functional_status ? " selected" : "") + '>' + text + '</option>').join("") + '</select>' +
      '<span class="field-help">' + (item.data.functional_checked_at ? "Recorded " + esc(dateLabel(item.data.functional_checked_at)) : "Not recorded") + '</span></label>' +
      '<button class="button quiet-button" type="button" data-profile-action="verify-links" data-id="' + esc(item.id) + '">Verify links</button></div>').join("") + '</div>'
      : '<p class="subtle">Add projects to check their links.</p>') + '</section>' +
    '<section class="view-card"><div class="card-heading"><div><h2>Entries to confirm</h2><p>' + counts.verified + ' verified · ' + counts.unverified + ' unverified · ' + counts.needs_review + ' need review. Entries marked “needs review” are left out of job matching.</p></div></div>' +
    (review.length ? '<div class="pf-verify-list">' + review.map(item => '<div class="pf-verify-row"><div><strong>' + esc(item.label) + '</strong><span class="subtle">' + esc(KIND_LABELS[item.kind]) + '</span></div>' + verificationChip(item.verification) +
      '<div class="pf-card-actions"><button class="button quiet-button" type="button" data-profile-action="mark-verified" data-id="' + esc(item.id) + '">Mark verified</button><button class="button quiet-button" type="button" data-profile-action="edit" data-id="' + esc(item.id) + '">Edit</button></div></div>').join("") + '</div>'
      : '<p class="subtle">Everything active is verified.</p>') + '</section>';
}

function renderProfile() {
  const pane = $("profile-pane");
  if (!pane || !profileData) return;
  const counts = profileData.counts || {};
  let body;
  if (profileTab === "personal") body = personalTab();
  else if (profileTab === "experience") body = listSection("experience", "Experience", "Detailed background is fine here; resumes only use what fits a job.");
  else if (profileTab === "projects") body = listSection("project", "Projects and applications", "Software you built, separate from job applications. Reused across resumes without copying them.");
  else if (profileTab === "skills") body = listSection("skill", "Skills", "Link each skill to the projects or roles that demonstrate it, so matching uses evidence rather than keywords.") +
    listSection("achievement", "Achievements", "") + listSection("education", "Education", "") + listSection("certification", "Certifications", "");
  else body = verificationTab();
  pane.innerHTML = '<div class="pf-head"><p>Your career source of truth. ApplyDock compares jobs against it and suggests resume additions from it — it never edits a resume or a sent file on its own.</p>' +
    '<label class="check-line"><input type="checkbox" data-profile-archived' + (profileShowArchived ? " checked" : "") + '> Show archived</label></div>' +
    '<div class="profile-tabs" role="tablist" aria-label="Master Profile sections">' + PROFILE_TABS.map(([key, label]) => {
      const count = {experience: counts.experience, projects: counts.project, skills: (counts.skill || 0) + (counts.achievement || 0) + (counts.education || 0) + (counts.certification || 0)}[key];
      return '<button type="button" role="tab" data-profile-tab="' + key + '" aria-selected="' + (key === profileTab) + '" class="' + (key === profileTab ? "active" : "") + '">' + esc(label) + (count ? ' <small>' + count + '</small>' : '') + '</button>';
    }).join("") + '</div><div class="pf-body">' + body + '</div>';
}

// ------------------------------------------------------------------ actions

function applyProfileResponse(response) {
  if (response.profile) profileData = response.profile;
  renderProfile();
}

async function profileAction(action, button) {
  const id = button.dataset.id;
  const item = (profileData.items || []).find(entry => entry.id === id);
  try {
    if (action === "new") { profileEditing = "new:" + button.dataset.kind; return renderProfile(); }
    if (action === "edit") {
      profileEditing = id;
      profileTab = {experience: "experience", project: "projects"}[item.kind] || "skills";
      renderProfile();
      return document.getElementById("pf-item-" + id)?.scrollIntoView({block: "start"}) ?? document.querySelector('[data-profile-form][data-id="' + id + '"]')?.scrollIntoView({block: "start"});
    }
    if (action === "cancel") { profileEditing = ""; return renderProfile(); }
    if (action === "add-claim") return button.previousElementSibling.insertAdjacentHTML("beforeend", claimRow());
    if (action === "remove-claim") return button.closest(".pf-claim").remove();
    if (action === "delete") {
      if (!window.confirm("Delete ‘" + item.label + "’ from your Master Profile? Resumes and submitted files are not affected.")) return;
      profileEditing = "";
      return applyProfileResponse(await api("/api/profile/items/" + id, "DELETE"));
    }
    if (action === "archive") return applyProfileResponse(await api("/api/profile/items/" + id, "PATCH", {archived: !item.archived}));
    if (action === "mark-verified") {
      applyProfileResponse(await api("/api/profile/items/" + id, "PATCH", {verification: "verified"}));
      return notify("Marked as verified.");
    }
    if (action === "verify-links" || action === "verify-all") {
      button.disabled = true;
      button.textContent = "Checking…";
      const response = await api("/api/profile/verify-links", "POST", action === "verify-links" ? {item_id: id} : {});
      applyProfileResponse(response);
      const bad = response.results.filter(result => !["reachable", "redirected"].includes(result.status)).length;
      return notify(response.results.length ? response.results.length + " link" + (response.results.length === 1 ? "" : "s") + " checked" + (bad ? ", " + bad + " need attention." : ", all reachable.") : "This project has no links to check.", bad > 0);
    }
    if (action === "import") {
      button.disabled = true;
      const response = await api("/api/profile/import", "POST", {resume_id: $("profile-import-resume").value, verified: $("profile-import-verified").checked});
      applyProfileResponse(response);
      const added = Object.values(response.added).reduce((sum, value) => sum + value, 0);
      return notify(added ? "Imported " + added + " new detail" + (added === 1 ? "" : "s") + ". Review them in each tab." : "Nothing new to import — the profile already has everything from that resume.");
    }
  } catch (error) {
    notify(error.message, true);
    if (error.status === 409) loadProfile(true);
  } finally { if (button.isConnected) button.disabled = false; }
}

async function saveProfileForm(form) {
  const kind = form.dataset.profileForm;
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const data = readProfileForm(form, kind);
    const revision = form.dataset.revision === "" ? undefined : Number(form.dataset.revision);
    if (kind === "personal") {
      applyProfileResponse(await api("/api/profile/personal", "PATCH", {data, expected_revision: revision}));
      return notify("Personal details saved.");
    }
    const verification = form.elements.__verification.value;
    const response = form.dataset.id
      ? await api("/api/profile/items/" + form.dataset.id, "PATCH", {data, verification, expected_revision: revision})
      : await api("/api/profile/items", "POST", {kind, data, verification});
    profileEditing = "";
    applyProfileResponse(response);
    notify("Saved to your Master Profile.");
  } catch (error) {
    notify(error.message, true);
    if (error.status === 409) { profileEditing = ""; loadProfile(true); }
  } finally { if (button.isConnected) button.disabled = false; }
}

async function openProfileItem(itemId) {
  showView("settings");
  setSettingsTab("profile");
  await loadProfile(true);
  const item = (profileData?.items || []).find(entry => entry.id === itemId);
  if (!item) return notify("That profile entry no longer exists.", true);
  profileTab = {experience: "experience", project: "projects"}[item.kind] || "skills";
  profileEditing = "";
  renderProfile();
  const card = document.getElementById("pf-item-" + itemId);
  card?.scrollIntoView({block: "center"});
  card?.classList.add("pf-highlight");
  card?.querySelector("button")?.focus();
}

function initializeProfile() {
  for (const button of document.querySelectorAll("[data-settings-tab]"))
    button.addEventListener("click", () => setSettingsTab(button.dataset.settingsTab));
  const pane = $("profile-pane");
  pane.addEventListener("click", event => {
    const tab = event.target.closest("[data-profile-tab]");
    if (tab) { profileTab = tab.dataset.profileTab; profileEditing = ""; renderProfile(); pane.querySelector('[data-profile-tab="' + profileTab + '"]')?.focus(); return; }
    const button = event.target.closest("[data-profile-action]");
    if (button) profileAction(button.dataset.profileAction, button);
  });
  pane.addEventListener("submit", event => {
    const form = event.target.closest("[data-profile-form]");
    if (form) { event.preventDefault(); saveProfileForm(form); }
  });
  pane.addEventListener("change", async event => {
    if (event.target.matches("[data-profile-archived]")) { profileShowArchived = event.target.checked; return renderProfile(); }
    const select = event.target.closest("[data-functional]");
    if (!select) return;
    try {
      applyProfileResponse(await api("/api/profile/items/" + select.dataset.functional, "PATCH", {data: {functional_status: select.value}}));
      notify("Your test result was recorded.");
    } catch (error) { notify(error.message, true); }
  });
}
