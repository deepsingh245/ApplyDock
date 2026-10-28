import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router";
import { useLoadedState, useReloadState } from "@/api/state";
import type { ApplyMethod, Entry } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckLine, Field, Input, Select, Textarea } from "@/components/ui/field";
import { BackButton, Page, PageHeading } from "@/components/ui/misc";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { resumeChoices } from "@/lib/domain";
import { usableLink } from "@/lib/format";

interface CreateForm {
  url: string;
  title: string;
  company: string;
  kind: "job" | "post";
  apply_method: ApplyMethod;
  excerpt: string;
  contact_emails: string;
  post_details: string;
  apply_url: string;
  recipient: string;
  resume_id: string;
  needs_review: boolean;
}

export default function CreateApplicationPage() {
  const state = useLoadedState();
  const reload = useReloadState();
  const navigate = useNavigate();
  const defaultResume = state.resumes.find((resume) => resume.is_default && resume.kind !== "tailored" && resume.available);
  const form = useForm<CreateForm>({
    defaultValues: {
      url: "",
      title: "",
      company: "",
      kind: "job",
      apply_method: "unknown",
      excerpt: "",
      contact_emails: "",
      post_details: "",
      apply_url: "",
      recipient: "",
      resume_id: defaultResume?.id ?? "",
      needs_review: true,
    },
  });
  const [kind, applyUrl] = useWatch({ control: form.control, name: ["kind", "apply_url"] });
  const [emailOpen, setEmailOpen] = useState(false);
  const isPost = kind === "post";
  const link = usableLink(applyUrl);
  const errors = form.formState.errors;
  const methodField = form.register("apply_method");

  const toggleEmail = () => {
    const opening = !emailOpen;
    if (opening) form.setValue("apply_method", "email");
    setEmailOpen(opening);
  };

  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await api<{ entry: Entry; duplicate: boolean }>("/api/capture", "POST", values);
      await reload();
      navigate(`/applications/${result.entry.id}`);
      notify(result.duplicate ? "Already captured. Opened the existing item." : "Saved locally and synced to Notion when available.");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  });

  return (
    <Page id="create-view">
      <BackButton onClick={() => navigate("/")}>Applications</BackButton>
      <PageHeading className="mt-2" title="Add a job or hiring post" description="Paste a specific posting. Check the details before saving." />
      <Card>
        <form id="create-form" noValidate onSubmit={submit} className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          <Field label="Posting URL" wide error={errors.url?.message}>
            <Input type="url" placeholder="https://" aria-invalid={Boolean(errors.url)} {...form.register("url", { required: "Paste the posting URL." })} />
          </Field>
          <Field label="Title" error={errors.title?.message}>
            <Input aria-invalid={Boolean(errors.title)} {...form.register("title", { required: "Add a title." })} />
          </Field>
          <Field label="Company">
            <Input {...form.register("company")} />
          </Field>
          <Field label="Type">
            <Select {...form.register("kind")}>
              <option value="job">Job</option>
              <option value="post">Hiring post</option>
            </Select>
          </Field>
          <Field label="Application route">
            <Select
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
          <Field label="Apply link">
            <span className="flex gap-1.5">
              <Input type="url" {...form.register("apply_url")} />
              <Button asChild={Boolean(link)} size="icon" disabled={!link} aria-label="Open application link" title="Open application link">
                {link ? (
                  <a href={link} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon aria-hidden />
                  </a>
                ) : (
                  <ExternalLinkIcon aria-hidden />
                )}
              </Button>
            </span>
          </Field>
          <Field label="Job or post text" wide>
            <Textarea rows={8} {...form.register("excerpt")} />
          </Field>
          <Field label={isPost ? "Emails mentioned in this post" : "Contact emails"} help="Saved as reference, one address per line">
            <Textarea rows={3} {...form.register("contact_emails")} />
          </Field>
          <Field label={isPost ? "Post instructions and contact notes" : "Application notes or instructions"} className="2xl:col-span-2">
            <Textarea rows={4} {...form.register("post_details")} />
          </Field>
          <div className="col-span-full grid gap-3 rounded-md border border-line">
            <button
              type="button"
              aria-expanded={emailOpen}
              aria-controls="create-email-fields"
              onClick={toggleEmail}
              className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-2"
            >
              <span className="grid gap-0.5">
                <strong className="text-sm">Email application</strong>
                <small className="text-xs text-ink-2">
                  {isPost ? "Use only when the post asks candidates to apply by email." : "Optional. Open only if you plan to email the employer."}
                </small>
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-accent">
                {emailOpen ? "Hide email" : "Add email"}
                <ChevronDownIcon className={cn("size-4 transition-transform", emailOpen && "rotate-180")} aria-hidden />
              </span>
            </button>
            <div id="create-email-fields" hidden={!emailOpen} className="grid gap-2 px-3 pb-3">
              <p className="m-0 text-xs text-ink-3">Choose one recipient. Saved contact emails above remain reference data.</p>
              <Field label="Recipient email">
                <Input type="email" placeholder="hiring@company.com" {...form.register("recipient")} />
              </Field>
            </div>
          </div>
          <Field label="Resume" help="The default resume is selected automatically">
            <Select {...form.register("resume_id")}>
              <option value="">Choose a resume</option>
              {resumeChoices(state.resumes.filter((resume) => resume.kind !== "tailored")).map(({ resume, label }) => (
                <option key={resume.id} value={resume.id} disabled={!resume.available}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="col-span-full flex flex-wrap items-center justify-between gap-3">
            <CheckLine {...form.register("needs_review")}>Needs more review</CheckLine>
            <Button type="submit" variant="primary" disabled={form.formState.isSubmitting}>
              Save
            </Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}
