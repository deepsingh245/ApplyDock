import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { keys, useLoadedState, useReloadState } from "@/api/state";
import type { Entry, ResumeVersion, Submission } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, Input, Select } from "@/components/ui/field";
import { KeyValue, Spinner } from "@/components/ui/misc";
import { Pill } from "@/components/ui/pill";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";
import { dateLabel, todayInput } from "@/lib/format";
import { editorPath, tailoredFor } from "./actions";

interface SubmissionRecord extends Submission {
  evidence_label?: string;
  channel_label?: string;
  note?: string;
  download_url?: string;
  replaced_at?: string;
}

function SubmissionDetails({ item }: { item: SubmissionRecord }) {
  return (
    <KeyValue
      className="submission-kv"
      items={[
        ["Resume", `${item.resume_name || "Deleted resume"} — v${item.version_number ?? ""}`],
        [
          "File",
          <span key="f" className="tabular" title={`SHA-256 ${item.sha256 ?? ""}`}>
            {item.filename} · {(item.sha256 ?? "").slice(0, 10)}
          </span>,
        ],
        ["Status", `Submitted · ${item.evidence_label ?? ""}`],
        ["Date", dateLabel(item.submitted_at)],
        ["Source", item.channel_label ?? item.channel ?? ""],
        Boolean(item.note) && ["Note", item.note],
      ]}
    />
  );
}

