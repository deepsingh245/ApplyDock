import { PlusIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import type { Entry } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Count } from "@/components/ui/misc";
import { Pill, toneFor } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { deliveryCategory, deliveryLabel, stageIsAfterApply } from "@/lib/domain";
import { scoreLabel } from "@/lib/format";
import { filterSource, listCounts, visibleEntries, type ListFilter, type ListOptions } from "./filtering";

const FILTERS: { value: ListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "to_apply", label: "To apply" },
  { value: "review", label: "Review" },
  { value: "applied", label: "Applied" },
  { value: "scheduled", label: "Scheduled" },
  { value: "rejected", label: "Rejected" },
];

function QueueItem({ entry, selected, onSelect }: { entry: Entry; selected: boolean; onSelect: () => void }) {
  const analysis = entry.analysis ?? { status: "not_analyzed", label: "Not analyzed", stale: false };
  const review = Boolean(entry.needs_review) && !stageIsAfterApply(entry.application_stage);
  return (
    <button
      type="button"
      data-id={entry.id}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "queue-item grid w-full cursor-pointer gap-1 border-b border-line px-4 py-3 text-left transition-ledger transition-colors hover:bg-surface-2",
        selected && "bg-accent-soft shadow-[inset_3px_0_0_var(--accent)] hover:bg-accent-soft",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <strong className="min-w-0 text-sm leading-snug font-semibold text-ink">{entry.title}</strong>
        <span className={cn("tabular shrink-0 text-xs", analysis.stale ? "text-warn" : "text-ink-2")} title={analysis.label || "Not analyzed"}>
          {scoreLabel(analysis.overall_score)}
        </span>
      </span>
      <span className="truncate text-xs text-ink-2">
        {entry.company || (entry.kind === "post" ? "Hiring post" : "Company not set")} · {entry.platform || "Other"}
      </span>
      <span className="flex flex-wrap gap-1">
        <Pill tone={toneFor(deliveryCategory(entry))}>{deliveryLabel(entry)}</Pill>
        {entry.application_stage ? <Pill tone="outline">{entry.application_stage}</Pill> : null}
        {review ? <Pill tone="warn">Needs review</Pill> : null}
      </span>
    </button>
  );
}

export function QueueList({
  entries,
  options,
  onOptionsChange,
  selectedId,
  onSelect,
  searchRef,
}: {
  entries: Entry[];
  options: ListOptions;
  onOptionsChange: (patch: Partial<ListOptions>) => void;
  selectedId: string;
  onSelect: (entry: Entry) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const counts = listCounts(entries);
  const shown = visibleEntries(entries, options);
  const source = filterSource(entries, options.filter);
  const filtersActive = options.analysis !== "all" || options.score !== "all" || options.sort !== "newest";
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (filtersActive && details.current) details.current.open = true;
  }, [filtersActive]);

  return (
    <aside className="flex min-h-0 flex-1 flex-col border-line bg-surface md:border-r" aria-label="Application queue">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h1 className="m-0 flex items-baseline gap-2 text-lg font-semibold">
          Applications <Count id="active-count">{counts.active}</Count>
        </h1>
        <Button asChild variant="primary" size="sm">
          <Link to="/applications/new" aria-label="Add a job or post" title="Add a job or post">
            <PlusIcon aria-hidden />
            Add
          </Link>
        </Button>
      </div>
      <div className="relative px-4 pb-2">
        <label className="sr-only" htmlFor="search-input">
          Search applications
        </label>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-6.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          ref={searchRef}
          id="search-input"
          type="search"
          placeholder="Search applications"
          value={options.query}
          onChange={(event) => onOptionsChange({ query: event.target.value })}
          className="h-(--control-h) w-full rounded-sm border border-line-strong bg-surface pr-8 pl-8 text-sm placeholder:text-ink-3 focus-visible:border-accent"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-6 -translate-y-1/2 rounded-sm border border-line px-1.5 text-xs text-ink-3" aria-hidden>
          /
        </kbd>
      </div>
      <Segmented
        label="Filter applications"
        testId="filters"
        className="flex-wrap overflow-visible px-4 pb-2"
        value={options.filter}
        onChange={(filter) => onOptionsChange({ filter })}
        options={FILTERS.map((item) =>
          item.value === "rejected" && counts.rejected ? { ...item, suffix: <Count id="rejected-count">{counts.rejected}</Count> } : item,
        )}
      />
      <details ref={details} className="group mx-4 mb-2 rounded-sm border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:text-ink">
          <SlidersHorizontalIcon className="size-4" aria-hidden />
          Analysis filters and sort
          {filtersActive ? <Pill tone="accent">On</Pill> : null}
        </summary>
        <div className="grid grid-cols-2 gap-2 border-t border-line p-2.5 text-xs">
          <label className="grid gap-1 text-ink-2">
            Analysis
            <Select value={options.analysis} onChange={(event) => onOptionsChange({ analysis: event.target.value as ListOptions["analysis"] })}>
              <option value="all">All results</option>
              <option value="complete">Complete</option>
              <option value="stale">Needs reanalysis</option>
              <option value="failed">Failed or limited</option>
              <option value="not_analyzed">Not analyzed</option>
            </Select>
          </label>
          <label className="grid gap-1 text-ink-2">
            Score
            <Select value={options.score} onChange={(event) => onOptionsChange({ score: event.target.value as ListOptions["score"] })}>
              <option value="all">Any score</option>
              <option value="high">75–100</option>
              <option value="medium">50–74</option>
              <option value="low">0–49</option>
            </Select>
          </label>
          <label className="col-span-2 grid gap-1 text-ink-2">
            Sort
            <Select value={options.sort} onChange={(event) => onOptionsChange({ sort: event.target.value as ListOptions["sort"] })}>
              <option value="newest">Newest</option>
              <option value="score_desc">Highest match</option>
              <option value="score_asc">Lowest match</option>
              <option value="analyzed">Last analyzed</option>
            </Select>
          </label>
        </div>
      </details>
      <div id="entry-list" className="min-h-0 flex-1 overflow-y-auto border-t border-line" aria-live="polite">
        {shown.length ? (
          shown.map((entry) => <QueueItem key={entry.id} entry={entry} selected={entry.id === selectedId} onSelect={() => onSelect(entry)} />)
        ) : (
          <div className="queue-empty grid gap-1 px-4 py-8 text-center text-sm text-ink-2">
            {options.filter === "rejected" && !source.length ? (
              <>
                <strong className="text-ink">No rejected applications.</strong>
                <p className="m-0">Applications whose stage is Rejected are kept here, out of your other lists.</p>
              </>
            ) : (
              <>
                <strong className="text-ink">{source.length ? "Nothing matches this view." : "Your queue is clear."}</strong>
                <p className="m-0">{source.length ? "Try another filter or search." : "Add a selected job or hiring post. Sent emails stay in Notion."}</p>
              </>
            )}
          </div>
        )}
      </div>
      <p className="m-0 border-t border-line px-4 py-2 text-xs text-ink-3">Sent applications leave this list and stay in Notion.</p>
    </aside>
  );
}
