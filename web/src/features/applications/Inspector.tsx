import { useWatch, type Control } from "react-hook-form";
import { useLoadedState } from "@/api/state";
import type { Entry } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Eyebrow, KeyValue, Meter, ScoreFigure } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill, toneFor } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { deliveryCategory, deliveryLabel, needsAction, profileChangedSince } from "@/lib/domain";
import { dateLabel, plural } from "@/lib/format";
import { isEditable, type EntryForm } from "./form";
import type { EntryAction } from "./useEntryActions";

interface ActionButton {
  action: EntryAction;
  label: string;
  kind: "secondary" | "quiet";
}

/** The ordered next steps for an application; the first secondary one is promoted to the primary button. */
export function nextActions(entry: Entry, profileHash: string): ActionButton[] {
  const analysis = entry.analysis ?? { status: "not_analyzed", label: "Not analyzed", stale: false };
  // Once a submission is recorded, delivery actions are hidden so the same application is not sent twice.
  const email = isEditable(entry) && entry.apply_method === "email" && !entry.submission;
  const profileChanged = profileChangedSince(analysis, profileHash);
  const actions: ActionButton[] = [];
  const add = (action: EntryAction, label: string, kind: ActionButton["kind"] = "secondary") => actions.push({ action, label, kind });
  if (!analysis.id || analysis.stale) add("ats-run", analysis.id ? "Run analysis again" : "Run analysis");
  else if (profileChanged) add("ats-run", "Re-run with updated profile");
  if (analysis.status === "complete" && entry.resume?.available) add("optimize-resume", "Optimize resume");
  if (email) {
    if (!entry.gmail_draft_id || entry.gmail_dirty) add("gmail-draft", entry.gmail_draft_id ? "Update Gmail draft" : "Save to Gmail Drafts");
    if (entry.delivery_mode === "gmail_schedule_pending" && !entry.gmail_dirty) add("gmail-scheduled", "I scheduled it in Gmail");
    add("gmail-prepare", "Prepare Gmail schedule");
    if (entry.delivery_mode === "local") add(entry.status === "approved" ? "unapprove" : "approve", entry.status === "approved" ? "Remove local approval" : "Approve local 9 AM");
  }
  if (analysis.id && !analysis.stale && !profileChanged) add("ats-run", "Run analysis again");
  if (email) {
    add("ai-draft", "Draft email with Codex", "quiet");
    add("ai-copy", "Copy prompt", "quiet");
  }
  // A Gmail draft or schedule is not proof of sending; the user confirms the submission explicitly.
  if (!entry.submission && entry.status !== "sending")
    add("record-submission", entry.delivery_mode === "gmail_scheduled" ? "Confirm it was sent" : "Mark as submitted", entry.delivery_mode === "gmail_scheduled" ? "secondary" : "quiet");
  return actions;
}

function EmailPreview({ control, entry }: { control: Control<EntryForm>; entry: Entry }) {
  const state = useLoadedState();
  const [subject, recipient, body, resumeId] = useWatch({ control, name: ["subject", "recipient", "body", "resume_id"] });
  const resume = state.resumes.find((item) => item.id === resumeId);
  const exact = entry.resume_version && entry.resume_id === resumeId ? ` · v${entry.resume_version.version_number} · ${entry.resume_version.filename}` : "";
  return (
    <div className="grid gap-1 rounded-sm border border-line bg-surface p-3 text-sm" data-testid="email-preview">
      <strong className="text-ink">{subject || "Your subject"}</strong>
      <span className="text-xs text-ink-2">To: {recipient || "Recipient not set"}</span>
      <span className="text-xs text-ink-2">Resume: {resume ? resume.name + exact : "Resume Missing"}</span>
      <p className="m-0 mt-1 line-clamp-12 whitespace-pre-wrap text-ink-2">{body || "Your email will appear here as you write."}</p>
    </div>
  );
}

