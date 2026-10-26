// Shared dashboard state and helpers: DOM lookup, escaping, API client, notices, formatting, shared <select> options.
// Loaded first; every other dashboard script uses these globals.

const key = () => sessionStorage.getItem("pairingKey") || localStorage.getItem("pairingKey") || "";

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

let state = null;

let selectedId = "";

let filter = "all";

let currentView = "queue";

let dirty = false;

let noticeTimer;

let emailPanelId = "";

let emailPanelOpen = false;

let createEmailOpen = false;

let analysisFilter = "all";

let scoreFilter = "all";

let analysisSort = "newest";

let analysisDetail = null;

let analysisHistory = [];

let analysisVersions = [];

let analysisQueue = [];

let previousAnalysisDetail = null;

let analysisPollTimer;

let selectedResumeId = "";

let editorTab = "overview";

const FALLBACK_APPLICATION_STAGES = ["Initiated", "To apply", "No Answer", "Applied", "Offer", "Rejected"];

const STAGES_AFTER_APPLY = new Set(["applied", "no answer", "offer", "rejected"]);

function stageIsAfterApply(value) {
  return STAGES_AFTER_APPLY.has(String(value || "").trim().toLowerCase());
}

// Rejected applications stay out of every list view except the Rejected filter.
function isRejected(entry) {
  return String(entry?.application_stage || "").trim().toLowerCase() === "rejected";
}

function localInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = number => String(number).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function dateLabel(iso) {
  if (!iso) return "Not set";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"});
}

function usableLink(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function resumeOptions(selectedId = "", entryId = "") {
  const options = ['<option value="">Choose a resume</option>'];
  for (const resume of state?.resumes || []) {
    // A tailored resume belongs to exactly one application; other pickers only offer masters.
    if (resume.kind === "tailored" && resume.entry_id !== entryId && resume.id !== selectedId) continue;
    const label = resume.name + (resume.kind === "tailored" ? " · Tailored for this job" : " · " + resume.category) + (resume.is_default ? " · Default" : "") + (!resume.available ? " · Missing file" : "");
    options.push('<option value="' + esc(resume.id) + '"' + (resume.id === selectedId ? " selected" : "") + (resume.available ? "" : " disabled") + '>' + esc(label) + '</option>');
  }
  return options.join("");
}

function stageOptions(selected = "") {
  const values = [...(state?.application_stage_options?.length ? state.application_stage_options : FALLBACK_APPLICATION_STAGES)];
  if (selected && !values.some(value => value.toLowerCase() === selected.toLowerCase())) values.push(selected);
  return ['<option value="">Not set</option>', ...values.map(value => '<option value="' + esc(value) + '"' + (value.toLowerCase() === selected.toLowerCase() ? ' selected' : '') + '>' + esc(value) + '</option>')].join("");
}

// How a job requirement is covered by the resume and the Master Profile (see ats.COVERAGE_LABELS).
const COVERAGE_LABELS = {represented: "Already represented", weak: "Weakly described", profile_only: "In your profile, not the resume", unsupported: "Missing from both"};

// True when the Master Profile changed after this analysis ran, so re-running would use newer evidence.
function profileChangedSince(analysis) {
  return Boolean(analysis && analysis.status === "complete" && state?.profile_hash !== undefined && (analysis.profile_hash || "") !== (state.profile_hash || ""));
}

function coverageLabel(value) {
  return COVERAGE_LABELS[value] || "";
}

function plural(count, word) {
  return count === 1 ? word : word + "s";
}

function bytesLabel(value) {
  const size = Number(value || 0);
  return size < 1_000_000 ? Math.max(1, Math.round(size / 1000)) + " KB" : (size / 1_000_000).toFixed(1) + " MB";
}

async function filePayload(file) {
  if (!file || file.size > 8_000_000) throw new Error("Choose a PDF or DOCX resume under 8 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return {filename: file.name, content: btoa(binary)};
}

function notify(message, isError = false) {
  const notice = $("notice");
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 6500);
}

async function api(path, method = "GET", data) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {"X-Local-Key": key(), ...(data === undefined ? {} : {"Content-Type": "application/json"})},
      body: data === undefined ? undefined : JSON.stringify(data)
    });
  } catch {
    throw new Error("The local helper is offline. Run start.cmd and try again.");
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error("Unexpected response from the local helper."); }
  if (response.status === 404 && path.startsWith("/api/resume"))
    throw new Error("The running helper is older than the Resume Library. Close it, restart start.cmd, then refresh this page.");
  if (!response.ok) {
    const error = new Error(result.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return result;
}
