export const agentIds = {
  runAnalysis: "application.run-analysis",
  approveApplication: "application.approve",
  saveResumeVersion: "resume.save-version",
  tailorResume: "resume.tailor",
  cancelJob: "job.cancel",
} as const;

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
