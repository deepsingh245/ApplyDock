// ATS Analysis view: queue, live progress console, results, requirements explorer, history. Uses core.js.

function scoreTone(score) {
  if (score == null) return "neutral";
  if (score >= 75) return "strong";
  if (score >= 50) return "medium";
  return "weak";
}

function analysisStageLabel(stage) {
  return ({queued: "Queued", validation: "Checking inputs", preparing: "Preparing files", resume_parse: "Parsing resume", jd_requirements: "Job requirements", job_comparison: "Comparing job", jd_match: "Comparing job", evidence_validation: "Validating evidence", scoring: "Calculating score", result_ready: "Preparing result", notion_sync: "Syncing Notion", complete: "Complete", plan_limit: "Plan limit reached", auth: "Sign-in required", codex_log: "Codex CLI", codex_missing: "Codex unavailable", cli_options: "Codex update needed", model_unavailable: "Model unavailable", schema_rejected: "Schema rejected", local_permissions: "Local access failed", sandbox_failed: "Sandbox failed", connection_failed: "Connection ended", invalid_output: "Invalid response", timeout: "Codex timed out", codex_failed: "Codex stopped", insufficient_jd: "Job description incomplete", interrupted: "Interrupted", failed: "Analysis failed"})[stage] || String(stage || "Processing").replaceAll("_", " ");
}

function analysisConsoleHtml(detail, live = false) {
  const events = detail.events || [];
  const lines = events.length ? events.map(event => {
    const time = new Date(event.created_at);
    const timeLabel = Number.isNaN(time.getTime()) ? "--:--:--" : time.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"});
    return '<div class="console-line ' + esc(event.level || "info") + '"><time>' + esc(timeLabel) + '</time><span class="console-stage">' + esc(analysisStageLabel(event.stage)) + '</span><p>' + esc(event.message) + '</p></div>';
  }).join("") : '<div class="console-line muted"><time>--:--:--</time><span class="console-stage">Waiting</span><p>No progress events were recorded for this older run.</p></div>';
  return '<section class="analysis-console-card"><div class="console-titlebar"><strong>Activity log</strong><span class="console-state ' + (live ? "live" : "") + '">' + (live ? "LIVE" : "LOG") + '</span></div><div class="console-progress"><div><span>' + esc(analysisStageLabel(detail.progress_stage)) + '</span><strong>' + esc(detail.progress_percent ?? 0) + '%</strong></div><div class="console-progress-track"><i style="width:' + Math.max(0, Math.min(100, Number(detail.progress_percent || 0))) + '%"></i></div><small>Stage estimate · validated results appear after completion</small></div><div class="console-output" role="log" aria-live="polite">' + lines + '</div></section>';
}

function scrollAnalysisConsole() {
  const output = $("analysis-content").querySelector(".console-output");
  if (output) output.scrollTop = output.scrollHeight;
}

function renderAnalysisQueue() {
  const active = analysisQueue || [];
  $("analysis-queue-count").textContent = active.length ? active.length + " active" : "Queue empty";
  // The queue card only earns its space while something is waiting or running.
  document.querySelector(".analysis-queue-card").hidden = !active.length;
  $("analysis-queue").innerHTML = active.length ? active.map(item => {
    const progress = Math.max(0, Math.min(100, Number(item.progress_percent || 0)));
    const current = item.id === analysisDetail?.id;
    return '<button class="analysis-queue-row' + (item.status === "analyzing" ? ' running' : '') + (current ? ' current' : '') + '" type="button" data-queue-analysis="' + esc(item.id) + '"><span class="analysis-queue-position">' + (item.status === "analyzing" ? '<i aria-hidden="true"></i>NOW' : '#' + esc(item.position)) + '</span><span class="analysis-queue-copy"><strong>' + esc(item.title || "Untitled application") + '</strong><small>' + esc(item.company || "Company not set") + ' · ' + esc(analysisStageLabel(item.progress_stage)) + '</small></span><span class="analysis-queue-meter"><span><i style="width:' + progress + '%"></i></span><b>' + progress + '%</b></span></button>';
  }).join("") : '<div class="analysis-queue-empty"><span aria-hidden="true">✓</span><div><strong>No analyses are waiting</strong><p>Run an analysis from any application to add it here.</p></div></div>';
  for (const button of $("analysis-queue").querySelectorAll("[data-queue-analysis]"))
    button.addEventListener("click", () => openAnalysis(button.dataset.queueAnalysis));
}

