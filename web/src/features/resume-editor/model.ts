import type { Item, Line, ListSection, Profile, ResumeContent, Section } from "./types";

export const SECTION_LABELS: Record<Section, string> = {
  summary: "Summary",
  skills: "Skills",
  work: "Experience",
  projects: "Projects",
  education: "Education",
  certificates: "Certifications",
  awards: "Awards",
  custom: "Additional sections",
};

export const SOURCE_LABELS: Record<string, string> = { upload: "Uploaded original", editor: "Saved in editor", tailor_seed: "Copied from master" };

export type FieldKind = "text" | "textarea" | "keywords";
export interface FieldSpec {
  name: string;
  label: string;
  placeholder?: string;
  kind?: FieldKind;
}

const f = (name: string, label: string, placeholder = "", kind: FieldKind = "text"): FieldSpec => ({ name, label, placeholder, kind });

export const ITEM_FIELDS: Record<ListSection, FieldSpec[]> = {
  work: [f("position", "Job title"), f("name", "Company"), f("location", "Location"), f("startDate", "Start", "Mar 2022"), f("endDate", "End", "Present"), f("summary", "Role summary", "", "textarea")],
  projects: [f("name", "Project name"), f("url", "Link", "https://"), f("startDate", "Start"), f("endDate", "End"), f("description", "Description", "", "textarea"), f("keywords", "Technologies", "React, Node.js", "keywords")],
  skills: [f("name", "Group", "Languages"), f("keywords", "Skills", "TypeScript, React, SQL", "keywords")],
  education: [f("institution", "Institution"), f("studyType", "Degree", "B.S."), f("area", "Field of study"), f("startDate", "Start"), f("endDate", "End"), f("score", "Grade or honors"), f("courses", "Relevant courses", "", "keywords")],
  certificates: [f("name", "Certification"), f("issuer", "Issuer"), f("date", "Date"), f("url", "Link", "https://")],
  awards: [f("title", "Award"), f("awarder", "Awarded by"), f("date", "Date"), f("summary", "Details", "", "textarea")],
  custom: [f("title", "Section heading", "Volunteering")],
};

export const ADD_LABELS: Record<ListSection, string> = {
  work: "experience",
  projects: "project",
  skills: "skill group",
  education: "education",
  certificates: "certification",
  awards: "award",
  custom: "section",
};

const PREFIX: Record<ListSection, string> = { work: "w", projects: "pr", skills: "s", education: "e", certificates: "c", awards: "a", custom: "cu" };

export function newId(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function newItem(section: ListSection): Item {
  const id = newId(PREFIX[section]);
  switch (section) {
    case "work":
      return { id, position: "", name: "", location: "", startDate: "", endDate: "", summary: "", highlights: [{ id: newId("h"), text: "" }] };
    case "projects":
      return { id, name: "", url: "", startDate: "", endDate: "", description: "", highlights: [], keywords: [] };
    case "skills":
      return { id, name: "", keywords: [] };
    case "education":
      return { id, institution: "", studyType: "", area: "", startDate: "", endDate: "", score: "", courses: [] };
    case "certificates":
      return { id, name: "", issuer: "", date: "", url: "" };
    case "awards":
      return { id, title: "", awarder: "", date: "", summary: "" };
    case "custom":
      return { id, title: "", items: [{ id: newId("ci"), text: "" }] };
  }
}

export const LIST_FIELDS = new Set(["keywords", "courses"]);

export interface Found {
  node: Record<string, unknown>;
  list: (Item | Line | Profile)[] | null;
  section: ListSection | "basics";
}

/** Locate any editable node (basics, a profile, an item, or a bullet/line) by id. */
export function findTarget(content: ResumeContent, id: string): Found | null {
  if (id === "basics") return { node: content.basics, list: null, section: "basics" };
  for (const profile of content.basics.profiles) if (profile.id === id) return { node: profile as unknown as Record<string, unknown>, list: content.basics.profiles, section: "basics" };
  for (const section of ["work", "projects", "skills", "education", "certificates", "awards", "custom"] as const) {
    for (const item of content[section]) {
      if (item.id === id) return { node: item, list: content[section], section };
      for (const key of ["highlights", "items"] as const)
        for (const child of item[key] ?? []) if (child.id === id) return { node: child as unknown as Record<string, unknown>, list: item[key]!, section };
    }
  }
  return null;
}

export function sectionEmpty(content: ResumeContent, section: Section) {
  return section === "summary" ? !content.basics.summary : !(content[section] ?? []).length;
}

export function sectionTitle(content: ResumeContent, section: Section) {
  return section === "custom" ? SECTION_LABELS.custom : content.meta.section_titles[section] || SECTION_LABELS[section];
}

export function moveInList<T>(list: T[], index: number, dir: number) {
  const target = index + dir;
  if (index < 0 || target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target]!, list[index]!];
}

export function itemTitle(section: ListSection, item: Item) {
  const value = item.position || item.name || item.institution || item.title;
  return typeof value === "string" && value ? value : `New ${SECTION_LABELS[section].toLowerCase().replace(/s$/, "")}`;
}

export function itemFilled(item: Item) {
  return Object.entries(item).some(([key, value]) => key !== "id" && (Array.isArray(value) ? value.length : value));
}

export const UNITS: Record<string, string> = { font_size: "pt", name_size: "pt", heading_size: "pt", margin_x: "mm", margin_y: "mm", line_height: "", section_gap: "em", entry_gap: "em", bullet_gap: "em" };
export const STEPS: Record<string, number> = { font_size: 0.25, name_size: 0.5, heading_size: 0.25, margin_x: 0.5, margin_y: 0.5, line_height: 0.05, section_gap: 0.05, entry_gap: 0.05, bullet_gap: 0.05 };
export const FONT_LABELS: Record<string, string> = { Carlito: "Sans · Carlito", "Libertinus Serif": "Serif · Libertinus", "New Computer Modern": "Classic · Computer Modern" };

export const PROFILE_GROUPS: [string, string][] = [
  ["personal", "Summary and headline"],
  ["experience", "Experience"],
  ["project", "Projects"],
  ["skill", "Skills"],
  ["achievement", "Achievements"],
  ["education", "Education"],
  ["certification", "Certifications"],
];
