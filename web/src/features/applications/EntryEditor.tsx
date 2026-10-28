import { ChevronLeftIcon, ExternalLinkIcon, MoreHorizontalIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Link } from "react-router";
import { useLoadedState, useReloadState } from "@/api/state";
import type { Entry } from "@/api/types";
import { Button, IconButton } from "@/components/ui/button";
import { CheckLine, Field, FieldGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Note } from "@/components/ui/note";
import { Pill, toneFor } from "@/components/ui/pill";
import { AttentionDot, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { deliveryCategory, deliveryLabel, resumeChoices, stageIsAfterApply, stageOptions } from "@/lib/domain";
import { usableLink } from "@/lib/format";
import { tailoredFor } from "./actions";
import { isEditable, stageEditable, type EntryForm } from "./form";
import { progressSteps } from "./progress";
import { SubmissionCard } from "./SubmissionCard";

export type EditorTab = "overview" | "details" | "resume" | "email";

function ProgressStrip({ entry }: { entry: Entry }) {
  return (
    <ol id="editor-progress" className="m-0 grid list-none grid-cols-5 gap-1 p-0" aria-label="Application progress">
      {progressSteps(entry).map((step) => (
        <li
          key={step.label}
          className={cn("step grid gap-0.5 border-t-[3px] pt-1.5", step.state, step.warn && "warn", {
            "border-success": step.state === "done",
            "border-accent": step.state === "current" && !step.warn,
            "border-warn": step.state === "current" && step.warn,
            "border-line": step.state === "todo",
          })}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <b className="text-xs font-semibold text-ink">{step.label}</b>
          <span className="truncate text-xs text-ink-3">{step.detail}</span>
        </li>
      ))}
    </ol>
  );
}

function LinkField({ form, disabled }: { form: UseFormReturn<EntryForm>; disabled: boolean }) {
  const href = usableLink(useWatch({ control: form.control, name: "apply_url" }));
  return (
    <Field label="Apply link" help="The employer's application page">
      <span className="flex gap-1.5">
        <Input type="url" placeholder="https://" disabled={disabled} {...form.register("apply_url")} />
        <Button asChild={Boolean(href)} size="icon" variant="secondary" disabled={!href} aria-label="Open application link" title="Open application link">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon aria-hidden />
            </a>
          ) : (
            <ExternalLinkIcon aria-hidden />
          )}
        </Button>
      </span>
    </Field>
  );
}

