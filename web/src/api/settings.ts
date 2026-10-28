import { api } from "@/lib/api";
import type { CodexStatus } from "./types";

export interface CodexCheck {
  codex: CodexStatus;
  usage: Record<string, unknown>;
}

export const settingsApi = {
  saveNotion: (body: { data_source_id: string; token: string }) => api("/api/settings/notion", "POST", body),
  saveSmtp: (body: { host: string; port: string; username: string; from: string; password: string }) => api("/api/settings/smtp", "POST", body),
  saveProfileText: (body: { profile: string }) => api("/api/settings/profile", "POST", body),
  saveGmailClient: (client: unknown) => api("/api/settings/gmail/client", "POST", client),
  connectGmail: () => api<{ authorization_url: string }>("/api/settings/gmail/connect", "POST"),
  checkCodex: () => api<CodexCheck>("/api/settings/codex/check", "POST"),
  sync: () => api<{ reconciliation?: { error?: string; updated?: number; removed?: number } }>("/api/sync", "POST"),
  setDefaultResume: (resumeId: string) => api(`/api/resumes/${resumeId}`, "PATCH", { is_default: true }),
};
