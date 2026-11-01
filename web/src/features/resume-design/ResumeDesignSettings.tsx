// Settings → Resume design: the default design every new tailored resume (and new upload) starts with, edited with
// the same controls as the resume editor and previewed live on one of your own resumes.
import { useQuery } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { sameDesign, useDesignSettings, useUpdateDesignSettings, type DesignMode, type DesignSettings, type ResumeDesign } from "@/api/design";
import { useLoadedState } from "@/api/state";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill } from "@/components/ui/pill";
import { notify } from "@/components/ui/toaster";
import { api, apiBlob, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dateLabel } from "@/lib/format";
import { DesignCard, DesignControls, type DesignHandlers } from "./DesignControls";

const SECTION_FALLBACK: Record<string, string> = { custom: "Custom sections" };

function ModeChoice({ settings, onChange, busy }: { settings: DesignSettings; onChange: (mode: DesignMode) => void; busy: boolean }) {
  const options: { mode: DesignMode; title: string; body: string; disabled?: boolean }[] = [
    {
      mode: "default",
      title: "Use my default design",
      body: settings.default ? `Saved ${dateLabel(settings.default_updated_at)}. Every new tailored resume starts with it.` : "Save a default design below first.",
      disabled: !settings.default,
    },
    {
      mode: "last",
      title: "Follow the last design I edited",
      body: settings.last ? `Your last design change was ${dateLabel(settings.last_updated_at)}.` : "No design edited yet: new tailored resumes keep their master's design.",
    },
  ];
  return (
    <div role="radiogroup" aria-label="Design for new resumes" className="grid gap-2 md:grid-cols-2" data-testid="design-mode">
      {options.map((option) => {
        const active = settings.mode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={active}
            data-mode={option.mode}
            disabled={busy || option.disabled || active}
            onClick={() => onChange(option.mode)}
            className={cn(
              "grid gap-1 rounded-md border p-3 text-left transition-ledger transition-colors disabled:cursor-default",
              active ? "border-accent bg-accent-soft" : "border-line-strong bg-surface enabled:cursor-pointer enabled:hover:bg-surface-2",
              option.disabled && !active && "opacity-60",
            )}
          >
            <strong className="text-sm">{option.title}</strong>
            <span className="text-xs text-ink-2">{option.body}</span>
          </button>
        );
      })}
    </div>
  );
}

function OrderList({ design, titles, onChange }: { design: ResumeDesign; titles: Record<string, string>; onChange: (order: string[]) => void }) {
  const order = design.section_order;
  const move = (index: number, by: number) => {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    onChange(next);
  };
  return (
    <ol className="m-0 grid list-none gap-1.5 p-0" data-testid="default-section-order">
      {order.map((section, index) => {
        const label = design.section_titles[section] || titles[section] || SECTION_FALLBACK[section] || section;
        return (
          <li key={section} data-order-section={section} className="flex items-center gap-2 rounded-sm border border-line bg-surface px-2 py-1 text-sm">
            <span className="tabular w-5 text-xs text-ink-3">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <IconButton label={`Move ${label} up`} disabled={index === 0} onClick={() => move(index, -1)}>
              <ArrowUpIcon aria-hidden />
            </IconButton>
            <IconButton label={`Move ${label} down`} disabled={index === order.length - 1} onClick={() => move(index, 1)}>
              <ArrowDownIcon aria-hidden />
            </IconButton>
          </li>
        );
      })}
    </ol>
  );
}

/** Live PDF of the design on screen, rendered with the text of one of your resumes (nothing is saved). */
function Preview({ design }: { design: ResumeDesign }) {
  const state = useLoadedState();
  const candidates = state.resumes.filter((resume) => resume.has_draft && resume.available);
  const [resumeId, setResumeId] = useState("");
  const chosen = candidates.find((resume) => resume.id === resumeId) ?? candidates.find((resume) => resume.is_default) ?? candidates[0];
  const draft = useQuery({
    queryKey: ["design-preview-content", chosen?.id],
    queryFn: () => api<{ draft: { content: Record<string, unknown> & { meta: Record<string, unknown> } } }>(`/api/resumes/${chosen!.id}/draft`),
    enabled: Boolean(chosen),
  });
  const [pdf, setPdf] = useState<{ url: string; pages: string } | null>(null);
  const [error, setError] = useState("");
  const content = draft.data?.draft.content;

  useEffect(() => {
    if (!content || !chosen) return;
    const controller = new AbortController();
    // Debounced: sliders send many changes per second.
    const timer = setTimeout(async () => {
      try {
        const { blob, headers } = await apiBlob(`/api/resumes/${chosen.id}/draft/preview`, { content: { ...content, meta: { ...content.meta, ...design } } }, { signal: controller.signal });
        const url = URL.createObjectURL(blob);
        setError("");
        setPdf((previous) => {
          if (previous) URL.revokeObjectURL(previous.url);
          return { url, pages: headers.get("X-Page-Count") ?? "" };
        });
      } catch (caught) {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      }
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [content, chosen, design]);

  useEffect(() => () => setPdf((previous) => (previous && URL.revokeObjectURL(previous.url), null)), []);

  if (!candidates.length)
    return (
      <EmptyState title="No preview yet">
        Open any resume in the editor once; its text is then used to preview this design here.
      </EmptyState>
    );
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-w-0 items-center gap-2 text-xs text-ink-2">
          Preview with
          <Select className="h-7 w-auto min-w-40 text-xs" value={chosen?.id ?? ""} onChange={(event) => setResumeId(event.target.value)}>
            {candidates.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.name}
              </option>
            ))}
          </Select>
        </label>
        {pdf?.pages ? <span className="tabular text-xs text-ink-3" data-testid="design-preview-pages">{pdf.pages === "1" ? "1 page" : `${pdf.pages} pages`}</span> : null}
      </div>
      {error ? <Note tone="danger">{error}</Note> : null}
      <div className="h-[min(78vh,960px)] overflow-hidden rounded-md border border-line bg-surface-2">
        {pdf ? (
          <iframe title="Default design preview" src={`${pdf.url}#toolbar=0&navpanes=0&view=FitH`} className="size-full border-0" data-testid="design-preview" />
        ) : (
          <div className="flex size-full items-center justify-center gap-2 text-sm text-ink-2">
            <Spinner /> Rendering preview…
          </div>
        )}
      </div>
    </div>
  );
}

