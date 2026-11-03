import { useMutation } from "@tanstack/react-query";
import { PaperclipIcon, PlusIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CheckLine, Field, FieldGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Count, EmptyState } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";
import { CONTACT_STATUSES, type OutreachContact } from "./types";

interface ImportResult {
  imported: number;
  skipped: number;
  invalid: Array<{ row_number?: number; error: string }>;
}

const blank = { full_name: "", company: "", phone: "", email: "", designation: "", job_title: "", linkedin_url: "", source: "", status: "Not Sent", notes: "", consent: false };
const SAMPLE = "Company\tRecruiter / Contact\tPhone\tEmail\tStatus\tNotes\n";

export function ContactsPanel({ contacts, refresh }: { contacts: OutreachContact[]; refresh: () => Promise<void> }) {
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const fail = (error: unknown) => notify(errorMessage(error), true);
  const set = (change: Partial<typeof blank>) => setForm((current) => ({ ...current, ...change }));

  const save = useMutation({
    mutationFn: () => (editing ? api(`/api/outreach/contacts/${editing}`, "PATCH", form) : api("/api/outreach/contacts", "POST", form)),
    onSuccess: async () => { await refresh(); notify(editing ? "Contact updated." : "Contact saved."); setForm(blank); setEditing(null); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/outreach/contacts/${id}`, "DELETE"),
    onSuccess: async () => { await refresh(); notify("Contact and its outreach history deleted."); },
    onError: fail,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/api/outreach/contacts/${id}`, "PATCH", { status }),
    onSuccess: refresh,
    onError: fail,
  });
  const importRows = useMutation({
    mutationFn: () => api<ImportResult>("/api/outreach/contacts/import", "POST", { csv: csvText }),
    onSuccess: async (data) => {
      setResult(data);
      await refresh();
      notify(`Imported ${data.imported} contact${data.imported === 1 ? "" : "s"}${data.skipped ? ` · ${data.skipped} duplicate skipped` : ""}.`, data.imported === 0 && data.invalid.length > 0);
    },
    onError: fail,
  });

  const loadFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : null;
    setCsvText(new TextDecoder(utf16 ?? "utf-8").decode(utf16 ? bytes.subarray(2) : bytes));
    setResult(null);
  };

  const edit = (contact: OutreachContact) => {
    setEditing(contact.id);
    setForm({ ...blank, ...contact, consent: Boolean(contact.consent) });
    window.scrollTo({ top: 0 });
  };

  const needle = query.trim().toLowerCase();
  const shown = needle ? contacts.filter((contact) => `${contact.full_name} ${contact.company} ${contact.phone} ${contact.job_title}`.toLowerCase().includes(needle)) : contacts;

  return (
    <div className="grid gap-4 pt-4 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader title="HR contacts" aside={<Count>{shown.length} of {contacts.length}</Count>} />
        <Input aria-label="Search contacts" placeholder="Search name, company, phone or role" value={query} onChange={(event) => setQuery(event.target.value)} className="mb-3" />
        {shown.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {shown.map((contact) => (
              <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line bg-canvas px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{contact.full_name}</div>
                  <div className="truncate text-xs text-ink-2">
                    {contact.company}{contact.job_title ? ` · ${contact.job_title}` : ""} · <span className="tabular">{contact.phone}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select aria-label={`Status for ${contact.full_name}`} className="w-48" value={contact.status} onChange={(event) => setStatus.mutate({ id: contact.id, status: event.target.value })}>
                    {CONTACT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </Select>
                  <Button variant="quiet" size="sm" onClick={() => edit(contact)}>Edit</Button>
                  <Button variant="quiet" size="sm" onClick={() => remove.mutate(contact.id)}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={contacts.length ? "No matches" : "No contacts yet"}>{contacts.length ? "Try a different search." : "Import a sheet or add a recruiter on the right."}</EmptyState>
        )}
      </Card>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title={editing ? "Edit contact" : "Add a contact"} aside={editing ? <Button variant="quiet" size="sm" onClick={() => { setEditing(null); setForm(blank); }}>Cancel edit</Button> : null} />
          <FieldGrid>
            <Field label="Name"><Input value={form.full_name} onChange={(event) => set({ full_name: event.target.value })} /></Field>
            <Field label="Company"><Input value={form.company} onChange={(event) => set({ company: event.target.value })} /></Field>
            <Field label="WhatsApp number" help="With country code; a bare 10-digit number is read as +91."><Input value={form.phone} onChange={(event) => set({ phone: event.target.value })} placeholder="+91 98765 43210" /></Field>
            <Field label="Email (optional)"><Input value={form.email} onChange={(event) => set({ email: event.target.value })} /></Field>
            <Field label="Designation"><Input value={form.designation} onChange={(event) => set({ designation: event.target.value })} /></Field>
            <Field label="Job title" help="Fills {{job_title}} in templates."><Input value={form.job_title} onChange={(event) => set({ job_title: event.target.value })} /></Field>
            <Field label="LinkedIn URL (optional)"><Input value={form.linkedin_url} onChange={(event) => set({ linkedin_url: event.target.value })} placeholder="https://" /></Field>
            <Field label="Source"><Input value={form.source} onChange={(event) => set({ source: event.target.value })} placeholder="Referral, LinkedIn, sheet…" /></Field>
            <Field label="Status">
              <Select value={form.status} onChange={(event) => set({ status: event.target.value })}>
                {CONTACT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </Select>
            </Field>
            <div className="self-end pb-1.5"><CheckLine checked={form.consent} onChange={(event) => set({ consent: event.target.checked })}>OK to contact on WhatsApp</CheckLine></div>
            <Field label="Notes" wide><Textarea value={form.notes} onChange={(event) => set({ notes: event.target.value })} /></Field>
          </FieldGrid>
          <div className="mt-3">
            <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}><PlusIcon aria-hidden />{editing ? "Save changes" : "Add contact"}</Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Import from a sheet" description="Paste rows from Excel or Google Sheets, or load a CSV/TSV file. A header row is optional; without one the order is Company, Recruiter, Phone, Email, Status, Notes. Existing contacts are never overwritten; duplicates are skipped." />
          <Textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} rows={5} placeholder={SAMPLE} aria-label="Contact rows" className="tabular text-xs" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => importRows.mutate()} disabled={importRows.isPending || !csvText.trim()}><UploadIcon aria-hidden />Import contacts</Button>
            <Button asChild variant="secondary">
              <label>
                <PaperclipIcon aria-hidden />Choose file
                <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.target.value = ""; }} />
              </label>
            </Button>
          </div>
          {result ? (
            <Note tone={result.invalid.length ? "warn" : "success"} className="mt-3">
              <div>Imported {result.imported} · duplicates skipped {result.skipped} · invalid {result.invalid.length}</div>
              {result.invalid.length ? (
                <ul className="m-0 mt-1 list-disc pl-4">
                  {result.invalid.slice(0, 10).map((item, index) => <li key={index}>{item.row_number ? `Row ${item.row_number}: ` : ""}{item.error}</li>)}
                  {result.invalid.length > 10 ? <li>and {result.invalid.length - 10} more</li> : null}
                </ul>
              ) : null}
            </Note>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
