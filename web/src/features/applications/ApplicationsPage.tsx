import { InboxIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useAppState, useLoadedState, useReloadState } from "@/api/state";
import type { Entry } from "@/api/types";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/misc";
import { notify } from "@/components/ui/toaster";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { activeEntries, isRejected, needsAction } from "@/lib/domain";
import { useOpenResumeEditor } from "./actions";
import { EntryEditor, MobileBack, type EditorTab } from "./EntryEditor";
import { DEFAULT_LIST, type ListOptions } from "./filtering";
import { FIELD_TAB, toForm, type EntryForm } from "./form";
import { Inspector } from "./Inspector";
import { QueueList } from "./QueueList";
import { useEntryActions } from "./useEntryActions";

// Whether the open application has unsaved edits; read by the background refresh, which must not run then.
const editing = { dirty: false };
const TABS: EditorTab[] = ["overview", "details", "resume", "email"];

function EmptyEditor({ onShowApplied }: { onShowApplied: () => void }) {
  const state = useLoadedState();
  const navigate = useNavigate();
  const waiting = state.entries.filter(needsAction).length;
  const done = state.entries.filter((entry) => !needsAction(entry) && !isRejected(entry)).length;
  return (
    <EmptyState
      icon={<InboxIcon aria-hidden />}
      title={<span id="empty-editor">{waiting ? "Select an application" : "No active applications"}</span>}
      actions={
        waiting ? null : (
          <>
            <Button variant="primary" onClick={() => navigate("/applications/new")}>
              Add a job
            </Button>
            {done ? <Button onClick={onShowApplied}>View applied ({done})</Button> : null}
          </>
        )
      }
    >
      {waiting
        ? "Pick one from the list to review the posting, prepare the resume, and send the email."
        : state.entries.length
          ? "Everything is applied, sent, or closed. Add the next job when you find it, or look back at what you sent."
          : "Add a job or hiring post to get started."}
    </EmptyState>
  );
}

/** The open application: editor + inspector share one form, so the email preview follows what you type. */
function Workspace({ entry, mobileBack }: { entry: Entry; mobileBack: ReactNode }) {
  const state = useLoadedState();
  const navigate = useNavigate();
  const reload = useReloadState();
  const { confirm } = useDialogs();
  const openEditor = useOpenResumeEditor();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as EditorTab) ? params.get("tab") : "overview") as EditorTab;
  const setTab = useCallback(
    (next: EditorTab) =>
      setParams(
        (current) => {
          const copy = new URLSearchParams(current);
          if (next === "overview") copy.delete("tab");
          else copy.set("tab", next);
          copy.delete("submission");
          return copy;
        },
        { replace: true },
      ),
    [setParams],
  );
  // keepDirtyValues: a background refresh updates untouched fields but never overwrites what you are typing.
  const form = useForm<EntryForm>({ values: toForm(entry), resetOptions: { keepDirtyValues: true } });
  const dirty = form.formState.isDirty;
  useEffect(() => {
    editing.dirty = dirty;
    return () => {
      editing.dirty = false;
    };
  }, [dirty]);

  // Each request carries a new number so the card reopens its form even when asked twice.
  const [submissionRequest, setSubmissionRequest] = useState<{ channel: string; at: number } | null>(null);
  const openSubmission = useCallback(
    (channel: string) => {
      setTab("resume");
      setSubmissionRequest((current) => ({ channel, at: (current?.at ?? 0) + 1 }));
    },
    [setTab],
  );
  // ?submission=1 (the extension's "submission" deep link) asks for the form, also when this application is already open.
  const wantsSubmission = params.get("submission") === "1";
  const [submissionParamSeen, setSubmissionParamSeen] = useState(false);
  if (wantsSubmission !== submissionParamSeen) {
    setSubmissionParamSeen(wantsSubmission);
    if (wantsSubmission) setSubmissionRequest((current) => ({ channel: entry.delivery_mode.startsWith("gmail") ? "gmail" : "external", at: (current?.at ?? 0) + 1 }));
  }
  const actions = useEntryActions(entry, form, openSubmission);
  const [saving, setSaving] = useState(false);

  const save = form.handleSubmit(
    async () => {
      setSaving(true);
      try {
        await actions.save();
        await reload();
        notify("Changes saved.");
      } catch (error) {
        notify(errorMessage(error), true);
      } finally {
        setSaving(false);
      }
    },
    // A required field on a hidden tab would block saving silently; show its tab instead.
    (errors) => {
      const field = Object.keys(errors)[0] as keyof EntryForm | undefined;
      const target = field && FIELD_TAB[field];
      if (target) setTab(target as EditorTab);
    },
  );

  // Leaving with unsaved edits asks first (list clicks, top bar, back button).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void confirm({ message: "Discard unsaved changes in this application?", confirmLabel: "Discard", danger: true }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, confirm]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (editing.dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [save]);

  return (
    <>
      <EditorPane>
        <EntryEditor
          entry={entry}
          form={form}
          tab={tab}
          onTabChange={setTab}
          onSave={() => void save()}
          saving={saving}
          onDelete={() => void actions.perform("local-delete")}
          onAnalysis={() => (entry.analysis?.id ? navigate(`/analysis/${entry.analysis.id}`) : void actions.perform("ats-run"))}
          onOpenEditor={(mode) => void openEditor(entry, mode, state.resumes, actions.saveIfDirty)}
          submissionRequest={submissionRequest}
          mobileBack={mobileBack}
        />
      </EditorPane>
      <InspectorPane>
        <Inspector entry={entry} control={form.control} onAction={(action) => void actions.perform(action)} busy={actions.busy} aiNotes={actions.aiNotes} />
      </InspectorPane>
    </>
  );
}

