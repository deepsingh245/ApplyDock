export const agentIds = {
  runAnalysis: "application.run-analysis",
  approveApplication: "application.approve",
  viewAnalysis: "application.view-analysis",
  optimizeResume: "resume.optimize",
  recordSubmission: "application.record-submission",
  saveGmailDraft: "application.save-gmail-draft",
  prepareGmailSchedule: "application.prepare-gmail-schedule",
  confirmGmailSchedule: "application.confirm-gmail-schedule",
  draftEmail: "application.draft-email",
  copyEmailPrompt: "application.copy-email-prompt",
  saveApplication: "application.save",
  saveResumeVersion: "resume.save-version",
  tailorResume: "resume.tailor",
  checkResumeScore: "resume.check-score",
  requestResumeSuggestions: "resume.request-suggestions",
  cancelJob: "job.cancel",
} as const;

export const entryActionAgentIds = {
  "ats-run": agentIds.runAnalysis,
  "ats-view": agentIds.viewAnalysis,
  "optimize-resume": agentIds.optimizeResume,
  "record-submission": agentIds.recordSubmission,
  "gmail-draft": agentIds.saveGmailDraft,
  "gmail-prepare": agentIds.prepareGmailSchedule,
  "gmail-scheduled": agentIds.confirmGmailSchedule,
  "ai-draft": agentIds.draftEmail,
  "ai-copy": agentIds.copyEmailPrompt,
  approve: agentIds.approveApplication,
} as const;

export function entryActionAgentId(action: string) {
  return Object.hasOwn(entryActionAgentIds, action)
    ? entryActionAgentIds[action as keyof typeof entryActionAgentIds]
    : undefined;
}

export type AgentId = (typeof agentIds)[keyof typeof agentIds];

export function applicationIdentity(entry: { title?: string; company?: string; kind?: string; excerpt?: string; url?: string; recipient?: string }) {
  const generic = new Set(["hiring post", "job opportunity"]);
  const role = generic.has((entry.title || "").trim().toLowerCase()) ? "" : (entry.title || "").trim();
  const company = (entry.company || "").trim();
  if (company && role) return `${company} — ${role}`;
  const activity = entry.url?.match(/(?:_activity-|activity-)(\d+)/)?.[1];
  const excerpt = entry.excerpt?.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 2);
  const fallback = excerpt || (activity ? `LinkedIn activity ${activity}` : "") || entry.recipient?.split("@").at(-1) || "Application";
  return company && role ? `${company} — ${role}` : fallback;
}