export function Inspector({
  entry,
  control,
  onAction,
  busy,
  aiNotes,
}: {
  entry: Entry | null;
  /** The open application's form (absent when nothing is selected). */
  control?: Control<EntryForm>;
  onAction: (action: EntryAction) => void;
  busy: EntryAction | null;
  aiNotes: string;
}) {
  const state = useLoadedState();
  if (!entry)
    return (
      <div className="grid gap-2 p-4">
        <Eyebrow>Next step</Eyebrow>
        <p className="m-0 text-sm text-ink-2">
          {state.entries.some(needsAction) ? "Select an application to see its status, match score, and delivery actions." : "Nothing needs action. Add a job when you find the next one."}
        </p>
      </div>
    );

  const analysis = entry.analysis ?? { status: "not_analyzed", label: "Not analyzed", stale: false };
  const profileChanged = profileChangedSince(analysis, state.profile_hash);
  const actions = nextActions(entry, state.profile_hash);
  const primary = actions.findIndex((item) => item.kind === "secondary");
  const notionId = /^[a-f0-9-]{32,36}$/i.test(entry.notion_id || "") ? entry.notion_id.replace(/-/g, "") : "";
  const block = "grid gap-2 border-b border-line p-4 last:border-b-0";

  return (
    <div className="text-sm" data-testid="inspector">
      <div className={block}>
        <Eyebrow>Estimated match</Eyebrow>
        <ScoreFigure score={analysis.overall_score} />
        <Meter value={analysis.overall_score} label="Estimated match" />
        <p className="m-0 text-xs text-ink-2">
          {analysis.label}
          {analysis.missing_mandatory ? ` · ${analysis.missing_mandatory} required ${plural(analysis.missing_mandatory, "gap")}` : ""}
        </p>
        {profileChanged && !analysis.stale ? (
          <Note tone="info" className="text-xs">
            Your Master Profile changed since this analysis. Re-run it to use the new details — your saved resume is not changed.
          </Note>
        ) : null}
        {analysis.id ? (
          <Button variant="text" className="justify-self-start" onClick={() => onAction("ats-view")} data-action="ats-view">
            View analysis
          </Button>
        ) : null}
      </div>
      <div className={block}>
        <Eyebrow>Next step</Eyebrow>
        <div className="grid gap-1.5">
          {actions.map((item, index) => (
            <Button
              key={item.action + index}
              data-action={item.action}
              variant={index === primary ? "primary" : item.kind === "quiet" ? "quiet" : "secondary"}
              className="w-full justify-start"
              disabled={busy !== null}
              onClick={() => onAction(item.action)}
            >
              {item.label}
            </Button>
          ))}
          {entry.submission ? (
            <p className="m-0 text-xs text-ink-3">Submitted {dateLabel(entry.submission.submitted_at)}. Delivery actions are hidden so this application is not sent twice.</p>
          ) : actions.length ? null : (
            <p className="m-0 text-xs text-ink-3">Choose an application route in the editor to see delivery actions.</p>
          )}
        </div>
        {aiNotes ? (
          <Note tone="info" className="text-xs" data-testid="ai-notes">
            {aiNotes}
          </Note>
        ) : null}
      </div>
      <div className={block}>
        <Eyebrow>Status</Eyebrow>
        <KeyValue
          items={[
            ["Delivery", <Pill key="d" tone={toneFor(deliveryCategory(entry))}>{deliveryLabel(entry)}</Pill>],
            ["Stage", entry.application_stage || "Not set"],
            entry.apply_method === "email" && [
              "Readiness",
              <span key="r" className={cn(entry.resume_status === "Resume Selected" ? "text-success" : "text-danger")}>
                {entry.readiness_status}
              </span>,
            ],
            entry.delivery_mode === "local" && entry.apply_method === "email" && ["Local send", <span key="s" className="tabular">{dateLabel(entry.send_at)}</span>],
            Boolean(entry.gmail_draft_id) && ["Gmail", entry.gmail_account || "Connected account"],
            entry.submission && ["Submitted", `${dateLabel(entry.submission.submitted_at)} · v${entry.submission.version_number ?? ""}`],
            [
              "Notion",
              notionId ? (
                <a key="n" href={`https://www.notion.so/${notionId}`} target="_blank" rel="noopener noreferrer">
                  Open page ↗
                </a>
              ) : entry.notion_id ? (
                "Synced"
              ) : (
                "Not synced"
              ),
            ],
          ]}
        />
      </div>
      <div className={block}>
        {entry.apply_method === "email" && control ? (
          <>
            <Eyebrow>Email preview</Eyebrow>
            <EmailPreview control={control} entry={entry} />
          </>
        ) : (
          <>
            <Eyebrow>Application route</Eyebrow>
            <p className="m-0 text-xs text-ink-2">Not set up as an email application.</p>
            {entry.apply_url ? (
              <Button asChild>
                <a href={entry.apply_url} target="_blank" rel="noopener noreferrer">
                  Open application form
                </a>
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
