// The Chrome extension opens this page and injects two window events into it (extension/sidepanel.js
// openWebWorkspace): "applydock-paired" after writing the pairing key to sessionStorage, then optionally
// "applydock-open" with {entryId, action}. The injection can happen before React has rendered, so the
// listeners are registered when this module is imported (before the first render) and the request is kept
// until the app is ready to act on it.
import { useSyncExternalStore } from "react";

export type OpenAction = "profile" | "analysis" | "optimize" | "submission" | "";
export interface OpenRequest {
  entryId: string;
  action: OpenAction;
}

let pairedCount = 0;
let pending: OpenRequest | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

window.addEventListener("applydock-paired", () => {
  pairedCount += 1;
  emit();
});

window.addEventListener("applydock-open", (event) => {
  const detail = (event as CustomEvent<Partial<OpenRequest>>).detail ?? {};
  pending = { entryId: String(detail.entryId ?? ""), action: (detail.action ?? "") as OpenAction };
  emit();
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Increments each time the extension hands over a pairing key. */
export const usePairedSignal = () => useSyncExternalStore(subscribe, () => pairedCount);

export const useOpenRequest = () => useSyncExternalStore(subscribe, () => pending);

/** Claim the pending request so it is handled once. */
export function takeOpenRequest(): OpenRequest | null {
  const request = pending;
  pending = null;
  emit();
  return request;
}
