import { createContext, use } from "react";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/misc";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { useCtl } from "./controller";
import type { Suggestion } from "./types";

export const SuggestionsContext = createContext<Suggestion[]>([]);
export const useSuggestionList = () => use(SuggestionsContext);

const active = (item: Suggestion) => item.status !== "rejected";

/** Suggestions shown next to one field or after one item/line, using the same matching as the classic editor. */
export function suggestionsFor(all: Suggestion[], target: string, field: string, structural = false) {
  const items = all.filter((item) => item.target_id === target && active(item) && (structural ? item.operation !== "replace" : item.operation === "replace" && item.field === field));
  if (structural && field === "keywords") return items.filter((item) => item.operation === "add_keyword");
  if (structural) return items.filter((item) => item.operation === "insert_after");
  return items;
}

export const addProjectSuggestions = (all: Suggestion[]) => all.filter((item) => item.operation === "add_project" && active(item));

export function Suggestions({ target, field, structural = false }: { target: string; field: string; structural?: boolean }) {
  const items = suggestionsFor(useSuggestionList(), target, field, structural);
  return items.map((item) => <SuggestionCard key={item.id} item={item} />);
}

const VERBS: Record<string, string> = { replace: "Rewrite", insert_after: "Add a bullet", add_keyword: "Add skill", add_project: "Add a project from your profile" };

export function SuggestionCard({ item }: { item: Suggestion }) {
  const ctl = useCtl();
  const applied = item.status === "accepted" || item.status === "edited";
  const flags = (item.guard_flags ?? []).filter((flag) => flag.type !== "unverified_profile");
  const source = item.source;
  return (
    <div
      className={cn("mt-2 grid gap-1.5 rounded-sm border border-l-[3px] border-line border-l-accent bg-accent-soft/40 p-3 text-sm", applied && "border-l-success bg-success-soft/50", item.stale && "opacity-75")}
      data-suggestion={item.id}
      data-applied={applied ? "true" : "false"}
      data-testid="suggestion"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>AI suggestion · {VERBS[item.operation] ?? item.operation}</Eyebrow>
        {item.needs_verification ? (
          <Pill tone="warn" data-testid="needs-verification">
            Needs your verification
          </Pill>
        ) : (
          <Pill tone="success" data-testid="supported">
            {source ? "Supported by your verified profile" : "Supported by your resume"}
          </Pill>
        )}
      </div>
      {item.requirement ? <p className="m-0 text-xs text-ink-2">For: {item.requirement}</p> : null}
      {source ? (
        <p className="m-0 text-xs text-ink-2" data-testid="suggestion-source">
          Evidence: {source.label}
          {source.verified ? "" : <b> (not yet verified in your profile)</b>}{" "}
          <Button variant="text" className="text-xs" onClick={() => void ctl.openProfileItem(source.item_id)}>
            View source
          </Button>
        </p>
      ) : null}
      {item.project ? (
        <p className="m-0 rounded-sm bg-surface px-2 py-1.5" data-testid="suggestion-project">
          <span className="mr-2 text-xs font-semibold text-ink-3 uppercase">Project</span>
          {item.project.name}
          {item.project.keywords?.length ? ` · ${item.project.keywords.join(", ")}` : ""}
          {item.project.url ? (
            <>
              <br />
              {item.project.url}
            </>
          ) : null}
        </p>
      ) : null}
      {item.original_text ? (
        <p className="m-0 rounded-sm bg-surface px-2 py-1.5 text-ink-2">
          <span className="mr-2 text-xs font-semibold text-ink-3 uppercase">Original</span>
          {item.original_text}
        </p>
      ) : null}
      <p className="m-0 rounded-sm bg-surface px-2 py-1.5 text-ink">
        <span className="mr-2 text-xs font-semibold text-ink-3 uppercase">{applied ? "Applied" : "Suggested"}</span>
        {applied ? item.applied_text : item.proposed_text}
      </p>
      {item.reason ? <p className="m-0 text-xs text-ink-2">{item.reason}</p> : null}
      {flags.length ? (
        <p className="m-0 text-xs text-warn">
          Not found in your resume{source ? " or verified profile" : ""}:{" "}
          {flags.map((flag, index) => (
            <b key={flag.value}>
              {index ? ", " : ""}
              {flag.value}
            </b>
          ))}
          . Only accept if this is true.
        </p>
      ) : null}
      {item.stale ? <p className="m-0 text-xs text-warn">The original text has changed since this suggestion was made.</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {applied ? (
          <Button size="sm" variant="quiet" onClick={() => void ctl.suggestionAction("revert", item)}>
            Revert
          </Button>
        ) : (
          <>
            {item.stale ? null : (
              <>
                <Button size="sm" variant="primary" onClick={() => void ctl.suggestionAction("accept", item)}>
                  {source ? "Add to resume" : "Accept"}
                </Button>
                <Button size="sm" onClick={() => void ctl.suggestionAction("edit", item)}>
                  Edit suggestion
                </Button>
              </>
            )}
            <Button size="sm" variant="quiet" onClick={() => void ctl.suggestionAction("reject", item)}>
              {source ? "Dismiss" : "Reject"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
