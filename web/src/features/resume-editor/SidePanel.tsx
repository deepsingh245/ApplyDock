import type { ReactNode } from "react";
import { useJob, useProfileEntries } from "@/api/drafts";
import { useAppState } from "@/api/state";
import type { Analysis, Requirement } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Eyebrow, Spinner } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Pill } from "@/components/ui/pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { CoverageChip, MatchStatusPill } from "@/features/analysis/Requirements";
import { profileChangedSince } from "@/lib/domain";
import { dateLabel } from "@/lib/format";
import { useCtl } from "./controller";
import { PROFILE_GROUPS, SOURCE_LABELS } from "./model";
import { editor, useEditor } from "./store";
import { useSuggestionList } from "./SuggestionCard";
import type { ScoreCheckResult, SidePanelName } from "./types";

const Footnote = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cn("m-0 text-xs text-ink-3", className)}>{children}</p>;

function PdfFrame({ url, title }: { url: string; title: string }) {
  return <iframe title={title} src={`${url}#toolbar=0&navpanes=0&view=FitH`} className="h-[min(1100px,78vh)] w-full rounded-sm border border-line bg-surface" />;
}

function PreviewPane() {
  const ctl = useCtl();
  const preview = useEditor((state) => state.preview);
  const validation = useEditor((state) => state.validation);
  return (
    <div className="grid gap-3">
      <div data-testid="preview-frame">
        {preview.error ? (
          <Note tone="danger" className="grid gap-1">
            <strong>Preview unavailable</strong>
            <span>{preview.error}</span>
          </Note>
        ) : !preview.url ? (
          <div className="flex items-center justify-center gap-2 rounded-sm border border-dashed border-line-strong p-12 text-sm text-ink-2">
            <Spinner /> Generating preview…
          </div>
        ) : (
          <>
            {preview.previousPageCount && preview.pageCount && preview.pageCount > preview.previousPageCount ? (
              <Note tone="warn" className="mb-2">
                This edit increased the resume to {preview.pageCount} pages.
              </Note>
            ) : null}
            <PdfFrame url={preview.url} title="Generated resume preview" />
          </>
        )}
      </div>
      <div className="grid gap-2" data-testid="validation">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-sm">PDF checks</strong>
          <Button size="sm" variant="quiet" onClick={() => void ctl.validate()}>
            Run checks
          </Button>
        </div>
        {validation ? (
          <>
            {validation.ok ? (
              <Note tone="success" data-testid="check-ok">
                Text extraction checks passed: {validation.page_count} page(s), all content found in reading order, {validation.links_found} link(s), fonts embedded.
              </Note>
            ) : (
              validation.warnings.map((warning) => (
                <Note key={warning} tone="warn" data-testid="check-warn">
                  {warning}
                </Note>
              ))
            )}
            <Footnote>These checks use one PDF text extractor. They cannot guarantee how a particular employer's ATS will read the file.</Footnote>
          </>
        ) : (
          <Footnote>Run checks to re-read the generated PDF and confirm every section, bullet and link is present.</Footnote>
        )}
      </div>
      <Footnote>This is the actual PDF ApplyDock generates. Text is selectable; checks below confirm it can be extracted in order.</Footnote>
    </div>
  );
}

