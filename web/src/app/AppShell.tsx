import { useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useReducer } from "react";
import { Outlet } from "react-router";
import { keys, useAppState } from "@/api/state";
import { usePairedSignal } from "@/bridge/extension";
import { Spinner } from "@/components/ui/misc";
import { notify } from "@/components/ui/toaster";
import type { AppState } from "@/api/types";
import { api, ApiError, forgetSessionKey, OFFLINE_MESSAGE, pairingKey, promoteSessionKey, setSessionKey } from "@/lib/api";
import { ExtensionOpenHandler } from "./ExtensionOpenHandler";
import { PairingScreen } from "./PairingScreen";
import { TopBar } from "./TopBar";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 p-12 text-sm text-ink-2">
      <Spinner />
      {label}
    </div>
  );
}

/** The paired app: top bar + current screen. Shows the pairing screen until /api/state accepts the key. */
export function AppShell() {
  const client = useQueryClient();
  // The key lives in storage; re-render after we change it ourselves, or when the extension signals it wrote one.
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const paired = usePairedSignal();
  const hasKey = Boolean(pairingKey());
  const state = useAppState();
  const unauthorized = state.error instanceof ApiError && state.error.status === 401;

  // reset (not invalidate): a key-less request still in flight would otherwise land after the key and show "not accepted".
  useEffect(() => {
    if (paired > 0) void client.resetQueries({ queryKey: keys.state });
  }, [paired, client]);

  useEffect(() => {
    if (state.data) promoteSessionKey();
  }, [state.data]);

  const pair = async (value: string) => {
    setSessionKey(value);
    rerender();
    const result = await client.fetchQuery({ queryKey: keys.state, queryFn: () => api<AppState>("/api/state") }).catch((error: unknown) => error);
    if (result instanceof Error) {
      forgetSessionKey();
      rerender();
      notify(result.message, true);
    } else notify("Connected to your local workspace.");
  };

  let body;
  if (!hasKey || unauthorized) body = <PairingScreen error={unauthorized ? "That pairing key was not accepted. Copy it again from the helper window." : undefined} onPair={pair} />;
  else if (state.isPending) body = <Loading label="Connecting to your local helper…" />;
  else if (state.error && !state.data)
    body = (
      <main className="grid flex-1 place-items-center p-8 text-center text-sm text-ink-2" role="alert">
        <div className="grid gap-2">
          <strong className="text-lg text-ink">Can’t reach the local helper</strong>
          <span>{state.error.message || OFFLINE_MESSAGE}</span>
        </div>
      </main>
    );
  else
    body = (
      <Suspense fallback={<Loading />}>
        <ExtensionOpenHandler />
        <Outlet />
      </Suspense>
    );

  return (
    <div className="flex h-full min-h-0 flex-col" id="app-view">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  );
}
