// In-app resume editor: structured sections on the left, the real generated PDF on the right.
// Loaded after main.js and uses the dashboard helpers through window.ApplyDock.
(() => {
  const AD = () => window.ApplyDock;
  const esc = value => AD().esc(value);
  const SAVE_DELAY = 900;
  const PREVIEW_DELAY = 700;
  const HISTORY_LIMIT = 100;
  const SECTION_LABELS = {summary: "Summary", skills: "Skills", work: "Experience", projects: "Projects", education: "Education",
    certificates: "Certifications", awards: "Awards", custom: "Additional sections"};
  const SOURCE_LABELS = {upload: "Uploaded original", editor: "Saved in editor", tailor_seed: "Copied from master"};
  const ITEM_FIELDS = {
    work: [["position", "Job title"], ["name", "Company"], ["location", "Location"], ["startDate", "Start", "Mar 2022"], ["endDate", "End", "Present"], ["summary", "Role summary", "", "textarea"]],
    projects: [["name", "Project name"], ["url", "Link", "https://"], ["startDate", "Start"], ["endDate", "End"], ["description", "Description", "", "textarea"], ["keywords", "Technologies", "React, Node.js", "keywords"]],
    skills: [["name", "Group", "Languages"], ["keywords", "Skills", "TypeScript, React, SQL", "keywords"]],
    education: [["institution", "Institution"], ["studyType", "Degree", "B.S."], ["area", "Field of study"], ["startDate", "Start"], ["endDate", "End"], ["score", "Grade or honors"], ["courses", "Relevant courses", "", "keywords"]],
    certificates: [["name", "Certification"], ["issuer", "Issuer"], ["date", "Date"], ["url", "Link", "https://"]],
    awards: [["title", "Award"], ["awarder", "Awarded by"], ["date", "Date"], ["summary", "Details", "", "textarea"]],
    custom: [["title", "Section heading", "Volunteering"]],
  };
  const NEW_ITEM = {
    work: () => ({position: "", name: "", location: "", startDate: "", endDate: "", summary: "", highlights: [{id: newId("h"), text: ""}]}),
    projects: () => ({name: "", url: "", startDate: "", endDate: "", description: "", highlights: [], keywords: []}),
    skills: () => ({name: "", keywords: []}),
    education: () => ({institution: "", studyType: "", area: "", startDate: "", endDate: "", score: "", courses: []}),
    certificates: () => ({name: "", issuer: "", date: "", url: ""}),
    awards: () => ({title: "", awarder: "", date: "", summary: ""}),
    custom: () => ({title: "", items: [{id: newId("ci"), text: ""}]}),
  };
  const PREFIX = {work: "w", projects: "pr", skills: "s", education: "e", certificates: "c", awards: "a", custom: "cu"};

  let s = null; // editor session
  let pollTimer = null;

  function newId(prefix) {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    return prefix + "_" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }

  const clone = value => JSON.parse(JSON.stringify(value));
  const root = () => document.getElementById("resume-editor-root");

  async function request(path, method = "GET", data, {blob = false, keepalive = false, signal} = {}) {
    let response;
    try {
      response = await fetch(path, {
        method, keepalive,
        headers: {"X-Local-Key": sessionStorage.getItem("pairingKey") || localStorage.getItem("pairingKey") || "",
          ...(data === undefined ? {} : {"Content-Type": "application/json"})},
        body: data === undefined ? undefined : JSON.stringify(data),
        signal,
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new Error("The local helper is offline. Run start.cmd and try again.");
    }
    if (blob && response.ok) return {status: response.status, blob: await response.blob(), headers: response.headers};
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      const error = new Error(payload.error || "Request failed.");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  // ------------------------------------------------------------------ session

  async function open(resumeId, context = {}) {
    if (s && s.resumeId !== resumeId) await flushSave();
    clearTimeout(pollTimer);
    const data = await request("/api/resumes/" + resumeId + "/draft");
    if (s?.previewUrl) URL.revokeObjectURL(s.previewUrl);
    s = {
      resumeId, entryId: context.entryId || data.resume.entry_id || "", analysisId: context.analysisId || "",
      data, content: data.draft.content, revision: data.draft.revision, contentHash: data.draft.content_hash,
      undo: [], redo: [], lastSnapshotAt: 0, saveTimer: null, saving: null, pendingSave: false, status: "saved",
      previewTimer: null, previewController: null, previewSeq: 0, previewUrl: "", pageCount: null, previousPageCount: null,
      previewError: "", validation: null, suggestions: [], suggestionJob: null, analysis: null, panel: "preview", compare: null,
      mobileTab: "edit", leftTab: s?.resumeId === resumeId ? s.leftTab : "content", conflict: null, onlySuggested: false,
      revealed: new Set(), profileEntries: null, recommending: "", scoreCheck: null,
    };
    const entry = currentEntry();
    if (entry && !s.analysisId && entry.analysis?.id && entry.analysis.status !== "not_analyzed") s.analysisId = entry.analysis.id;
    AD().showView("resume-editor");
    if (context.panel) s.panel = context.panel;
    render();
    schedulePreview(0);
    if (s.analysisId) loadAnalysis();
    loadProfileEntries();
    // Opened from an application's submission record: compare that exact version with the current draft.
    if (context.compareVersionId && s.data.versions.some(version => version.id === context.compareVersionId)) {
      s.panel = "compare";
      compareWith("v:" + context.compareVersionId);
    }
    if (data.import.job && ["pending", "running"].includes(data.import.job.status)) pollImport(data.import.job.id);
  }

  function currentEntry() {
    return s?.entryId ? (AD().state()?.entries || []).find(entry => entry.id === s.entryId) || null : null;
  }

  function hasUnsavedVersionChanges() {
    return !s.data.base_content_hash || s.contentHash !== s.data.base_content_hash || s.status !== "saved";
  }

  // ------------------------------------------------------------------ content helpers

  function findTarget(content, id) {
    if (id === "basics") return {node: content.basics, list: null, section: "basics"};
    for (const profile of content.basics.profiles) if (profile.id === id) return {node: profile, list: content.basics.profiles, section: "basics"};
    for (const section of ["work", "projects", "skills", "education", "certificates", "awards", "custom"]) {
      for (const item of content[section]) {
        if (item.id === id) return {node: item, list: content[section], section};
        for (const key of ["highlights", "items"])
          for (const child of item[key] || []) if (child.id === id) return {node: child, list: item[key], parent: item, section};
      }
    }
    return null;
  }

  function snapshot(force = false) {
    const now = Date.now();
    if (!force && now - s.lastSnapshotAt < 1200) return;
    s.undo.push(clone(s.content));
    if (s.undo.length > HISTORY_LIMIT) s.undo.shift();
    s.redo = [];
    s.lastSnapshotAt = force ? 0 : now;
  }

  function changed({rerender = false} = {}) {
    s.status = "unsaved";
    clearTimeout(s.saveTimer);
    s.saveTimer = setTimeout(saveDraft, SAVE_DELAY);
    schedulePreview();
    if (rerender) { renderForm(); renderDesign(); } else renderStatus();
  }

  function setField(target, field, raw) {
    const found = findTarget(s.content, target);
    if (!found) return;
    snapshot();
    found.node[field] = ["keywords", "courses"].includes(field) ? raw.split(",").map(value => value.trim()).filter(Boolean) : raw;
    changed();
  }

  function structural(mutator) {
    snapshot(true);
    mutator(s.content);
    changed({rerender: true});
  }

  function undo() {
    if (!s.undo.length) return;
    s.redo.push(clone(s.content));
    s.content = s.undo.pop();
    s.lastSnapshotAt = 0;
    changed({rerender: true});
  }

  function redo() {
    if (!s.redo.length) return;
    s.undo.push(clone(s.content));
    s.content = s.redo.pop();
    s.lastSnapshotAt = 0;
    changed({rerender: true});
  }

  // ------------------------------------------------------------------ saving (serialized; never overwrites a newer revision)

  async function saveDraft() {
    clearTimeout(s.saveTimer);
    if (s.conflict) return;
    if (s.saving) { s.pendingSave = true; return s.saving; }
    const session = s;
    const sentContent = clone(session.content);
    session.status = "saving";
    renderStatus();
    session.saving = (async () => {
      try {
        const result = await request("/api/resumes/" + session.resumeId + "/draft", "PATCH", {content: sentContent, expected_revision: session.revision});
        session.revision = result.draft.revision;
        session.contentHash = result.draft.content_hash;
        session.data.draft = {...session.data.draft, ...result.draft, content: session.data.draft.content};
        session.status = JSON.stringify(sentContent) === JSON.stringify(session.content) ? "saved" : "unsaved";
      } catch (error) {
        if (error.status === 409) {
          session.conflict = error.payload.draft;
          session.status = "conflict";
        } else {
          session.status = "error";
          session.saveError = error.message;
        }
      } finally {
        session.saving = null;
        if (session === s) renderStatus();
      }
      if (session.pendingSave && session === s && !session.conflict) {
        session.pendingSave = false;
        await saveDraft();
      } else if (session === s && session.status === "unsaved" && !session.conflict) {
        session.saveTimer = setTimeout(saveDraft, SAVE_DELAY);
      }
    })();
    return session.saving;
  }

  async function flushSave() {
    if (!s) return;
    clearTimeout(s.saveTimer);
    if (s.saving) await s.saving;
    if (s.status === "unsaved" || s.status === "error") await saveDraft();
    if (s.status === "conflict") throw new Error("Resolve the editing conflict first.");
    if (s.status === "error") throw new Error(s.saveError || "The draft could not be saved.");
  }

  function beforeLeave() {
    if (!s || !["unsaved", "error"].includes(s.status) || s.conflict) return;
    clearTimeout(s.saveTimer);
    request("/api/resumes/" + s.resumeId + "/draft", "PATCH", {content: s.content, expected_revision: s.revision}, {keepalive: true}).catch(() => {});
  }

  // ------------------------------------------------------------------ preview

  function schedulePreview(delay = PREVIEW_DELAY) {
    clearTimeout(s.previewTimer);
    s.previewTimer = setTimeout(renderPreviewPdf, delay);
  }

  async function renderPreviewPdf() {
    const session = s;
    if (!session) return;
    session.previewController?.abort();
    session.previewController = new AbortController();
    const seq = ++session.previewSeq;
    try {
      const result = await request("/api/resumes/" + session.resumeId + "/draft/preview", "POST", {content: session.content},
        {blob: true, signal: session.previewController.signal});
      if (seq !== session.previewSeq || session !== s) return;
      if (session.previewUrl) URL.revokeObjectURL(session.previewUrl);
      session.previewUrl = URL.createObjectURL(result.blob);
      session.previousPageCount = session.pageCount;
      session.pageCount = Number(result.headers.get("X-Page-Count") || 0) || null;
      session.previewError = "";
    } catch (error) {
      if (error.name === "AbortError" || seq !== session.previewSeq) return;
      session.previewError = error.message;
    }
    if (session === s) { renderPreviewFrame(); renderStatus(); }
  }

  // ------------------------------------------------------------------ rendering

  function render() {
    const d = s.data;
    const resume = d.resume;
    const entry = currentEntry();
    const contextLine = resume.kind === "tailored"
      ? "Tailored copy for " + (d.entry ? (d.entry.title || "an application") + (d.entry.company ? " at " + d.entry.company : "") : "an application") +
        (d.parent ? " · based on " + d.parent.name + (d.parent.deleted ? " (master deleted)" : "") : "")
      : "Master resume · editing never changes resumes already tailored for applications";
    root().innerHTML =
      '<div class="re-header"><button class="back-button" type="button" data-re="back">← ' + (entry ? "Back to application" : "Back to resume library") + '</button>' +
      '<div class="re-title"><div><span class="eyebrow">RESUME EDITOR</span><h1>' + esc(resume.name) + ' <span class="re-kind ' + esc(resume.kind) + '">' + (resume.kind === "tailored" ? "Tailored" : "Master") + '</span></h1><p>' + esc(contextLine) + '</p></div>' +
      '<div class="re-status-group"><span id="re-save-status" class="re-save-status"></span><span id="re-page-status" class="re-page-status"></span></div></div>' +
      '<div class="re-toolbar" role="toolbar" aria-label="Resume editor actions">' +
      '<button class="button quiet-button" type="button" data-re="undo" title="Undo (Ctrl+Z)">Undo</button><button class="button quiet-button" type="button" data-re="redo" title="Redo (Ctrl+Y)">Redo</button>' +
      '<button class="button quiet-button" type="button" data-re="reset">Reset unsaved edits</button>' +
      '<span class="re-toolbar-spacer"></span>' +
      '<button class="button quiet-button" type="button" data-re="download">Download PDF</button>' +
      (entry ? '<button class="button secondary" type="button" data-re="check-score" title="Score the current draft, including accepted suggestions, against this job — no version is saved">Check score</button>' +
        '<button class="button quiet-button" type="button" data-re="save-analyze">Save &amp; new analysis</button>' : '') +
      '<button class="button primary" type="button" data-re="save-version">Save version</button></div>' +
      '<div id="re-banners"></div>' +
      '<div class="re-mobile-tabs" role="tablist"><button type="button" data-re-tab="edit" role="tab">Edit</button><button type="button" data-re-tab="preview" role="tab">Preview</button></div>' +
      '<div class="re-layout" data-mobile-tab="' + esc(s.mobileTab) + '"><div class="re-form-panel">' +
      '<div class="re-left-tabs" role="tablist" aria-label="Editor mode"><button type="button" role="tab" data-left="content">Content</button><button type="button" role="tab" data-left="design">Design</button></div>' +
      '<div id="re-left-content"><div id="re-suggestion-summary"></div><form id="re-form" autocomplete="off"></form></div><div id="re-design" hidden></div></div>' +
      '<aside class="re-side-panel"><div id="re-side"></div></aside></div>';
    if (!d.renderer.available) s.previewError = d.renderer.message;
    renderBanners();
    renderForm();
    renderSide();
    renderStatus();
    setMobileTab(s.mobileTab);
    setLeftTab(s.leftTab);
  }

  // ------------------------------------------------------------------ design (FlowCV-style customize panel)

  function setLeftTab(tab) {
    s.leftTab = tab;
    document.getElementById("re-left-content").hidden = tab !== "content";
    document.getElementById("re-design").hidden = tab !== "design";
    for (const button of root().querySelectorAll("[data-left]")) {
      button.classList.toggle("active", button.dataset.left === tab);
      button.setAttribute("aria-selected", String(button.dataset.left === tab));
    }
    if (tab === "design") renderDesign();
  }

  const UNITS = {font_size: "pt", name_size: "pt", heading_size: "pt", margin_x: "mm", margin_y: "mm", line_height: "", section_gap: "em", entry_gap: "em", bullet_gap: "em"};
  const STEPS = {font_size: 0.25, name_size: 0.5, heading_size: 0.25, margin_x: 0.5, margin_y: 0.5, line_height: 0.05, section_gap: 0.05, entry_gap: 0.05, bullet_gap: 0.05};

  function slider(key, label) {
    const [min, max] = s.data.design.ranges[key];
    const value = s.content.meta.layout[key];
    return '<div class="re-slider"><label for="re-layout-' + key + '">' + esc(label) + '</label><input id="re-layout-' + key + '" type="range" min="' + min + '" max="' + max + '" step="' + STEPS[key] + '" value="' + value + '" data-layout="' + key + '">' +
      '<output data-layout-value="' + key + '">' + esc(value) + (UNITS[key] ? " " + UNITS[key] : "") + '</output></div>';
  }

  function segmented(key, options) {
    const value = s.content.meta.layout[key];
    return '<div class="re-segmented" role="group">' + options.map(([option, label]) =>
      '<button type="button" data-layout-choice="' + key + '" data-value="' + esc(option) + '" class="' + (String(value) === String(option) ? "active" : "") + '" aria-pressed="' + (String(value) === String(option)) + '">' + esc(label) + '</button>').join("") + '</div>';
  }

  function toggle(key, label) {
    return '<label class="check-line re-toggle"><input type="checkbox" data-layout="' + key + '"' + (s.content.meta.layout[key] ? " checked" : "") + '> ' + esc(label) + '</label>';
  }

  function renderDesign() {
    const box = document.getElementById("re-design");
    if (!box || box.hidden) return;
    const meta = s.content.meta;
    const L = meta.layout;
    const design = s.data.design;
    const preset = design.presets[meta.template];
    const customized = Object.keys(preset).some(key => String(preset[key]) !== String(L[key]));
    const fontLabels = {"Carlito": "Sans · Carlito", "Libertinus Serif": "Serif · Libertinus", "New Computer Modern": "Classic · Computer Modern"};
    const order = meta.section_order;
    box.innerHTML = '<div class="re-design-col">' +
      '<section class="re-design-card"><h3>Template</h3><div class="re-template-grid">' + s.data.templates.map(t =>
        '<button type="button" class="re-template' + (t.id === meta.template ? " active" : "") + '" data-preset="' + esc(t.id) + '"><strong>' + esc(t.label) + '</strong><span>' + esc(t.description) + '</span></button>').join("") + '</div>' +
        (customized ? '<button type="button" class="text-button" data-preset="' + esc(meta.template) + '">Reset design to ' + esc(s.data.templates.find(t => t.id === meta.template)?.label || "template") + ' defaults</button>' : '') + '</section>' +
      '<section class="re-design-card"><h3>Page</h3><div class="re-design-row"><label class="re-field"><span>Paper</span><select data-meta="paper"><option value="a4">A4</option><option value="us-letter">US Letter</option></select></label>' +
        '<label class="re-field"><span>Page limit</span><select data-meta="page_limit"><option value="0">No limit</option><option value="1">1 page</option><option value="2">2 pages</option><option value="3">3 pages</option></select></label></div>' +
        '<button type="button" class="button secondary re-fit" data-re="fit"' + (meta.page_limit ? "" : " disabled") + '>' + (meta.page_limit ? "Fit to " + meta.page_limit + " page" + (meta.page_limit > 1 ? "s" : "") : "Fit to page limit") + '</button><p class="re-footnote">Fit tightens spacing first, then margins, then text size, and never goes below readable minimums.</p></section>' +
      '<section class="re-design-card"><h3>Margins</h3>' + slider("margin_x", "Left & right") + slider("margin_y", "Top & bottom") + '</section>' +
      '<section class="re-design-card"><h3>Spacing</h3>' + slider("section_gap", "Between sections") + slider("entry_gap", "Between entries") + slider("bullet_gap", "Between bullet points") + '</section>' +
      '<section class="re-design-card"><h3>Header</h3><span class="re-design-label">Alignment</span>' + segmented("header_align", [["left", "Left"], ["center", "Center"], ["right", "Right"]]) +
        '<span class="re-design-label">Contact separator</span>' + segmented("contact_separator", design.choices.contact_separator.map(value => [value, value])) + '</section>' +
      '</div><div class="re-design-col">' +
      '<section class="re-design-card"><h3>Text</h3><div class="re-font-grid">' + design.choices.font.map(font =>
        '<button type="button" class="re-font' + (L.font === font ? " active" : "") + '" data-layout-choice="font" data-value="' + esc(font) + '" style="font-family:' + (font === "Carlito" ? "Calibri, Carlito, sans-serif" : "Georgia, serif") + '">' + esc(fontLabels[font] || font) + '</button>').join("") + '</div>' +
        slider("font_size", "Font size") + slider("line_height", "Line height") + slider("name_size", "Name size") + slider("heading_size", "Section heading size") + '</section>' +
      '<section class="re-design-card"><h3>Color</h3><div class="re-swatches">' + design.accents.map(color =>
        '<button type="button" class="re-swatch' + (L.accent.toLowerCase() === color ? " active" : "") + '" data-layout-choice="accent" data-value="' + color + '" style="background:' + color + '" aria-label="Accent ' + color + '"></button>').join("") +
        '<label class="re-swatch-custom" title="Custom color"><input type="color" data-layout="accent" value="' + esc(L.accent) + '"></label></div>' +
        '<div class="re-toggles">' + toggle("accent_name", "Name") + toggle("accent_headings", "Section headings") + toggle("accent_links", "Links") + '</div></section>' +
      '<section class="re-design-card"><h3>Sections & entries</h3><div class="re-toggles">' + toggle("heading_upper", "Uppercase headings") + toggle("heading_rule", "Line under headings") + toggle("skills_inline", "Skills on one line") + '</div>' +
        '<span class="re-design-label">Dates</span>' + segmented("date_position", [["right", "Right-aligned"], ["below", "Below title"]]) +
        '<span class="re-design-label">Bullet style</span>' + segmented("bullet", design.choices.bullet.map(value => [value, value])) + '</section>' +
      '</div>' +
      '<section class="re-design-card re-design-wide"><h3>Section order</h3><p class="re-footnote">Drag a section to move it. With the keyboard, focus its handle and use the up and down arrow keys.</p>' +
        '<div class="re-order" role="list">' + order.map((section, index) => {
          const label = section === "custom" ? SECTION_LABELS.custom : meta.section_titles[section] || SECTION_LABELS[section];
          return '<div class="re-order-row" role="listitem" data-order-section="' + section + '"><button type="button" class="re-drag-handle" data-drag-section="' + section + '" aria-label="' +
            esc(label) + ', position ' + (index + 1) + ' of ' + order.length + '. Use the arrow keys to move it.">' + '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>' + '</button><span class="re-order-label">' + esc(label) +
            (resumeSectionEmpty(section) ? ' <small>(empty — not printed until you add content)</small>' : '') + '</span><span class="re-order-position" aria-hidden="true">' + (index + 1) + '</span></div>';
        }).join("") + '</div></section>';
    for (const select of box.querySelectorAll("[data-meta]")) select.value = String(meta[select.dataset.meta]);
  }

  function resumeSectionEmpty(section) {
    return section === "summary" ? !s.content.basics.summary : !(s.content[section] || []).length;
  }

  function setLayout(key, value, {rerender = false} = {}) {
    snapshot();
    const range = s.data.design.ranges[key];
    s.content.meta.layout[key] = range ? Number(value) : value;
    const output = root().querySelector('[data-layout-value="' + key + '"]');
    if (output) output.textContent = value + (UNITS[key] ? " " + UNITS[key] : "");
    changed();
    if (rerender) renderDesign();
  }

  async function fitToPages() {
    try {
      await flushSave();
      const result = await request("/api/resumes/" + s.resumeId + "/draft/fit", "POST", {content: s.content, page_limit: s.content.meta.page_limit});
      if (result.changed) {
        snapshot(true);
        s.content.meta.layout = result.layout;
        changed();
        renderDesign();
      }
      AD().notify(result.fitted ? (result.changed ? "Adjusted spacing to fit " + result.page_count + " page(s). Undo restores the previous design." : "Already fits.") :
        "Still " + result.page_count + " pages at the smallest readable settings. Shorten the content to fit.", !result.fitted);
    } catch (error) { AD().notify(error.message, true); }
  }

  function renderStatus() {
    const status = document.getElementById("re-save-status");
    if (!status) return;
    const labels = {saved: "All changes saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save failed — retrying when you edit", conflict: "Changed elsewhere"};
    status.textContent = labels[s.status] || s.status;
    status.className = "re-save-status " + s.status;
    const pages = document.getElementById("re-page-status");
    const limit = Number(s.content.meta.page_limit || 0);
    if (pages) {
      const over = limit && s.pageCount > limit;
      pages.textContent = s.pageCount ? s.pageCount + (s.pageCount === 1 ? " page" : " pages") + (limit ? " of " + limit : "") : "Preview pending";
      pages.className = "re-page-status" + (over ? " over" : "");
    }
    const undoButton = root().querySelector('[data-re="undo"]');
    if (undoButton) undoButton.disabled = !s.undo.length;
    const redoButton = root().querySelector('[data-re="redo"]');
    if (redoButton) redoButton.disabled = !s.redo.length;
    renderBanners();
  }

  function renderBanners() {
    const box = document.getElementById("re-banners");
    if (!box) return;
    const d = s.data;
    const banners = [];
    if (s.conflict) banners.push('<div class="re-banner danger"><strong>This resume was changed in another tab.</strong><span>Load the latest draft (your recent edits here are discarded) or keep this version (it replaces the other changes).</span><div><button class="button secondary" type="button" data-re="conflict-load">Load latest</button><button class="button quiet-button" type="button" data-re="conflict-keep">Keep mine</button></div></div>');
    if (s.data.draft.needs_review) {
      const source = {heuristic: "ApplyDock's local reader", codex: "Codex", empty: "an empty template", version: "a saved version"}[d.draft.import_source] || "the uploaded file";
      const warnings = d.draft.import_warnings || [];
      const job = d.import.job;
      const running = job && ["pending", "running"].includes(job.status);
      banners.push('<div class="re-banner review"><strong>Review the imported content</strong><span>The fields were filled from your original file by ' + esc(source) + '. Check names, dates, titles and every bullet before saving — the original PDF stays unchanged.</span>' +
        (warnings.length ? '<ul>' + warnings.map(w => '<li>' + esc(w) + '</li>').join("") + '</ul>' : '') +
        (running ? '<p class="re-progress">Codex import: ' + esc(job.message || "waiting") + ' (' + esc(job.percent) + '%)</p>' : '') +
        (job?.status === "failed" ? '<p class="re-progress error">Codex import failed: ' + esc(job.error_message) + '</p>' : '') +
        '<div><button class="button primary" type="button" data-re="mark-reviewed">I have reviewed the content</button>' +
        (d.import.extraction_status === "ready" && d.draft.import_source !== "codex" ? '<button class="button secondary" type="button" data-re="import-codex"' + (running ? " disabled" : "") + '>Re-import with Codex</button>' : '') +
        '<button class="button quiet-button" type="button" data-re="import-heuristic">' + (d.draft.import_source === "codex" ? "Use local import instead" : "Re-run local import") + '</button>' +
        '<button class="button quiet-button" type="button" data-re="compare-original">View original PDF</button></div></div>');
    }
    if (d.resume.kind === "tailored" && d.parent?.deleted) banners.push('<div class="re-banner"><span>The master resume this copy came from was deleted. This tailored resume keeps working on its own.</span></div>');
    box.innerHTML = banners.join("");
  }

  function field(target, name, label, value, {placeholder = "", type = "text", wide = false, attrs = ""} = {}) {
    const id = "re-" + target + "-" + name;
    const control = type === "textarea"
      ? '<textarea id="' + esc(id) + '" data-target="' + esc(target) + '" data-field="' + esc(name) + '" rows="3" placeholder="' + esc(placeholder) + '"' + attrs + '>' + esc(value) + '</textarea>'
      : '<input id="' + esc(id) + '" data-target="' + esc(target) + '" data-field="' + esc(name) + '" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '"' + attrs + '>';
    return '<div class="re-field' + (wide ? " wide" : "") + '"><label for="' + esc(id) + '">' + esc(label) + '</label>' + control + suggestionsFor(target, name) + '</div>';
  }

  function lineList(item, key, sectionLabel) {
    const lines = item[key] || [];
    return '<div class="re-lines"><span class="re-lines-label">' + (key === "highlights" ? "Bullet points" : "Lines") + '</span>' +
      lines.map((line, index) => '<div class="re-line" data-line="' + esc(line.id) + '"><textarea rows="2" data-target="' + esc(line.id) + '" data-field="text" aria-label="' + esc(sectionLabel) + ' line ' + (index + 1) + '" placeholder="Describe what you did and the result">' + esc(line.text) + '</textarea>' +
        '<div class="re-line-actions"><button type="button" class="re-icon" data-move-line="' + esc(line.id) + '" data-dir="-1" aria-label="Move line up"' + (index ? "" : " disabled") + '>↑</button><button type="button" class="re-icon" data-move-line="' + esc(line.id) + '" data-dir="1" aria-label="Move line down"' + (index < lines.length - 1 ? "" : " disabled") + '>↓</button><button type="button" class="re-icon" data-remove-line="' + esc(line.id) + '" aria-label="Remove line">×</button></div>' +
        suggestionsFor(line.id, "text") + suggestionsFor(line.id, "text", true) + '</div>').join("") +
      '<button class="button quiet-button re-add" type="button" data-add-line="' + esc(item.id) + '" data-key="' + key + '">+ Add ' + (key === "highlights" ? "bullet" : "line") + '</button></div>';
  }

  function itemCard(section, item, index, count) {
    const fields = ITEM_FIELDS[section].map(([name, label, placeholder, kind]) => {
      const value = ["keywords", "courses"].includes(name) ? (item[name] || []).join(", ") : item[name] || "";
      return field(item.id, name, label, value, {placeholder: placeholder || "", type: kind === "textarea" ? "textarea" : "text", wide: kind === "textarea" || kind === "keywords"});
    }).join("");
    const title = item.position || item.name || item.institution || item.title || "New " + SECTION_LABELS[section].toLowerCase().replace(/s$/, "");
    return '<div class="re-item" data-item="' + esc(item.id) + '"><div class="re-item-head"><strong>' + esc(title) + '</strong><div class="re-item-actions">' +
      '<button type="button" class="re-icon" data-move-item="' + esc(item.id) + '" data-section="' + section + '" data-dir="-1" aria-label="Move up"' + (index ? "" : " disabled") + '>↑</button>' +
      '<button type="button" class="re-icon" data-move-item="' + esc(item.id) + '" data-section="' + section + '" data-dir="1" aria-label="Move down"' + (index < count - 1 ? "" : " disabled") + '>↓</button>' +
      '<button type="button" class="re-icon danger" data-remove-item="' + esc(item.id) + '" data-section="' + section + '" aria-label="Remove">×</button></div></div>' +
      '<div class="re-grid">' + fields + '</div>' + suggestionsFor(item.id, "keywords", ["skills", "projects"].includes(section)) +
      (["work", "projects"].includes(section) ? lineList(item, "highlights", SECTION_LABELS[section]) : "") +
      (section === "custom" ? lineList(item, "items", item.title || "Section") : "") + suggestionsFor(item.id, "text", true) + '</div>';
  }

  // Empty sections stay out of the form until revealed, unless a suggestion targets them.
  function sectionVisible(section) {
    if (!resumeSectionEmpty(section) || s.revealed.has(section)) return true;
    const pending = (s.suggestions || []).filter(item => item.status !== "rejected");
    if (section === "summary") return pending.some(item => item.target_id === "basics" && item.field === "summary");
    if (section === "projects") return pending.some(item => item.operation === "add_project");
    return false;
  }

  function sectionBlock(section, position, total) {
    const c = s.content;
    const titles = c.meta.section_titles;
    let body;
    if (section === "summary") {
      const fromProfile = (s.profileEntries || []).find(entry => entry.key === "personal:summary" && !entry.in_resume);
      body = field("basics", "summary", "Professional summary", c.basics.summary, {type: "textarea", wide: true, attrs: ' rows="4"'}) +
        (fromProfile ? '<button class="button quiet-button re-add" type="button" data-profile-add="personal:summary">' + (c.basics.summary ? "Replace with my profile summary" : "Use my profile summary") + '</button>' : '');
    }
    else {
      const items = c[section];
      body = (section !== "custom" ? '<label class="re-field re-heading-field"><span>Heading shown on the resume</span><input data-section-title="' + section + '" value="' + esc(titles[section]) + '"></label>' : '') +
        items.map((item, index) => itemCard(section, item, index, items.length)).join("") + (section === "projects" ? addProjectSuggestions() : "") +
        '<button class="button secondary re-add" type="button" data-add-item="' + section + '">+ Add ' + ({work: "experience", projects: "project", skills: "skill group", education: "education", certificates: "certification", awards: "award", custom: "section"})[section] + '</button>';
    }
    const count = section === "summary" ? (c.basics.summary ? 1 : 0) : c[section].length;
    return '<details class="re-section" data-section="' + section + '" open><summary><span>' + esc(section === "custom" ? SECTION_LABELS.custom : titles[section] || SECTION_LABELS[section]) + '</span><small>' + count + '</small>' +
      '<span class="re-section-move"><button type="button" class="re-icon" data-move-section="' + section + '" data-dir="-1" aria-label="Move section up"' + (position ? "" : " disabled") + '>↑</button><button type="button" class="re-icon" data-move-section="' + section + '" data-dir="1" aria-label="Move section down"' + (position < total - 1 ? "" : " disabled") + '>↓</button></span></summary>' +
      '<div class="re-section-body">' + body + '</div></details>';
  }

  function renderForm() {
    const form = document.getElementById("re-form");
    if (!form) return;
    const active = document.activeElement;
    const focus = active && form.contains(active) ? {target: active.dataset.target, field: active.dataset.field, title: active.dataset.sectionTitle, start: active.selectionStart, end: active.selectionEnd} : null;
    const openState = {};
    for (const details of form.querySelectorAll("details[data-section]")) openState[details.dataset.section] = details.open;
    const c = s.content;
    const b = c.basics;
    const personal = '<details class="re-section" data-section="basics" open><summary><span>Personal information</span></summary><div class="re-section-body"><div class="re-grid">' +
      field("basics", "name", "Full name", b.name) + field("basics", "label", "Headline", b.label, {placeholder: "Frontend Engineer"}) +
      field("basics", "email", "Email", b.email) + field("basics", "phone", "Phone", b.phone) + field("basics", "location", "Location", b.location, {placeholder: "City, Country"}) +
      field("basics", "url", "Website", b.url, {placeholder: "https://"}) + '</div>' +
      '<div class="re-lines"><span class="re-lines-label">Profiles</span>' + b.profiles.map(p => '<div class="re-profile"><input data-target="' + esc(p.id) + '" data-field="network" value="' + esc(p.network) + '" placeholder="LinkedIn" aria-label="Profile name"><input data-target="' + esc(p.id) + '" data-field="url" value="' + esc(p.url) + '" placeholder="https://" aria-label="Profile link"><button type="button" class="re-icon" data-remove-profile="' + esc(p.id) + '" aria-label="Remove profile">×</button></div>').join("") +
      '<button class="button quiet-button re-add" type="button" data-re="add-profile">+ Add profile link</button></div></div></details>';
    const order = c.meta.section_order;
    const hidden = order.filter(section => !sectionVisible(section));
    const strip = hidden.length ? '<div class="re-add-sections"><span>Add a section</span>' + hidden.map(section =>
      '<button type="button" class="re-add-section" data-reveal-section="' + section + '">+ ' + esc(section === "custom" ? SECTION_LABELS.custom : c.meta.section_titles[section] || SECTION_LABELS[section]) + '</button>').join("") + '</div>' : '';
    form.innerHTML = personal + strip + order.map((section, index) => sectionVisible(section) ? sectionBlock(section, index, order.length) : "").join("");
    for (const details of form.querySelectorAll("details[data-section]")) if (details.dataset.section in openState) details.open = openState[details.dataset.section];
    if (s.onlySuggested) applySuggestedFilter();
    if (focus) {
      const selector = focus.title ? '[data-section-title="' + focus.title + '"]' : '[data-target="' + focus.target + '"][data-field="' + focus.field + '"]';
      const element = form.querySelector(selector);
      if (element) { element.focus(); try { element.setSelectionRange(focus.start, focus.end); } catch { /* not a text input */ } }
    }
    renderSuggestionSummary();
    renderStatus();
  }

  function renderSide() {
    const side = document.getElementById("re-side");
    if (!side) return;
    const tabs = '<div class="re-side-tabs" role="tablist"><button type="button" data-side="preview" class="' + (s.panel === "preview" ? "active" : "") + '">Preview</button><button type="button" data-side="versions" class="' + (s.panel === "versions" ? "active" : "") + '">Versions</button><button type="button" data-side="compare" class="' + (s.panel === "compare" ? "active" : "") + '">Compare</button>' +
      (s.analysisId || currentEntry() ? '<button type="button" data-side="analysis" class="' + (s.panel === "analysis" ? "active" : "") + '">Job match</button>' : '') +
      '<button type="button" data-side="profile" class="' + (s.panel === "profile" ? "active" : "") + '">From profile</button></div>';
    let body = "";
    if (s.panel === "preview") body = '<div class="re-preview"><div id="re-preview-frame" class="re-preview-frame"></div><div id="re-validation"></div><p class="re-footnote">This is the actual PDF ApplyDock generates. Text is selectable; checks below confirm it can be extracted in order.</p></div>';
    else if (s.panel === "versions") body = versionsHtml();
    else if (s.panel === "compare") body = compareHtml();
    else if (s.panel === "profile") body = profileHtml();
    else body = analysisHtml();
    side.innerHTML = tabs + body;
    if (s.panel === "preview") { renderPreviewFrame(); renderValidation(); }
  }

  function renderPreviewFrame() {
    const box = document.getElementById("re-preview-frame");
    if (!box) return;
    if (s.previewError) { box.innerHTML = '<div class="re-preview-empty error"><strong>Preview unavailable</strong><p>' + esc(s.previewError) + '</p></div>'; return; }
    if (!s.previewUrl) { box.innerHTML = '<div class="re-preview-empty"><span class="analysis-spinner" aria-hidden="true"></span><p>Generating preview…</p></div>'; return; }
    const pageWarning = s.previousPageCount && s.pageCount > s.previousPageCount ? '<p class="re-page-warning">This edit increased the resume to ' + s.pageCount + ' pages.</p>' : "";
    box.innerHTML = pageWarning + '<iframe title="Generated resume preview" src="' + s.previewUrl + '#toolbar=0&navpanes=0&view=FitH"></iframe>';
  }

  function renderValidation() {
    const box = document.getElementById("re-validation");
    if (!box) return;
    const report = s.validation;
    box.innerHTML = '<div class="re-validation-head"><strong>PDF checks</strong><button class="button quiet-button" type="button" data-re="validate">Run checks</button></div>' +
      (report ? (report.ok ? '<p class="re-check ok">Text extraction checks passed: ' + report.page_count + ' page(s), all content found in reading order, ' + report.links_found + ' link(s), fonts embedded.</p>'
        : report.warnings.map(w => '<p class="re-check warn">' + esc(w) + '</p>').join("")) + '<p class="re-footnote">These checks use one PDF text extractor. They cannot guarantee how a particular employer\'s ATS will read the file.</p>'
        : '<p class="re-footnote">Run checks to re-read the generated PDF and confirm every section, bullet and link is present.</p>');
  }

  function versionsHtml() {
    const versions = s.data.versions || [];
    return '<div class="re-versions"><p class="re-footnote">Each saved version is an immutable PDF. Restoring makes it current again without deleting anything.</p>' + versions.map(v =>
      '<div class="re-version' + (v.is_current ? " current" : "") + '"><div><strong>Version ' + esc(v.version_number) + (v.is_current ? " · Current" : "") + '</strong><span>' + esc(SOURCE_LABELS[v.source] || v.source) + (v.label ? " · " + esc(v.label) : "") + '</span><small>' + esc(v.original_filename) + ' · ' + esc(AD().dateLabel(v.created_at)) + ' · ' + esc(v.sha256.slice(0, 10)) + '</small>' +
      (v.validation ? '<small class="' + (v.validation.ok ? "ok" : "warn") + '">' + (v.validation.ok ? "Checks passed · " + v.validation.page_count + " page(s)" : v.validation.warnings.length + " check warning(s)") + '</small>' : '') + '</div>' +
      '<div class="re-version-actions"><button class="button quiet-button" type="button" data-version-download="' + esc(v.id) + '">Download</button>' + (v.has_content || v.source === "upload" ? '<button class="button quiet-button" type="button" data-version-compare="' + esc(v.id) + '">Compare</button>' : '') +
      (v.is_current ? '' : '<button class="button quiet-button" type="button" data-version-restore="' + esc(v.id) + '">Make current</button>') + (v.has_content ? '<button class="button quiet-button" type="button" data-version-load="' + esc(v.id) + '">Edit from here</button>' : '') + '</div></div>').join("") + '</div>';
  }

  function compareHtml() {
    const versions = s.data.versions || [];
    const options = versions.map(v => '<option value="v:' + esc(v.id) + '">Version ' + esc(v.version_number) + ' · ' + esc(SOURCE_LABELS[v.source] || v.source) + '</option>');
    if (s.data.parent && !s.data.parent.deleted && s.data.parent.current_version_id) options.unshift('<option value="p:' + esc(s.data.parent.current_version_id) + '">Master: ' + esc(s.data.parent.name) + '</option>');
    const c = s.compare;
    let result = '<p class="re-footnote">Choose a version to see what changed in your current draft.</p>';
    if (c?.loading) result = '<p class="re-footnote">Loading…</p>';
    else if (c?.error) result = '<p class="re-check warn">' + esc(c.error) + '</p>';
    else if (c?.pdfUrl) result = '<p class="re-footnote">The uploaded original has no structured content to diff. It is shown unchanged:</p><div class="re-preview-frame"><iframe title="Original PDF" src="' + c.pdfUrl + '#toolbar=0&navpanes=0&view=FitH"></iframe></div>';
    else if (c?.changes) result = c.changes.length ? '<div class="re-diff">' + c.changes.map(change => '<div class="re-diff-row ' + esc(change.type) + '"><span class="re-diff-type">' + esc(change.type) + '</span><div><strong>' + esc(change.label) + '</strong><small>' + esc(change.section) + ' · ' + esc(change.field) + '</small>' +
      (change.before ? '<del>' + esc(change.before) + '</del>' : '') + (change.after ? '<ins>' + esc(change.after) + '</ins>' : '') + '</div></div>').join("") + '</div>' : '<p class="re-check ok">No differences.</p>';
    return '<div class="re-compare"><label class="re-field"><span>Compare current draft with</span><select data-re="compare-select"><option value="">Choose…</option>' + options.join("") + '</select></label>' + result + '</div>';
  }

  // ------------------------------------------------------------------ analysis and suggestions

  function analysisHtml() {
    const entry = currentEntry();
    const a = s.analysis;
    const resume = s.data.resume;
    const job = s.suggestionJob;
    const running = job && ["pending", "running"].includes(job.status);
    let html = '<div class="re-analysis">';
    if (!entry) html += '<p class="re-footnote">Open this resume from an application to compare it with that job.</p>';
    if (a) {
      const reqs = a.result?.requirements || [];
      const addressedCount = reqs.filter(item => a.checklist?.[item.id] === "addressed").length;
      const gaps = reqs.filter(item => item.status !== "demonstrated" && a.checklist?.[item.id] !== "addressed");
      html += '<div class="re-score"><strong>' + (a.overall_score == null ? "—" : esc(a.overall_score) + "%") + '</strong><div><span>' + esc(a.result?.draft ? "Draft check · not saved as a version" : a.label) + '</span><small>Estimated match using ApplyDock\'s scoring — not a prediction of any employer\'s ATS.</small></div></div>';
      if (["pending", "analyzing"].includes(a.status)) html += '<p class="re-progress">Analyzing… ' + esc(a.progress_percent || 0) + '%</p>';
      if (AD().profileChangedSince(a)) html += '<p class="re-check warn">Your Master Profile changed since this result. Use <b>New analysis</b> to compare against it, then refresh suggestions — nothing needs to be saved first.</p>';
      html += scoreCheckHtml(a);
      if (gaps.length) html += '<div class="re-gaps"><strong>Gaps and weak areas</strong>' + gaps.slice(0, 10).map(item => '<p><span class="match-status ' + esc(item.status) + '">' + esc(item.status) + '</span> ' + esc(item.requirement) +
        (item.coverage ? ' <span class="coverage-chip ' + esc(item.coverage) + '">' + esc(AD().coverageLabel(item.coverage)) + '</span>' : '') +
        (item.recommendation ? '<small>' + esc(item.recommendation) + '</small>' : '') +
        (item.profile_evidence || []).map(source => '<button class="text-button" type="button" data-profile-item="' + esc(source.item_id) + '">From your profile: ' + esc(source.label) + '</button>').join("") + '</p>').join("") + '</div>';
      if (addressedCount) html += '<p class="re-footnote">' + addressedCount + ' requirement' + (addressedCount === 1 ? ' is' : 's are') + ' marked addressed and hidden here.</p>';
    } else if (entry) html += '<p class="re-footnote">No completed analysis yet for this application.</p>';
    if (entry) {
      if (resume.kind === "master" && entry.resume_id === resume.id)
        html += '<div class="re-banner"><span>You are editing the master resume. To tailor it for ' + esc(entry.company || "this job") + ' without changing the master, create a tailored copy.</span><div><button class="button secondary" type="button" data-re="tailor">Create tailored copy</button></div></div>';
      // "Check score" re-scores edits against this analysis (no history entry); a new analysis only runs on request.
      const checking = ["pending", "running"].includes(s.scoreCheck?.job?.status);
      html += '<div class="re-suggest-actions">' + (a?.status === "complete" ? '<button class="button primary" type="button" data-re="check-score"' + (checking || s.data.draft.needs_review ? " disabled" : "") + '>Check score</button>' +
          '<button class="button secondary" type="button" data-re="suggest"' + (running || s.data.draft.needs_review ? " disabled" : "") + '>' + (s.suggestions.length ? "Refresh suggestions" : "Suggest improvements") + '</button>' : '') +
        '<button class="button ' + (a?.status === "complete" ? "quiet-button" : "primary") + '" type="button" data-re="analyze-draft"' + (s.data.draft.needs_review ? " disabled" : "") + '>New analysis</button>' +
        '<button class="button quiet-button" type="button" data-re="save-analyze">Save version &amp; new analysis</button>' +
        (a?.id ? '<button class="button quiet-button" type="button" data-re="open-analysis">Open full analysis</button>' : '') + '</div>';
      if (s.data.draft.needs_review) html += '<p class="re-footnote">Confirm the imported content before asking for suggestions.</p>';
      if (running) html += '<p class="re-progress">Codex is preparing suggestions… ' + esc(job.percent || 0) + '%</p>';
      if (job?.status === "failed") html += '<p class="re-check warn">' + esc(job.error_message || "Suggestions failed.") + '</p>';
      if (job?.result?.notes) html += '<p class="re-footnote">' + esc(job.result.notes) + '</p>';
      const usingThis = entry.resume_id === resume.id;
      const version = entry.resume_version;
      html += '<div class="re-attach"><strong>Application attachment</strong>' + (usingThis && version ? '<p>This application uses version ' + esc(version.version_number) + (version.pinned ? " (pinned)" : " (follows current)") + ' · ' + esc(version.filename) + '</p>' : '<p>This application currently uses a different resume.</p>') +
        '<button class="button secondary" type="button" data-re="use-for-application">Use current version for this application</button></div>';
    }
    return html + '</div>';
  }

  // ------------------------------------------------------------------ score check (no new analysis)

  function scoreCheckHtml(a) {
    const check = s.scoreCheck;
    if (!check || check.analysisId !== a?.id) return a?.status === "complete" ? '<p class="re-footnote">After applying suggestions, use <b>Check score</b> to see their effect on this analysis. It keeps every requirement whose text you did not change and adds nothing to the analysis history.</p>' : '';
    const job = check.job;
    if (["pending", "running"].includes(job?.status)) return '<p class="re-progress">Checking the score of your changes… ' + esc(job.percent || 0) + '%</p>';
    if (job?.status === "failed") return '<p class="re-check warn">' + esc(job.error_message || "The score check failed.") + '</p>';
    const r = job?.result;
    if (!r) return '';
    const delta = Math.round((r.overall_score - (r.baseline_score ?? a.overall_score)) * 10) / 10;
    const outdated = r.content_hash && r.content_hash !== s.contentHash;
    return '<div class="re-score-check"><div class="re-score-check-head"><div><span class="eyebrow">Score with your changes</span>' +
      '<strong>' + esc(Number(r.overall_score).toFixed(1)) + '</strong><span class="re-delta ' + (delta > 0 ? "up" : delta < 0 ? "down" : "") + '">' + (delta > 0 ? "+" : "") + esc(delta.toFixed(1)) + '</span></div>' +
      '<small>vs ' + esc(Number(r.baseline_score ?? a.overall_score).toFixed(1)) + ' in this analysis</small></div>' +
      '<p class="re-checked-what">Checked: your current draft (not saved as a version)' + (r.applied_suggestions ? ', including ' + esc(r.applied_suggestions) + ' accepted suggestion' + (r.applied_suggestions === 1 ? '' : 's') : '') + '. Nothing was added to the analysis history.</p>' +
      '<p class="re-footnote">' + (r.full ? 'Re-checked every requirement (' + esc(r.rechecked) + ').' : 'Re-checked ' + esc(r.rechecked) + ' requirement' + (r.rechecked === 1 ? '' : 's') + ' your edits touched; ' + esc(r.kept) + ' kept their verdict because their text is unchanged.') + ' A requirement never drops while its supporting text is unchanged.</p>' +
      ((r.rechecked_items || []).length ? '<ul class="re-check-changes">' + r.rechecked_items.map(item => '<li><span class="match-status ' + esc(item.from) + '">' + esc(item.from) + '</span> → <span class="match-status ' + esc(item.to) + '">' + esc(item.to) + '</span> ' + esc(item.requirement) +
        (item.from === item.to ? ' <small class="re-unchanged">unchanged</small>' : '') + (item.explanation ? '<small>' + esc(item.explanation) + '</small>' : '') + '</li>').join("") + '</ul>'
        : (r.changes?.length ? '<ul class="re-check-changes">' + r.changes.map(change => '<li><span class="match-status ' + esc(change.from) + '">' + esc(change.from) + '</span> → <span class="match-status ' + esc(change.to) + '">' + esc(change.to) + '</span> ' + esc(change.requirement) + '</li>').join("") + '</ul>' : '<p class="re-footnote">No requirement needed re-checking: none of the text the analysis relied on changed.</p>')) +
      (r.full ? '' : '<button class="button quiet-button" type="button" data-re="check-score-full">Re-check all requirements</button>') +
      (outdated ? '<p class="re-check warn">The draft changed after this check. Check again to include the latest edits.</p>' : '') + '</div>';
  }

  async function checkScore(button, full = false) {
    if (!s.analysisId) return AD().notify("Run an analysis for this job first; Check score compares your draft with it.", true);
    const session = s;
    if (button) button.disabled = true;
    s.panel = "analysis";  // the result is shown in Job match
    try {
      await flushSave();
      const result = await request("/api/analyses/" + s.analysisId + "/score-check", "POST", {resume_id: s.resumeId, expected_revision: s.revision, full});
      s.scoreCheck = {analysisId: s.analysisId, job: result.job};
      renderSide();
      while (["pending", "running"].includes(s.scoreCheck?.job?.status)) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        if (session !== s) return;
        s.scoreCheck.job = (await request("/api/resume-jobs/" + result.job.id)).job;
        renderSide();
      }
      const r = s.scoreCheck.job.result;
      if (r) AD().notify("Score with your changes: " + Number(r.overall_score).toFixed(1) + " (" + (r.changes.length ? r.changes.length + " requirement(s) changed" : "no requirement changed") + "). The analysis history is unchanged.");
    } catch (error) {
      if (error.status === 409) { s.conflict = error.payload?.draft; s.status = "conflict"; renderStatus(); }
      AD().notify(error.message, true);
    } finally { if (button?.isConnected) button.disabled = false; if (session === s) renderSide(); }
  }

  async function loadAnalysis() {
    if (!s.analysisId) return;
    const session = s;
    try {
      const result = await request("/api/analyses/" + session.analysisId);
      if (session !== s) return;
      s.analysis = result.analysis;
      if (["pending", "analyzing"].includes(s.analysis.status)) { clearTimeout(pollTimer); pollTimer = setTimeout(loadAnalysis, 1500); }
      await loadSuggestions();
    } catch (error) { AD().notify(error.message, true); }
    if (s.panel === "analysis") renderSide();
  }

  async function loadSuggestions() {
    if (!s.analysisId) return;
    const result = await request("/api/resumes/" + s.resumeId + "/suggestions?analysis_id=" + encodeURIComponent(s.analysisId));
    s.suggestions = result.suggestions || [];
    renderForm();
  }

  function suggestionsFor(target, fieldName, structuralOnly = false) {
    if (!s?.suggestions?.length) return "";
    const items = s.suggestions.filter(item => item.target_id === target && (structuralOnly ? item.operation !== "replace" : (item.operation === "replace" && item.field === fieldName)) && !["rejected"].includes(item.status));
    if (structuralOnly && fieldName === "keywords") return items.filter(item => item.operation === "add_keyword").map(suggestionCard).join("");
    if (structuralOnly) return items.filter(item => item.operation === "insert_after").map(suggestionCard).join("");
    return items.map(suggestionCard).join("");
  }

  function addProjectSuggestions() {
    return (s?.suggestions || []).filter(item => item.operation === "add_project" && item.status !== "rejected").map(suggestionCard).join("");
  }

  function suggestionCard(item) {
    const applied = ["accepted", "edited"].includes(item.status);
    const flags = (item.guard_flags || []).filter(flag => flag.type !== "unverified_profile");
    const verb = {replace: "Rewrite", insert_after: "Add a bullet", add_keyword: "Add skill", add_project: "Add a project from your profile"}[item.operation];
    const source = item.source;
    const support = item.needs_verification ? '<span class="re-verify">Needs your verification</span>'
      : '<span class="re-safe">' + (source ? "Supported by your verified profile" : "Supported by your resume") + '</span>';
    const project = item.project;
    return '<div class="re-suggestion' + (applied ? " applied" : "") + (item.stale ? " stale" : "") + '" data-suggestion="' + esc(item.id) + '">' +
      '<div class="re-suggestion-head"><span class="eyebrow">AI SUGGESTION · ' + esc(verb) + '</span>' + support + '</div>' +
      (item.requirement ? '<p class="re-suggestion-req">For: ' + esc(item.requirement) + '</p>' : '') +
      (source ? '<p class="re-suggestion-source">Evidence: ' + esc(source.label) + (source.verified ? '' : ' <b>(not yet verified in your profile)</b>') +
        ' <button class="text-button" type="button" data-profile-item="' + esc(source.item_id) + '">View source</button></p>' : '') +
      (project ? '<p class="re-suggestion-original re-suggestion-project"><span>Project</span>' + esc(project.name) + (project.keywords?.length ? ' · ' + esc(project.keywords.join(", ")) : '') + (project.url ? '<br>' + esc(project.url) : '') + '</p>' : '') +
      (item.original_text ? '<p class="re-suggestion-original"><span>Original</span>' + esc(item.original_text) + '</p>' : '') +
      '<p class="re-suggestion-proposed"><span>' + (applied ? "Applied" : "Suggested") + '</span>' + esc(applied ? item.applied_text : item.proposed_text) + '</p>' +
      (item.reason ? '<p class="re-suggestion-reason">' + esc(item.reason) + '</p>' : '') +
      (flags.length ? '<p class="re-suggestion-flags">Not found in your resume' + (source ? ' or verified profile' : '') + ': ' + flags.map(flag => '<b>' + esc(flag.value) + '</b>').join(", ") + '. Only accept if this is true.</p>' : '') +
      (item.stale ? '<p class="re-suggestion-flags">The original text has changed since this suggestion was made.</p>' : '') +
      '<div class="re-suggestion-actions">' + (applied
        ? '<button class="button quiet-button" type="button" data-sugg="revert" data-id="' + esc(item.id) + '">Revert</button>'
        : (item.stale ? '' : '<button class="button primary" type="button" data-sugg="accept" data-id="' + esc(item.id) + '">' + (source ? "Add to resume" : "Accept") + '</button><button class="button secondary" type="button" data-sugg="edit" data-id="' + esc(item.id) + '">Edit suggestion</button>') +
          '<button class="button quiet-button" type="button" data-sugg="reject" data-id="' + esc(item.id) + '">' + (source ? "Dismiss" : "Reject") + '</button>') + '</div></div>';
  }

  function renderSuggestionSummary() {
    const box = document.getElementById("re-suggestion-summary");
    if (!box) return;
    const pending = s.suggestions.filter(item => item.status === "pending" && !item.stale);
    if (!s.suggestions.length) { box.innerHTML = ""; return; }
    const verify = pending.filter(item => item.needs_verification).length;
    box.innerHTML = '<div class="re-suggestion-summary"><strong>' + pending.length + ' suggestion' + (pending.length === 1 ? "" : "s") + ' to review</strong><span>' + verify + ' need your verification · shown next to the text they change</span><label class="check-line"><input type="checkbox" data-re="only-suggested"' + (s.onlySuggested ? " checked" : "") + '> Show only items with suggestions</label></div>';
  }

  function applySuggestedFilter() {
    for (const item of root().querySelectorAll(".re-item, .re-section[data-section]")) {
      const has = item.querySelector(".re-suggestion");
      item.classList.toggle("re-filtered-out", s.onlySuggested && !has);
    }
  }

  async function suggestionAction(action, id) {
    const item = s.suggestions.find(entry => entry.id === id);
    if (!item) return;
    try {
      if (action === "reject") {
        await request("/api/resume-suggestions/" + id, "PATCH", {status: "rejected"});
        await loadSuggestions();
        return;
      }
      await flushSave();
      let text;
      if (action === "edit") {
        text = window.prompt("Edit the suggested text before applying it:", item.proposed_text);
        if (text === null) return;
      }
      let confirmVerified = false;
      if ((action === "accept" || action === "edit") && item.needs_verification) {
        const flags = (item.guard_flags || []).map(flag => flag.value).join(", ");
        confirmVerified = window.confirm("This suggestion adds something not found in your resume" + (item.source ? " or verified profile" : "") + (flags ? " (" + flags + ")" : "") + ".\n\nOnly continue if it is accurate for your real experience. Apply it?");
        if (!confirmVerified) return;
      } else if (action === "accept" && item.source && !window.confirm("Add this to the resume draft?\n\n" + item.proposed_text + "\n\nYou can revert it, and nothing is saved as a version until you choose Save version.")) return;
      const path = "/api/resume-suggestions/" + id + "/" + (action === "revert" ? "revert" : "accept");
      const result = await request(path, "POST", {expected_revision: s.revision, ...(text !== undefined ? {text} : {}), confirm_verified: confirmVerified});
      snapshot(true);
      s.content = result.draft.content;
      s.revision = result.draft.revision;
      s.contentHash = result.draft.content_hash;
      s.status = "saved";
      await loadSuggestions();
      schedulePreview(0);
      AD().notify(action === "revert" ? "Suggestion reverted." : "Suggestion applied to the draft. Use Check score to see its effect — no need to save a version.");
    } catch (error) {
      if (error.status === 409) { s.conflict = error.payload.draft; s.status = "conflict"; renderStatus(); }
      AD().notify(error.message, true);
    }
  }

  // ------------------------------------------------------------------ Master Profile inside the editor

  async function loadProfileEntries() {
    const session = s;
    try {
      const result = await request("/api/resumes/" + s.resumeId + "/draft/profile-entries");
      if (session !== s) return;
      s.profileEntries = result.entries || [];
      renderForm();
      if (s.panel === "profile") renderSide();
    } catch (error) { if (session === s) { s.profileEntries = []; if (s.panel === "profile") renderSide(); } }
  }

  const PROFILE_GROUPS = [["personal", "Summary and headline"], ["experience", "Experience"], ["project", "Projects"], ["skill", "Skills"],
    ["achievement", "Achievements"], ["education", "Education"], ["certification", "Certifications"]];

  function profileHtml() {
    const entries = s.profileEntries;
    if (!entries) return '<div class="re-profile-panel"><p class="re-progress">Loading your Master Profile…</p></div>';
    // Entries the job analysis cited for a gap come first, tagged with what they help with.
    const helps = {};
    for (const requirement of s.analysis?.result?.requirements || []) {
      if (requirement.coverage === "represented") continue;
      for (const source of requirement.profile_evidence || []) (helps[source.item_id] = helps[source.item_id] || []).push(requirement.requirement);
    }
    const entry = currentEntry();
    const busy = s.recommending;
    let html = '<div class="re-profile-panel"><p class="re-footnote">Add entries from your Master Profile to this draft. Facts are copied as written in your profile; nothing is saved as a version until you choose Save version.</p>';
    if (entry) html += '<div class="re-recommend"><button class="button primary" type="button" data-re="recommend-profile"' + (busy || s.data.draft.needs_review ? " disabled" : "") + '>Recommend from my profile for this job</button>' +
      (busy ? '<p class="re-progress">' + esc(busy) + '</p>' : '<p class="re-footnote">Uses this job\'s current analysis (or runs one if there is none) and suggests what to add from your profile — shown next to the text it changes.</p>') + '</div>';
    if (!entries.length) return html + '<p class="re-footnote">Your Master Profile is empty. Add experience and projects under Settings → Master Profile.</p></div>';
    for (const [kind, title] of PROFILE_GROUPS) {
      const group = entries.filter(item => item.kind === kind).sort((a, b) => (helps[b.item_id] ? 1 : 0) - (helps[a.item_id] ? 1 : 0));
      if (!group.length) continue;
      html += '<section class="re-profile-group"><h3>' + esc(title) + '</h3>' + group.map(item => {
        const help = kind === "personal" ? [] : helps[item.item_id] || [];
        const action = item.in_resume ? '<span class="re-safe">In resume</span>'
          : !item.addable ? '<span class="subtle">' + esc(item.reason) + '</span>'
          : '<button class="button secondary" type="button" data-profile-add="' + esc(item.key) + '">Add to resume</button>';
        return '<div class="re-profile-entry' + (help.length ? " relevant" : "") + '"><div><strong>' + esc(item.label) + '</strong>' +
          (item.detail ? '<small>' + esc(item.detail) + '</small>' : '') +
          (help.length ? '<small class="re-helps">Helps with: ' + esc(help.slice(0, 2).join("; ")) + '</small>' : '') +
          (item.verified ? '' : '<span class="re-verify">Not verified</span>') + '</div>' + action + '</div>';
      }).join("") + '</section>';
    }
    return html + '</div>';
  }

  async function addFromProfile(key, button) {
    const entry = (s.profileEntries || []).find(item => item.key === key);
    if (!entry) return;
    const personalField = key.startsWith("personal:") ? (key === "personal:summary" ? "summary" : "label") : "";
    const replace = Boolean(personalField && s.content.basics[personalField]);
    if (replace && !window.confirm("Replace the resume's current " + (personalField === "label" ? "headline" : "summary") + " with the one from your Master Profile? You can undo this.")) return;
    if (!entry.verified && !window.confirm("‘" + entry.label + "’ is not verified in your Master Profile.\n\nOnly add it if it is accurate. Add it?")) return;
    if (button) button.disabled = true;
    try {
      await flushSave();
      const result = await request("/api/resumes/" + s.resumeId + "/draft/add-from-profile", "POST",
        {key, expected_revision: s.revision, confirm_unverified: !entry.verified, replace});
      s.profileEntries = result.entries;
      if (personalField === "summary") s.revealed.add("summary");
      acceptServerDraft(result.draft);
      renderSide();
      AD().notify("Added ‘" + entry.label + "’ to the draft. Undo is available; choose Save version when you're happy.");
    } catch (error) {
      if (error.status === 409) { s.conflict = error.payload?.draft; s.status = "conflict"; renderStatus(); }
      AD().notify(error.message, true);
    } finally { if (button?.isConnected) button.disabled = false; }
  }

  async function recommendFromProfile() {
    const session = s;
    try {
      if (s.analysis?.status !== "complete") {
        s.recommending = "Analyzing this draft against the job with your current profile…";
        renderSide();
        await analyzeDraft(null);
        if (session !== s) return;
        s.panel = "profile";
      }
      for (let tries = 0; tries < 120 && ["pending", "analyzing"].includes(s.analysis?.status); tries++) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        if (session !== s) return;
        s.analysis = (await request("/api/analyses/" + s.analysisId)).analysis;
      }
      if (s.analysis?.status !== "complete") throw new Error(s.analysis?.error_message || "The analysis did not finish. Open Job match for details.");
      s.recommending = "Preparing suggestions from your profile…";
      renderSide();
      await requestSuggestions();
    } catch (error) { AD().notify(error.message, true); }
    finally { if (session === s) { s.recommending = ""; renderSide(); } }
  }

  async function requestSuggestions() {
    try {
      await flushSave();
      const result = await request("/api/analyses/" + s.analysisId + "/suggestions", "POST", {resume_id: s.resumeId});
      s.suggestionJob = result.job;
      s.suggestions = result.suggestions || [];
      renderSide();
      if (["pending", "running"].includes(result.job.status)) pollSuggestions(result.job.id);
      else { await loadSuggestions(); AD().notify(result.reused ? "Loaded suggestions already prepared for this exact draft." : "Suggestions ready."); }
    } catch (error) { AD().notify(error.message, true); }
  }

  async function pollSuggestions(jobId) {
    const session = s;
    try {
      const result = await request("/api/resume-jobs/" + jobId);
      if (session !== s) return;
      s.suggestionJob = result.job;
      if (["pending", "running"].includes(result.job.status)) { clearTimeout(pollTimer); pollTimer = setTimeout(() => pollSuggestions(jobId), 1500); }
      else if (result.job.status === "complete") { await loadSuggestions(); AD().notify(result.job.result?.count ? result.job.result.count + " suggestion(s) ready. Review each one next to the text it changes." : "No safe suggestions were found for this draft."); }
      if (s.panel === "analysis") renderSide();
    } catch (error) { AD().notify(error.message, true); }
  }

  async function pollImport(jobId) {
    const session = s;
    try {
      const result = await request("/api/resume-jobs/" + jobId);
      if (session !== s) return;
      s.data.import.job = result.job;
      renderBanners();
      if (["pending", "running"].includes(result.job.status)) { setTimeout(() => pollImport(jobId), 1500); return; }
      if (result.job.status === "complete") {
        await flushSave();
        const applied = await request("/api/resumes/" + s.resumeId + "/draft/import", "POST", {mode: "codex", expected_revision: s.revision});
        if (applied.draft) acceptServerDraft(applied.draft);
        AD().notify("Codex import applied. Review every field before saving.");
      }
    } catch (error) { AD().notify(error.message, true); }
  }

  function acceptServerDraft(draft) {
    snapshot(true);
    s.content = draft.content;
    s.revision = draft.revision;
    s.contentHash = draft.content_hash;
    s.data.draft = draft;
    s.status = "saved";
    s.conflict = null;
    renderForm();
    renderDesign();
    schedulePreview(0);
  }

  // ------------------------------------------------------------------ actions

  async function refreshState() {
    const data = await request("/api/resumes/" + s.resumeId + "/draft");
    s.data = data;
    await AD().load(true);
  }

  async function saveVersion({analyze = false} = {}) {
    const button = root().querySelector('[data-re="' + (analyze ? "save-analyze" : "save-version") + '"]');
    if (button) button.disabled = true;
    try {
      await flushSave();
      const result = await request("/api/resumes/" + s.resumeId + "/versions/from-draft", "POST", {expected_revision: s.revision});
      s.validation = result.validation;
      await refreshState();
      const warnings = result.validation.warnings.length;
      AD().notify(result.unchanged ? "No changes since version " + result.version_number + "." :
        "Saved version " + result.version_number + "." + (warnings ? " " + warnings + " PDF check warning(s) — see Preview." : " PDF checks passed."), warnings > 0);
      if (analyze) {
        const entry = currentEntry();
        if (!entry) return;
        const analysis = await request("/api/entries/" + entry.id + "/analyses", "POST", {resume_version_id: result.version_id});
        s.analysisId = analysis.analysis.id;
        s.panel = "analysis";
        await loadAnalysis();
        AD().notify(analysis.cached ? "This exact version was already analyzed; showing that result." : "Analysis queued for version " + result.version_number + ".");
      }
      renderSide();
      renderStatus();
    } catch (error) {
      if (error.status === 409) { s.conflict = error.payload.draft; s.status = "conflict"; renderStatus(); }
      AD().notify(error.message, true);
    } finally { if (button) button.disabled = false; }
  }

  // Scores the draft as it is now; no resume version is created. Saving identical content later reuses the result.
  async function analyzeDraft(button) {
    const entry = currentEntry();
    if (!entry) return;
    if (button) button.disabled = true;
    try {
      await flushSave();
      const result = await request("/api/resumes/" + s.resumeId + "/draft/analyze", "POST", {entry_id: entry.id, expected_revision: s.revision});
      s.analysisId = result.analysis.id;
      s.panel = "analysis";
      await loadAnalysis();
      renderSide();
      AD().notify(result.cached ? "This exact draft was already analyzed; showing that result." : "Checking the current draft against this job…");
    } catch (error) {
      if (error.status === 409) { s.conflict = error.payload?.draft; s.status = "conflict"; renderStatus(); }
      AD().notify(error.message, true);
    } finally { if (button?.isConnected) button.disabled = false; }
  }

  // ------------------------------------------------------------------ section order: drag and drop

  function commitOrder(order, focusSection) {
    if (order.join() === s.content.meta.section_order.join()) return;
    structural(c => { c.meta.section_order = order; });
    if (focusSection) root().querySelector('[data-drag-section="' + focusSection + '"]')?.focus();
  }

  // Pointer events (not the HTML drag API) so dragging also works on touch screens.
  function onOrderPointerDown(event) {
    const row = event.target.closest?.(".re-order-row");
    if (!s || !row || event.button !== 0) return;
    const list = row.parentElement;
    const startY = event.clientY;
    // Slot positions are measured once, relative to the list: rows move between slots, the slots stay put
    // (and the panel may scroll while dragging).
    const listTop = () => list.getBoundingClientRect().top;
    const slots = [...list.children].map(item => { const rect = item.getBoundingClientRect(); return rect.top - listTop() + rect.height / 2; });
    let dragging = false;
    event.preventDefault();
    // Listen on the document: moving the row in the DOM would release a pointer capture on it.
    const move = moveEvent => {
      if (moveEvent.pointerId !== event.pointerId) return;
      if (!dragging && Math.abs(moveEvent.clientY - startY) < 4) return;
      dragging = true;
      row.classList.add("dragging");
      list.classList.add("sorting");
      const y = moveEvent.clientY - listTop();
      const target = slots.reduce((best, mid, index) => Math.abs(y - mid) < Math.abs(y - slots[best]) ? index : best, 0);
      if ([...list.children].indexOf(row) === target) return;
      const others = [...list.children].filter(item => item !== row);
      list.insertBefore(row, others[target] || null);
    };
    const end = endEvent => {
      if (endEvent.pointerId !== event.pointerId) return;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      row.classList.remove("dragging");
      list.classList.remove("sorting");
      if (dragging) commitOrder([...list.children].map(item => item.dataset.orderSection), row.dataset.orderSection);
      else row.querySelector(".re-drag-handle")?.focus();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  }

  function onOrderKey(event) {
    const handle = event.target.closest?.("[data-drag-section]");
    if (!s || !handle || !["ArrowUp", "ArrowDown"].includes(event.key)) return false;
    event.preventDefault();
    const order = [...s.content.meta.section_order];
    const index = order.indexOf(handle.dataset.dragSection);
    const target = index + (event.key === "ArrowUp" ? -1 : 1);
    if (target < 0 || target >= order.length) return true;
    [order[index], order[target]] = [order[target], order[index]];
    commitOrder(order, handle.dataset.dragSection);
    return true;
  }

  async function downloadVersion(versionId, name) {
    try {
      const result = await request("/api/resumes/" + s.resumeId + "/versions/" + versionId + "/file?download=1", "GET", undefined, {blob: true});
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name || "Resume.pdf";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) { AD().notify(error.message, true); }
  }

  async function compareWith(value) {
    if (!value) { s.compare = null; renderSide(); return; }
    const [kind, versionId] = value.split(":");
    const resumeId = kind === "p" ? s.data.parent.id : s.resumeId;
    s.compare = {loading: true};
    renderSide();
    try {
      await flushSave();
      const result = await request("/api/resumes/" + resumeId + "/versions/" + versionId + "/content?draft_of=" + encodeURIComponent(s.resumeId));
      if (result.changes_to_draft) s.compare = {changes: result.changes_to_draft};
      else {
        const file = await request("/api/resumes/" + resumeId + "/versions/" + versionId + "/file", "GET", undefined, {blob: true});
        s.compare = {pdfUrl: URL.createObjectURL(file.blob)};
      }
    } catch (error) { s.compare = {error: error.message}; }
    renderSide();
    const select = root().querySelector('[data-re="compare-select"]');
    if (select) select.value = value;
  }

  async function action(name, button) {
    const d = s.data;
    try {
      if (name === "back") {
        await flushSave().catch(() => {});
        if (s.entryId && currentEntry()) { AD().selectEntry(s.entryId); AD().showView("queue"); }
        else AD().showView("resumes");
        return;
      }
      if (name === "undo") return undo();
      if (name === "redo") return redo();
      if (name === "reset") {
        if (!window.confirm("Discard all edits since the last saved version?")) return;
        await flushSave();
        acceptServerDraft((await request("/api/resumes/" + s.resumeId + "/draft/reset", "POST", {expected_revision: s.revision, version_id: d.draft.base_version_id})).draft);
        s.undo = []; s.redo = [];
        return AD().notify("Reset to the last saved version.");
      }
      if (name === "save-version") return saveVersion();
      if (name === "save-analyze") return saveVersion({analyze: true});
      if (name === "analyze-draft") return analyzeDraft(button);
      if (name === "check-score") return checkScore(button);
      if (name === "check-score-full") return checkScore(button, true);
      if (name === "recommend-profile") return recommendFromProfile();
      if (name === "validate") {
        s.validation = (await request("/api/resumes/" + s.resumeId + "/draft/validate", "POST", {content: s.content})).validation;
        return renderValidation();
      }
      if (name === "download") {
        const current = (d.versions || []).find(v => v.is_current);
        if (!current) return AD().notify("No saved version yet.", true);
        if (hasUnsavedVersionChanges() && !window.confirm("Download the last saved version (v" + current.version_number + ")? Your newer edits are not in it — use Save version first to include them.")) return;
        return downloadVersion(current.id, current.original_filename);
      }
      if (name === "compare-original") {
        const original = (d.versions || []).filter(v => v.source === "upload").pop();
        s.panel = "compare";
        renderSide();
        if (original) await compareWith("v:" + original.id);
        return;
      }
      if (name === "mark-reviewed") {
        await flushSave();
        const result = await request("/api/resumes/" + s.resumeId + "/draft", "PATCH", {content: s.content, expected_revision: s.revision, reviewed: true});
        s.revision = result.draft.revision;
        s.data.draft = result.draft;
        renderBanners();
        renderSide();
        return AD().notify("Thanks — the imported content is marked as reviewed.");
      }
      if (name === "import-codex" || name === "import-heuristic") {
        if (!window.confirm("Replace the current fields with a new import of the original file? Your edits since the last import will be lost (you can undo).")) return;
        await flushSave();
        const result = await request("/api/resumes/" + s.resumeId + "/draft/import", "POST", {mode: name === "import-codex" ? "codex" : "heuristic", expected_revision: s.revision});
        if (result.draft) { acceptServerDraft(result.draft); renderBanners(); return AD().notify("Import applied. Review every field."); }
        s.data.import.job = result.job;
        renderBanners();
        AD().notify("Codex is reading your resume. This uses your ChatGPT Plus allowance once per file.");
        return pollImport(result.job.id);
      }
      if (name === "add-profile") return structural(c => c.basics.profiles.push({id: newId("p"), network: "", url: ""}));
      if (name === "tailor") {
        await flushSave();
        const result = await request("/api/entries/" + s.entryId + "/tailor", "POST", {base_resume_id: s.resumeId});
        await AD().load(true);
        AD().notify(result.created ? "Tailored copy created. The master resume is unchanged." : "Opened this application's existing tailored copy.");
        return open(result.resume.id, {entryId: s.entryId, analysisId: s.analysisId});
      }
      if (name === "suggest") return requestSuggestions();
      if (name === "fit") return fitToPages();
      if (name === "open-analysis") return flushSave().then(() => AD().openAnalysisModal(s.analysisId));
      if (name === "use-for-application") {
        const current = (d.versions || []).find(v => v.is_current);
        if (hasUnsavedVersionChanges() && !window.confirm("Your latest edits are not saved as a version. Attach the last saved version (v" + (current?.version_number || "?") + ") to this application anyway?")) return;
        await request("/api/entries/" + s.entryId + "/pin-resume", "POST", {resume_id: s.resumeId, resume_version_id: current?.id || ""});
        await AD().load(true);
        renderSide();
        return AD().notify("This application will attach version " + (current?.version_number || "") + " exactly. Update its Gmail draft if one exists.");
      }
      if (name === "conflict-load") {
        const latest = s.conflict;
        s.conflict = null;
        acceptServerDraft(latest);
        return renderStatus();
      }
      if (name === "conflict-keep") {
        s.revision = s.conflict.revision;
        s.conflict = null;
        s.status = "unsaved";
        return saveDraft();
      }
    } catch (error) {
      if (error.status === 409) { s.conflict = error.payload.draft; s.status = "conflict"; renderStatus(); }
      AD().notify(error.message, true);
    } finally { if (button) button.blur(); }
  }

  function setMobileTab(tab) {
    s.mobileTab = tab;
    root().querySelector(".re-layout").dataset.mobileTab = tab;
    for (const button of root().querySelectorAll("[data-re-tab]")) button.classList.toggle("active", button.dataset.reTab === tab);
  }

  function moveInList(list, index, dir) {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
  }

  function onClick(event) {
    if (!s) return;
    const el = event.target.closest("button, [data-re-tab]");
    if (!el || !root().contains(el)) return;
    const d = el.dataset;
    if (d.re) { event.preventDefault(); return action(d.re, el); }
    if (d.reTab) { setMobileTab(d.reTab); return; }
    if (d.left) return setLeftTab(d.left);
    if (d.layoutChoice) return setLayout(d.layoutChoice, d.value, {rerender: true});
    if (d.preset) {
      const preset = s.data.design.presets[d.preset];
      snapshot(true);
      s.content.meta.template = d.preset;
      s.content.meta.layout = clone(preset);
      changed();
      return renderDesign();
    }
    if (d.side) { s.panel = d.side; if (d.side === "analysis") loadAnalysis(); if (d.side === "profile") loadProfileEntries(); return renderSide(); }
    if (d.sugg) { event.preventDefault(); return suggestionAction(d.sugg, d.id); }
    if (d.profileItem) { event.preventDefault(); return flushSave().then(() => AD().openProfileItem(d.profileItem)); }
    if (d.profileAdd) { event.preventDefault(); return addFromProfile(d.profileAdd, el); }
    if (d.revealSection) {
      s.revealed.add(d.revealSection);
      renderForm();
      const block = root().querySelector('#re-form details[data-section="' + d.revealSection + '"]');
      if (block) { block.open = true; block.scrollIntoView({block: "start"}); block.querySelector("input, textarea, button.re-add")?.focus(); }
      return;
    }
    if (d.versionDownload) { const v = s.data.versions.find(item => item.id === d.versionDownload); return downloadVersion(v.id, v.original_filename); }
    if (d.versionCompare) { s.panel = "compare"; renderSide(); return compareWith("v:" + d.versionCompare); }
    if (d.versionRestore) {
      if (!window.confirm("Make this version current? Applications that follow this resume will use it; pinned applications keep their exact file.")) return;
      return request("/api/resumes/" + s.resumeId + "/versions/" + d.versionRestore + "/restore", "POST", {})
        .then(refreshState).then(() => { renderSide(); AD().notify("Version restored as current."); }).catch(error => AD().notify(error.message, true));
    }
    if (d.versionLoad) {
      if (!window.confirm("Replace the draft with this version's content? You can undo this.")) return;
      return flushSave().then(() => request("/api/resumes/" + s.resumeId + "/draft/reset", "POST", {expected_revision: s.revision, version_id: d.versionLoad}))
        .then(result => { acceptServerDraft(result.draft); AD().notify("Draft loaded from that version."); }).catch(error => AD().notify(error.message, true));
    }
    if (d.addItem) return structural(c => { c[d.addItem].push({id: newId(PREFIX[d.addItem]), ...NEW_ITEM[d.addItem]()}); });
    if (d.removeItem) {
      const item = s.content[d.section].find(entry => entry.id === d.removeItem);
      const filled = item && Object.entries(item).some(([k, v]) => k !== "id" && (Array.isArray(v) ? v.length : v));
      if (filled && !window.confirm("Remove this entry? You can undo this.")) return;
      return structural(c => { c[d.section] = c[d.section].filter(entry => entry.id !== d.removeItem); });
    }
    if (d.moveItem) return structural(c => moveInList(c[d.section], c[d.section].findIndex(entry => entry.id === d.moveItem), Number(d.dir)));
    if (d.addLine) return structural(c => { const found = findTarget(c, d.addLine); found.node[d.key] = [...(found.node[d.key] || []), {id: newId(d.key === "highlights" ? "h" : "ci"), text: ""}]; });
    if (d.removeLine) return structural(c => { const found = findTarget(c, d.removeLine); found.list.splice(found.list.indexOf(found.node), 1); });
    if (d.moveLine) return structural(c => { const found = findTarget(c, d.moveLine); moveInList(found.list, found.list.indexOf(found.node), Number(d.dir)); });
    if (d.removeProfile) return structural(c => { c.basics.profiles = c.basics.profiles.filter(p => p.id !== d.removeProfile); });
    if (d.moveSection) { event.preventDefault(); return structural(c => moveInList(c.meta.section_order, c.meta.section_order.indexOf(d.moveSection), Number(d.dir))); }
  }

  function onInput(event) {
    if (!s || !root().contains(event.target)) return;
    const el = event.target;
    if (el.dataset.target) return setField(el.dataset.target, el.dataset.field, el.value);
    if (el.dataset.layout && el.type !== "checkbox") return setLayout(el.dataset.layout, el.value);
    if (el.dataset.sectionTitle) { snapshot(); s.content.meta.section_titles[el.dataset.sectionTitle] = el.value; return changed(); }
  }

  function onChange(event) {
    if (!s || !root().contains(event.target)) return;
    const el = event.target;
    if (el.dataset.meta) { snapshot(true); s.content.meta[el.dataset.meta] = el.dataset.meta === "page_limit" ? Number(el.value) : el.value; changed(); return renderDesign(); }
    if (el.dataset.layout && el.type === "checkbox") return setLayout(el.dataset.layout, el.checked);
    if (el.dataset.layout && el.type === "color") return setLayout(el.dataset.layout, el.value, {rerender: true});
    if (el.dataset.re === "compare-select") return compareWith(el.value);
    if (el.dataset.re === "only-suggested") { s.onlySuggested = el.checked; return applySuggestedFilter(); }
    if (el.dataset.field && ["keywords", "courses"].includes(el.dataset.field)) renderForm();
  }

  function onKey(event) {
    if (!s || AD().currentView() !== "resume-editor") return;
    if (onOrderKey(event)) return;
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const keyName = event.key.toLowerCase();
    if (keyName === "s") { event.preventDefault(); saveVersion(); }
    else if (keyName === "z" && !event.shiftKey && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) { event.preventDefault(); undo(); }
    else if ((keyName === "y" || (keyName === "z" && event.shiftKey)) && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) { event.preventDefault(); redo(); }
  }

  document.addEventListener("click", onClick);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", event => { if (event.target.closest?.("#re-design .re-order-row")) onOrderPointerDown(event); });
  window.addEventListener("beforeunload", event => {
    if (s && ["unsaved", "saving"].includes(s.status)) { beforeLeave(); event.preventDefault(); event.returnValue = ""; }
  });

  window.ResumeEditor = {open, beforeLeave, isOpen: () => !!s};
})();
