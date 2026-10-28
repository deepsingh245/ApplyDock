import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { isRunning, useAnalysis, useAnalysisQueue, useEntryAnalyses } from "@/api/analyses";
import { useResumeVersions } from "@/api/resumes";
import { keys, useLoadedState, useReloadState } from "@/api/state";
import type { Analysis, Entry } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Count, Eyebrow, Meter, ScoreFigure, Spinner } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill } from "@/components/ui/pill";
import { notify } from "@/components/ui/toaster";
import { useOpenResumeEditor, useRunAnalysis } from "@/features/applications/actions";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { profileChangedSince } from "@/lib/domain";
import { dateLabel } from "@/lib/format";
import { categoryRows, compareRuns, comparisonBaseline, isAddressed, matchCounts, previousRun, signed, stageLabel } from "./model";
import { ActivityLog, QueueCard } from "./parts";
import { PriorityImprovements, RequirementsExplorer } from "./Requirements";

interface ViewProps {
  analysisId: string;
  /** Rendered inside the dialog over the resume editor: links to other runs stay in the dialog. */
  inDialog?: boolean;
  /** Called before an action that leaves this view (optimize, settings, profile source). */
  onLeave?: () => void;
}

export function analysisSubtitle(analysis: Analysis, entry: Entry | undefined) {
  const model = typeof analysis.model === "string" && analysis.model ? analysis.model : "Codex";
  return `${entry?.company || "Company not set"}${analysis.result?.draft ? " · Unsaved draft check" : ` · Resume version ${analysis.result?.resume_version || "—"}`} · ${model}`;
}

function Running({ analysis }: { analysis: Analysis }) {
  const percent = Number(analysis.progress_percent ?? 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card className="grid content-start gap-4" data-testid="analysis-running">
        <div className="flex items-start gap-3">
          <Spinner className="mt-1 size-5 text-accent" label="Analysis running" />
          <div className="min-w-0 flex-1">
            <Eyebrow>Processing</Eyebrow>
            <h2 className="m-0 text-lg font-semibold">{stageLabel(analysis.progress_stage)}</h2>
            <p className="m-0 text-sm text-ink-2">{analysis.progress_message || "ApplyDock is preparing the analysis."}</p>
          </div>
          <strong className="tabular text-2xl">{percent}%</strong>
        </div>
        <Meter value={percent} tone="neutral" label="Analysis progress" className="h-2" />
        <div className="grid gap-1 text-xs text-ink-3">
          <p className="m-0">ApplyDock processes one analysis at a time and saves every stage locally.</p>
          <p className="m-0">Partial AI output is hidden until its evidence and schema are validated.</p>
        </div>
      </Card>
      <ActivityLog analysis={analysis} live />
    </div>
  );
}

function Stopped({ analysis, onRerun, onSettings }: { analysis: Analysis; onRerun: () => void; onSettings: () => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card className="grid content-start gap-3" data-testid="analysis-stopped">
        <Pill tone="danger" className="justify-self-start">
          {analysis.label ?? analysis.status}
        </Pill>
        <h2 className="m-0 text-lg font-semibold">The analysis stopped at {analysis.progress_percent ?? 0}%</h2>
        <p className="m-0 text-sm text-ink-2">{analysis.error_message || analysis.progress_message || "The analysis could not be completed."}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onRerun}>
            Run again
          </Button>
          <Button variant="quiet" onClick={onSettings}>
            Open Codex settings
          </Button>
        </div>
        <p className="m-0 text-xs text-ink-3">The percentage is a stage estimate. No match score is shown because the result did not pass validation.</p>
      </Card>
      <ActivityLog analysis={analysis} live={false} />
    </div>
  );
}