// At ≥1281px these are the middle and right columns, each scrolling on its own; below that the inspector
// sits under the editor in one scrolling column (see the wrapper in ApplicationsPage).
function EditorPane({ children }: { children: ReactNode }) {
  return <div className="min-h-0 px-[clamp(16px,2.5vw,32px)] pt-5 xl:overflow-y-auto">{children}</div>;
}

function InspectorPane({ children }: { children: ReactNode }) {
  return (
    <aside id="inspector" aria-label="Application status and actions" className="min-h-0 border-line bg-canvas max-xl:mt-6 max-xl:border-t xl:overflow-y-auto xl:border-l">
      {children}
    </aside>
  );
}

function readOptions(params: URLSearchParams): Omit<ListOptions, "query"> {
  return {
    filter: (params.get("filter") as ListOptions["filter"]) || DEFAULT_LIST.filter,
    analysis: (params.get("analysis") as ListOptions["analysis"]) || DEFAULT_LIST.analysis,
    score: (params.get("score") as ListOptions["score"]) || DEFAULT_LIST.score,
    sort: (params.get("sort") as ListOptions["sort"]) || DEFAULT_LIST.sort,
  };
}

export default function ApplicationsPage() {
  // Refresh every minute while you are only looking, never while you are typing or have unsaved edits.
  const { data: state } = useAppState({
    refetchInterval: () => (editing.dirty || document.activeElement?.matches("input, textarea, select") ? false : 60_000),
  });
  const { entryId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const options: ListOptions = { ...readOptions(params), query };
  const entries = useMemo(() => state?.entries ?? [], [state]);

  // Keep an explicit choice; otherwise show the first application that still needs action (or none). That
  // default sticks through refreshes of this visit, so finishing it (recording a submission) does not swap it
  // away mid-task; a new navigation (the brand, a filter change) picks again.
  const location = useLocation();
  const [sticky, setSticky] = useState({ key: "", id: "" });
  const kept = sticky.key === location.key ? entries.find((entry) => entry.id === sticky.id) : undefined;
  const selected = (entryId ? entries.find((entry) => entry.id === entryId) : kept || activeEntries(entries).find(needsAction)) || null;
  if (!entryId && (sticky.key !== location.key || (selected?.id ?? "") !== sticky.id)) setSticky({ key: location.key, id: selected?.id ?? "" });
  const detailOpen = Boolean(entryId);

  const changeOptions = (patch: Partial<ListOptions>) => {
    if (patch.query !== undefined) setQuery(patch.query);
    const { query: _ignored, ...rest } = patch;
    if (!Object.keys(rest).length) return;
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        for (const [key, value] of Object.entries(rest)) {
          if (value === DEFAULT_LIST[key as keyof ListOptions]) copy.delete(key);
          else copy.set(key, String(value));
        }
        return copy;
      },
      { replace: true },
    );
  };

  const select = (entry: Entry) => {
    const list = new URLSearchParams(params);
    list.delete("tab");
    list.delete("submission");
    const search = list.toString();
    navigate(`/applications/${entry.id}${search ? `?${search}` : ""}`);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName))) return;
      event.preventDefault();
      if (detailOpen && window.matchMedia("(max-width: 760px)").matches) navigate("/");
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailOpen, navigate]);

  if (!state) return null;
  if (entryId && !entries.some((entry) => entry.id === entryId))
    return (
      <EmptyState title="Application not found" actions={<Button onClick={() => navigate("/")}>Back to applications</Button>}>
        It may have been removed from ApplyDock.
      </EmptyState>
    );

  return (
    <div
      id="queue-view"
      className="workspace grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[var(--list-w)_minmax(0,1fr)] xl:grid-cols-[var(--list-w)_minmax(0,1fr)_var(--context-w)]"
    >
      <div className={cn("flex min-h-0 flex-col", detailOpen && "max-md:hidden")}>
        <QueueList entries={entries} options={options} onOptionsChange={changeOptions} selectedId={selected?.id ?? ""} onSelect={select} searchRef={searchRef} />
      </div>
      <section aria-label="Application editor" className={cn("editor-surface min-h-0 overflow-y-auto pb-6 xl:contents", !detailOpen && "max-md:hidden")}>
        {selected ? (
          <Workspace key={selected.id} entry={selected} mobileBack={<MobileBack onClick={() => navigate("/")} />} />
        ) : (
          <>
            <EditorPane>
              <EmptyEditor onShowApplied={() => changeOptions({ filter: "applied" })} />
            </EditorPane>
            <InspectorPane>
              <Inspector entry={null} onAction={() => undefined} busy={null} aiNotes="" />
            </InspectorPane>
          </>
        )}
      </section>
    </div>
  );
}
