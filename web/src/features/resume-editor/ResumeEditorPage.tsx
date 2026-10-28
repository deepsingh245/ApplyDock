import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useEditorAnalysis, useEditorState, useJob, useSuggestions } from "@/api/drafts";
import { keys, useEntry } from "@/api/state";
import { Loading } from "@/app/AppShell";
import { BackButton, EmptyState, Page } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/toaster";
import { AnalysisDialog } from "@/features/analysis/AnalysisDialog";
import { cn } from "@/lib/cn";
import { ContentPanel } from "./ContentPanel";
import { EditorProvider, useCtl, useEditorController } from "./controller";
import { DesignPanel } from "./DesignPanel";
import { EditorBanners, EditorHeader, EditorToolbar, MobileTabs } from "./Header";
import { DraftSaver } from "./saver";
import { SidePanel } from "./SidePanel";
import { editor, useEditor } from "./store";
import { SuggestionsContext } from "./SuggestionCard";
import type { EditorState, ScoreCheckResult, SidePanelName } from "./types";
import { usePreview } from "./usePreview";

const PANELS = new Set<SidePanelName>(["preview", "versions", "compare", "analysis", "profile"]);

/** Notices when background jobs finish, whichever panel is open. */
function JobWatchers() {
  const ctl = useCtl();
  const client = useQueryClient();
  const suggestionJobId = useEditor((state) => state.suggestionJobId);
  const checkJobId = useEditor((state) => state.scoreCheck?.jobId ?? "");
  const importJob = ctl.data.import.job;
  const { data: suggestionJob } = useJob(suggestionJobId);
  const { data: checkJob } = useJob(checkJobId, 1200);
  const { data: importStatus } = useJob(importJob && ["pending", "running"].includes(importJob.status) ? importJob.id : "");
  const seen = useRef(new Set<string>());

  const once = (id: string, status: string | undefined) => {
    if (!id || !status || status === "pending" || status === "running" || seen.current.has(id)) return false;
    seen.current.add(id);
    return true;
  };

  useEffect(() => {
    if (!suggestionJob || !once(suggestionJob.id, suggestionJob.status)) return;
    if (suggestionJob.status === "complete") {
      void client.invalidateQueries({ queryKey: ["suggestions", ctl.resumeId] });
      const count = Number(suggestionJob.result?.count ?? 0);
      notify(count ? `${count} suggestion(s) ready. Review each one next to the text it changes.` : "No safe suggestions were found for this draft.");
    } else notify(suggestionJob.error_message || "Suggestions failed.", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per finished job
  }, [suggestionJob?.id, suggestionJob?.status]);

  useEffect(() => {
    if (!checkJob || !once(checkJob.id, checkJob.status)) return;
    const result = checkJob.result as unknown as ScoreCheckResult | null;
    if (checkJob.status === "complete" && result)
      notify(
        `Score with your changes: ${Number(result.overall_score).toFixed(1)} (${result.changes.length ? `${result.changes.length} requirement(s) changed` : "no requirement changed"}). The analysis history is unchanged.`,
      );
    else if (checkJob.status === "failed") notify(checkJob.error_message || "The score check failed.", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per finished job
  }, [checkJob?.id, checkJob?.status]);

  useEffect(() => {
    if (!importStatus || !once(importStatus.id, importStatus.status)) return;
    client.setQueryData<EditorState>(keys.draft(ctl.resumeId), (current) => (current ? { ...current, import: { ...current.import, job: importStatus } } : current));
    if (importStatus.status === "complete") void ctl.applyImportJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per finished job
  }, [importStatus?.id, importStatus?.status]);

  return null;
}

function useEditorKeys() {
  const ctl = useCtl();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const inField = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "");
      if (key === "s") {
        event.preventDefault();
        void ctl.saveVersion(false);
      } else if (key === "z" && !event.shiftKey && !inField) {
        event.preventDefault();
        editor().undoEdit();
      } else if ((key === "y" || (key === "z" && event.shiftKey)) && !inField) {
        event.preventDefault();
        editor().redoEdit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ctl]);
}