function renderAnalysis() {
  const detail = analysisDetail;
  if (!detail) return;
  renderAnalysisQueue();
  const entry = (state.entries || []).find(item => item.id === detail.entry_id);
  $("analysis-title").textContent = entry?.title || "ATS analysis";
  $("analysis-subtitle").textContent = (entry?.company || "Company not set") + (detail.result?.draft ? " · Unsaved draft check" : " · Resume version " + (detail.result?.resume_version || "—")) + " · " + (detail.model || "Codex");
  if (["pending", "analyzing"].includes(detail.status)) {
    $("analysis-content").innerHTML = '<div class="analysis-running-layout"><section class="view-card analysis-progress-panel"><div class="analysis-progress-heading"><span class="analysis-spinner" aria-hidden="true"></span><div><span class="eyebrow">PROCESSING</span><h2>' + esc(analysisStageLabel(detail.progress_stage)) + '</h2><p>' + esc(detail.progress_message || "ApplyDock is preparing the analysis.") + '</p></div><strong class="analysis-progress-number">' + esc(detail.progress_percent ?? 0) + '%</strong></div><div class="analysis-main-progress"><i style="width:' + Math.max(0, Math.min(100, Number(detail.progress_percent || 0))) + '%"></i></div><div class="analysis-progress-notes"><p>ApplyDock processes one analysis at a time and saves every stage locally.</p><p>Partial AI output is hidden until its evidence and schema are validated.</p></div></section>' + analysisConsoleHtml(detail, true) + '</div>';
    scrollAnalysisConsole();
    clearTimeout(analysisPollTimer);
    analysisPollTimer = setTimeout(() => openAnalysis(detail.id, true), 1200);
    return;
  }
  if (detail.status !== "complete") {
    $("analysis-content").innerHTML = '<div class="analysis-running-layout analysis-stopped-layout"><section class="view-card analysis-stopped"><span class="sub-status">' + esc(detail.label) + '</span><h2>The analysis stopped at ' + esc(detail.progress_percent ?? 0) + '%</h2><p>' + esc(detail.error_message || detail.progress_message || "The analysis could not be completed.") + '</p><div class="analysis-stopped-actions"><button class="button primary" data-analysis-rerun type="button">Run again</button><button class="button quiet-button" data-analysis-settings type="button">Open Codex settings</button></div><p class="subtle">The percentage is a stage estimate. No match score is shown because the result did not pass validation.</p></section>' + analysisConsoleHtml(detail, false) + '</div>';
    $("analysis-content").querySelector("[data-analysis-rerun]")?.addEventListener("click", () => runAnalysis(entry));
    $("analysis-content").querySelector("[data-analysis-settings]")?.addEventListener("click", () => showView("settings"));
    scrollAnalysisConsole();
    if (analysisQueue.length) analysisPollTimer = setTimeout(() => openAnalysis(detail.id, true), 1200);
    return;
  }
  const result = detail.result || {};
  const requirements = result.requirements || [];
  const categories = result.category_scores || {};
  const currentHistoryIndex = analysisHistory.findIndex(item => item.id === detail.id);
  const previous = analysisHistory.slice(currentHistoryIndex + 1).find(item => item.status === "complete");
  // Runs on the same job description share one requirement checklist, so their scores are directly comparable.
  // Scores from an older scoring method are not comparable (the requirement list was regenerated each run).
  const baseline = result.previous || (previous?.scoring_version === detail.scoring_version ? previous : null);
  const olderMethod = !baseline && previous && previous.scoring_version !== detail.scoring_version;
  const delta = baseline?.overall_score == null || detail.overall_score == null ? null : Math.round((detail.overall_score - baseline.overall_score) * 10) / 10;
  const coverage = result.coverage_counts || null;
  const potential = result.potential_score != null && detail.overall_score != null && result.potential_score > detail.overall_score ? result.potential_score : null;
  const warnings = [...(result.warnings || [])];
  if (detail.error_message) warnings.unshift(detail.error_message);
  const matchCounts = requirements.reduce((counts, item) => {
    if (item.status === "demonstrated") counts.matched += 1;
    else if (["partial", "listed"].includes(item.status)) counts.partial += 1;
    else counts.missing += 1;
    return counts;
  }, {matched: 0, partial: 0, missing: 0});
  const categoryNames = {required_skills: "Required technical skills", experience: "Relevant work experience", responsibilities: "Responsibilities and projects", preferred_skills: "Preferred skills", education: "Education and qualifications"};
  // Categories the job never asks for are not scored (score null) and are left out of the breakdown.
  const categoryHtml = Object.entries(categoryNames).filter(([keyName]) => !categories[keyName] || categories[keyName].score !== null).map(([keyName, label]) => {
    const score = categories[keyName] || {earned: 0, possible: 0, score: 0};
    return '<div class="category-row"><div><strong>' + esc(label) + '</strong><span>' + esc(score.earned) + ' / ' + esc(score.possible) + ' points</span></div><div class="score-track"><i style="width:' + Math.max(0, Math.min(100, Number(score.score || 0))) + '%"></i></div><b>' + esc(score.score || 0) + '%</b></div>';
  }).join("");
  const statusRank = {missing: 0, uncertain: 0, listed: 1, partial: 2, demonstrated: 3};
  // Requirements you marked "addressed" leave the open list (and priority improvements); they stay reachable below.
  const isAddressed = item => detail.checklist?.[item.id] === "addressed";
  const openRequirements = requirements.filter(item => !isAddressed(item));
  const addressedRequirements = requirements.filter(isAddressed);
  const requirementCard = item => {
    const checklist = detail.checklist?.[item.id] || "pending";
    const evidence = item.resume_evidence || [];
    const filterStatus = item.status === "demonstrated" ? "matched" : ["partial", "listed"].includes(item.status) ? "partial" : "missing";
    const change = item.previous_status && item.previous_status !== item.status
      ? '<span class="status-change ' + (statusRank[item.status] > statusRank[item.previous_status] ? "up" : statusRank[item.status] < statusRank[item.previous_status] ? "down" : "") + '" title="Previous run: ' + esc(item.previous_status) + '">was ' + esc(item.previous_status) + '</span>' : '';
    const sources = item.profile_evidence || [];
    const profileHtml = sources.length ? '<div class="profile-evidence"><strong>' + (item.coverage === "profile_only" ? "Your Master Profile has evidence the resume lacks" : "Related evidence in your Master Profile") + '</strong>' +
      sources.map(source => '<p>' + esc(source.label) + (source.verified ? '' : ' <span class="sub-status warn">Unverified</span>') + ' <button class="text-button" type="button" data-profile-item="' + esc(source.item_id) + '">View source</button></p>').join("") + '</div>'
      : (item.coverage === "unsupported" ? '<p class="subtle">Neither your resume nor your Master Profile supports this. Do not add it unless it is true; if it is, add the evidence to your profile first.</p>' : '');
    return '<details class="requirement-card" data-requirement-status="' + filterStatus + '" data-requirement-coverage="' + esc(item.coverage || "") + '" data-requirement-text="' + esc(item.requirement).toLowerCase() + '"><summary><span class="requirement-dot ' + filterStatus + '"></span><span><strong>' + esc(item.requirement) + '</strong><small>' + esc(item.explanation || "Open to inspect evidence and recommendation.") + '</small></span><span class="requirement-chips">' + change + '<span class="match-status ' + esc(item.status) + '">' + esc(item.status) + '</span>' + (item.coverage ? '<span class="coverage-chip ' + esc(item.coverage) + '">' + esc(coverageLabel(item.coverage)) + '</span>' : '') + '</span><b aria-hidden="true">›</b></summary><div class="requirement-body"><div class="requirement-head">' + (item.mandatory ? '<span class="required-pill">Required</span>' : '<span class="preferred-pill">Preferred</span>') + '<span class="priority-pill">' + esc(item.priority) + ' priority</span></div>' + (evidence.length ? '<div class="evidence-list">' + evidence.map(block => '<blockquote><strong>' + esc(block.id) + '</strong>' + esc(block.text) + '</blockquote>').join("") + '</div>' : '<small>No supporting resume evidence</small>') + profileHtml + (item.recommendation ? '<div class="recommendation"><strong>Recommendation</strong><p>' + esc(item.recommendation) + '</p><label>Checklist state<select data-recommendation="' + esc(item.id) + '"><option value="pending"' + (checklist === "pending" ? " selected" : "") + '>Pending</option><option value="reviewed"' + (checklist === "reviewed" ? " selected" : "") + '>Reviewed</option><option value="addressed"' + (checklist === "addressed" ? " selected" : "") + '>Addressed</option></select></label></div>' : '') + '</div></details>';
  };
  const requirementHtml = openRequirements.length ? openRequirements.map(requirementCard).join("")
    : '<div class="view-card"><p>' + (requirements.length ? "Everything is addressed. Reopen an item below if you want to work on it again." : "No scorable requirements are available for this run.") + '</p></div>';
  const addressedHtml = addressedRequirements.length ? '<details class="addressed-requirements"><summary>Addressed (' + addressedRequirements.length + ') — hidden from the list above</summary><div class="addressed-list">' +
    addressedRequirements.map(item => '<div class="addressed-row"><span class="match-status ' + esc(item.status) + '">' + esc(item.status) + '</span><span>' + esc(item.requirement) + '</span><button class="text-button" type="button" data-reopen="' + esc(item.id) + '">Reopen</button></div>').join("") + '</div></details>' : '';
  // Gaps the profile can fill come first: they are the changes that are both truthful and new to the resume.
  const coverageOrder = {profile_only: 0, weak: 1, unsupported: 2};
  const priorityItems = openRequirements.filter(item => item.recommendation && item.status !== "demonstrated")
    .sort((a, b) => (coverageOrder[a.coverage] ?? 1) - (coverageOrder[b.coverage] ?? 1)).slice(0, 3);
  const priorityHtml = '<div class="view-card priority-improvements"><div class="card-heading"><h2>Priority improvements</h2><span class="sub-status">' + priorityItems.length + ' high impact</span></div>' + (priorityItems.length ? priorityItems.map(item => '<article><strong>' + esc(item.requirement) + '</strong>' + (item.coverage ? '<span class="coverage-chip ' + esc(item.coverage) + '">' + esc(coverageLabel(item.coverage)) + '</span>' : '') + '<p>' + esc(item.recommendation) + '</p></article>').join("") : '<p>No priority gaps were returned for this analysis.</p>') + '</div>';
  const historyHtml = analysisHistory.length ? analysisHistory.map(item => '<button type="button" data-analysis-history="' + esc(item.id) + '" class="history-row' + (item.id === detail.id ? ' active' : '') + '"><span>' + esc(item.label) + '</span><strong>' + (item.overall_score == null ? '—' : esc(item.overall_score) + '%') + '</strong><small>' + esc(dateLabel(item.completed_at || item.created_at)) + '</small></button>').join("") : '<p class="subtle">No prior analyses.</p>';
  let comparisonHtml = "";
  if (previousAnalysisDetail?.result && !olderMethod) {
    const priorRequirements = new Map((previousAnalysisDetail.result.requirements || []).map(item => [String(item.requirement).toLowerCase(), item]));
    const matchedStates = new Set(["demonstrated", "partial", "listed"]);
    const newlyMatched = requirements.filter(item => matchedStates.has(item.status) && !matchedStates.has(priorRequirements.get(String(item.requirement).toLowerCase())?.status));
    const remainingGaps = requirements.filter(item => ["missing", "uncertain"].includes(item.status));
    const resolved = (previousAnalysisDetail.result.requirements || []).filter(item => item.recommendation && ["missing", "uncertain"].includes(item.status) && matchedStates.has(requirements.find(current => String(current.requirement).toLowerCase() === String(item.requirement).toLowerCase())?.status));
    const oldWarnings = new Set(previousAnalysisDetail.result.warnings || []);
    const newWarnings = (result.warnings || []).filter(value => !oldWarnings.has(value));
    const comparisonList = (items, empty) => items.length ? '<ul>' + items.map(item => '<li>' + esc(item.requirement || item) + '</li>').join("") + '</ul>' : '<p>' + empty + '</p>';
    comparisonHtml = '<section class="view-card comparison-card"><div class="card-heading"><h2>Changes from previous run</h2><span class="sub-status">' + (delta > 0 ? '+' : '') + esc(delta ?? 0) + ' points</span></div><div class="comparison-grid"><div><strong>Newly matched</strong>' + comparisonList(newlyMatched, "No newly matched requirements.") + '</div><div><strong>Remaining gaps</strong>' + comparisonList(remainingGaps, "No remaining gaps were classified.") + '</div><div><strong>Resolved recommendations</strong>' + comparisonList(resolved, "No recommendations resolved yet.") + '</div><div><strong>New warnings</strong>' + comparisonList(newWarnings, "No new warnings.") + '</div></div></section>';
  }
  $("analysis-content").innerHTML =
    '<div class="analysis-hero"><div class="score-panel"><span class="eyebrow">Estimated match</span><div class="score-figure ' + scoreTone(detail.overall_score) + '"><strong>' + (detail.overall_score == null ? '—' : esc(Number(detail.overall_score).toFixed(1))) + '</strong><span>/ 100</span></div><div class="score-meter ' + scoreTone(detail.overall_score) + '"><i style="width:' + Math.max(0, Math.min(100, Number(detail.overall_score || 0))) + '%"></i></div></div><div><span class="sub-status">' + esc(detail.label) + '</span><h2>' + esc(result.summary || "Analysis result") + '</h2><div class="analysis-totals">' + (coverage
      ? '<span><strong>' + coverage.represented + '</strong>Represented</span><span><strong>' + coverage.weak + '</strong>Weak</span><span><strong>' + coverage.profile_only + '</strong>In profile only</span><span><strong>' + coverage.unsupported + '</strong>Missing from both</span>'
      : '<span><strong>' + matchCounts.matched + '</strong>Matched</span><span><strong>' + matchCounts.partial + '</strong>Partial</span><span><strong>' + matchCounts.missing + '</strong>Missing evidence</span>') + '</div><p>Job relevance: ' + (detail.relevance_score == null ? '—' : esc(detail.relevance_score) + '%') + ' · ATS readability: ' + (detail.readability_score == null ? '—' : esc(detail.readability_score) + '%') + ' · Missing mandatory: ' + esc(detail.missing_mandatory || 0) + '</p>' + (delta == null ? '' : '<p class="score-change">Change from previous run' + (baseline?.resume_version ? ' (resume v' + esc(baseline.resume_version) + ')' : '') + ': ' + (delta > 0 ? '+' : '') + esc(delta) + ' points</p>') +
    (profileChangedSince(detail) ? '<p class="profile-changed">Your Master Profile changed since this run. Run the analysis again to compare against it — the resume is not changed.</p>' : '') +
    (olderMethod ? '<p class="subtle">Earlier runs used the previous scoring method, which rebuilt the requirement list every time, so their scores are not comparable with this one.</p>' : '') +
    (potential == null ? '' : '<p class="score-potential">Adding the evidence already in your Master Profile could raise this to about ' + esc(Number(potential).toFixed(1)) + '.</p>') +
    (result.profile_used === false && result.scoring_version === "score-v2" ? '<p class="subtle">Add projects and experience under Settings → Master Profile so ApplyDock can find evidence your resume leaves out.</p>' : '') + '</div><div class="analysis-hero-actions"><button class="button primary" data-analysis-optimize type="button">Optimize resume for this job</button><button class="button secondary" data-analysis-rerun type="button">' + (profileChangedSince(detail) ? "Re-run with updated profile" : "Run analysis again") + '</button></div></div>' +
    (warnings.length ? '<div class="analysis-warnings">' + warnings.map(value => '<p>' + esc(value) + '</p>').join("") + '</div>' : '') +
    '<div class="analysis-layout"><main><section class="view-card"><div class="card-heading"><h2>Score breakdown</h2><span class="sub-status">Scored locally</span></div><div class="category-list">' + categoryHtml + '<div class="category-row readability-row"><div><strong>ATS readability and structure</strong><span>5% of estimated match</span></div><b>' + (detail.readability_score == null ? '—' : esc(detail.readability_score) + '%') + '</b></div></div></section>' + comparisonHtml + '<section class="analysis-section"><div class="card-heading"><div><h2>Requirements explorer</h2><p>Inspect matched evidence and gaps in your resume.</p></div><span class="sub-status">' + openRequirements.length + ' open' + (addressedRequirements.length ? ' · ' + addressedRequirements.length + ' addressed' : '') + '</span></div><div class="requirements-toolbar"><div class="requirement-filters"><button class="active" type="button" data-requirement-filter="all">All</button><button type="button" data-requirement-filter="missing">Missing</button><button type="button" data-requirement-filter="partial">Partial</button><button type="button" data-requirement-filter="matched">Matched</button>' + (coverage ? '<button type="button" data-requirement-filter="profile_only">In profile</button>' : '') + '</div><label><span class="sr-only">Search requirements</span><input id="requirements-search" type="search" placeholder="Search requirements"></label></div><div class="requirements-list">' + requirementHtml + '</div>' + addressedHtml + '</section></main><aside class="analysis-history">' + priorityHtml + analysisConsoleHtml(detail, false) + '<div class="view-card"><div class="card-heading"><h2>Analysis history</h2><span class="sub-status">' + analysisHistory.length + '</span></div><div class="history-list">' + historyHtml + '</div></div><div class="view-card"><div class="card-heading"><h2>Resume versions</h2><span class="sub-status">' + analysisVersions.length + '</span></div><p>This run stays linked to version ' + esc(result.resume_version || "—") + '. Replacing a resume keeps earlier results for comparison.</p><div class="version-list">' + analysisVersions.map(version => '<div><strong>Version ' + esc(version.version_number) + (version.is_current ? ' · Current' : '') + '</strong><span>' + esc(version.original_filename) + '</span><small>' + esc(version.extraction_status) + ' · ' + esc(dateLabel(version.created_at)) + '</small></div>').join("") + '</div></div></aside></div>';
  let requirementFilter = "all";
  const applyRequirementFilters = () => {
    const query = ($("requirements-search")?.value || "").trim().toLowerCase();
    for (const card of $("analysis-content").querySelectorAll("[data-requirement-status]"))
      card.hidden = (requirementFilter !== "all" && card.dataset.requirementStatus !== requirementFilter && card.dataset.requirementCoverage !== requirementFilter) || (query && !card.dataset.requirementText.includes(query));
  };
  for (const button of $("analysis-content").querySelectorAll("[data-requirement-filter]")) button.addEventListener("click", () => {
    requirementFilter = button.dataset.requirementFilter;
    for (const item of $("analysis-content").querySelectorAll("[data-requirement-filter]")) item.classList.toggle("active", item === button);
    applyRequirementFilters();
  });
  $("requirements-search")?.addEventListener("input", applyRequirementFilters);
  for (const select of $("analysis-content").querySelectorAll("[data-recommendation]")) select.addEventListener("change", async () => {
    try {
      const response = await api("/api/analyses/" + detail.id + "/recommendations/" + select.dataset.recommendation, "PATCH", {state: select.value});
      analysisDetail = response.analysis; renderAnalysis();
      notify(select.value === "addressed" ? "Marked as addressed — moved to the Addressed section." : "Recommendation checklist updated.");
    } catch (error) { notify(error.message, true); }
  });
  for (const button of $("analysis-content").querySelectorAll("[data-reopen]")) button.addEventListener("click", async () => {
    try {
      const response = await api("/api/analyses/" + detail.id + "/recommendations/" + button.dataset.reopen, "PATCH", {state: "pending"});
      analysisDetail = response.analysis; renderAnalysis(); notify("Reopened — it is back in the open list.");
    } catch (error) { notify(error.message, true); }
  });
  for (const button of $("analysis-content").querySelectorAll("[data-analysis-history]")) button.addEventListener("click", () => openAnalysis(button.dataset.analysisHistory));
  for (const button of $("analysis-content").querySelectorAll("[data-profile-item]")) button.addEventListener("click", () => openProfileItem(button.dataset.profileItem));
  $("analysis-content").querySelector("[data-analysis-rerun]")?.addEventListener("click", () => runAnalysis(entry));
  $("analysis-content").querySelector("[data-analysis-optimize]")?.addEventListener("click", () => {
    if (!entry) return notify("This analysis's application is no longer available.", true);
    closeAnalysisModal();
    openResumeEditorForEntry({...entry, analysis: {...entry.analysis, id: detail.id}}, "optimize");
  });
  scrollAnalysisConsole();
  if (analysisQueue.length) analysisPollTimer = setTimeout(() => openAnalysis(detail.id, true), 1200);
}

