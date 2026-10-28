// Shapes of the resume editor payloads (applydock/resume_workflows.editor_state, resume_model, resume_store).

export interface Line {
  id: string;
  text: string;
}

export interface Profile {
  id: string;
  network: string;
  url: string;
}

export interface Basics {
  name: string;
  label: string;
  email: string;
  phone: string;
  location: string;
  url: string;
  summary: string;
  profiles: Profile[];
  [key: string]: unknown;
}

/** A section entry; the fields present depend on the section (see ITEM_FIELDS). */
export interface Item {
  id: string;
  highlights?: Line[];
  items?: Line[];
  keywords?: string[];
  courses?: string[];
  [key: string]: unknown;
}

export const SECTIONS = ["work", "projects", "skills", "education", "certificates", "awards", "custom"] as const;
export type ListSection = (typeof SECTIONS)[number];
export type Section = ListSection | "summary";

export type Layout = Record<string, string | number | boolean>;

export interface Meta {
  template: string;
  paper: string;
  page_limit: number;
  section_order: Section[];
  section_titles: Record<string, string>;
  layout: Layout;
  [key: string]: unknown;
}

export interface ResumeContent {
  basics: Basics;
  work: Item[];
  projects: Item[];
  skills: Item[];
  education: Item[];
  certificates: Item[];
  awards: Item[];
  custom: Item[];
  meta: Meta;
  [key: string]: unknown;
}

/** Everything about the working draft except its content. */
export interface DraftMeta {
  resume_id?: string;
  revision: number;
  content_hash: string;
  needs_review?: boolean | number;
  import_source?: string;
  import_warnings?: string[];
  base_version_id?: string;
}

export interface Draft extends DraftMeta {
  content: ResumeContent;
}

export interface EditorVersion {
  id: string;
  version_number: number;
  source: string;
  label?: string;
  original_filename: string;
  created_at: string;
  sha256: string;
  is_current: boolean;
  has_content?: boolean;
  available?: boolean;
  validation?: Validation | null;
  [key: string]: unknown;
}

export interface Validation {
  ok: boolean;
  page_count: number;
  links_found: number;
  warnings: string[];
}

export interface EditorJob {
  id: string;
  purpose: string;
  status: "pending" | "running" | "complete" | "failed";
  percent: number;
  message: string;
  error_message: string;
  result: Record<string, unknown> | null;
}

export interface EditorState {
  draft: Draft;
  resume: {
    id: string;
    name: string;
    kind: "master" | "tailored" | string;
    entry_id: string;
    parent_resume_id: string;
    [key: string]: unknown;
  };
  versions: EditorVersion[];
  base_content_hash: string;
  templates: { id: string; label: string; description: string }[];
  renderer: { available: boolean; message?: string };
  design: {
    presets: Record<string, Layout>;
    ranges: Record<string, [number, number]>;
    choices: { font: string[]; bullet: string[]; contact_separator: string[]; [key: string]: string[] };
    accents: string[];
  };
  import: { structured_status: string; extraction_status: string; extraction_error: string; job: EditorJob | null };
  parent: { id: string; name: string; deleted: boolean; current_version_id: string } | null;
  entry: { id: string; title: string; company: string } | null;
}

export interface GuardFlag {
  type: string;
  value: string;
}

export interface Suggestion {
  id: string;
  analysis_id: string;
  requirement_id: string;
  requirement?: string;
  target_id: string;
  field: string;
  operation: "replace" | "insert_after" | "add_keyword" | "add_project";
  original_text: string;
  proposed_text: string;
  applied_text?: string;
  reason?: string;
  status: "pending" | "accepted" | "edited" | "rejected" | string;
  stale?: boolean;
  needs_verification?: boolean;
  guard_flags?: GuardFlag[];
  source?: { item_id: string; label: string; verified: boolean } | null;
  project?: { name: string; keywords?: string[]; url?: string } | null;
}

export interface ProfileEntry {
  key: string;
  item_id: string;
  kind: string;
  label: string;
  detail?: string;
  verified: boolean;
  in_resume: boolean;
  addable: boolean;
  reason?: string;
}

export interface Change {
  type: string;
  label: string;
  section: string;
  field: string;
  before?: string;
  after?: string;
}

export interface ScoreCheckResult {
  overall_score: number;
  baseline_score?: number;
  analysis_id?: string;
  content_hash?: string;
  full?: boolean;
  applied_suggestions?: number;
  rechecked: number;
  kept: number;
  changes: { id: string; requirement: string; from: string; to: string }[];
  rechecked_items?: { id: string; requirement: string; from: string; to: string; explanation?: string }[];
}

export type SidePanelName = "preview" | "versions" | "compare" | "analysis" | "profile";
export type SaveStatus = "saved" | "saving" | "unsaved" | "error" | "conflict";
