import { useMutation } from "@tanstack/react-query";
import { CopyIcon, ExternalLinkIcon, FileTextIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Count, EmptyState, KeyValue } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill } from "@/components/ui/pill";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";
import { whatsappLink } from "./message";
import { isWaiting, timing } from "./reminders";
import { formatDate, type OutreachBatch, type OutreachFollowup, type OutreachSchedule } from "./types";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify("Message copied.");
  } catch {
    notify("Could not copy. Select the message and copy it manually.", true);
  }
}

export function QueuePanel({ queue, batches, followups, now, refresh }: {
  queue: OutreachSchedule[];
  batches: OutreachBatch[];
  followups: OutreachFollowup[];
  now: number;
  refresh: () => Promise<void>;
}) {
  const [moving, setMoving] = useState<{ id: string; value: string } | null>(null);
  const [followupDays, setFollowupDays] = useState("3, 7");
  const fail = (error: unknown) => notify(errorMessage(error), true);

  const queueAction = useMutation({
    mutationFn: ({ id, ...body }: { id: string; action: "reschedule" | "cancel" | "opened"; send_at?: string }) => api(`/api/outreach/schedules/${id}`, "PATCH", body),
    onSuccess: async () => { setMoving(null); await refresh(); },
    onError: fail,
  });
  const markResult = useMutation({
    mutationFn: ({ id, result }: { id: string; result: "sent" | "skipped" | "failed" }) => {
      const days = followupDays.split(/[,\s]+/).map(Number).filter((value) => Number.isInteger(value) && value > 0);
      return api(`/api/outreach/schedules/${id}`, "PATCH", { result, followup_days: result === "sent" ? days : undefined });
    },
    onSuccess: refresh,
    onError: fail,
  });
  const finishFollowup = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "done" | "dismissed" }) => api(`/api/outreach/followups/${id}`, "PATCH", { action }),
    onSuccess: refresh,
    onError: fail,
  });
  const batchAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" }) => api(`/api/outreach/batches/${id}/${action}`, "POST", {}),
    onSuccess: refresh,
    onError: fail,
  });

  const pending = queue.filter((item) => item.result === "pending");
  const openFollowups = followups.filter((item) => item.status === "pending");
  const openBatches = batches.filter((batch) => batch.status !== "cancelled");

  return (
    <div className="grid gap-4 pt-4">
      <Card>
        <CardHeader title="Awaiting you" aside={<Count>{pending.length}</Count>} />
        {pending.length ? (
          <>
            <Field label="Remind me to follow up after (working days)" help="Used when you select I sent it. Leave empty for no follow-up reminders." className="mb-3 max-w-xs">
              <Input value={followupDays} onChange={(event) => setFollowupDays(event.target.value)} placeholder="3, 7" />
            </Field>
            <ul className="m-0 grid list-none gap-3 p-0">
              {pending.map((item) => {
                const state = isWaiting(item.status) ? timing(item.send_at, now) : "later";
                return (
                  <li key={item.id} className="rounded-sm border border-line bg-canvas p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm text-ink">{item.contact?.full_name ?? "Deleted contact"} <span className="font-normal text-ink-2">· {item.contact?.company}</span></strong>
                      <span className="flex items-center gap-2">
                        {item.status === "awaiting_confirmation" ? <Pill tone="accent">{item.auto_send ? "Extension working · check WhatsApp" : "Opened · confirm when sent"}</Pill> : null}
                        {item.status === "draft" ? <Pill tone="neutral">Paused</Pill> : null}
                        {item.auto_send ? <Pill tone="outline">Extension sends</Pill> : null}
                        {state === "missed" ? <Pill tone="danger">Missed</Pill> : null}
                        <Pill tone={state === "due" ? "warn" : "outline"}>{state === "due" ? "Due now" : formatDate(item.send_at)}</Pill>
                      </span>
                    </div>
                    <p className="my-2 text-sm whitespace-pre-wrap text-ink-2">{item.message}</p>
                    {item.notes ? <Note tone="neutral" className="mb-2">{item.notes}</Note> : null}
                    <KeyValue
                      className="mb-3"
                      items={[[
                        "Resume",
                        item.resume?.id ? (
                          <span className="inline-flex flex-wrap items-center gap-2">
                            {item.resume.name || item.resume.original_filename || "Selected resume"}
                            {item.resume_file_url ? <a className="inline-flex items-center gap-1 text-accent underline" href={item.resume_file_url} target="_blank" rel="noreferrer"><FileTextIcon aria-hidden className="size-3.5" />Open PDF to attach</a> : <Pill tone="danger">File missing</Pill>}
                          </span>
                        ) : "None",
                      ]]}
                    />
                    <div className="flex flex-wrap gap-2">
                      {item.contact?.phone ? (
                        <Button variant="primary" size="sm" asChild>
                          <a href={whatsappLink(item.contact.phone, item.message)} target="_blank" rel="noreferrer" onClick={() => queueAction.mutate({ id: item.id, action: "opened" })}><ExternalLinkIcon aria-hidden />Open WhatsApp</a>
                        </Button>
                      ) : null}
                      <Button size="sm" onClick={() => void copyText(item.message)}><CopyIcon aria-hidden />Copy message</Button>
                      <Button size="sm" onClick={() => markResult.mutate({ id: item.id, result: "sent" })}><SendIcon aria-hidden />I sent it</Button>
                      <Button variant="quiet" size="sm" onClick={() => markResult.mutate({ id: item.id, result: "skipped" })}>Skip</Button>
                      <Button variant="quiet" size="sm" onClick={() => markResult.mutate({ id: item.id, result: "failed" })}>Mark failed</Button>
                      <Button variant="quiet" size="sm" onClick={() => setMoving({ id: item.id, value: "" })}>Reschedule</Button>
                      <Button variant="quiet" size="sm" onClick={() => queueAction.mutate({ id: item.id, action: "cancel" })}>Cancel</Button>
                    </div>
                    {moving?.id === item.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input type="datetime-local" aria-label="New time" className="w-52" value={moving.value} onChange={(event) => setMoving({ id: item.id, value: event.target.value })} />
                        <Button size="sm" variant="primary" disabled={!moving.value} onClick={() => queueAction.mutate({ id: item.id, action: "reschedule", send_at: new Date(moving.value).toISOString() })}>Move</Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <EmptyState title="Nothing waiting">Add contacts to the queue from the Schedule tab.</EmptyState>
        )}
      </Card>

      <Card>
        <CardHeader title="Follow-ups" aside={<Count>{openFollowups.length}</Count>} description="Created when you confirm a message as sent. They are reminders only: you review, send and confirm each one." />
        {openFollowups.length ? (
          <ul className="m-0 grid list-none gap-3 p-0">
            {openFollowups.map((item) => {
              const due = new Date(item.due_at).getTime() <= now;
              return (
                <li key={item.id} className="rounded-sm border border-line bg-canvas p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-ink">{item.contact?.full_name ?? "Deleted contact"} <span className="font-normal text-ink-2">· {item.contact?.company} · follow-up {item.step}</span></strong>
                    <Pill tone={due ? "warn" : "outline"}>{due ? "Due" : formatDate(item.due_at)}</Pill>
                  </div>
                  <p className="my-2 text-sm whitespace-pre-wrap text-ink-2">{item.message}</p>
                  <div className="flex flex-wrap gap-2">
                    {item.contact?.phone ? <Button variant="primary" size="sm" asChild><a href={whatsappLink(item.contact.phone, item.message)} target="_blank" rel="noreferrer"><ExternalLinkIcon aria-hidden />Open WhatsApp</a></Button> : null}
                    <Button size="sm" onClick={() => void copyText(item.message)}><CopyIcon aria-hidden />Copy message</Button>
                    <Button size="sm" onClick={() => finishFollowup.mutate({ id: item.id, action: "done" })}><SendIcon aria-hidden />I sent it</Button>
                    <Button variant="quiet" size="sm" onClick={() => finishFollowup.mutate({ id: item.id, action: "dismissed" })}>Dismiss</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No follow-ups pending">They appear here after you mark a message as sent.</EmptyState>
        )}
      </Card>

      {openBatches.length ? (
        <Card>
          <CardHeader title="Batches" aside={<Count>{openBatches.length}</Count>} />
          <ul className="m-0 grid list-none gap-2 p-0">
            {openBatches.map((batch) => (
              <li key={batch.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ink">
                  {batch.scheduled_date} · <span className="tabular">{batch.window_start}–{batch.window_end}</span> <span className="text-ink-2">· {batch.recipient_count} contacts</span>
                </span>
                <span className="flex items-center gap-2">
                  <Pill tone={batch.status === "paused" ? "neutral" : "accent"}>{batch.status === "paused" ? "Paused" : "Active"}</Pill>
                  <Button variant="quiet" size="sm" onClick={() => batchAction.mutate({ id: batch.id, action: batch.status === "paused" ? "resume" : "pause" })}>{batch.status === "paused" ? "Resume" : "Pause"}</Button>
                  <Button variant="quiet" size="sm" onClick={() => batchAction.mutate({ id: batch.id, action: "cancel" })}>Cancel batch</Button>
                </span>
              </li>
            ))}
          </ul>
          <Note tone="neutral" className="mt-3">Pausing holds every still-scheduled message in the batch; resuming puts them back on their original times.</Note>
        </Card>
      ) : null}
    </div>
  );
}
