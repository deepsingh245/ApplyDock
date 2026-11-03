import { useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, FieldGrid, Input, Select } from "@/components/ui/field";
import { Count, EmptyState, KeyValue } from "@/components/ui/misc";
import { Pill, type PillTone } from "@/components/ui/pill";
import { formatDate, type OutreachFollowup, type OutreachSchedule } from "./types";

const tone = (result: string): PillTone => (result === "sent" ? "success" : result === "failed" ? "danger" : result === "skipped" ? "warn" : result === "cancelled" ? "neutral" : "outline");
const label = (result: string) => ({ pending: "Pending", sent: "Sent", skipped: "Skipped", failed: "Failed", cancelled: "Cancelled" })[result] ?? result;

/** Every outreach attempt, filterable. Pending items are included so the full trail lives in one place. */
export function HistoryPanel({ queue, followups }: { queue: OutreachSchedule[]; followups: OutreachFollowup[] }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [resume, setResume] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const resumeNames = useMemo(() => [...new Set(queue.map((item) => item.resume?.name).filter((name): name is string => Boolean(name)))], [queue]);
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return queue
      .filter((item) => !result || item.result === result)
      .filter((item) => !resume || item.resume?.name === resume)
      .filter((item) => !from || item.send_at.slice(0, 10) >= from)
      .filter((item) => !to || item.send_at.slice(0, 10) <= to)
      .filter((item) => !needle || `${item.contact?.full_name} ${item.contact?.company} ${item.contact?.job_title}`.toLowerCase().includes(needle))
      .sort((a, b) => b.send_at.localeCompare(a.send_at));
  }, [queue, text, result, resume, from, to]);

  return (
    <Card className="mt-4">
      <CardHeader title="History" aside={<Count>{rows.length} of {queue.length}</Count>} />
      <FieldGrid className="mb-4 md:grid-cols-2 xl:grid-cols-5">
        <Field label="Contact, company or role"><Input value={text} onChange={(event) => setText(event.target.value)} /></Field>
        <Field label="Status">
          <Select value={result} onChange={(event) => setResult(event.target.value)}>
            <option value="">All</option>
            {["pending", "sent", "skipped", "failed", "cancelled"].map((value) => <option key={value} value={value}>{label(value)}</option>)}
          </Select>
        </Field>
        <Field label="Resume">
          <Select value={resume} onChange={(event) => setResume(event.target.value)}>
            <option value="">All</option>
            {resumeNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
        </Field>
        <Field label="From"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
      </FieldGrid>
      {rows.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {rows.map((item) => {
            const next = followups.filter((entry) => entry.contact?.id === item.contact?.id && entry.status === "pending")[0];
            return (
              <li key={item.id} className="rounded-sm border border-line bg-canvas px-3 py-2">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-ink">{item.contact?.full_name ?? "Contact"} <span className="text-ink-2">· {item.contact?.company}{item.contact?.job_title ? ` · ${item.contact.job_title}` : ""}</span></span>
                    <span className="flex items-center gap-2"><span className="tabular text-xs text-ink-3">{formatDate(item.send_at)}</span><Pill tone={tone(item.result)}>{label(item.result)}</Pill></span>
                  </summary>
                  <KeyValue
                    className="mt-3"
                    items={[
                      ["Resume", item.resume?.name || "None"],
                      ["Template", item.template?.name || "Custom message"],
                      ["Scheduled", formatDate(item.send_at)],
                      item.opened_at ? ["Opened", formatDate(item.opened_at)] : null,
                      item.sent_at ? [item.sent_by === "extension" ? "Sent by extension" : "Confirmed sent", formatDate(item.sent_at)] : null,
                      next ? ["Next follow-up", formatDate(next.due_at)] : null,
                      item.notes ? ["Notes", item.notes] : null,
                      ["Message", <span key="m" className="whitespace-pre-wrap">{item.message}</span>],
                    ]}
                  />
                </details>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No outreach matches">{queue.length ? "Loosen the filters." : "Scheduled and sent messages will be listed here."}</EmptyState>
      )}
    </Card>
  );
}
