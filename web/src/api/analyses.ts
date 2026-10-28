import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { keys } from "./state";
import { ANALYSIS_RUNNING, type Analysis, type AnalysisQueueItem, type ChecklistState } from "./types";

/** One row of an application's analysis history (GET /api/entries/{id}/analyses; no result payload). */
export interface AnalysisHistoryItem {
  id: string;
  status: string;
  label: string;
  overall_score: number | null;
  created_at: string;
  completed_at?: string;
  scoring_version?: string;
  [key: string]: unknown;
}

const POLL_MS = 1200;

export const isRunning = (analysis?: Pick<Analysis, "status"> | null) => Boolean(analysis && ANALYSIS_RUNNING.has(analysis.status));

/** One analysis run. poll: keep refreshing (while it runs, or while other analyses are queued). */
export function useAnalysis(id: string | undefined, poll = false) {
  return useQuery({
    queryKey: keys.analysis(id ?? ""),
    queryFn: () => api<{ analysis: Analysis }>(`/api/analyses/${id}`).then((response) => response.analysis),
    enabled: Boolean(id),
    refetchInterval: (query) => (poll || isRunning(query.state.data) ? POLL_MS : false),
  });
}

export function useAnalysisQueue(poll: boolean) {
  return useQuery({
    queryKey: keys.analysisQueue,
    queryFn: () => api<{ queue: AnalysisQueueItem[] }>("/api/analyses/queue").then((response) => response.queue ?? []),
    refetchInterval: (query) => (poll || (query.state.data?.length ?? 0) > 0 ? POLL_MS : false),
  });
}

export function useEntryAnalyses(entryId: string | undefined, refreshKey?: string) {
  return useQuery({
    queryKey: [...keys.entryAnalyses(entryId ?? ""), refreshKey ?? ""],
    queryFn: () => api<{ analyses: AnalysisHistoryItem[] }>(`/api/entries/${entryId}/analyses`).then((response) => response.analyses ?? []),
    enabled: Boolean(entryId),
  });
}

/** Set a recommendation's checklist state; the response is the updated analysis. */
export function useSetChecklist(analysisId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ requirementId, state }: { requirementId: string; state: ChecklistState }) =>
      api<{ analysis: Analysis }>(`/api/analyses/${analysisId}/recommendations/${requirementId}`, "PATCH", { state }).then((response) => response.analysis),
    onSuccess: (analysis) => client.setQueryData(keys.analysis(analysisId), analysis),
  });
}
