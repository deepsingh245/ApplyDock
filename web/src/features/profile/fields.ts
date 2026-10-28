// Master Profile form schema: which fields each kind has and how each is edited. Mirrors applydock/profile.py FIELDS;
// the helper validates and cleans everything, so this only decides presentation.
import type { ProfileKind, Verification } from "@/api/profile";

export type FieldType = "text" | "url" | "long" | "lines" | "list" | "choice" | "bool" | "claims" | "ids";

export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  /** Help text (text-like fields), option labels (choice), or linkable kinds (ids). */
  help?: string;
  choices?: Record<string, string>;
  kinds?: ProfileKind[];
}

export const PROFILE_SECTIONS = [
  ["personal", "Personal details"],
  ["experience", "Experience"],
  ["projects", "Projects"],
  ["skills", "Skills & achievements"],
  ["verification", "Verification"],
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number][0];

export const isProfileSection = (value: unknown): value is ProfileSection => PROFILE_SECTIONS.some(([key]) => key === value);

/** The section that lists items of a kind (everything that is not experience or a project lives under skills). */
export const sectionFor = (kind: ProfileKind): ProfileSection => (kind === "experience" ? "experience" : kind === "project" ? "projects" : kind === "personal" ? "personal" : "skills");

export const VERIFICATION_LABELS: Record<Verification, string> = { verified: "Verified", unverified: "Unverified", needs_review: "Needs review" };
export const LINK_LABELS: Record<string, string> = {
  reachable: "Reachable",
  redirected: "Redirected",
  auth_required: "Sign-in required",
  unreachable: "Unreachable",
  could_not_verify: "Could not verify",
  not_checked: "Not checked",
};
export const LINK_TONES: Record<string, "success" | "warn" | "danger" | "neutral"> = {
  reachable: "success",
  redirected: "success",
  auth_required: "warn",
  unreachable: "danger",
  could_not_verify: "warn",
  not_checked: "neutral",
};
export const LINK_FIELD_LABELS: Record<string, string> = { live_url: "Live app", repo_url: "Source", docs_url: "Docs" };
export const FUNCTIONAL_LABELS: Record<string, string> = {
  not_verified: "Not tested",
  working: "Tested and working",
  partial: "Partially working",
  not_working: "Not working",
};
export const PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: "Planning",
  in_development: "In development",
  completed: "Completed",
  maintained: "Maintained",
  archived: "Archived",
};
export const SKILL_CATEGORY_LABELS: Record<string, string> = {
  languages: "Languages",
  frameworks: "Frameworks & libraries",
  backend: "Backend",
  databases: "Databases",
  cloud: "Cloud",
  devops: "DevOps & tools",
  testing: "Testing",
  architecture_security: "Architecture & security",
  domain: "Domain",
  other: "Other",
};
export const EMPLOYMENT_LABELS: Record<string, string> = {
  "": "Not set",
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  freelance: "Freelance",
  other: "Other",
};
export const KIND_LABELS: Record<ProfileKind, string> = {
  personal: "personal details",
  experience: "experience",
  project: "project",
  skill: "skill",
  achievement: "achievement",
  education: "education",
  certification: "certification",
};

const f = (name: string, label: string, type: FieldType = "text", extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, label, type, ...extra });

