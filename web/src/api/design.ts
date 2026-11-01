import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DesignOptions, Layout } from "@/features/resume-design/DesignControls";
import { keys } from "./state";

/** The look of a resume without its text (applydock/resume_model.DESIGN_KEYS). */
export interface ResumeDesign {
  template: string;
  paper: string;
  page_limit: number;
  layout: Layout;
  section_order: string[];
  section_titles: Record<string, string>;
}

export type DesignMode = "default" | "last";

export interface DesignSettings {
  /** "default": new resumes use `default`; "last": they copy the design last edited in the editor. */
  mode: DesignMode;
  default: ResumeDesign | null;
  default_updated_at: string;
  last: ResumeDesign | null;
  last_updated_at: string;
  /** What the next new resume will get (null: it keeps its master's design). */
  effective: ResumeDesign | null;
  factory: ResumeDesign;
  options: DesignOptions & { papers: string[]; section_titles: Record<string, string> };
}

export function useDesignSettings() {
  return useQuery({ queryKey: keys.resumeDesign, queryFn: () => api<DesignSettings>("/api/resume-design") });
}

export function useUpdateDesignSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { mode?: DesignMode; design?: ResumeDesign; from_resume_id?: string }) => api<DesignSettings>("/api/resume-design", "PATCH", body),
    onSuccess: (settings) => client.setQueryData(keys.resumeDesign, settings),
  });
}

/** Key-order independent comparison, so a design read back from the server matches the one on screen. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  return value;
}

export const DESIGN_KEYS = ["template", "paper", "page_limit", "layout", "section_order", "section_titles"] as const;

export function designOf(meta: Record<string, unknown>): ResumeDesign {
  return Object.fromEntries(DESIGN_KEYS.map((key) => [key, meta[key]])) as unknown as ResumeDesign;
}

export function sameDesign(a: ResumeDesign | null | undefined, b: ResumeDesign | null | undefined) {
  return Boolean(a && b) && JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