function LeftPanel() {
  const tab = useEditor((state) => state.leftTab);
  return (
    <div className="grid gap-3">
      <Tabs value={tab} onValueChange={(value) => editor().set({ leftTab: value as "content" | "design" })}>
        <TabsList variant="segmented" aria-label="Editor mode">
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="design">Design</TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="mt-3">
          <ContentPanel />
        </TabsContent>
        <TabsContent value="design" className="mt-3">
          <DesignPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EditorLayout() {
  const ctl = useCtl();
  useEditorKeys();
  const mobileTab = useEditor((state) => state.mobileTab);
  const analysisId = useEditor((state) => state.analysisId);
  const dialogOpen = useEditor((state) => state.analysisDialog);
  const client = useQueryClient();
  const { data: analysis } = useEditorAnalysis(analysisId);
  const { data: suggestions } = useSuggestions(ctl.resumeId, analysisId);
  return (
    <SuggestionsContext value={suggestions ?? []}>
      <JobWatchers />
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[clamp(16px,3vw,48px)] pt-4 pb-4 md:overflow-hidden" aria-label="Resume editor" data-testid="resume-editor">
        <EditorHeader />
        <EditorToolbar />
        <EditorBanners />
        <MobileTabs />
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.15fr)_minmax(440px,0.85fr)]">
          <section className={cn("min-h-0 md:block md:overflow-y-auto md:pr-1", mobileTab === "edit" ? "block" : "hidden")} data-testid="form-panel" aria-label="Edit resume">
            <LeftPanel />
          </section>
          <aside className={cn("min-h-0 md:block md:overflow-y-auto md:pr-1", mobileTab === "preview" ? "block" : "hidden")} data-testid="side-panel" aria-label="Preview and job match">
            <SidePanel analysis={analysis} />
          </aside>
        </div>
      </main>
      {analysisId ? (
        <AnalysisDialog
          analysisId={analysisId}
          open={dialogOpen}
          onOpenChange={(open) => {
            editor().set({ analysisDialog: open });
            // Checklist marks made in the dialog change which gaps Job match shows.
            if (!open) void client.invalidateQueries({ queryKey: keys.analysis(analysisId) });
          }}
        />
      ) : null}
    </SuggestionsContext>
  );
}

export default function ResumeEditorPage() {
  const { resumeId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const query = useEditorState(resumeId);
  const data = query.data;
  const entryId = params.get("entry") || data?.resume.entry_id || "";
  const entry = useEntry(entryId);
  const loaded = useEditor((state) => state.resumeId === resumeId && Boolean(state.content));
  const saver = useMemo(() => new DraftSaver(resumeId), [resumeId]);
  const loadedFor = useRef("");

  // Load the draft once per opened resume; later refreshes of the editor data never replace edited content.
  useEffect(() => {
    if (!data || !query.isFetchedAfterMount || loadedFor.current === resumeId) return;
    loadedFor.current = resumeId;
    editor().load(resumeId, data.draft);
    const analysisParam = params.get("analysis") || "";
    const fallback = entry?.analysis?.id && entry.analysis.status !== "not_analyzed" ? entry.analysis.id : "";
    const panel = params.get("panel") as SidePanelName | null;
    editor().set({ analysisId: analysisParam || fallback, ...(panel && PANELS.has(panel) ? { panel } : {}) });
  }, [data, query.isFetchedAfterMount, resumeId, params, entry]);

  // Every local edit schedules an autosave; leaving saves what is left with keepalive.
  useEffect(() => {
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (state.editSeq !== previous.editSeq && state.resumeId === resumeId) saver.schedule();
    });
    const onUnload = (event: BeforeUnloadEvent) => {
      const status = editor().status;
      if (editor().resumeId === resumeId && (status === "unsaved" || status === "saving")) {
        saver.keepalive();
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", onUnload);
      saver.keepalive();
      saver.dispose();
    };
  }, [saver, resumeId]);

  usePreview(loaded ? resumeId : "", data && !data.renderer.available ? (data.renderer.message ?? "The PDF renderer is unavailable.") : null);

  if (query.error)
    return (
      <Page>
        <EmptyState title="This resume can't be opened" actions={<BackButton onClick={() => navigate("/resumes")}>Resume library</BackButton>}>
          {query.error.message}
        </EmptyState>
      </Page>
    );
  if (!data || !loaded) return <Loading label="Opening the resume editor…" />;
  return <LoadedEditor resumeId={resumeId} entryId={entryId} data={data} saver={saver} />;
}

function LoadedEditor({ resumeId, entryId, data, saver }: { resumeId: string; entryId: string; data: EditorState; saver: DraftSaver }) {
  const entry = useEntry(entryId);
  const ctl = useEditorController({ resumeId, entryId, entry, data, saver });
  const [params] = useSearchParams();
  const compareVersion = params.get("compare");
  const opened = useRef(false);

  // Opened from a submission record: compare that exact version with the current draft.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (compareVersion && data.versions.some((version) => version.id === compareVersion)) {
      editor().set({ panel: "compare" });
      void ctl.compareWith(`v:${compareVersion}`);
    }
  }, [compareVersion, data.versions, ctl]);

  return (
    <EditorProvider value={ctl}>
      <EditorLayout />
    </EditorProvider>
  );
}
