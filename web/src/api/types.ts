// Payload shapes returned by the local helper (applydock/http_server.py). Fields the UI does not read are omitted;
// the index signatures keep unknown extras type-safe instead of pretending they do not exist.

export type ApplyMethod = "unknown" | "email" | "external_form";
export type EntryStatus = "draft" | "approved" | "sending" | "sent" | "failed" | "gmail_draft" | "gmail_schedule_pending" | "gmail_scheduled" | string;

export interface ResumeVersionRef {
  id: string;
  version_number: number;
  pinned: boolean;
  is_current: boolean;
  filename: string;
  sha256: string;
  source: string;
  file_url: string;
}

export interface AnalysisSummary {
  id?: string;
  status: string;
  label: string;
  stale: boolean;
  overall_score?: number | null;
  relevance_score?: number | null;
  readability_score?: number | null;
  missing_mandatory?: number | null;
  analyzed_at?: string;
  error?: string;
  profile_hash?: string;
  scoring_version?: string;
}

export interface Submission {
  id: string;
  entry_id: string;
  resume_id: string;
  resume_version_id: string;
  version_number?: number;
  filename?: string;
  sha256?: string;
  channel?: string;
  submitted_at: string;
  notes?: string;
  active?: boolean | number;
  file_url?: string;
  resume_name?: string;
  [key: string]: unknown;
}

export interface Entry {
  id: string;
  url: string;
  kind: "job" | "post" | string;
  title: string;
  company: string;
  excerpt: string;
  recipient: string;
  subject: string;
  body: string;
  send_at: string;
  status: EntryStatus;
  notion_id: string;
  sync_error: string;
  send_error: string;
  created_at: string;
  updated_at: string;
  sent_at: string;
  platform: string;
  apply_method: ApplyMethod;
  apply_url: string;
  needs_review: number | boolean;
  delivery_mode: "local" | "gmail" | string;
  gmail_draft_id: string;
  gmail_account: string;
  gmail_dirty: number | boolean;
  contact_emails: string[];
  post_details: string;
  resume_id: string;
  application_stage: string;
  resume_version_id: string;
  attachment_sha256: string;
  attachment_filename: string;
  attached_at: string;
  resume: Resume | null;
  resume_status: string;
  readiness_status: string;
  resume_version: ResumeVersionRef | null;
  submission: Submission | null;
  analysis: AnalysisSummary;
}

export interface Resume {
  id: string;
  name: string;
  category: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  is_default: boolean;
  available: boolean;
  created_at: string;
  updated_at: string;
  file_url: string;
  preview_url: string;
  version_count: number;
  analysis_count: number;
  current_version_id: string;
  current_version_number: number;
  current_version_source: string;
  extraction_status: string;
  extraction_error: string;
  parse_status: string;
  kind: "master" | "tailored" | string;
  parent_resume_id: string;
  entry_id: string;
  has_draft?: boolean;
  submission_count?: number;
  [key: string]: unknown;
}

export interface ResumeVersion {
  id: string;
  resume_id: string;
  version_number: number;
  original_filename: string;
  sha256: string;
  source: string;
  created_at: string;
  file_url: string;
  is_current?: boolean;
  label?: string;
  note?: string;
  [key: string]: unknown;
}

export interface CodexStatus {
  installed: boolean;
  connected: boolean;
  checked?: boolean;
  model?: string;
  message?: string;
}

export interface AppState {
  entries: Entry[];
  resumes: Resume[];
  application_stage_options: string[];
  notion_connected: boolean;
  notion_data_source_id: string;
  notion_sync_checked_at: string;
  notion_sync_error: string;
  smtp: { host?: string; port?: number | string; username?: string; from?: string };
  smtp_connected: boolean;
  gmail_client_ready: boolean;
  gmail_client_id: string;
  gmail_connected: boolean;
  gmail_address: string;
  candidate_profile: string;
  profile_saved: boolean;
  codex: CodexStatus;
  ats_usage: { calls?: number; cached?: number; [key: string]: unknown };
  local_time: string;
  profile_hash: string;
}

export type MatchStatus = "demonstrated" | "partial" | "listed" | "missing" | "uncertain";
export type Coverage = "represented" | "weak" | "profile_only" | "unsupported";
export type ChecklistState = "pending" | "reviewed" | "addressed";

export interface ProfileEvidence {
  id: string;
  item_id: string;
  kind: string;
  label: string;
  verified?: boolean;
}

export interface Requirement {
  id: string;
  category: string;
  requirement: string;
  mandatory: boolean;
  priority: "high" | "medium" | "low";
  terms?: string[];
  status: MatchStatus;
  previous_status?: MatchStatus;
  explanation: string;
  resume_evidence: { id: string; text: string }[];
  recommendation: string;
  profile_status?: string;
  profile_evidence: ProfileEvidence[];
  coverage: Coverage;
}

export interface AnalysisResult {
  summary: string;
  requirements: Requirement[];
  category_scores: Record<string, { score?: number; weight?: number; [key: string]: unknown } | number>;
  warnings: string[];
  resume_version: number;
  draft?: boolean;
  model?: string;
  scoring_version?: string;
  profile_used?: boolean;
  coverage_counts?: Partial<Record<Coverage, number>>;
  potential_score?: number | null;
  previous?: { id: string; overall_score: number; resume_version: number; completed_at: string } | null;
}

export interface AnalysisEvent {
  percent: number;
  stage: string;
  message: string;
  level: "info" | "success" | "warning" | "error" | string;
  created_at: string;
}

export interface Analysis {
  id: string;
  entry_id: string;
  status: string;
  label?: string;
  resume_version_id: string;
  document_id?: string;
  draft_resume_id?: string;
  overall_score: number | null;
  relevance_score: number | null;
  readability_score: number | null;
  missing_mandatory: number | null;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error_code?: string;
  error_message?: string;
  scoring_version?: string;
  profile_hash?: string;
  result: AnalysisResult | null;
  checklist: Record<string, ChecklistState>;
  events: AnalysisEvent[];
  progress_percent?: number;
  progress_stage?: string;
  progress_message?: string;
  [key: string]: unknown;
}

export interface AnalysisQueueItem {
  id: string;
  entry_id: string;
  status: string;
  title: string;
  company: string;
  created_at: string;
  started_at?: string;
  progress_percent?: number;
  progress_stage?: string;
  progress_message?: string;
  position?: number;
  label?: string;
}

export interface ResumeJob {
  id: string;
  purpose: "resume_structure" | "resume_suggestions" | "score_check" | string;
  resume_id: string;
  analysis_id: string;
  status: "pending" | "running" | "complete" | "failed";
  percent: number;
  message: string;
  error_code: string;
  error_message: string;
  created_at: string;
  completed_at: string;
  result: Record<string, unknown> | null;
}

export const ANALYSIS_RUNNING = new Set(["pending", "analyzing"]);