function ComparisonCard({ current, previous, delta }: { current: Analysis; previous: Analysis; delta: number | null }) {
  const changes = compareRuns(current, previous);
  const list = (items: { requirement: string }[] | string[], empty: string) =>
    items.length ? (
      <ul className="m-0 grid gap-1 pl-4 text-sm">
        {items.map((item, index) => (
          <li key={index}>{typeof item === "string" ? item : item.requirement}</li>
        ))}
      </ul>
    ) : (
      <p className="m-0 text-sm text-ink-3">{empty}</p>
    );
  return (
    <Card data-testid="comparison-card">
      <CardHeader title="Changes from previous run" aside={<Count>{signed(delta ?? 0)} points</Count>} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid content-start gap-1">
          <strong className="text-sm">Newly matched</strong>
          {list(changes.newlyMatched, "No newly matched requirements.")}
        </div>
        <div className="grid content-start gap-1">
          <strong className="text-sm">Remaining gaps</strong>
          {list(changes.remainingGaps, "No remaining gaps were classified.")}
        </div>
        <div className="grid content-start gap-1">
          <strong className="text-sm">Resolved recommendations</strong>
          {list(changes.resolved, "No recommendations resolved yet.")}
        </div>
        <div className="grid content-start gap-1">
          <strong className="text-sm">New warnings</strong>
          {list(changes.newWarnings, "No new warnings.")}
        </div>
      </div>
    </Card>
  );
}

