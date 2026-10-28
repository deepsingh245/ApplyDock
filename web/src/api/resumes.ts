import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { keys } from "./state";
import type { ResumeVersion } from "./types";

export interface ResumeVersionDetail extends ResumeVersion {
  available?: boolean;
  extraction_status?: string;
}

export interface UsageSubmission {
  id: string;
  entry_id: string;
  resume_id: string;
  title: string;
  company: string;
  version_number: number;
  submitted_at: string;
  channel_label: string;
  file_url: string;
}

export interface UsageApplication {
  id: string;
  title: string;
  company: string;
  version_number: number | null;
}

export interface ResumeUsage {
  submissions: UsageSubmission[];
  applications: UsageApplication[];
}

export function useResumeVersions(resumeId: string | undefined) {
  return useQuery({
    queryKey: keys.versions(resumeId ?? ""),
    queryFn: () => api<{ versions: ResumeVersionDetail[] }>(`/api/resumes/${resumeId}/versions`).then((response) => response.versions ?? []),
    enabled: Boolean(resumeId),
  });
}

/** Where a resume was sent; loaded only when the user opens the list. */
export function useResumeUsage(resumeId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.usage(resumeId ?? ""),
    queryFn: () => api<ResumeUsage>(`/api/resumes/${resumeId}/usage`),
    enabled: Boolean(resumeId) && enabled,
  });
}
