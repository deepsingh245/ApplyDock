// Resume editor data: the working draft, its suggestions, Master Profile entries and background jobs.
import { useQuery } from "@tanstack/react-query";
import type { EditorJob, EditorState, ProfileEntry, Suggestion } from "@/features/resume-editor/types";
import { api, ApiError, pairingKey } from "@/lib/api";
import { keys } from "./state";
import { ANALYSIS_RUNNING, type Analysis } from "./types";

export const JOB_RUNNING = new Set(["pending", "running"]);

export const draftKeys = {
  suggestions: (resumeId: string, analysisId: string) => ["suggestions", resumeId, analysisId] as const,
  profileEntries: (resumeId: string) => ["profile-entries", resumeId] as const,
};

export const fetchEditorState = (resumeId: string) => api<EditorState>(`/api/resumes/${resumeId}/draft`);

/** Everything the editor shows besides the content itself. Never refetched behind the user's back. */
export function useEditorState(resumeId: string) {
  return useQuery({
    queryKey: keys.draft(resumeId),
    queryFn: () => fetchEditorState(resumeId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}

/** The analysis compared with the draft, polled while it runs. Same cache entry as the analysis screen. */
export function useEditorAnalysis(analysisId: string) {
  return useQuery({
    queryKey: keys.analysis(analysisId),
    queryFn: () => api<{ analysis: Analysis }>(`/api/analyses/${analysisId}`).then((response) => response.analysis),
    enabled: Boolean(analysisId),
    refetchInterval: (query) => (query.state.data && ANALYSIS_RUNNING.has(query.state.data.status) ? 1500 : false),
  });
}

export function useSuggestions(resumeId: string, analysisId: string) {
  return useQuery({
    queryKey: draftKeys.suggestions(resumeId, analysisId),
    queryFn: () =>
      api<{ suggestions: Suggestion[] }>(`/api/resumes/${resumeId}/suggestions?analysis_id=${encodeURIComponent(analysisId)}`).then((response) => response.suggestions ?? []),
    enabled: Boolean(resumeId && analysisId),
  });
}

export function useProfileEntries(resumeId: string) {
  return useQuery({
    queryKey: draftKeys.profileEntries(resumeId),
    queryFn: () => api<{ entries: ProfileEntry[] }>(`/api/resumes/${resumeId}/draft/profile-entries`).then((response) => response.entries ?? []),
    enabled: Boolean(resumeId),
    retry: false,
  });
}

/** A background job (import, suggestions, score check), polled until it finishes. */
export function useJob(jobId: string, interval = 1500) {
  return useQuery({
    queryKey: keys.job(jobId),
    queryFn: () => api<{ job: EditorJob }>(`/api/resume-jobs/${jobId}`).then((response) => response.job),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (!query.state.data || JOB_RUNNING.has(query.state.data.status) ? interval : false),
  });
}

/** GET a file the helper serves (a version PDF) as a blob, authenticated like any API call. */
export async function fetchFile(path: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { "X-Local-Key": pairingKey() } });
  } catch {
    throw new ApiError("The local helper is offline. Run start.cmd and try again.", 0);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      message = ((await response.json()) as { error?: string }).error || message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(message, response.status);
  }
  return response.blob();
}