function SubmissionForm({ entry, channel, onDone }: { entry: Entry; channel: string; onDone: () => void }) {
  const state = useLoadedState();
  const reload = useReloadState();
  const resumeIds = [entry.resume_id, tailoredFor(entry, state.resumes)?.id].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index);
  const versions = useQueries({
    queries: resumeIds.map((resumeId) => ({
      queryKey: keys.versions(resumeId),
      queryFn: () => api<{ versions: (ResumeVersion & { available?: boolean })[] }>(`/api/resumes/${resumeId}/versions`),
    })),
  });
  const loading = versions.some((query) => query.isPending);
  const options = versions.flatMap((query, index) => {
    const resume = state.resumes.find((item) => item.id === resumeIds[index]);
    return (query.data?.versions ?? [])
      .filter((version) => version.available !== false)
      .map((version) => ({
        id: version.id,
        label: `${resume?.name ?? "Resume"} — v${version.version_number} · ${version.original_filename}${version.id === entry.resume_version?.id ? " (attached)" : ""}`,
      }));
  });
  const [versionId, setVersionId] = useState("");
  const [how, setHow] = useState(channel);
  const [date, setDate] = useState(todayInput());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const chosen = versionId || (options.find((option) => option.id === entry.resume_version?.id) ?? options[0])?.id || "";

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/entries/${entry.id}/submissions`, "POST", { resume_version_id: chosen, channel: how, submitted_at: date ? `${date}T12:00:00` : "", note });
      await reload();
      onDone();
      notify("Submission recorded. This exact resume file stays with the application.");
    } catch (error) {
      notify(errorMessage(error), true);
      setSaving(false);
    }
  };

  if (loading)
    return (
      <p className="m-0 flex items-center gap-2 text-xs text-ink-3">
        <Spinner /> Loading resume versions…
      </p>
    );
  return (
    <div className="grid gap-3 border-t border-line pt-3" data-testid="submission-form">
      <FieldGrid>
        <Field label="Resume that was sent">
          <Select id="submission-version" value={chosen} onChange={(event) => setVersionId(event.target.value)}>
            {options.length ? options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>) : <option value="">No resume file available</option>}
          </Select>
        </Field>
        <Field label="How you applied">
          <Select value={how} onChange={(event) => setHow(event.target.value)}>
            <option value="external">Company site or portal</option>
            <option value="gmail">Gmail</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Date submitted">
          <Input type="date" max={todayInput()} value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Note">
          <Input placeholder="Optional, e.g. referred by a recruiter" value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </FieldGrid>
      <p className="m-0 text-xs text-ink-3">
        ApplyDock keeps this exact file for this application even if you edit or delete the resume later.
        {entry.submission ? " The previous record is kept in the history." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" data-submission="save" disabled={saving || !chosen} onClick={save}>
          Save submission
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The submission record of an application: which exact resume file was sent, when, and how.
 * openRequest asks it to open the form (from the inspector or the extension's "submission" deep link).
 */
export function SubmissionCard({ entry, openRequest }: { entry: Entry; openRequest: { channel: string; at: number } | null }) {
  const state = useLoadedState();
  const navigate = useNavigate();
  const [formChannel, setFormChannel] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const item = entry.submission as SubmissionRecord | null;
  const resumeExists = Boolean(item && state.resumes.some((resume) => resume.id === item.resume_id));
  const history = useQuery({
    queryKey: keys.submissions(entry.id),
    queryFn: () => api<{ submissions: SubmissionRecord[] }>(`/api/entries/${entry.id}/submissions`),
    enabled: showLog,
  });

  const [handledAt, setHandledAt] = useState(0);
  if (openRequest && openRequest.at !== handledAt) {
    setHandledAt(openRequest.at);
    setFormChannel(openRequest.channel);
  }
  useEffect(() => {
    if (formChannel) card.current?.scrollIntoView({ block: "nearest" });
  }, [formChannel]);

  return (
    <div ref={card} id="submission-card" className="grid gap-3 rounded-md border border-line bg-surface p-4" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <strong className="text-sm">{item ? "Submitted resume" : "Submission"}</strong>
          {item ? null : (
            <p className="m-0 mt-1 text-xs text-ink-2">
              Not recorded yet. A Gmail draft or an approved email is not a submission — record it once you have actually applied.
            </p>
          )}
        </div>
        {item ? <Pill tone="success">Submitted</Pill> : null}
      </div>
      {item ? (
        <>
          <SubmissionDetails item={item} />
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href={item.file_url} target="_blank" rel="noopener noreferrer">
                View PDF
              </a>
            </Button>
            {item.download_url ? (
              <Button asChild size="sm" variant="quiet">
                <a href={item.download_url}>Download</a>
              </Button>
            ) : null}
            {resumeExists ? (
              <>
                <Button size="sm" variant="quiet" onClick={() => navigate(editorPath(item.resume_id, { entryId: entry.id, compareVersionId: item.resume_version_id }))}>
                  Compare with current resume
                </Button>
                <Button size="sm" variant="quiet" onClick={() => navigate(editorPath(item.resume_id, { entryId: entry.id, panel: "versions" }))}>
                  Version history
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="quiet" onClick={() => setShowLog((value) => !value)}>
              {showLog ? "Hide record history" : "Record history"}
            </Button>
            <Button size="sm" variant="quiet" data-submission="change" onClick={() => setFormChannel(entry.delivery_mode.startsWith("gmail") ? "gmail" : "external")}>
              Change record
            </Button>
          </div>
          {showLog ? (
            <div className="grid gap-3 border-t border-line pt-3">
              {history.isPending ? (
                <Spinner />
              ) : (history.data?.submissions.length ?? 0) > 1 ? (
                history.data!.submissions.map((record) => (
                  <div key={record.id} className="grid gap-1">
                    <strong className="text-xs">{record.active ? "Current record" : `Replaced ${dateLabel(record.replaced_at)}`}</strong>
                    <SubmissionDetails item={record} />
                  </div>
                ))
              ) : (
                <p className="m-0 text-xs text-ink-3">This record has not been changed.</p>
              )}
            </div>
          ) : null}
        </>
      ) : entry.status !== "sending" && !formChannel ? (
        <Button className="justify-self-start" data-submission="change" onClick={() => setFormChannel(entry.delivery_mode.startsWith("gmail") ? "gmail" : "external")}>
          Record submission
        </Button>
      ) : null}
      {formChannel ? (
        // Keyed by the resume it offers: if that changes underneath (a refresh), the old choices would be wrong.
        <SubmissionForm key={`${entry.id}:${entry.resume_id}:${entry.resume_version?.id ?? ""}`} entry={entry} channel={formChannel} onDone={() => setFormChannel(null)} />
      ) : null}
    </div>
  );
}
