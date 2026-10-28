import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useSetChecklist } from "@/api/analyses";
import type { Analysis, ChecklistState, Requirement } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Count } from "@/components/ui/misc";
import { Pill, toneFor } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { notify } from "@/components/ui/toaster";
import { profileItemPath } from "@/features/profile/links";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { coverageLabel } from "@/lib/domain";
import { priorityItems, requirementVisible, statusChange, statusGroup, type RequirementFilter } from "./model";

const DOT: Record<string, string> = { matched: "bg-success", partial: "bg-warn", missing: "bg-danger" };

export function MatchStatusPill({ status }: { status: string }) {
  return (
    <Pill tone={toneFor(status)} data-match-status={status}>
      {status}
    </Pill>
  );
}

export function CoverageChip({ coverage }: { coverage?: string }) {
  if (!coverage) return null;
  return (
    <Pill tone={toneFor(coverage)} className="coverage-chip" data-coverage={coverage}>
      {coverageLabel(coverage)}
    </Pill>
  );
}

function RequirementCard({ analysis, item, onLeave }: { analysis: Analysis; item: Requirement; onLeave?: () => void }) {
  const setChecklist = useSetChecklist(analysis.id);
  const checklist = analysis.checklist?.[item.id] ?? "pending";
  const group = statusGroup(item.status);
  const change = statusChange(item);
  const sources = item.profile_evidence ?? [];
  const update = (state: ChecklistState) =>
    setChecklist.mutate(
      { requirementId: item.id, state },
      {
        onSuccess: () => notify(state === "addressed" ? "Marked as addressed — moved to the Addressed section." : "Recommendation checklist updated."),
        onError: (error) => notify(errorMessage(error), true),
      },
    );
  return (
    <details
      className="group rounded-md border border-line bg-surface open:border-line-strong"
      data-testid="requirement-card"
      data-requirement-status={group}
      data-requirement-coverage={item.coverage ?? ""}
    >
      <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2.5 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <span className={cn("mt-1.5 size-2 rounded-pill", DOT[group])} aria-hidden />
        <span className="min-w-0">
          <strong className="block text-sm">{item.requirement}</strong>
          <small className="block text-xs text-ink-2">{item.explanation || "Open to inspect evidence and recommendation."}</small>
        </span>
        <span className="flex flex-wrap items-center justify-end gap-1.5">
          {change ? (
            <Pill tone={change === "up" ? "success" : change === "down" ? "danger" : "neutral"} title={`Previous run: ${item.previous_status}`}>
              was {item.previous_status}
            </Pill>
          ) : null}
          <MatchStatusPill status={item.status} />
          <CoverageChip coverage={item.coverage} />
          <ChevronRightIcon className="size-4 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
        </span>
      </summary>
      <div className="grid gap-3 border-t border-line px-3 py-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {item.mandatory ? <Pill tone="danger">Required</Pill> : <Pill tone="outline">Preferred</Pill>}
          <Pill tone="neutral">{item.priority} priority</Pill>
        </div>
        {item.resume_evidence?.length ? (
          <div className="grid gap-1.5">
            {item.resume_evidence.map((block) => (
              <blockquote key={block.id} className="m-0 rounded-sm border-l-[3px] border-line-strong bg-surface-2 px-3 py-2 text-sm">
                <strong className="tabular mr-2 text-xs text-ink-3">{block.id}</strong>
                {block.text}
              </blockquote>
            ))}
          </div>
        ) : (
          <small className="text-xs text-ink-3">No supporting resume evidence</small>
        )}
        {sources.length ? (
          <div className="grid gap-1 rounded-sm bg-accent-soft px-3 py-2" data-testid="profile-evidence">
            <strong className="text-sm">{item.coverage === "profile_only" ? "Your Master Profile has evidence the resume lacks" : "Related evidence in your Master Profile"}</strong>
            {sources.map((source) => (
              <p key={source.id} className="m-0 flex flex-wrap items-center gap-2">
                {source.label}
                {source.verified ? null : <Pill tone="warn">Unverified</Pill>}
                <Link to={profileItemPath(source.item_id)} onClick={onLeave} className="text-sm" data-profile-item={source.item_id}>
                  View source
                </Link>
              </p>
            ))}
          </div>
        ) : item.coverage === "unsupported" ? (
          <p className="m-0 text-xs text-ink-3">
            Neither your resume nor your Master Profile supports this. Do not add it unless it is true; if it is, add the evidence to your profile first.
          </p>
        ) : null}
        {item.recommendation ? (
          <div className="grid gap-2 rounded-sm border border-line px-3 py-2">
            <strong>Recommendation</strong>
            <p className="m-0 text-ink-2">{item.recommendation}</p>
            <label className="grid max-w-60 gap-1 text-xs font-medium text-ink-2">
              Checklist state
              <Select value={checklist} disabled={setChecklist.isPending} onChange={(event) => update(event.target.value as ChecklistState)} data-recommendation={item.id}>
                <option value="pending">Pending</option>
                <option value="reviewed">Reviewed</option>
                <option value="addressed">Addressed</option>
              </Select>
            </label>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function AddressedList({ analysis, items }: { analysis: Analysis; items: Requirement[] }) {
  const setChecklist = useSetChecklist(analysis.id);
  if (!items.length) return null;
  return (
    <details className="mt-3 rounded-md border border-line bg-surface" data-testid="addressed-requirements">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-2">Addressed ({items.length}) — hidden from the list above</summary>
      <div className="grid border-t border-line">
        {items.map((item) => (
          <div key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-2 text-sm text-ink-2 last:border-b-0" data-testid="addressed-row">
            <MatchStatusPill status={item.status} />
            <span>{item.requirement}</span>
            <Button
              variant="text"
              disabled={setChecklist.isPending}
              onClick={() =>
                setChecklist.mutate(
                  { requirementId: item.id, state: "pending" },
                  { onSuccess: () => notify("Reopened — it is back in the open list."), onError: (error) => notify(errorMessage(error), true) },
                )
              }
            >
              Reopen
            </Button>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Requirements explorer: open requirements with filters and search; addressed ones collapse into their own list. */
export function RequirementsExplorer({ analysis, open, addressed, hasCoverage, onLeave }: {
  analysis: Analysis;
  open: Requirement[];
  addressed: Requirement[];
  hasCoverage: boolean;
  onLeave?: () => void;
}) {
  const [filter, setFilter] = useState<RequirementFilter>("all");
  const [query, setQuery] = useState("");
  const total = open.length + addressed.length;
  const visible = open.filter((item) => requirementVisible(item, filter, query));
  return (
    <section className="grid gap-3" aria-labelledby="requirements-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="requirements-title" className="m-0 text-lg font-semibold">
            Requirements explorer
          </h2>
          <p className="m-0 text-sm text-ink-2">Inspect matched evidence and gaps in your resume.</p>
        </div>
        <Count data-testid="requirements-count">
          {open.length} open{addressed.length ? ` · ${addressed.length} addressed` : ""}
        </Count>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Filter requirements"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "missing", label: "Missing" },
            { value: "partial", label: "Partial" },
            { value: "matched", label: "Matched" },
            ...(hasCoverage ? [{ value: "profile_only" as const, label: "In profile" }] : []),
          ]}
        />
        <Input type="search" placeholder="Search requirements" aria-label="Search requirements" className="md:max-w-64" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="grid gap-2" data-testid="requirements-list">
        {open.length ? (
          visible.map((item) => <RequirementCard key={item.id} analysis={analysis} item={item} onLeave={onLeave} />)
        ) : (
          <Card>
            <p className="m-0 text-sm">
              {total ? "Everything is addressed. Reopen an item below if you want to work on it again." : "No scorable requirements are available for this run."}
            </p>
          </Card>
        )}
        {open.length && !visible.length ? <p className="m-0 text-sm text-ink-3">Nothing matches this filter.</p> : null}
      </div>
      <AddressedList analysis={analysis} items={addressed} />
    </section>
  );
}

export function PriorityImprovements({ open }: { open: Requirement[] }) {
  const items = priorityItems(open);
  return (
    <Card data-testid="priority-improvements">
      <CardHeader title="Priority improvements" aside={<Count>{items.length} high impact</Count>} />
      {items.length ? (
        <div className="grid gap-3">
          {items.map((item) => (
            <article key={item.id} className="grid gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">{item.requirement}</strong>
                <CoverageChip coverage={item.coverage} />
              </div>
              <p className="m-0 text-sm text-ink-2">{item.recommendation}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-ink-2">No priority gaps were returned for this analysis.</p>
      )}
    </Card>
  );
}