function VersionsPane() {
  const ctl = useCtl();
  return (
    <div className="grid gap-2" data-testid="versions">
      <Footnote>Each saved version is an immutable PDF. Restoring makes it current again without deleting anything.</Footnote>
      {ctl.data.versions.map((version) => (
        <div key={version.id} className={cn("grid gap-2 rounded-sm border p-3", version.is_current ? "border-accent bg-accent-soft/40" : "border-line bg-surface")} data-testid="version">
          <div className="grid gap-0.5 text-sm">
            <strong data-testid="version-title">
              Version {version.version_number}
              {version.is_current ? " · Current" : ""}
            </strong>
            <span className="text-ink-2">
              {SOURCE_LABELS[version.source] ?? version.source}
              {version.label ? ` · ${version.label}` : ""}
            </span>
            <small className="tabular text-xs text-ink-3">
              {version.original_filename} · {dateLabel(version.created_at)} · {version.sha256.slice(0, 10)}
            </small>
            {version.validation ? (
              <small className={cn("text-xs", version.validation.ok ? "text-success" : "text-warn")}>
                {version.validation.ok ? `Checks passed · ${version.validation.page_count} page(s)` : `${version.validation.warnings.length} check warning(s)`}
              </small>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="quiet" onClick={() => void ctl.downloadVersion(version)}>
              Download
            </Button>
            {version.has_content || version.source === "upload" ? (
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  editor().set({ panel: "compare" });
                  void ctl.compareWith(`v:${version.id}`);
                }}
              >
                Compare
              </Button>
            ) : null}
            {version.is_current ? null : (
              <Button size="sm" variant="quiet" onClick={() => void ctl.restoreVersion(version)}>
                Make current
              </Button>
            )}
            {version.has_content ? (
              <Button size="sm" variant="quiet" onClick={() => void ctl.loadVersion(version)}>
                Edit from here
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ComparePane() {
  const ctl = useCtl();
  const compare = useEditor((state) => state.compare);
  const parent = ctl.data.parent;
  return (
    <div className="grid gap-3" data-testid="compare">
      <label className="grid gap-1">
        <span className="text-xs font-medium text-ink-2">Compare current draft with</span>
        <Select value={compare?.value ?? ""} onChange={(event) => void ctl.compareWith(event.target.value)} data-testid="compare-select">
          <option value="">Choose…</option>
          {parent && !parent.deleted && parent.current_version_id ? <option value={`p:${parent.current_version_id}`}>Master: {parent.name}</option> : null}
          {ctl.data.versions.map((version) => (
            <option key={version.id} value={`v:${version.id}`}>
              Version {version.version_number} · {SOURCE_LABELS[version.source] ?? version.source}
            </option>
          ))}
        </Select>
      </label>
      {!compare ? (
        <Footnote>Choose a version to see what changed in your current draft.</Footnote>
      ) : compare.loading ? (
        <Footnote>Loading…</Footnote>
      ) : compare.error ? (
        <Note tone="warn">{compare.error}</Note>
      ) : compare.pdfUrl ? (
        <>
          <Footnote>The uploaded original has no structured content to diff. It is shown unchanged:</Footnote>
          <PdfFrame url={compare.pdfUrl} title="Original PDF" />
        </>
      ) : compare.changes?.length ? (
        <div className="grid gap-2" data-testid="diff">
          {compare.changes.map((change, index) => (
            <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-sm border border-line bg-surface p-2.5 text-sm" data-testid="diff-row" data-type={change.type}>
              <Pill tone={change.type === "added" ? "success" : change.type === "removed" ? "danger" : "warn"}>{change.type}</Pill>
              <div className="grid gap-1">
                <strong>{change.label}</strong>
                <small className="text-xs text-ink-3">
                  {change.section} · {change.field}
                </small>
                {change.before ? <del className="text-danger">{change.before}</del> : null}
                {change.after ? <ins className="text-success no-underline">{change.after}</ins> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Note tone="success" data-testid="no-differences">
          No differences.
        </Note>
      )}
    </div>
  );
}

const Status = ({ value }: { value: string }) => <MatchStatusPill status={value} />;

function ScoreCheck({ analysis }: { analysis: Analysis }) {
  const ctl = useCtl();
  const check = useEditor((state) => state.scoreCheck);
  const contentHash = useEditor((state) => state.contentHash);
  const { data: job } = useJob(check?.analysisId === analysis.id ? check.jobId : "", 1200);
  if (!check || check.analysisId !== analysis.id || !job)
    return analysis.status === "complete" ? (
      <Footnote>
        After applying suggestions, use <b>Check score</b> to see their effect on this analysis. It keeps every requirement whose text you did not change and adds nothing to the analysis history.
      </Footnote>
    ) : null;
  if (job.status === "pending" || job.status === "running")
    return (
      <p className="m-0 flex items-center gap-2 text-sm text-ink-2">
        <Spinner /> Checking the score of your changes… {job.percent || 0}%
      </p>
    );
  if (job.status === "failed") return <Note tone="warn">{job.error_message || "The score check failed."}</Note>;
  const result = job.result as unknown as ScoreCheckResult | null;
  if (!result) return null;
  const baseline = result.baseline_score ?? analysis.overall_score ?? 0;
  const delta = Math.round((result.overall_score - baseline) * 10) / 10;
  const outdated = Boolean(result.content_hash && result.content_hash !== contentHash);
  const items = result.rechecked_items ?? [];
  return (
    <div className="grid gap-2 rounded-md border border-accent bg-accent-soft/50 p-3" data-testid="score-check">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Eyebrow>Score with your changes</Eyebrow>
          <div className="flex items-baseline gap-2">
            <strong className="tabular text-2xl" data-testid="score-check-value">
              {Number(result.overall_score).toFixed(1)}
            </strong>
            <span className={cn("tabular text-sm", delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-ink-3")}>
              {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}
            </span>
          </div>
        </div>
        <small className="text-xs text-ink-2">vs {Number(baseline).toFixed(1)} in this analysis</small>
      </div>
      <p className="m-0 text-sm font-medium text-ink" data-testid="checked-what">
        Checked: your current draft (not saved as a version)
        {result.applied_suggestions ? `, including ${result.applied_suggestions} accepted suggestion${result.applied_suggestions === 1 ? "" : "s"}` : ""}. Nothing was added to the analysis history.
      </p>
      <Footnote>
        {result.full
          ? `Re-checked every requirement (${result.rechecked}).`
          : `Re-checked ${result.rechecked} requirement${result.rechecked === 1 ? "" : "s"} your edits touched; ${result.kept} kept their verdict because their text is unchanged.`}{" "}
        A requirement never drops while its supporting text is unchanged.
      </Footnote>
      {items.length ? (
        <ul className="m-0 grid list-none gap-1.5 p-0" data-testid="rechecked">
          {items.map((item) => (
            <li key={item.id} className="text-sm">
              <Status value={item.from} /> → <Status value={item.to} /> {item.requirement}
              {item.from === item.to ? <small className="ml-1 text-xs text-ink-3">unchanged</small> : null}
              {item.explanation ? <small className="block text-xs text-ink-2">{item.explanation}</small> : null}
            </li>
          ))}
        </ul>
      ) : result.changes?.length ? (
        <ul className="m-0 grid list-none gap-1.5 p-0" data-testid="rechecked">
          {result.changes.map((change) => (
            <li key={change.id} className="text-sm">
              <Status value={change.from} /> → <Status value={change.to} /> {change.requirement}
            </li>
          ))}
        </ul>
      ) : (
        <Footnote>No requirement needed re-checking: none of the text the analysis relied on changed.</Footnote>
      )}
      {result.full ? null : (
        <Button size="sm" variant="quiet" className="justify-self-start" onClick={() => void ctl.checkScore(true)}>
          Re-check all requirements
        </Button>
      )}
      {outdated ? <Note tone="warn">The draft changed after this check. Check again to include the latest edits.</Note> : null}
    </div>
  );
}

function Gap({ item }: { item: Requirement }) {
  const ctl = useCtl();
  return (
    <div className="grid gap-1 border-t border-line pt-2 text-sm first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <Status value={item.status} />
        <span>{item.requirement}</span>
        <CoverageChip coverage={item.coverage} />
      </div>
      {item.recommendation ? <small className="text-xs text-ink-2">{item.recommendation}</small> : null}
      {(item.profile_evidence ?? []).map((source) => (
        <Button key={source.id} variant="text" className="justify-self-start text-xs" onClick={() => void ctl.openProfileItem(source.item_id)}>
          From your profile: {source.label}
        </Button>
      ))}
    </div>
  );
}

function JobMatchPane({ analysis }: { analysis: Analysis | undefined }) {
  const ctl = useCtl();
  const { data: appState } = useAppState();
  const meta = useEditor((state) => state.meta);
  const suggestionJobId = useEditor((state) => state.suggestionJobId);
  const { data: job } = useJob(suggestionJobId);
  const suggestionsCount = useSuggestionList().length;
  const checkJobId = useEditor((state) => state.scoreCheck?.jobId ?? "");
  const { data: checkJob } = useJob(checkJobId, 1200);
  const checking = Boolean(checkJob && (checkJob.status === "pending" || checkJob.status === "running"));
  const running = Boolean(job && (job.status === "pending" || job.status === "running"));
  const needsReview = Boolean(meta?.needs_review);
  const entry = ctl.entry;
  const resume = ctl.data.resume;
  const requirements = analysis?.result?.requirements ?? [];
  const addressedCount = requirements.filter((item) => analysis?.checklist?.[item.id] === "addressed").length;
  const gaps = requirements.filter((item) => item.status !== "demonstrated" && analysis?.checklist?.[item.id] !== "addressed");
  const complete = analysis?.status === "complete";
  return (
    <div className="grid gap-3" data-testid="job-match">
      {!entry ? <Footnote>Open this resume from an application to compare it with that job.</Footnote> : null}
      {analysis ? (
        <>
          <div className="flex items-center gap-3" data-testid="analysis-score">
            <strong className="tabular text-2xl">{analysis.overall_score == null ? "—" : `${analysis.overall_score}%`}</strong>
            <div className="grid">
              <span className="text-sm font-medium" data-testid="analysis-label">
                {analysis.result?.draft ? "Draft check · not saved as a version" : analysis.label}
              </span>
              <small className="text-xs text-ink-3">Estimated match using ApplyDock's scoring — not a prediction of any employer's ATS.</small>
            </div>
          </div>
          {analysis.status === "pending" || analysis.status === "analyzing" ? (
            <p className="m-0 flex items-center gap-2 text-sm text-ink-2" data-testid="analyzing">
              <Spinner /> Analyzing… {analysis.progress_percent ?? 0}%
            </p>
          ) : null}
          {profileChangedSince(analysis, appState?.profile_hash) ? (
            <Note tone="warn">
              Your Master Profile changed since this result. Use <b>New analysis</b> to compare against it, then refresh suggestions — nothing needs to be saved first.
            </Note>
          ) : null}
          <ScoreCheck analysis={analysis} />
          {gaps.length ? (
            <div className="grid gap-2">
              <strong className="text-sm">Gaps and weak areas</strong>
              {gaps.slice(0, 10).map((item) => (
                <Gap key={item.id} item={item} />
              ))}
            </div>
          ) : null}
          {addressedCount ? (
            <Footnote>
              {addressedCount} requirement{addressedCount === 1 ? " is" : "s are"} marked addressed and hidden here.
            </Footnote>
          ) : null}
        </>
      ) : entry ? (
        <Footnote>No completed analysis yet for this application.</Footnote>
      ) : null}
      {entry ? (
        <>
          {resume.kind === "master" && entry.resume_id === resume.id ? (
            <Note tone="info" className="grid gap-2">
              <span>You are editing the master resume. To tailor it for {entry.company || "this job"} without changing the master, create a tailored copy.</span>
              <Button className="justify-self-start" onClick={() => void ctl.tailor()}>
                Create tailored copy
              </Button>
            </Note>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {complete ? (
              <>
                <Button variant="primary" disabled={checking || needsReview} onClick={() => void ctl.checkScore(false)}>
                  Check score
                </Button>
                <Button disabled={running || needsReview} onClick={() => void ctl.requestSuggestions()}>
                  {suggestionsCount ? "Refresh suggestions" : "Suggest improvements"}
                </Button>
              </>
            ) : null}
            <Button variant={complete ? "quiet" : "primary"} disabled={needsReview} onClick={() => void ctl.analyzeDraft()}>
              New analysis
            </Button>
            <Button variant="quiet" onClick={() => void ctl.saveVersion(true)}>
              Save version &amp; new analysis
            </Button>
            {analysis?.id ? (
              <Button variant="quiet" onClick={() => void ctl.openAnalysis()}>
                Open full analysis
              </Button>
            ) : null}
          </div>
          {needsReview ? <Footnote>Confirm the imported content before asking for suggestions.</Footnote> : null}
          {running && job ? (
            <p className="m-0 flex items-center gap-2 text-sm text-ink-2">
              <Spinner /> Codex is preparing suggestions… {job.percent || 0}%
            </p>
          ) : null}
          {job?.status === "failed" ? <Note tone="warn">{job.error_message || "Suggestions failed."}</Note> : null}
          {typeof job?.result?.notes === "string" && job.result.notes ? <Footnote>{job.result.notes}</Footnote> : null}
          <div className="grid gap-1.5 rounded-sm border border-line bg-surface p-3 text-sm">
            <strong>Application attachment</strong>
            {entry.resume_id === resume.id && entry.resume_version ? (
              <p className="m-0 text-ink-2">
                This application uses version {entry.resume_version.version_number}
                {entry.resume_version.pinned ? " (pinned)" : " (follows current)"} · {entry.resume_version.filename}
              </p>
            ) : (
              <p className="m-0 text-ink-2">This application currently uses a different resume.</p>
            )}
            <Button className="justify-self-start" onClick={() => void ctl.useForApplication()}>
              Use current version for this application
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ProfilePane({ analysis }: { analysis: Analysis | undefined }) {
  const ctl = useCtl();
  const { data: entries } = useProfileEntries(ctl.resumeId);
  const recommending = useEditor((state) => state.recommending);
  const needsReview = Boolean(useEditor((state) => state.meta?.needs_review));
  if (!entries)
    return (
      <p className="m-0 flex items-center gap-2 text-sm text-ink-2">
        <Spinner /> Loading your Master Profile…
      </p>
    );
  // Entries the job analysis cited for a gap come first, tagged with what they help with.
  const helps: Record<string, string[]> = {};
  for (const requirement of analysis?.result?.requirements ?? []) {
    if (requirement.coverage === "represented") continue;
    for (const source of requirement.profile_evidence ?? []) (helps[source.item_id] ??= []).push(requirement.requirement);
  }
  return (
    <div className="grid gap-3" data-testid="from-profile">
      <Footnote>Add entries from your Master Profile to this draft. Facts are copied as written in your profile; nothing is saved as a version until you choose Save version.</Footnote>
      {ctl.entry ? (
        <div className="grid gap-1.5">
          <Button variant="primary" className="justify-self-start" disabled={Boolean(recommending) || needsReview} onClick={() => void ctl.recommendFromProfile()}>
            Recommend from my profile for this job
          </Button>
          {recommending ? (
            <p className="m-0 flex items-center gap-2 text-sm text-ink-2">
              <Spinner /> {recommending}
            </p>
          ) : (
            <Footnote>Uses this job's current analysis (or runs one if there is none) and suggests what to add from your profile — shown next to the text it changes.</Footnote>
          )}
        </div>
      ) : null}
      {!entries.length ? (
        <Footnote>Your Master Profile is empty. Add experience and projects under Settings → Master Profile.</Footnote>
      ) : (
        PROFILE_GROUPS.map(([kind, title]) => {
          const group = entries.filter((item) => item.kind === kind).sort((a, b) => (helps[b.item_id] ? 1 : 0) - (helps[a.item_id] ? 1 : 0));
          if (!group.length) return null;
          return (
            <section key={kind} className="grid gap-1.5">
              <h3 className="m-0 text-sm font-semibold">{title}</h3>
              {group.map((item) => {
                const help = kind === "personal" ? [] : (helps[item.item_id] ?? []);
                return (
                  <div
                    key={item.key}
                    className={cn("flex items-center justify-between gap-3 rounded-sm border bg-surface p-2.5", help.length ? "border-accent" : "border-line")}
                    data-testid="profile-entry"
                    data-profile-key={item.key}
                  >
                    <div className="grid min-w-0 gap-0.5 text-sm">
                      <strong className="truncate">{item.label}</strong>
                      {item.detail ? <small className="text-xs text-ink-2">{item.detail}</small> : null}
                      {help.length ? <small className="text-xs text-accent">Helps with: {help.slice(0, 2).join("; ")}</small> : null}
                      {item.verified ? null : (
                        <Pill tone="warn" className="justify-self-start">
                          Not verified
                        </Pill>
                      )}
                    </div>
                    {item.in_resume ? (
                      <Pill tone="success">In resume</Pill>
                    ) : !item.addable ? (
                      <span className="text-xs text-ink-3">{item.reason}</span>
                    ) : (
                      <Button size="sm" onClick={() => void ctl.addFromProfile(item)}>
                        Add to resume
                      </Button>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })
      )}
    </div>
  );
}

export function SidePanel({ analysis }: { analysis: Analysis | undefined }) {
  const ctl = useCtl();
  const panel = useEditor((state) => state.panel);
  const analysisId = useEditor((state) => state.analysisId);
  const showJobMatch = Boolean(analysisId || ctl.entry);
  return (
    <div className="grid gap-3">
      <Tabs value={panel} onValueChange={(value) => ctl.showPanel(value as SidePanelName)}>
        <TabsList variant="segmented" aria-label="Side panel" className="w-full">
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
          {showJobMatch ? <TabsTrigger value="analysis">Job match</TabsTrigger> : null}
          <TabsTrigger value="profile">From profile</TabsTrigger>
        </TabsList>
        {/* Radix renders only the active panel, so tab aria-controls always point at a rendered element. */}
        <TabsContent value="preview" className="mt-3">
          <PreviewPane />
        </TabsContent>
        <TabsContent value="versions" className="mt-3">
          <VersionsPane />
        </TabsContent>
        <TabsContent value="compare" className="mt-3">
          <ComparePane />
        </TabsContent>
        {showJobMatch ? (
          <TabsContent value="analysis" className="mt-3">
            <JobMatchPane analysis={analysis} />
          </TabsContent>
        ) : null}
        <TabsContent value="profile" className="mt-3">
          <ProfilePane analysis={analysis} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