function ResumeTab({
  entry,
  form,
  editable,
  onOpenEditor,
  submissionRequest,
}: {
  entry: Entry;
  form: UseFormReturn<EntryForm>;
  editable: boolean;
  onOpenEditor: (mode: "optimize" | "edit") => void;
  submissionRequest: { channel: string; at: number } | null;
}) {
  const state = useLoadedState();
  const reload = useReloadState();
  const selected = entry.resume_status === "Resume Selected";
  const version = entry.resume_version;
  const unpin = async () => {
    try {
      await api(`/api/entries/${entry.id}`, "PATCH", { resume_version_id: "" });
      await reload();
      notify("This application now follows the resume's current version.");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  };
  const choices = resumeChoices(state.resumes, entry.id, entry.resume_id);
  const unavailable = entry.resume_id && !state.resumes.some((resume) => resume.id === entry.resume_id);
  const attached = version && entry.attachment_sha256 ? (entry.attachment_sha256 === version.sha256 ? " · matches the last attached file" : " · differs from the last attached file") : "";
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-md border border-line bg-surface p-4">
        <div className="grid gap-0.5">
          <strong className="text-sm">Assigned resume</strong>
          <span className={cn("text-xs", selected ? "text-success" : "text-danger")}>
            {selected && entry.resume ? `Resume Selected · ${entry.resume.name} · ${entry.resume.category}` : "Resume Missing · choose one before sending"}
          </span>
          {version ? (
            <span id="resume-version-line" className="text-xs text-ink-2">
              Attaches version {version.version_number} · {version.filename} ·{" "}
              {version.pinned ? `pinned to this exact file${version.is_current ? "" : " (a newer version exists)"}` : "follows the resume's current version"}
              {attached}
              {version.pinned ? (
                <Button variant="text" className="ml-2 text-xs" onClick={unpin} data-entry-resume="unpin">
                  Follow current version
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-64 flex-1">
            <span className="sr-only">Assigned resume</span>
            <Select disabled={!editable} {...form.register("resume_id")}>
              <option value="">Choose a resume</option>
              {choices.map(({ resume, label }) => (
                <option key={resume.id} value={resume.id} disabled={!resume.available}>
                  {label}
                </option>
              ))}
              {unavailable ? (
                <option value={entry.resume_id} disabled>
                  {(entry.resume?.name || "Previously selected resume") + " · Unavailable"}
                </option>
              ) : null}
            </Select>
          </label>
          <Button asChild variant="quiet">
            <Link to="/resumes">Manage resumes</Link>
          </Button>
        </div>
        {entry.resume_id && entry.resume?.available && editable ? (
          <div className="flex flex-wrap gap-2">
            <Button data-entry-resume="optimize" onClick={() => onOpenEditor("optimize")}>
              {tailoredFor(entry, state.resumes) ? "Edit tailored resume" : "Optimize resume for this job"}
            </Button>
            {entry.resume.kind === "master" ? (
              <Button variant="quiet" data-entry-resume="edit" onClick={() => onOpenEditor("edit")}>
                Edit master
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <SubmissionCard entry={entry} openRequest={submissionRequest} />
    </div>
  );
}

function EmailTab({ entry, form, editable, open, onToggle }: { entry: Entry; form: UseFormReturn<EntryForm>; editable: boolean; open: boolean; onToggle: () => void }) {
  const isPost = entry.kind === "post";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="grid gap-0.5">
          <strong className="text-sm">{isPost ? "Send an application email" : "Email application"}</strong>
          <small className="text-xs text-ink-2">
            {isPost ? "Optional. Use this only when the post asks candidates to apply by email." : "Optional. Open this only when you want to contact the employer by email."}
          </small>
        </span>
        <Button aria-expanded={open} aria-controls="email-section-fields" onClick={onToggle} disabled={!editable}>
          {open ? "Hide email fields" : "Use email for this application"}
        </Button>
      </div>
      <div id="email-section-fields" hidden={!open} className="grid gap-3">
        <Note tone="info">
          <strong>Email content</strong>{" "}
          {isPost
            ? "Emails detected in the post are saved above as reference. Choose one recipient here only when you intend to send an application."
            : "Choose one recipient, then write the subject and message. Nothing is sent until you choose and confirm a delivery action."}
        </Note>
        <Field label="Recipient email" help="The single address that will receive this application">
          <Input type="email" placeholder="hiring@company.com" disabled={!editable} {...form.register("recipient")} />
        </Field>
        <Field label="Subject">
          <Input placeholder="Application for..." disabled={!editable} {...form.register("subject")} />
        </Field>
        <Field label="Message">
          <Textarea rows={16} placeholder="Write your application email here..." disabled={!editable} {...form.register("body")} />
        </Field>
        <div className="grid gap-3 rounded-md border border-line bg-surface-2 p-3 md:grid-cols-2">
          <div>
            <strong className="text-sm">Delivery timing</strong>
            <p className="m-0 text-xs text-ink-2">Only for ApplyDock's local 9 AM sender. Gmail scheduling happens in Gmail.</p>
          </div>
          <Field label="Local 9 AM send date" help="Leave empty when using Gmail drafts">
            <Input type="datetime-local" step={60} disabled={!editable} {...form.register("send_at")} />
          </Field>
        </div>
      </div>
    </div>
  );
}

export function EntryEditor({
  entry,
  form,
  tab,
  onTabChange,
  onSave,
  saving,
  onDelete,
  onAnalysis,
  onOpenEditor,
  submissionRequest,
  mobileBack,
}: {
  entry: Entry;
  form: UseFormReturn<EntryForm>;
  tab: EditorTab;
  onTabChange: (tab: EditorTab) => void;
  onSave: () => void;
  saving: boolean;
  onDelete: () => void;
  onAnalysis: () => void;
  onOpenEditor: (mode: "optimize" | "edit") => void;
  submissionRequest: { channel: string; at: number } | null;
  mobileBack: ReactNode;
}) {
  const state = useLoadedState();
  const editable = isEditable(entry);
  const canStage = stageEditable(entry);
  const isPost = entry.kind === "post";
  const [emailOpen, setEmailOpen] = useState(() => entry.apply_method === "email" || Boolean(entry.recipient || entry.subject || entry.body || entry.gmail_draft_id || entry.send_at));
  const stage = useWatch({ control: form.control, name: "application_stage" });

  const alerts = [
    Boolean(entry.needs_review) && !stageIsAfterApply(entry.application_stage) && "Check captured details before you apply.",
    entry.sync_error && `Notion sync: ${entry.sync_error}`,
    entry.send_error && `Email: ${entry.send_error}`,
    Boolean(entry.gmail_dirty) && "Local changes need an updated Gmail draft.",
    entry.resume_status === "Resume Missing" && "Resume missing. Choose an available resume before preparing or sending this application.",
  ].filter(Boolean) as string[];

  const toggleEmail = () => {
    const opening = !emailOpen;
    if (opening && form.getValues("apply_method") !== "email") form.setValue("apply_method", "email", { shouldDirty: true });
    setEmailOpen(opening);
  };
  const methodField = form.register("apply_method");
  const stageField = form.register("application_stage");

  return (
    <div id="editor-view" className="grid gap-4">
      {mobileBack}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="editor-title" className="m-0 text-xl font-semibold">
            {entry.title || "Untitled opportunity"}
          </h2>
          <p className="m-0 mt-0.5 text-sm text-ink-2">
            {entry.company || "Company not set"} · {entry.platform || "Other"} <span className="text-ink-3">· {isPost ? "Hiring post" : "Job"}</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Pill tone="outline">{entry.application_stage || "Stage not set"}</Pill>
          <Pill tone={toneFor(deliveryCategory(entry))}>{deliveryLabel(entry)}</Pill>
          {entry.status !== "sending" ? (
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="More actions">
                  <MoreHorizontalIcon aria-hidden />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuItem danger onSelect={onDelete}>
                  Remove from ApplyDock
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : null}
        </div>
      </div>
      <ProgressStrip entry={entry} />
      <Tabs value={tab} onValueChange={(value) => (value === "analysis" ? onAnalysis() : onTabChange(value as EditorTab))}>
        <TabsList aria-label="Application sections">
          <TabsTrigger value="overview" data-editor-tab="overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="details" data-editor-tab="details">
            Job details
          </TabsTrigger>
          <TabsTrigger value="resume" data-editor-tab="resume">
            Resume
            {entry.resume_status !== "Resume Selected" ? <AttentionDot label="needs attention" /> : null}
          </TabsTrigger>
          <TabsTrigger value="email" data-editor-tab="email">
            Email
          </TabsTrigger>
          <TabsTrigger value="analysis" data-editor-tab="analysis">
            Analysis
          </TabsTrigger>
        </TabsList>
        {alerts.length ? (
          <div className="mt-3 grid gap-2" id="editor-alerts">
            {alerts.map((message) => (
              <Note key={message} tone="warn">
                {message}
              </Note>
            ))}
          </div>
        ) : null}
        <form
          id="editor-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
          className="mt-4"
        >
          {/* Panes stay mounted (forceMount + hidden) so every field keeps its registered value across tabs. */}
          <TabsContent value="overview" forceMount hidden={tab !== "overview"} data-pane="overview" className="grid gap-3">
            <FieldGrid>
              <Field label="Role or post title" error={form.formState.errors.title?.message}>
                <Input maxLength={300} disabled={!editable} aria-invalid={Boolean(form.formState.errors.title)} {...form.register("title", { required: "Add a title." })} />
              </Field>
              <Field label="Company">
                <Input maxLength={300} disabled={!editable} {...form.register("company")} />
              </Field>
            </FieldGrid>
            <FieldGrid>
              <Field label="Application stage" help="Your progress; synced with Notion">
                <Select
                  disabled={!canStage}
                  {...stageField}
                  onChange={(event) => {
                    void stageField.onChange(event);
                    if (stageIsAfterApply(event.target.value)) form.setValue("needs_review", false, { shouldDirty: true });
                  }}
                >
                  <option value="">Not set</option>
                  {stageOptions(state, stage).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Application route" help="How you will apply">
                <Select
                  disabled={!editable}
                  {...methodField}
                  onChange={(event) => {
                    void methodField.onChange(event);
                    setEmailOpen(event.target.value === "email");
                  }}
                >
                  <option value="unknown">Not decided</option>
                  <option value="email">Email application</option>
                  <option value="external_form">External application form</option>
                </Select>
              </Field>
            </FieldGrid>
            <LinkField form={form} disabled={!editable} />
            <div className="grid gap-0.5 text-sm">
              <span className="font-medium">Source link</span>
              <span className="text-xs text-ink-3">Captured from the original posting</span>
              <a id="source-link" href={entry.url} target="_blank" rel="noopener noreferrer" className="truncate">
                {entry.url}
              </a>
            </div>
            <CheckLine disabled={!editable} {...form.register("needs_review")}>
              Needs more review
            </CheckLine>
          </TabsContent>
          <TabsContent value="details" forceMount hidden={tab !== "details"} data-pane="details" className="grid gap-3">
            <Field label="Job or post text" help="Used for ATS analysis">
              <Textarea rows={14} placeholder="The details you selected from the posting" disabled={!editable} {...form.register("excerpt")} />
            </Field>
            <Field
              label={isPost ? "Emails mentioned in this post" : "Contact emails"}
              help={isPost ? "Saved as post reference. These addresses are not emailed automatically." : "Saved as reference. One address per line."}
            >
              <Textarea rows={3} placeholder="hiring@company.com" disabled={!editable} {...form.register("contact_emails")} />
            </Field>
            <Field label={isPost ? "Post instructions and contact notes" : "Application notes or instructions"}>
              <Textarea rows={4} placeholder="Application instructions, deadline, location, or contact person" disabled={!editable} {...form.register("post_details")} />
            </Field>
          </TabsContent>
          <TabsContent value="resume" forceMount hidden={tab !== "resume"} data-pane="resume">
            <ResumeTab entry={entry} form={form} editable={editable} onOpenEditor={onOpenEditor} submissionRequest={submissionRequest} />
          </TabsContent>
          <TabsContent value="email" forceMount hidden={tab !== "email"} data-pane="email">
            <EmailTab entry={entry} form={form} editable={editable} open={emailOpen} onToggle={toggleEmail} />
          </TabsContent>
          <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas py-3">
            <p className="m-0 text-xs text-ink-3">
              {editable ? "Changes to an approved item remove its approval; stage-only changes keep it approved." : "Email delivery is locked, but you can still update the application stage."}
            </p>
            <Button id="save-button" type="submit" variant="primary" disabled={saving || (!editable && !canStage)}>
              {editable ? "Save changes" : "Save stage"}
            </Button>
          </div>
        </form>
      </Tabs>
    </div>
  );
}

export function MobileBack({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="quiet" size="sm" className="-ml-2 justify-self-start md:hidden" onClick={onClick}>
      <ChevronLeftIcon aria-hidden />
      Applications
    </Button>
  );
}
