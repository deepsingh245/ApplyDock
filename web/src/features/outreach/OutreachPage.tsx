import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, DownloadIcon, ExternalLinkIcon, PaperclipIcon, PlusIcon, SendIcon, UploadIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Resume } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, FieldGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Count, EmptyState, Eyebrow, KeyValue, Page, PageHeading } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill, type PillTone } from "@/components/ui/pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";
import { renderTemplate, whatsappLink } from "./message";

interface OutreachOverview {
  total_contacts: number;
  total_scheduled: number;
  awaiting_action: number;
  sent_successfully: number;
  failed_or_skipped: number;
  today_scheduled: number;
  upcoming_outreach: number;
}

interface OutreachContact {
  id: string;
  full_name: string;
  phone: string;
  company: string;
  designation: string;
  email: string;
  status: string;
  job_title: string;
  notes: string;
}

interface OutreachTemplate {
  id: string;
  name: string;
  body: string;
}

interface OutreachSchedule {
  id: string;
  contact?: OutreachContact;
  template?: OutreachTemplate;
  resume?: { id: string; name?: string; original_filename?: string; available?: boolean };
  message: string;
  send_at: string;
  status: string;
  result: string;
  notes?: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  invalid: Array<{ row_number?: number; error: string }>;
  summary: { total: number };
}

const CONTACT_STATUSES = [
  "Not Sent", "Mailed/Messaged", "Application Sent", "Reached / In Discussion", "Scheduled", "On Hold", "Rejected", "No Response",
  "New", "Interested", "Contacted", "Replied", "Follow-up required", "Not interested", "Do not contact",
];

const contactDefaults = { full_name: "", company: "", phone: "", email: "", designation: "", status: "Not Sent", notes: "" };
const templateDefaults = { name: "", body: "Hi {{hr_name}}, I came across the {{job_title}} role at {{company_name}} and would love to be considered. I've attached my resume." };
const SAMPLE_CSV = "Company\tRecruiter / Contact\tPhone\tEmail\tStatus\tNotes\n";

function localInputValue(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

const scheduleDefaults = () => ({ contact_id: "", template_id: "", resume_id: "", send_at: localInputValue(new Date(Date.now() + 60 * 60 * 1000)), message: "", notes: "" });

const resultTone = (result: string): PillTone => (result === "sent" ? "success" : result === "failed" ? "danger" : result === "skipped" ? "warn" : "outline");
const resultLabel = (result: string) => ({ pending: "Awaiting you", sent: "Sent", skipped: "Skipped", failed: "Failed" })[result] ?? result;

function formatDate(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <Eyebrow>{label}</Eyebrow>
      <div className="tabular mt-1 text-2xl font-semibold text-ink">{value}</div>
    </div>
  );
}