function Complete({ analysis, entry, onOpen, onRerun, onOptimize, onLeave }: {
  analysis: Analysis;
  entry: Entry | undefined;
  onOpen: (id: string) => void;
  onRerun: () => void;
  onOptimize: () => void;
  onLeave?: () => void;
}) {
  const state = useLoadedState();
  const history = useEntryAnalyses(analysis.entry_id, analysis.status);
  const previous = previousRun(history.data ?? [], analysis.id);
  const previousDetail = useAnalysis(previous?.id);
  const versions = useResumeVersions(entry?.resume_id || undefined);
  const result = analysis.result;
  const requirements = result?.requirements ?? [];
  const open = requirements.filter((item) => !isAddressed(analysis, item));
  const addressed = requirements.filter((item) => isAddressed(analysis, item));
  const { baseline, olderMethod, delta } = comparisonBaseline(analysis, previous);
  const coverage = result?.coverage_counts ?? null;
  const potential = result?.potential_score != null && analysis.overall_score != null && result.potential_score > analysis.overall_score ? result.potential_score : null;
  const warnings = [...(analysis.error_message ? [analysis.error_message] : []), ...(result?.warnings ?? [])];
  const counts = matchCounts(requirements);
  const profileChanged = profileChangedSince(analysis, state.profile_hash);
  const percent = (value: number | null | undefined) => (value == null ? "—" : `${value}%`);
  const totals = coverage
    ? [
        [coverage.represented ?? 0, "Represented"],
        [coverage.weak ?? 0, "Weak"],
        [coverage.profile_only ?? 0, "In profile only"],
        [coverage.unsupported ?? 0, "Missing from both"],
      ]
    : [
        [counts.matched, "Matched"],
        [counts.partial, "Partial"],
        [counts.missing, "Missing evidence"],
      ];

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-md border border-line bg-surface p-4 lg:grid-cols-[180px_minmax(0,1fr)_auto]" data-testid="analysis-hero">
        <div className="grid content-start gap-2">
          <Eyebrow>Estimated match</Eyebrow>
          <ScoreFigure score={analysis.overall_score} />
          <Meter value={analysis.overall_score} label="Estimated match" />
        </div>
        <div className="grid min-w-0 content-start gap-2">
          <Pill tone="success" className="justify-self-start">
            {analysis.label ?? "Analysis Complete"}
          </Pill>
          <h2 className="m-0 text-lg font-semibold">{result?.summary || "Analysis result"}</h2>
          <div className="flex flex-wrap gap-4" data-testid="analysis-totals">
            {totals.map(([value, label]) => (
              <span key={label} className="grid text-xs text-ink-2">
                <strong className="tabular text-lg text-ink">{value}</strong>
                {label}
              </span>
            ))}
          </div>
          <p className="m-0 text-sm text-ink-2">
            Job relevance: {percent(analysis.relevance_score)} · ATS readability: {percent(analysis.readability_score)} · Missing mandatory: {analysis.missing_mandatory || 0}
          </p>
          {delta == null ? null : (
            <p className="m-0 text-sm font-medium" data-testid="score-change">
              Change from previous run{baseline?.resume_version ? ` (resume v${baseline.resume_version})` : ""}: {signed(delta)} points
            </p>
          )}
          {profileChanged ? (
            <Note tone="info" data-testid="profile-changed">
              Your Master Profile changed since this run. Run the analysis again to compare against it — the resume is not changed.
            </Note>
          ) : null}
          {olderMethod ? (
            <p className="m-0 text-xs text-ink-3">
              Earlier runs used the previous scoring method, which rebuilt the requirement list every time, so their scores are not comparable with this one.
            </p>
          ) : null}
          {potential == null ? null : (
            <p className="m-0 text-sm text-accent" data-testid="score-potential">
              Adding the evidence already in your Master Profile could raise this to about {Number(potential).toFixed(1)}.
            </p>
          )}
          {result?.profile_used === false && result.scoring_version === "score-v2" ? (
            <p className="m-0 text-xs text-ink-3">Add projects and experience under Settings → Master Profile so ApplyDock can find evidence your resume leaves out.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap content-start gap-2 lg:flex-col">
          <Button variant="primary" onClick={onOptimize}>
            Optimize resume for this job
          </Button>
          <Button onClick={onRerun}>{profileChanged ? "Re-run with updated profile" : "Run analysis again"}</Button>
        </div>
      </section>

      {warnings.length ? (
        <Note tone="warn" className="grid gap-1" data-testid="analysis-warnings">
          {warnings.map((value, index) => (
            <p key={index} className="m-0">
              {value}
            </p>
          ))}
        </Note>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader title="Score breakdown" aside={<Count>Scored locally</Count>} />
            <div className="grid gap-3">
              {categoryRows(result?.category_scores).map(({ key, label, score }) => (
                <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,2fr)_48px] items-center gap-3">
                  <div className="min-w-0">
                    <strong className="block text-sm">{label}</strong>
                    <span className="text-xs text-ink-3">
                      {score.earned} / {score.possible} points
                    </span>
                  </div>
                  <Meter value={score.score ?? 0} label={label} />
                  <b className="tabular text-right text-sm">{score.score || 0}%</b>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_48px] items-center gap-3 border-t border-line pt-3">
                <div>
                  <strong className="block text-sm">ATS readability and structure</strong>
                  <span className="text-xs text-ink-3">5% of estimated match</span>
                </div>
                <b className="tabular text-right text-sm">{percent(analysis.readability_score)}</b>
              </div>
            </div>
          </Card>
          {previousDetail.data?.result && !olderMethod ? <ComparisonCard current={analysis} previous={previousDetail.data} delta={delta} /> : null}
          <RequirementsExplorer analysis={analysis} open={open} addressed={addressed} hasCoverage={Boolean(coverage)} onLeave={onLeave} />
        </div>
        <aside className="grid min-w-0 content-start gap-4">
          <PriorityImprovements open={open} />
          <ActivityLog analysis={analysis} live={false} />
          <Card>
            <CardHeader title="Analysis history" aside={<Count>{history.data?.length ?? 0}</Count>} />
            <div className="grid gap-1">
              {history.data?.length ? (
                history.data.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpen(item.id)}
                    aria-current={item.id === analysis.id ? "true" : undefined}
                    className={cn(
                      "grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-2",
                      item.id === analysis.id && "bg-accent-soft",
                    )}
                  >
                    <span className="truncate">{item.label}</span>
                    <strong className="tabular">{item.overall_score == null ? "—" : `${item.overall_score}%`}</strong>
                    <small className="col-span-2 text-xs text-ink-3">{dateLabel(item.completed_at || item.created_at)}</small>
                  </button>
                ))
              ) : (
                <p className="m-0 text-xs text-ink-3">No prior analyses.</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Resume versions" aside={<Count>{versions.data?.length ?? 0}</Count>} />
            <p className="mt-0 text-sm text-ink-2">This run stays linked to version {result?.resume_version || "—"}. Replacing a resume keeps earlier results for comparison.</p>
            <div className="grid gap-2">
              {(versions.data ?? []).map((version) => (
                <div key={version.id} className="grid text-sm">
                  <strong>
                    Version {version.version_number}
                    {version.is_current ? " · Current" : ""}
                  </strong>
                  <span className="truncate text-ink-2">{version.original_filename}</span>
                  <small className="text-xs text-ink-3">
                    {version.extraction_status} · {dateLabel(version.created_at)}
                  </small>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** The full analysis: rendered as a page (/analysis/:id) and inside the dialog over the resume editor. */
export function AnalysisView({ analysisId, inDialog = false, onLeave }: ViewProps) {
  // Inside the dialog, opening another run (history, queue, re-run) swaps the run shown instead of navigating away.
  const [dialogId, setDialogId] = useState(analysisId);
  const id = inDialog ? dialogId : analysisId;
  const navigate = useNavigate();
  const client = useQueryClient();
  const reload = useReloadState();
  const state = useLoadedState();
  const runAnalysis = useRunAnalysis();
  const openEditor = useOpenResumeEditor();
  const queue = useAnalysisQueue(false);
  const analysis = useAnalysis(id, (queue.data?.length ?? 0) > 0);
  const detail = analysis.data;
  const entry = state.entries.find((item) => item.id === detail?.entry_id);
  const running = isRunning(detail);

  // When a run finishes, the application's summary (score, status) in /api/state changes too.
  const finishedStatus = detail && !running ? detail.status : "";
  useEffect(() => {
    if (finishedStatus) void client.invalidateQueries({ queryKey: keys.state });
  }, [finishedStatus, client]);

  const openRun = (next: string) => (inDialog ? setDialogId(next) : navigate(`/analysis/${next}`));

  const rerun = async () => {
    if (!entry) return notify("This analysis's application is no longer available.", true);
    if (!inDialog) return runAnalysis(entry);
    try {
      const result = await api<{ analysis: Analysis; cached: boolean }>(`/api/entries/${entry.id}/analyses`, "POST", { retry: entry.analysis?.status === "plan_limit" });
      client.setQueryData(keys.analysis(result.analysis.id), result.analysis);
      await reload();
      setDialogId(result.analysis.id);
      notify(result.cached ? "Loaded the unchanged analysis from ApplyDock's cache." : "Analysis queued using your ChatGPT Plus Codex allowance.");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  };

  const optimize = () => {
    if (!entry || !detail) return notify("This analysis's application is no longer available.", true);
    onLeave?.();
    void openEditor({ ...entry, analysis: { ...entry.analysis, id: detail.id } }, "optimize", state.resumes);
  };

  const settings = () => {
    onLeave?.();
    navigate("/settings/connections");
  };

  let body;
  if (analysis.isPending) body = <Card className="flex items-center gap-2 text-sm text-ink-2"><Spinner /> Loading analysis…</Card>;
  else if (analysis.error || !detail)
    body = (
      <Note tone="danger" role="alert">
        {analysis.error ? errorMessage(analysis.error) : "This analysis is not available."}
      </Note>
    );
  else if (running) body = <Running analysis={detail} />;
  else if (detail.status !== "complete") body = <Stopped analysis={detail} onRerun={rerun} onSettings={settings} />;
  else body = <Complete analysis={detail} entry={entry} onOpen={openRun} onRerun={rerun} onOptimize={optimize} onLeave={onLeave} />;

  return (
    <div className="grid gap-4" data-testid="analysis-view" data-analysis-id={id}>
      <div className="min-w-0">
        <h1 className={cn("m-0 font-semibold", inDialog ? "text-lg" : "text-xl")} data-testid="analysis-title">
          {entry?.title || "ATS analysis"}
        </h1>
        <p className="mt-1 mb-0 text-sm text-ink-2">{detail ? analysisSubtitle(detail, entry) : "Evidence-based comparison of your resume and the job description."}</p>
      </div>
      <QueueCard queue={queue.data ?? []} currentId={id} onOpen={openRun} />
      {body}
    </div>
  );
}
