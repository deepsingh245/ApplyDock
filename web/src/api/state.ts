import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api, ApiError } from "@/lib/api";
import type { AppState, Entry } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The helper is local: a failure is real (offline, unauthorized), not a flaky network worth retrying.
      retry: (count, error) => error instanceof ApiError && error.status >= 500 && count < 1,
      // Refetching on focus would replace values in forms the user is editing.
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

export const keys = {
  state: ["state"] as const,
  analysis: (id: string) => ["analysis", id] as const,
  analysisQueue: ["analysis-queue"] as const,
  entryAnalyses: (entryId: string) => ["entry-analyses", entryId] as const,
  versions: (resumeId: string) => ["versions", resumeId] as const,
  usage: (resumeId: string) => ["usage", resumeId] as const,
  submissions: (entryId: string) => ["submissions", entryId] as const,
  profile: ["profile"] as const,
  draft: (resumeId: string) => ["draft", resumeId] as const,
  job: (id: string) => ["job", id] as const,
};

export function useAppState(options: { refetchInterval?: number | false | (() => number | false) } = {}) {
  return useQuery({
    queryKey: keys.state,
    queryFn: () => api<AppState>("/api/state"),
    refetchInterval: typeof options.refetchInterval === "function" ? () => (options.refetchInterval as () => number | false)() : options.refetchInterval,
  });
}

/** The loaded state; components below the pairing gate can rely on it being present. */
export function useLoadedState(): AppState {
  const { data } = useAppState();
  if (!data) throw new Error("useLoadedState used before /api/state loaded");
  return data;
}

export function useEntry(entryId?: string | null): Entry | null {
  const { data } = useAppState();
  return (entryId && data?.entries.find((entry) => entry.id === entryId)) || null;
}

/** Re-fetch /api/state and wait for it, so callers can act on fresh data. */
export function useReloadState() {
  const client = useQueryClient();
  return useCallback(() => client.refetchQueries({ queryKey: keys.state, type: "active" }).then(() => client.getQueryData<AppState>(keys.state)), [client]);
}
