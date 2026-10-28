import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useResumeUsage } from "@/api/resumes";
import { useLoadedState, useReloadState } from "@/api/state";
import type { Entry, Resume } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { useDialogs } from "@/components/ui/confirm";
import { CheckLine, Field, FieldGrid, Input } from "@/components/ui/field";
import { BackButton, Count, EmptyState, Page, PageHeading } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill } from "@/components/ui/pill";
import { notify } from "@/components/ui/toaster";
import { editorPath } from "@/features/applications/actions";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { bytesLabel, dateLabel, filePayload, plural, shortDate } from "@/lib/format";
import { deleteWarning, fileExtension, isPdf, orderResumes, RESUME_CATEGORIES } from "./model";

const CATEGORY_LIST = "resume-categories";
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const COLUMNS = "md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_64px_minmax(0,1fr)_minmax(0,1.2fr)_72px]";

function CategoryList() {
  return (
    <datalist id={CATEGORY_LIST}>
      {RESUME_CATEGORIES.map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  );
}

function UploadForm({ count, onDone }: { count: number; onDone: () => void }) {
  const reload = useReloadState();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    try {
      const payload = await filePayload(fields.get("file") as File | null);
      await api("/api/resumes", "POST", {
        ...payload,
        display_name: String(fields.get("display_name") ?? ""),
        category: String(fields.get("category") ?? ""),
        is_default: fields.get("is_default") === "on",
      });
      form.reset();
      await reload();
      notify("Resume saved to your private local library.");
      onDone();
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mb-4">
      <CardHeader title="Upload a resume" aside={<Count>{count} saved</Count>} />
      <form onSubmit={submit} className="grid gap-3" aria-label="Upload a resume">
        <FieldGrid>
          <Field label="Resume name">
            <Input name="display_name" required maxLength={120} placeholder="Full Stack Resume" />
          </Field>
          <Field label="Category">
            <Input name="category" list={CATEGORY_LIST} required maxLength={80} placeholder="Full Stack Developer" />
          </Field>
        </FieldGrid>
        <Field label="PDF or DOCX file">
          <Input name="file" type="file" accept={ACCEPT} required className="h-auto py-1.5" />
        </Field>
        <CheckLine name="is_default">Use as the default for new applications</CheckLine>
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            Upload resume
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Usage({ resume }: { resume: Resume }) {
  const [open, setOpen] = useState(false);
  const usage = useResumeUsage(resume.id, open);
  const navigate = useNavigate();
  const count = Number(resume.submission_count || 0);
  const sentEntries = new Set((usage.data?.submissions ?? []).map((item) => item.entry_id));
  const linked = (usage.data?.applications ?? []).filter((item) => !sentEntries.has(item.id));
  return (
    <details className="rounded-sm border border-line" onToggle={(event) => setOpen(event.currentTarget.open)} data-testid="resume-usage">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Submitted to {count} {plural(count, "application")} — show where
      </summary>
      <div className="grid gap-2 border-t border-line px-3 py-2 text-sm" data-testid="resume-usage-list" aria-live="polite">
        {usage.isPending ? (
          <p className="m-0 text-xs text-ink-3">Loading…</p>
        ) : usage.error ? (
          <p className="m-0 text-xs text-danger">{errorMessage(usage.error)}</p>
        ) : (
          <>
            {usage.data?.submissions.length ? (
              <div className="grid gap-1">
                <strong>Submitted</strong>
                <ul className="m-0 grid gap-1.5 pl-4">
                  {usage.data.submissions.map((item) => (
                    <li key={item.id}>
                      <a href={item.file_url} target="_blank" rel="noopener noreferrer">
                        {item.company || "Company not set"} — {item.title}
                      </a>
                      <small className="block text-xs text-ink-3">
                        v{item.version_number}
                        {item.resume_id !== resume.id ? " of the tailored copy" : ""} · {dateLabel(item.submitted_at)} · {item.channel_label}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="m-0 text-xs text-ink-3">No recorded submissions yet.</p>
            )}
            {linked.length ? (
              <div className="grid gap-1">
                <strong>Attached, not submitted</strong>
                <ul className="m-0 grid gap-1.5 pl-4">
                  {linked.map((item) => (
                    <li key={item.id}>
                      <Button variant="text" onClick={() => navigate(`/applications/${item.id}`)}>
                        {item.company || "Company not set"} — {item.title}
                      </Button>
                      <small className="block text-xs text-ink-3">
                        {item.version_number ? `pinned to v${item.version_number}` : "follows the current version"} · not submitted yet
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </details>
  );
}

function Detail({ resume, entries }: { resume: Resume; entries: Entry[] }) {
  const reload = useReloadState();
  const navigate = useNavigate();
  const { confirm } = useDialogs();
  const [busy, setBusy] = useState(false);
  const assigned = entries.filter((entry) => entry.resume_id === resume.id).length;
  const pdf = isPdf(resume);
  const previewUrl = resume.preview_url || resume.file_url;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const file = fields.get("file") as File | null;
      await api(`/api/resumes/${resume.id}`, "PATCH", {
        name: String(fields.get("name") ?? ""),
        category: String(fields.get("category") ?? ""),
        ...(file && file.size ? await filePayload(file) : {}),
      });
      await reload();
      notify("Resume details saved. Assigned applications and Notion were updated.");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  };

  const makeDefault = async () => {
    setBusy(true);
    try {
      await api(`/api/resumes/${resume.id}`, "PATCH", { is_default: true });
      await reload();
      notify("Default resume updated.");
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: "Delete resume?", message: deleteWarning(resume, assigned), confirmLabel: "Delete", danger: true }))) return;
    setBusy(true);
    try {
      const result = await api<{ applications_needing_resume?: number }>(`/api/resumes/${resume.id}`, "DELETE");
      navigate("/resumes", { replace: true });
      await reload();
      notify(`Resume deleted locally. ${result.applications_needing_resume || 0} application(s) need reassignment.`);
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]" data-testid="resume-detail">
      <Card className="grid content-start gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 flex flex-wrap items-center gap-2 text-lg font-semibold">
              {resume.name}
              {resume.is_default ? <Pill tone="accent">Default</Pill> : null}
            </h2>
            <small className="text-xs text-ink-3">
              Document preview · {bytesLabel(resume.size_bytes)} · {pdf ? "PDF" : "DOCX"}
            </small>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => navigate(editorPath(resume.id, { entryId: resume.entry_id || undefined }))}>
              {resume.has_draft ? "Edit in ApplyDock" : "Import & edit"}
            </Button>
            <Button asChild>
              <a href={previewUrl} target="_blank" rel="noreferrer">
                Preview
              </a>
            </Button>
            <Button asChild>
              <a href={`${resume.file_url}&download=1`} download>
                Download
              </a>
            </Button>
          </div>
        </div>
        {pdf ? (
          <iframe className="h-[min(80vh,900px)] w-full rounded-sm border border-line bg-surface-2" src={`${previewUrl}#toolbar=0&navpanes=0`} title={`Preview of ${resume.name}`} />
        ) : (
          <div className="grid justify-items-center gap-1 rounded-sm border border-dashed border-line-strong px-4 py-12 text-center text-sm">
            <Pill tone="accent">DOC</Pill>
            <strong>{resume.original_filename}</strong>
            <span className="text-ink-2">Open Preview to inspect this DOCX file.</span>
          </div>
        )}
      </Card>
      <Card className="content-start">
        {/* Keyed by the resume so switching rows resets the uncontrolled fields to that resume's values. */}
        <form key={`${resume.id}:${resume.updated_at}`} onSubmit={save} className="grid gap-3" aria-label="Document details">
          <h2 className="m-0 text-lg font-semibold">Document details</h2>
          <p className="m-0 text-xs text-ink-3">
            Version {resume.current_version_number || 1} · {pdf ? "PDF" : "DOCX"} · used by {assigned} {plural(assigned, "application")}
          </p>
          <Usage resume={resume} />
          {resume.extraction_status !== "ready" ? <Note tone="warn">{resume.extraction_error || "Resume text extraction needs attention."}</Note> : null}
          <Field label="Name">
            <Input name="name" defaultValue={resume.name} maxLength={120} required />
          </Field>
          <Field label="Category">
            <Input name="category" list={CATEGORY_LIST} defaultValue={resume.category} maxLength={80} required />
          </Field>
          <Field label="Replace file" help="Optional PDF or DOCX, up to 8 MB">
            <Input name="file" type="file" accept=".pdf,.docx" className="h-auto py-1.5" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              Save details
            </Button>
            {resume.is_default ? null : (
              <Button variant="quiet" onClick={makeDefault} disabled={busy}>
                Make default
              </Button>
            )}
            <Button variant="danger" onClick={remove} disabled={busy}>
              Delete
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default function ResumeLibraryPage() {
  const state = useLoadedState();
  const navigate = useNavigate();
  const { resumeId } = useParams();
  const [uploading, setUploading] = useState(false);
  const library = state.resumes;
  const ordered = orderResumes(library);
  const selected = library.find((resume) => resume.id === resumeId) ?? library[0] ?? null;
  const linked = state.entries.filter((entry) => entry.resume_id).length;

  return (
    <Page>
      <BackButton onClick={() => navigate("/")}>Applications</BackButton>
      <PageHeading
        className="mt-2"
        title="Resumes"
        description="Your resume library. Files stay on this device."
        actions={
          <Button variant="primary" onClick={() => setUploading((value) => !value)} aria-expanded={uploading}>
            {uploading ? "Close upload" : "Upload resume"}
          </Button>
        }
      />
      <CategoryList />
      {uploading ? <UploadForm count={library.length} onDone={() => setUploading(false)} /> : null}
      {!library.length ? (
        <Card>
          <EmptyState title="No resumes saved yet.">Use Upload resume to add a reusable PDF or DOCX.</EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-4 text-sm text-ink-2" data-testid="resume-stats">
            <span>
              <strong className="tabular text-ink">{library.length}</strong> {plural(library.length, "resume")}
            </span>
            <span>
              <strong className="tabular text-ink">{linked}</strong> linked {plural(linked, "application")}
            </span>
          </div>
          <div className="overflow-hidden rounded-md border border-line bg-surface" aria-label="Resume library" role="group" data-testid="resume-table">
            <div className={cn("hidden gap-3 border-b border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink-3 md:grid", COLUMNS)} aria-hidden>
              <span>Resume</span>
              <span>Category</span>
              <span>Version</span>
              <span>Last updated</span>
              <span>Usage</span>
              <span>Default</span>
            </div>
            {ordered.map((resume) => {
              const assigned = state.entries.filter((entry) => entry.resume_id === resume.id).length;
              const extension = fileExtension(resume);
              const tailored = resume.kind === "tailored";
              const tailoredEntry = tailored ? state.entries.find((entry) => entry.id === resume.entry_id) : null;
              const subtitle = tailored ? `Tailored · ${tailoredEntry ? tailoredEntry.company || tailoredEntry.title : "application removed"}` : resume.original_filename;
              const current = resume.id === selected?.id;
              return (
                <button
                  key={resume.id}
                  type="button"
                  onClick={() => navigate(`/resumes/${resume.id}`)}
                  aria-pressed={current}
                  data-resume-select={resume.id}
                  data-kind={resume.kind}
                  className={cn(
                    "grid w-full cursor-pointer grid-cols-1 items-center gap-1 border-b border-line px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-surface-2 md:gap-3",
                    COLUMNS,
                    current && "bg-accent-soft hover:bg-accent-soft",
                    tailored && "md:pl-8",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <b className={cn("tabular shrink-0 rounded-sm px-1.5 py-0.5 text-xs", extension === "PDF" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent")}>
                      {extension === "DOCX" ? "DOC" : extension}
                    </b>
                    <span className="min-w-0">
                      <strong className="block truncate">{resume.name}</strong>
                      <small className="block truncate text-xs text-ink-3">{subtitle}</small>
                    </span>
                  </span>
                  <span className="truncate text-ink-2">{resume.category}</span>
                  <span className="tabular text-ink-2">v{resume.current_version_number || 1}</span>
                  <span className="text-ink-2">{shortDate(resume.updated_at || resume.created_at) || "—"}</span>
                  <span className="text-ink-2">
                    {assigned} {plural(assigned, "application")}
                    {resume.submission_count ? ` · ${resume.submission_count} sent` : ""}
                  </span>
                  <span>{resume.is_default ? <Pill tone="accent">Default</Pill> : <span className="text-ink-3">—</span>}</span>
                </button>
              );
            })}
          </div>
          {selected ? <Detail resume={selected} entries={state.entries} /> : null}
        </>
      )}
    </Page>
  );
}