export default function OutreachPage() {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ["outreach-overview"], queryFn: () => api<OutreachOverview>("/api/outreach/overview") });
  const contacts = useQuery({ queryKey: ["outreach-contacts"], queryFn: () => api<{ contacts: OutreachContact[] }>("/api/outreach/contacts") });
  const templates = useQuery({ queryKey: ["outreach-templates"], queryFn: () => api<{ templates: OutreachTemplate[] }>("/api/outreach/templates") });
  const schedules = useQuery({ queryKey: ["outreach-schedules"], queryFn: () => api<{ schedules: OutreachSchedule[] }>("/api/outreach/schedules") });
  const resumes = useQuery({ queryKey: ["resumes"], queryFn: () => api<{ resumes: Resume[] }>("/api/resumes") });

  const [contactForm, setContactForm] = useState(contactDefaults);
  const [templateForm, setTemplateForm] = useState(templateDefaults);
  const [scheduleForm, setScheduleForm] = useState(scheduleDefaults);
  const [csvText, setCsvText] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const contactList = useMemo(() => contacts.data?.contacts ?? [], [contacts.data]);
  const templateList = useMemo(() => templates.data?.templates ?? [], [templates.data]);
  const resumeList = useMemo(() => resumes.data?.resumes ?? [], [resumes.data]);
  const queue = schedules.data?.schedules ?? [];
  const stats = overview.data;

  const refresh = async () => {
    await Promise.all(["outreach-contacts", "outreach-overview", "outreach-schedules", "outreach-templates"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
  };
  const fail = (error: unknown) => notify(errorMessage(error), true);

  const addContact = useMutation({
    mutationFn: () => api("/api/outreach/contacts", "POST", contactForm),
    onSuccess: async () => { await refresh(); setContactForm(contactDefaults); notify("Contact saved."); },
    onError: fail,
  });
  const removeContact = useMutation({
    mutationFn: (id: string) => api(`/api/outreach/contacts/${id}`, "DELETE"),
    onSuccess: async () => { await refresh(); notify("Contact deleted."); },
    onError: fail,
  });
  const setContactStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/api/outreach/contacts/${id}`, "PATCH", { status }),
    onSuccess: refresh,
    onError: fail,
  });
  const addTemplate = useMutation({
    mutationFn: () => api("/api/outreach/templates", "POST", templateForm),
    onSuccess: async () => { await refresh(); setTemplateForm(templateDefaults); notify("Template saved."); },
    onError: fail,
  });
  const removeTemplate = useMutation({
    mutationFn: (id: string) => api(`/api/outreach/templates/${id}`, "DELETE"),
    onSuccess: async () => { await refresh(); notify("Template deleted."); },
    onError: fail,
  });
  const importContacts = useMutation({
    mutationFn: () => api<ImportResult>("/api/outreach/contacts/import", "POST", { csv: csvText }),
    onSuccess: async (result) => {
      setImportResult(result);
      await refresh();
      notify(`Imported ${result.imported} contact${result.imported === 1 ? "" : "s"}${result.skipped ? ` · ${result.skipped} duplicate skipped` : ""}.`, result.imported === 0 && result.invalid.length > 0);
    },
    onError: fail,
  });
  const addSchedule = useMutation({
    mutationFn: () => api("/api/outreach/schedules", "POST", {
      ...scheduleForm,
      send_at: scheduleForm.send_at ? new Date(scheduleForm.send_at).toISOString() : undefined,
      message: scheduleForm.message.trim() || preview.text,
    }),
    onSuccess: async () => {
      await refresh();
      setScheduleForm({ ...scheduleDefaults(), template_id: scheduleForm.template_id, resume_id: scheduleForm.resume_id });
      notify("Added to the queue.");
    },
    onError: fail,
  });
  const markResult = useMutation({
    mutationFn: ({ id, result }: { id: string; result: "sent" | "skipped" | "failed" }) => api(`/api/outreach/schedules/${id}`, "PATCH", { result }),
    onSuccess: refresh,
    onError: fail,
  });

  const selectedContact = contactList.find((contact) => contact.id === scheduleForm.contact_id);
  const selectedTemplate = templateList.find((template) => template.id === scheduleForm.template_id);
  const preview = renderTemplate(selectedTemplate?.body ?? "", selectedContact);
  const selectedResume = resumeList.find((resume) => resume.id === scheduleForm.resume_id);
  const pending = queue.filter((item) => item.result === "pending");
  const done = queue.filter((item) => item.result !== "pending");

  const loadFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : null;
    setCsvText(new TextDecoder(utf16 ?? "utf-8").decode(utf16 ? bytes.subarray(2) : bytes));
    setImportResult(null);
  };

  const exportContacts = async () => {
    try {
      const response = await api<{ csv: string }>("/api/outreach/contacts/export");
      const url = URL.createObjectURL(new Blob([response.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "applydock-contacts.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      fail(error);
    }
  };

  const copyMessage = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      notify("Message copied.");
    } catch {
      notify("Could not copy. Select the message and copy it manually.", true);
    }
  };

  return (
    <Page>
      <PageHeading
        title="Outreach"
        description="Keep recruiter contacts, prepare WhatsApp messages and queue them. ApplyDock never sends for you: you open the chat, attach the resume, press Send, then confirm here."
        actions={<Button onClick={exportContacts}><DownloadIcon aria-hidden />Export contacts</Button>}
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts <Count>{contactList.length}</Count></TabsTrigger>
          <TabsTrigger value="templates">Templates <Count>{templateList.length}</Count></TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="queue">Queue <Count>{pending.length}</Count></TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          {stats ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="HR contacts" value={stats.total_contacts} />
              <Stat label="Scheduled" value={stats.total_scheduled} />
              <Stat label="Awaiting you" value={stats.awaiting_action} />
              <Stat label="Sent" value={stats.sent_successfully} />
              <Stat label="Failed or skipped" value={stats.failed_or_skipped} />
              <Stat label="Due today" value={stats.today_scheduled} />
              <Stat label="Upcoming" value={stats.upcoming_outreach} />
            </div>
          ) : null}
          <Note tone="info" className="mt-4 max-w-[72ch]">
            Opening WhatsApp only prefills the message. Nothing is marked Sent until you confirm it in the Queue tab.
          </Note>
        </TabsContent>

        <TabsContent value="contacts" className="grid gap-4 pt-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="HR contacts" aside={<Count>{contactList.length} total</Count>} />
            {contactList.length ? (
              <ul className="m-0 grid list-none gap-2 p-0">
                {contactList.map((contact) => (
                  <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-line bg-canvas px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{contact.full_name}</div>
                      <div className="truncate text-xs text-ink-2">
                        {contact.company}{contact.designation ? ` · ${contact.designation}` : ""} · <span className="tabular">{contact.phone}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        aria-label={`Status for ${contact.full_name}`}
                        className="w-48"
                        value={contact.status}
                        onChange={(event) => setContactStatus.mutate({ id: contact.id, status: event.target.value })}
                      >
                        {CONTACT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                      </Select>
                      <Button variant="quiet" size="sm" onClick={() => removeContact.mutate(contact.id)}>Delete</Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No contacts yet">Import a sheet or add a recruiter on the right.</EmptyState>
            )}
          </Card>

          <div className="grid content-start gap-4">
            <Card>
              <CardHeader title="Import from a sheet" description="Paste rows from Excel or Google Sheets, or load a CSV/TSV file. A header row is optional; without one the order is Company, Recruiter, Phone, Email, Status, Notes." />
              <Textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} rows={5} placeholder={SAMPLE_CSV} aria-label="Contact rows" className="tabular text-xs" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => importContacts.mutate()} disabled={importContacts.isPending || !csvText.trim()}>
                  <UploadIcon aria-hidden />Import contacts
                </Button>
                <Button asChild variant="secondary">
                  <label>
                    <PaperclipIcon aria-hidden />Choose file
                    <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.target.value = ""; }} />
                  </label>
                </Button>
              </div>
              {importResult ? (
                <Note tone={importResult.invalid.length ? "warn" : "success"} className="mt-3">
                  <div>Imported {importResult.imported} · duplicates skipped {importResult.skipped} · invalid {importResult.invalid.length}</div>
                  {importResult.invalid.length ? (
                    <ul className="m-0 mt-1 list-disc pl-4">
                      {importResult.invalid.slice(0, 10).map((item, index) => <li key={index}>{item.row_number ? `Row ${item.row_number}: ` : ""}{item.error}</li>)}
                      {importResult.invalid.length > 10 ? <li>and {importResult.invalid.length - 10} more</li> : null}
                    </ul>
                  ) : null}
                </Note>
              ) : null}
            </Card>

            <Card>
              <CardHeader title="Add a contact" />
              <FieldGrid>
                <Field label="Name"><Input value={contactForm.full_name} onChange={(event) => setContactForm({ ...contactForm, full_name: event.target.value })} /></Field>
                <Field label="Company"><Input value={contactForm.company} onChange={(event) => setContactForm({ ...contactForm, company: event.target.value })} /></Field>
                <Field label="WhatsApp number" help="With country code; a bare 10-digit number is read as +91."><Input value={contactForm.phone} onChange={(event) => setContactForm({ ...contactForm, phone: event.target.value })} placeholder="+91 98765 43210" /></Field>
                <Field label="Email (optional)"><Input value={contactForm.email} onChange={(event) => setContactForm({ ...contactForm, email: event.target.value })} /></Field>
                <Field label="Designation"><Input value={contactForm.designation} onChange={(event) => setContactForm({ ...contactForm, designation: event.target.value })} /></Field>
                <Field label="Status">
                  <Select value={contactForm.status} onChange={(event) => setContactForm({ ...contactForm, status: event.target.value })}>
                    {CONTACT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </Select>
                </Field>
                <Field label="Notes" wide><Textarea value={contactForm.notes} onChange={(event) => setContactForm({ ...contactForm, notes: event.target.value })} /></Field>
              </FieldGrid>
              <div className="mt-3">
                <Button variant="primary" onClick={() => addContact.mutate()} disabled={addContact.isPending}><PlusIcon aria-hidden />Add contact</Button>
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="templates" className="grid gap-4 pt-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Templates" aside={<Count>{templateList.length}</Count>} />
            {templateList.length ? (
              <ul className="m-0 grid list-none gap-2 p-0">
                {templateList.map((template) => (
                  <li key={template.id} className="rounded-sm border border-line bg-canvas p-3">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-ink">{template.name}</strong>
                      <Button variant="quiet" size="sm" onClick={() => removeTemplate.mutate(template.id)}>Delete</Button>
                    </div>
                    <p className="mt-1 mb-0 text-sm whitespace-pre-wrap text-ink-2">{template.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No templates yet">Write one on the right and reuse it for every recruiter.</EmptyState>
            )}
          </Card>
          <Card>
            <CardHeader title="New template" description="Variables: {{hr_name}}, {{company_name}}, {{job_title}}. Only use skills and experience that are true for you." />
            <div className="grid gap-3">
              <Field label="Name"><Input value={templateForm.name} onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })} /></Field>
              <Field label="Message" help={`${templateForm.body.length} characters`}><Textarea rows={7} value={templateForm.body} onChange={(event) => setTemplateForm({ ...templateForm, body: event.target.value })} /></Field>
              <div><Button variant="primary" onClick={() => addTemplate.mutate()} disabled={addTemplate.isPending}>Save template</Button></div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="schedule" className="pt-4">
          <Card className="max-w-3xl">
            <CardHeader title="Add to queue" description="Pick a contact, template and resume, check the personalised message, and set when you want the reminder." />
            <FieldGrid>
              <Field label="Contact">
                <Select value={scheduleForm.contact_id} onChange={(event) => setScheduleForm({ ...scheduleForm, contact_id: event.target.value, message: "" })}>
                  <option value="">Select a contact</option>
                  {contactList.filter((contact) => contact.status !== "Do not contact").map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name} · {contact.company}</option>)}
                </Select>
              </Field>
              <Field label="Template">
                <Select value={scheduleForm.template_id} onChange={(event) => setScheduleForm({ ...scheduleForm, template_id: event.target.value, message: "" })}>
                  <option value="">Select a template</option>
                  {templateList.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </Select>
              </Field>
              <Field label="Resume" help={selectedResume && selectedResume.available === false ? "This file is missing. Pick another resume." : "Attach it yourself in WhatsApp."}>
                <Select value={scheduleForm.resume_id} onChange={(event) => setScheduleForm({ ...scheduleForm, resume_id: event.target.value })}>
                  <option value="">No resume</option>
                  {resumeList.map((resume) => <option key={resume.id} value={resume.id}>{resume.name || resume.original_filename || "Resume"}</option>)}
                </Select>
              </Field>
              <Field label="Remind me at"><Input type="datetime-local" value={scheduleForm.send_at} onChange={(event) => setScheduleForm({ ...scheduleForm, send_at: event.target.value })} /></Field>
              <Field label="Message" wide help={preview.missing.length ? `Not filled: ${preview.missing.join(", ")}. Edit the message before queueing.` : `${(scheduleForm.message || preview.text).length} characters. Edit to override the template.`}>
                <Textarea rows={6} value={scheduleForm.message || preview.text} onChange={(event) => setScheduleForm({ ...scheduleForm, message: event.target.value })} />
              </Field>
            </FieldGrid>
            <div className="mt-3">
              <Button variant="primary" onClick={() => addSchedule.mutate()} disabled={addSchedule.isPending || !scheduleForm.contact_id || !scheduleForm.template_id}>Add to queue</Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="queue" className="grid gap-4 pt-4">
          <Card>
            <CardHeader title="Awaiting you" aside={<Count>{pending.length}</Count>} />
            {pending.length ? (
              <ul className="m-0 grid list-none gap-3 p-0">
                {pending.map((item) => (
                  <li key={item.id} className="rounded-sm border border-line bg-canvas p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm text-ink">{item.contact?.full_name ?? "Contact"} <span className="font-normal text-ink-2">· {item.contact?.company}</span></strong>
                      <Pill tone={new Date(item.send_at).getTime() <= now ? "warn" : "outline"}>{new Date(item.send_at).getTime() <= now ? "Due" : formatDate(item.send_at)}</Pill>
                    </div>
                    <p className="my-2 text-sm whitespace-pre-wrap text-ink-2">{item.message}</p>
                    <KeyValue className="mb-3" items={[["Resume", item.resume?.id ? (item.resume.name || item.resume.original_filename || "Selected resume") : "None"]]} />
                    <div className="flex flex-wrap gap-2">
                      {item.contact ? (
                        <Button variant="primary" size="sm" asChild>
                          <a href={whatsappLink(item.contact.phone, item.message)} target="_blank" rel="noreferrer"><ExternalLinkIcon aria-hidden />Open WhatsApp</a>
                        </Button>
                      ) : null}
                      <Button size="sm" onClick={() => void copyMessage(item.message)}><CopyIcon aria-hidden />Copy message</Button>
                      <Button size="sm" onClick={() => markResult.mutate({ id: item.id, result: "sent" })}><SendIcon aria-hidden />I sent it</Button>
                      <Button variant="quiet" size="sm" onClick={() => markResult.mutate({ id: item.id, result: "skipped" })}>Skip</Button>
                      <Button variant="quiet" size="sm" onClick={() => markResult.mutate({ id: item.id, result: "failed" })}>Mark failed</Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing waiting">Add contacts to the queue from the Schedule tab.</EmptyState>
            )}
          </Card>

          {done.length ? (
            <Card>
              <CardHeader title="History" aside={<Count>{done.length}</Count>} />
              <ul className="m-0 grid list-none gap-2 p-0">
                {done.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-ink">{item.contact?.full_name ?? "Contact"} <span className="text-ink-2">· {item.contact?.company}</span></span>
                    <span className="flex items-center gap-2"><span className="tabular text-xs text-ink-3">{formatDate(item.send_at)}</span><Pill tone={resultTone(item.result)}>{resultLabel(item.result)}</Pill></span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
