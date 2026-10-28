// The only place that knows the pairing key. Every request to the local helper goes through here.

const KEY = "pairingKey";

export function pairingKey(): string {
  try {
    return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

/** A key typed or injected this session; kept in sessionStorage until the helper accepts it. */
export function setSessionKey(value: string) {
  sessionStorage.setItem(KEY, value.trim());
}

/** After a successful request, remember the key across browser restarts. */
export function promoteSessionKey() {
  const value = sessionStorage.getItem(KEY);
  if (value) {
    localStorage.setItem(KEY, value);
    sessionStorage.removeItem(KEY);
  }
}

export function forgetSessionKey() {
  sessionStorage.removeItem(KEY);
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: Record<string, unknown>;
  constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export const OFFLINE_MESSAGE = "The local helper is offline. Run start.cmd and try again.";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  signal?: AbortSignal;
  /** Lets a save finish while the page unloads. */
  keepalive?: boolean;
}

async function send(path: string, method: Method, body: unknown, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { "X-Local-Key": pairingKey() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    return await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
      keepalive: options.keepalive,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(OFFLINE_MESSAGE, 0);
  }
}

async function failure(response: Response, path: string): Promise<ApiError> {
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }
  if (response.status === 404 && path.startsWith("/api/resume") && !payload.error)
    return new ApiError("The running helper is older than this app. Close it, run start.cmd again, then refresh.", 404);
  const message = typeof payload.error === "string" && payload.error ? payload.error : `Request failed (${response.status}).`;
  return new ApiError(message, response.status, payload);
}

export async function api<T>(path: string, method: Method = "GET", body?: unknown, options: RequestOptions = {}): Promise<T> {
  // The helper rejects POST/PATCH without a JSON body, so actions without input send {}.
  const payload = body === undefined && (method === "POST" || method === "PATCH") ? {} : body;
  const response = await send(path, method, payload, options);
  if (!response.ok) throw await failure(response, path);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError("Unexpected response from the local helper.", response.status);
  }
}

/** POST that answers with a file (the PDF preview), plus the response headers. */
export async function apiBlob(path: string, body: unknown, options: RequestOptions = {}) {
  const response = await send(path, "POST", body ?? {}, options);
  if (!response.ok) throw await failure(response, path);
  return { blob: await response.blob(), headers: response.headers };
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