async function openAnalysis(id, preserveView = false) {
  clearTimeout(analysisPollTimer);
  try {
    const response = await api("/api/analyses/" + id);
    analysisDetail = response.analysis;
    const queueResponse = await api("/api/analyses/queue");
    analysisQueue = queueResponse.queue || [];
    const history = await api("/api/entries/" + analysisDetail.entry_id + "/analyses");
    analysisHistory = history.analyses || [];
    const currentHistoryIndex = analysisHistory.findIndex(item => item.id === analysisDetail.id);
    const previous = analysisHistory.slice(currentHistoryIndex + 1).find(item => item.status === "complete");
    previousAnalysisDetail = previous ? (await api("/api/analyses/" + previous.id)).analysis : null;
    const entry = (state.entries || []).find(item => item.id === analysisDetail.entry_id);
    if (entry?.resume_id) {
      const versions = await api("/api/resumes/" + entry.resume_id + "/versions");
      analysisVersions = versions.versions || [];
    } else analysisVersions = [];
    renderAnalysis();
    if (!preserveView && !analysisInModal) showView("analysis");
  } catch (error) { notify(error.message, true); }
}

async function runAnalysis(entry) {
  if (!entry) return;
  try {
    if (entry.id === selectedId && dirty) await saveForm();
    const result = await api("/api/entries/" + entry.id + "/analyses", "POST", {retry: entry.analysis?.status === "plan_limit"});
    await load(true);
    await openAnalysis(result.analysis.id);
    notify(result.cached ? "Loaded the unchanged analysis from ApplyDock's cache." : "Analysis queued using your ChatGPT Plus Codex allowance.");
  } catch (error) { notify(error.message, true); }
}

// From the resume editor, the full analysis opens in a large dialog so closing it returns to the editor.
// The same #analysis-view is moved into the dialog while open and put back afterwards.
let analysisHome = null;

async function openAnalysisModal(id) {
  const dialog = $("analysis-dialog");
  const view = $("analysis-view");
  if (!analysisInModal) {
    analysisHome = document.createComment("analysis-view");
    view.before(analysisHome);
    $("analysis-dialog-body").append(view);
    analysisInModal = true;
  }
  view.hidden = false;
  if (!dialog.open) dialog.showModal();
  dialog.append($("notice"));  // toasts must sit above the modal backdrop
  await openAnalysis(id, true);
  $("analysis-dialog-body").scrollTop = 0;
}

function closeAnalysisModal() {
  if (!analysisInModal) return;
  const dialog = $("analysis-dialog");
  const view = $("analysis-view");
  clearTimeout(analysisPollTimer);
  analysisHome.replaceWith(view);
  analysisHome = null;
  analysisInModal = false;
  document.body.append($("notice"));
  view.hidden = currentView !== "analysis";
  if (dialog.open) dialog.close();
}