export function ResumeDesignSettings() {
  const query = useDesignSettings();
  const update = useUpdateDesignSettings();
  const settings = query.data;
  // The design being edited on this page; starts from the saved default (or the last edited design).
  const [draft, setDraft] = useState<ResumeDesign | null>(null);
  const [baseline, setBaseline] = useState<ResumeDesign | null>(null);
  const initial = settings ? (settings.default ?? settings.last ?? settings.factory) : null;
  if (settings && initial && baseline === null) {
    setBaseline(initial);
    setDraft(initial);
  }

  if (query.isPending || !settings || !draft) return <EmptyState title="Loading resume design…" />;

  const handlers: DesignHandlers = {
    setLayout: (key, value) => setDraft((current) => current && { ...current, layout: { ...current.layout, [key]: value } }),
    setMeta: (key, value) => setDraft((current) => current && { ...current, [key]: key === "page_limit" ? Number(value) : String(value) }),
    applyPreset: (template, layout) => setDraft((current) => current && { ...current, template, layout: { ...layout } }),
  };
  const unsaved = !sameDesign(draft, settings.default);
  const run = async (body: Parameters<typeof update.mutateAsync>[0], message: string) => {
    try {
      const next = await update.mutateAsync(body);
      if (body.design || body.from_resume_id) {
        setBaseline(next.default);
        setDraft(next.default);
      }
      notify(message);
    } catch (error) {
      notify(errorMessage(error), true);
    }
  };

  return (
    <div className="grid gap-4" data-testid="resume-design-settings">
      <Card>
        <CardHeader
          title="Design for new resumes"
          description="Saved resumes always keep their own design. This decides how a new tailored resume (or a newly uploaded one) looks when it is created."
        />
        <ModeChoice settings={settings} busy={update.isPending} onChange={(mode) => void run({ mode }, mode === "default" ? "New resumes now use your default design." : "New resumes now follow the last design you edited.")} />
      </Card>
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(380px,520px)]">
        <div className="grid content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface p-3">
            <div className="flex items-center gap-2">
              <h2 className="m-0 text-lg font-semibold">Default design</h2>
              {settings.default ? (
                unsaved ? <Pill tone="warn">Unsaved changes</Pill> : settings.mode === "default" ? <Pill tone="success">In use</Pill> : <Pill>Saved, not in use</Pill>
              ) : (
                <Pill tone="warn">Not saved yet</Pill>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {settings.last && !sameDesign(draft, settings.last) ? (
                <Button variant="quiet" onClick={() => setDraft(settings.last)}>
                  Start from my last edited design
                </Button>
              ) : null}
              {unsaved && settings.default ? (
                <Button variant="quiet" onClick={() => setDraft(baseline)}>
                  Discard changes
                </Button>
              ) : null}
              <Button variant="primary" disabled={!unsaved || update.isPending} onClick={() => void run({ design: draft }, "Default design saved. New tailored resumes will start with it.")}>
                Save as default design
              </Button>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <DesignControls
              meta={draft}
              options={settings.options}
              handlers={handlers}
              idPrefix="default-design"
              orderCard={
                <DesignCard title="Section order" className="lg:col-span-2">
                  <p className="m-0 text-xs text-ink-3">Sections a resume doesn't have are skipped when it is printed.</p>
                  <OrderList design={draft} titles={settings.options.section_titles} onChange={(section_order) => setDraft({ ...draft, section_order })} />
                </DesignCard>
              }
            />
          </div>
        </div>
        <aside className="2xl:sticky 2xl:top-0 2xl:self-start" aria-label="Preview">
          <Preview design={draft} />
        </aside>
      </div>
    </div>
  );
}