export const PROFILE_FIELDS: Record<ProfileKind, FieldSpec[]> = {
  personal: [
    f("name", "Full name"),
    f("headline", "Professional headline"),
    f("email", "Email"),
    f("phone", "Phone"),
    f("location", "Location"),
    f("website", "Portfolio website", "url"),
    f("github", "GitHub profile", "url"),
    f("linkedin", "LinkedIn profile", "url"),
    f("preferred_roles", "Preferred roles", "list", { help: "Comma-separated, for example Backend Engineer, Full-stack Engineer" }),
    f("summary", "Professional summary", "long"),
  ],
  experience: [
    f("company", "Company"),
    f("title", "Job title"),
    f("start", "Start", "text", { help: "For example 2022-03" }),
    f("end", "End", "text", { help: "Leave empty if current" }),
    f("employment_type", "Employment type", "choice", { choices: EMPLOYMENT_LABELS }),
    f("location", "Location"),
    f("summary", "Summary", "long"),
    f("responsibilities", "Responsibilities", "lines", { help: "One per line" }),
    f("technologies", "Technologies used", "list", { help: "Comma-separated" }),
    f("achievements", "Achievements and results", "claims"),
    f("project_ids", "Projects from this role", "ids", { kinds: ["project"] }),
  ],
  project: [
    f("name", "Project name"),
    f("category", "Category", "text", { help: "For example web app, CLI, library" }),
    f("summary", "Short description"),
    f("status", "Status", "choice", { choices: PROJECT_STATUS_LABELS }),
    f("description", "Detailed description", "long"),
    f("role", "Your role and contributions", "long"),
    f("technologies", "Technology stack", "list", { help: "Comma-separated" }),
    f("architecture", "Architecture and engineering highlights", "long"),
    f("features", "Features implemented", "lines", { help: "One per line" }),
    f("challenges", "Technical challenges solved", "long"),
    f("deployment", "Deployment", "text", { help: "For example Vercel, Firebase Hosting, AWS ECS" }),
    f("live_url", "Live application URL", "url"),
    f("repo_url", "Source code URL", "url"),
    f("docs_url", "Documentation URL", "url"),
    f("start", "Started", "text", { help: "For example 2023-01" }),
    f("end", "Completed"),
    f("experience_id", "Built during", "ids", { kinds: ["experience"] }),
    f("resume_ready", "Can be used in a resume", "bool"),
    f("achievements", "Achievement bullets", "claims"),
    f("evidence", "Evidence for technical claims", "long", { help: "Links, metric sources, or notes that back up the claims" }),
  ],
  skill: [
    f("name", "Skill"),
    f("category", "Category", "choice", { choices: SKILL_CATEGORY_LABELS }),
    f("evidence_ids", "Demonstrated in", "ids", { kinds: ["project", "experience"] }),
    f("notes", "Notes"),
  ],
  achievement: [
    f("text", "Achievement", "long"),
    f("date", "Date"),
    f("evidence", "Evidence", "long"),
    f("related_ids", "Related to", "ids", { kinds: ["project", "experience"] }),
  ],
  education: [f("institution", "Institution"), f("degree", "Degree"), f("field", "Field of study"), f("start", "Start"), f("end", "End"), f("details", "Details", "long")],
  certification: [f("name", "Certification"), f("issuer", "Issuer"), f("date", "Date"), f("url", "Credential URL", "url"), f("credential_id", "Credential ID")],
};

/** Form values: lists and lines are edited as text; claims as rows; ids as checked ids. */
export type FormValue = string | boolean | string[] | ClaimRow[];
export interface ClaimRow {
  // Not `id`: useFieldArray reserves that key for its own row identity.
  claimId: string;
  text: string;
  verified: boolean;
}
export type ProfileFormValues = Record<string, FormValue> & { __verification: Verification };

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function toFormValues(kind: ProfileKind, data: Record<string, unknown>, verification: Verification): ProfileFormValues {
  const values: Record<string, FormValue> = {};
  for (const spec of PROFILE_FIELDS[kind]) {
    const value = data[spec.name];
    if (spec.type === "bool") values[spec.name] = value === undefined || value === null ? spec.name === "resume_ready" : Boolean(value);
    else if (spec.type === "claims")
      values[spec.name] = asArray(value).map((claim) => {
        const item = claim as Partial<ClaimRow>;
        return { claimId: String((claim as { id?: unknown }).id ?? ""), text: String(item.text ?? ""), verified: Boolean(item.verified) };
      });
    else if (spec.type === "ids") values[spec.name] = asArray(value).map(String);
    else if (spec.type === "lines") values[spec.name] = asArray(value).map(String).join("\n");
    else if (spec.type === "list") values[spec.name] = asArray(value).map(String).join(", ");
    else values[spec.name] = value === undefined || value === null ? "" : String(value);
  }
  return { ...values, __verification: verification } as ProfileFormValues;
}

/** Shape the request payload exactly like the classic dashboard: blank claims dropped, lines split, lists as text. */
export function fromFormValues(kind: ProfileKind, values: ProfileFormValues): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const spec of PROFILE_FIELDS[kind]) {
    const value = values[spec.name];
    if (spec.type === "claims")
      data[spec.name] = (value as ClaimRow[])
        .filter((claim) => claim.text.trim())
        .map((claim) => ({ id: claim.claimId || undefined, text: claim.text, verified: claim.verified }));
    else if (spec.type === "lines") data[spec.name] = String(value ?? "").split("\n");
    else data[spec.name] = value;
  }
  return data;
}
