import { useMutation } from "@tanstack/react-query";
import { CalendarClockIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CheckLine, Field, FieldGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Count, EmptyState } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill } from "@/components/ui/pill";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";

export interface WizardContact { id: string; full_name: string; company: string; phone: string; status: string }
export interface WizardTemplate { id: string; name: string; is_default?: boolean }
export interface WizardResume { id: string; name?: string; original_filename?: string; available?: boolean }

interface PreviewRow {
  contact_id: string;
  name?: string;
  company?: string;
  phone?: string;
  send_at: string;
  message: string;
  errors: string[];
  warnings: string[];
  duplicate: boolean;
}

interface EditableRow extends PreviewRow {
  time: string;
  removed: boolean;
  allowDuplicate: boolean;
}

interface Preview { rows: PreviewRow[]; overflow: number; notice: string }

const toLocalInput = (iso: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function tomorrow() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Pick contacts, set a time window, review every message and slot, then confirm. Nothing is saved until Confirm. */
export function ScheduleWizard({ contacts, templates, resumes, onDone }: {
  contacts: WizardContact[];
  templates: WizardTemplate[];
  resumes: WizardResume[];
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pickedTemplate, setTemplateId] = useState("");
  const [resumeId, setResumeId] = useState("");
  const [date, setDate] = useState(tomorrow);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [mode, setMode] = useState<"even" | "fixed" | "manual">("even");
  const [manualTimes, setManualTimes] = useState("");
  const [interval, setIntervalMinutes] = useState("5");
  const [maxPerWindow, setMaxPerWindow] = useState("");
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [autoSend, setAutoSend] = useState(false);
  const [rows, setRows] = useState<EditableRow[] | null>(null);
  const [notice, setNotice] = useState("");

  const templateId = pickedTemplate || templates.find((template) => template.is_default)?.id || "";
  const eligible = contacts.filter((contact) => contact.status !== "Do not contact");
  const config = {
    contact_ids: selected, template_id: templateId, resume_id: resumeId, date, start, end, mode,
    interval_minutes: mode === "fixed" ? Number(interval) : undefined,
    manual_times: mode === "manual" ? manualTimes.split(/[,\s]+/).filter(Boolean) : undefined,
    max_per_window: maxPerWindow ? Number(maxPerWindow) : undefined,
    skip_weekends: skipWeekends, auto_send: autoSend, timezone: "Asia/Kolkata",
  };

  const preview = useMutation({
    mutationFn: () => api<Preview>("/api/outreach/batches/preview", "POST", config),
    onSuccess: (result) => {
      setRows(result.rows.map((row) => ({ ...row, time: toLocalInput(row.send_at), removed: false, allowDuplicate: false })));
      setNotice(result.notice);
    },
    onError: (error) => notify(errorMessage(error), true),
  });

  const kept = (rows ?? []).filter((row) => !row.removed && !row.errors.length);
  const blocked = kept.some((row) => (row.duplicate && !row.allowDuplicate) || !row.time || !row.message.trim() || row.message.includes("{{"));

  const commit = useMutation({
    mutationFn: () => api("/api/outreach/batches", "POST", {
      ...config,
      rows: kept.map((row) => ({ contact_id: row.contact_id, send_at: new Date(row.time).toISOString(), message: row.message })),
      allow_duplicate_ids: kept.filter((row) => row.duplicate && row.allowDuplicate).map((row) => row.contact_id),
    }),
    onSuccess: () => {
      notify(`${kept.length} message${kept.length === 1 ? "" : "s"} queued.`);
      setRows(null);
      setSelected([]);
      onDone();
    },
    onError: (error) => notify(errorMessage(error), true),
  });

  const patch = (id: string, change: Partial<EditableRow>) => setRows((current) => current?.map((row) => (row.contact_id === id ? { ...row, ...change } : row)) ?? null);
  const toggle = (id: string) => { setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id])); setRows(null); };
  const ready = selected.length > 0 && templateId && resumeId && date && start && end;

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title="Recipients" aside={<Count>{selected.length} selected</Count>} />
          {eligible.length ? (
            <>
              <div className="mb-2 flex gap-2">
                <Button variant="text" size="sm" onClick={() => { setSelected(eligible.map((contact) => contact.id)); setRows(null); }}>Select all</Button>
                <Button variant="text" size="sm" onClick={() => { setSelected([]); setRows(null); }}>Clear</Button>
              </div>
              <ul className="m-0 grid max-h-80 list-none gap-1 overflow-y-auto p-0">
                {eligible.map((contact) => (
                  <li key={contact.id}>
                    <CheckLine checked={selected.includes(contact.id)} onChange={() => toggle(contact.id)}>
                      {contact.full_name} <span className="text-ink-3">· {contact.company}</span>
                    </CheckLine>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState title="No contacts to schedule">Add or import contacts first.</EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader title="Time window" description="Times are in India time (IST)." />
          <FieldGrid className="md:grid-cols-1">
            <Field label="Template">
              <Select value={templateId} onChange={(event) => { setTemplateId(event.target.value); setRows(null); }}>
                <option value="">Select a template</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </Select>
            </Field>
            <Field label="Resume" help="Choose the exact resume to send. The current version is pinned when you confirm.">
              <Select value={resumeId} onChange={(event) => { setResumeId(event.target.value); setRows(null); }}>
                <option value="">Select a resume</option>
                {resumes.map((resume) => <option key={resume.id} value={resume.id} disabled={resume.available === false}>{resume.name || resume.original_filename || "Resume"}{resume.available === false ? " (file missing)" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Date"><Input type="date" value={date} onChange={(event) => { setDate(event.target.value); setRows(null); }} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><Input type="time" value={start} onChange={(event) => { setStart(event.target.value); setRows(null); }} /></Field>
              <Field label="To"><Input type="time" value={end} onChange={(event) => { setEnd(event.target.value); setRows(null); }} /></Field>
            </div>
            <Field label="Spacing">
              <Select value={mode} onChange={(event) => { setMode(event.target.value as "even" | "fixed" | "manual"); setRows(null); }}>
                <option value="even">Spread evenly across the window</option>
                <option value="fixed">Fixed interval</option>
                <option value="manual">Specific times</option>
              </Select>
            </Field>
            {mode === "fixed" ? <Field label="Minutes between messages"><Input type="number" min={1} value={interval} onChange={(event) => { setIntervalMinutes(event.target.value); setRows(null); }} /></Field> : null}
            {mode === "manual" ? <Field label="Times (HH:MM, comma separated)" help="Each must fall inside the window; one time per recipient, in order."><Input value={manualTimes} onChange={(event) => { setManualTimes(event.target.value); setRows(null); }} placeholder="09:05, 09:20, 09:45" /></Field> : null}
            <Field label="Max messages in this window (optional)"><Input type="number" min={1} value={maxPerWindow} onChange={(event) => { setMaxPerWindow(event.target.value); setRows(null); }} /></Field>
            <CheckLine checked={skipWeekends} onChange={(event) => { setSkipWeekends(event.target.checked); setRows(null); }}>Working days only</CheckLine>
            <CheckLine checked={autoSend} onChange={(event) => setAutoSend(event.target.checked)}>Send for me with the ApplyDock extension</CheckLine>
            {autoSend ? <Note tone="warn">At each time the extension opens WhatsApp Web, attaches the resume with the message and presses Send for you, paced at least 90 seconds apart and at most 25 a day. Chrome must be open with WhatsApp Web logged in. Automated sending breaks WhatsApp's terms and can get your number restricted, so keep batches small. Leave this off to press Send yourself.</Note> : null}
          </FieldGrid>
          <div className="mt-3">
            <Button variant="primary" onClick={() => preview.mutate()} disabled={!ready || preview.isPending}><CalendarClockIcon aria-hidden />Preview schedule</Button>
          </div>
        </Card>
      </div>

      <Card className="content-start">
        <CardHeader title="Preview" aside={rows ? <Count>{kept.length} to queue</Count> : null} description="Check each time and message. Edit or remove anything before you confirm." />
        {rows ? (
          <>
            {notice ? <Note tone="warn" className="mb-3">{notice}</Note> : null}
            <ul className="m-0 grid list-none gap-3 p-0">
              {rows.filter((row) => !row.removed).map((row) => (
                <li key={row.contact_id} className="rounded-sm border border-line bg-canvas p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <strong className="text-ink">{row.name}</strong> <span className="text-ink-2">· {row.company} · <span className="tabular">{row.phone}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      {row.errors.length ? null : <Input type="datetime-local" aria-label={`Send time for ${row.name}`} className="w-52" value={row.time} onChange={(event) => patch(row.contact_id, { time: event.target.value })} />}
                      <IconButton label={`Remove ${row.name}`} onClick={() => patch(row.contact_id, { removed: true })}><XIcon aria-hidden /></IconButton>
                    </div>
                  </div>
                  {row.errors.map((error) => <Pill key={error} tone="danger" className="mt-2 mr-1">{error}</Pill>)}
                  {row.warnings.map((warning) => <Pill key={warning} tone="warn" className="mt-2 mr-1">{warning}</Pill>)}
                  {row.errors.length ? null : (
                    <Textarea aria-label={`Message for ${row.name}`} className="mt-2" rows={3} value={row.message} onChange={(event) => patch(row.contact_id, { message: event.target.value })} />
                  )}
                  {row.duplicate && !row.errors.length ? (
                    <CheckLine className="mt-2" checked={row.allowDuplicate} onChange={(event) => patch(row.contact_id, { allowDuplicate: event.target.checked })}>
                      Send again anyway (intentional duplicate)
                    </CheckLine>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-3">
              <Button variant="primary" onClick={() => commit.mutate()} disabled={!kept.length || blocked || commit.isPending}>Confirm and queue {kept.length}</Button>
              {blocked ? <span className="text-xs text-ink-3">Fill every message, set every time and confirm duplicates to continue.</span> : null}
            </div>
          </>
        ) : (
          <EmptyState icon={<CalendarClockIcon aria-hidden />} title="Nothing previewed yet">Choose recipients, a template, a resume and a window, then select Preview schedule.</EmptyState>
        )}
      </Card>
    </div>
  );
}
