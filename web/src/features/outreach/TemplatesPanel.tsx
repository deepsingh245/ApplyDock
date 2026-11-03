import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CheckLine, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Count, EmptyState } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill } from "@/components/ui/pill";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";
import { renderTemplate } from "./message";
import { TEMPLATE_CATEGORIES, type OutreachContact, type OutreachTemplate } from "./types";

const blank = { name: "", category: TEMPLATE_CATEGORIES[0], is_default: false, body: "Hi {{hr_name}}, I came across the {{job_title}} role at {{company_name}} and would love to be considered. I have attached my resume." };

export function TemplatesPanel({ templates, contacts, refresh }: { templates: OutreachTemplate[]; contacts: OutreachContact[]; refresh: () => Promise<void> }) {
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const fail = (error: unknown) => notify(errorMessage(error), true);

  const save = useMutation({
    mutationFn: () => (editing ? api(`/api/outreach/templates/${editing}`, "PATCH", form) : api("/api/outreach/templates", "POST", form)),
    onSuccess: async () => { await refresh(); notify(editing ? "Template updated." : "Template saved."); setForm(blank); setEditing(null); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/outreach/templates/${id}`, "DELETE"),
    onSuccess: async () => { await refresh(); notify("Template deleted."); },
    onError: fail,
  });
  const makeDefault = useMutation({
    mutationFn: (template: OutreachTemplate) => api(`/api/outreach/templates/${template.id}`, "PATCH", { is_default: true }),
    onSuccess: refresh,
    onError: fail,
  });
  const duplicate = useMutation({
    mutationFn: (template: OutreachTemplate) => api("/api/outreach/templates", "POST", { name: `Copy of ${template.name}`, body: template.body, category: template.category }),
    onSuccess: async () => { await refresh(); notify("Template duplicated."); },
    onError: fail,
  });

  const sample = contacts[0];
  const preview = renderTemplate(form.body, sample);

  return (
    <div className="grid gap-4 pt-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Templates" aside={<Count>{templates.length}</Count>} />
        {templates.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {templates.map((template) => (
              <li key={template.id} className="rounded-sm border border-line bg-canvas p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <strong className="text-sm text-ink">{template.name}</strong>
                    {template.category ? <Pill tone="outline">{template.category}</Pill> : null}
                    {template.is_default ? <Pill tone="accent">Default</Pill> : null}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {template.is_default ? null : <Button variant="quiet" size="sm" onClick={() => makeDefault.mutate(template)}>Make default</Button>}
                    <Button variant="quiet" size="sm" onClick={() => { setEditing(template.id); setForm({ name: template.name, category: template.category || TEMPLATE_CATEGORIES[0], is_default: template.is_default, body: template.body }); }}>Edit</Button>
                    <Button variant="quiet" size="sm" onClick={() => duplicate.mutate(template)}>Duplicate</Button>
                    <Button variant="quiet" size="sm" onClick={() => remove.mutate(template.id)}>Delete</Button>
                  </span>
                </div>
                <p className="mt-1 mb-0 text-sm whitespace-pre-wrap text-ink-2">{template.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No templates yet">Write one on the right and reuse it for every recruiter.</EmptyState>
        )}
      </Card>
      <Card className="content-start">
        <CardHeader
          title={editing ? "Edit template" : "New template"}
          description="Variables: {{hr_name}}, {{company_name}}, {{job_title}}. Only claim skills and experience that are true for you."
          aside={editing ? <Button variant="quiet" size="sm" onClick={() => { setEditing(null); setForm(blank); }}>Cancel edit</Button> : null}
        />
        <div className="grid gap-3">
          <Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Category">
            <Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {TEMPLATE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </Select>
          </Field>
          <Field label="Message" help={`${form.body.length} characters`}><Textarea rows={7} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></Field>
          <CheckLine checked={form.is_default} onChange={(event) => setForm({ ...form, is_default: event.target.checked })}>Use as the default template</CheckLine>
          <Note tone={preview.missing.length ? "warn" : "neutral"}>
            <strong className="block text-xs">Preview{sample ? ` for ${sample.full_name}` : " (add a contact to preview)"}</strong>
            <span className="whitespace-pre-wrap">{preview.text}</span>
            {preview.missing.length ? <span className="mt-1 block text-xs">Not filled: {preview.missing.join(", ")}</span> : null}
          </Note>
          <div><Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>{editing ? "Save changes" : "Save template"}</Button></div>
        </div>
      </Card>
    </div>
  );
}
