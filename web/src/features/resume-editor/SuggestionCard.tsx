import { createContext, use, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Eyebrow, Spinner } from "@/components/ui/misc";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { useCtl } from "./controller";
import { useEditor } from "./store";
import type { GapKind, Suggestion } from "./types";

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

/** Requirements missing from both the resume and the profile, still waiting for the candidate's answer. */
export const gapQuestions = (all: Suggestion[]) => all.filter((item) => item.operation === "ask" && item.status === "pending");

/** Where a missing requirement can go: a job or project (a new line), a skill group (a skill), or the summary. */
function usePlacements() {
  const content = useEditor((state) => state.content)!;
  const option = (value: string, label: string) => ({ value, label });
  return [
    { group: "Experience: add a line", kind: "bullet" as GapKind, items: content.work.map((item) => option(item.id, [item.position, item.name].filter(Boolean).join(" — ") || "Untitled job")) },
    { group: "Projects: add a line", kind: "bullet" as GapKind, items: content.projects.map((item) => option(item.id, String(item.name || "Untitled project"))) },
    { group: "Skills: add a skill", kind: "skill" as GapKind, items: content.skills.map((item) => option(item.id, String(item.name || "Skills"))) },
    { group: "Summary", kind: "summary" as GapKind, items: [option("basics", content.basics.summary ? "Add it to the summary" : "Write a summary that includes it")] },
  ].filter((group) => group.items.length);
}

/**
 * A requirement nothing in the resume or profile supports. Instead of inventing content, ask: if you did this, where
 * does it belong and what did you do? The answer becomes an ordinary suggestion (written only from your words) that
 * you review and accept like any other.
 */
export function GapQuestionCard({ item }: { item: Suggestion }) {
  const ctl = useCtl();
  const placements = usePlacements();
  const [target, setTarget] = useState("");
  const [details, setDetails] = useState("");
  const [skill, setSkill] = useState(() => ((item.requirement ?? "").length <= 40 ? (item.requirement ?? "") : ""));
  const [busy, setBusy] = useState(false);
  const kind = placements.find((group) => group.items.some((option) => option.value === target))?.kind;
  const ready = kind === "skill" ? Boolean(skill.trim()) : Boolean(kind) && details.trim().length >= 8;
  const submit = async () => {
    if (!kind) return;
    setBusy(true);
    await ctl.answerGap(item, { kind, target_id: target, details, skill });
    setBusy(false);
  };
  return (
    <div className="grid gap-2 rounded-sm border border-l-[3px] border-line border-l-warn bg-warn-soft/40 p-3 text-sm" data-suggestion={item.id} data-testid="gap-question">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Missing from your resume and profile</Eyebrow>
        <Pill tone="warn">Your answer needed</Pill>
      </div>
      <p className="m-0 font-medium text-ink">{item.requirement}</p>
      <p className="m-0 text-xs text-ink-2">Have you done this, even if it isn't written down yet? Say where it belongs and what you actually did; a line is written only from your words for you to review.</p>
      <label className="grid gap-1 text-xs font-medium text-ink-2">
        Where does it belong?
        <Select value={target} onChange={(event) => setTarget(event.target.value)} data-testid="gap-target">
          <option value="">Choose a job, project, skill group or the summary</option>
          {placements.map((group) => (
            <optgroup key={group.group} label={group.group}>
              {group.items.map((option) => (
                <option key={`${group.kind}:${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </label>
      {kind === "skill" ? (
        <label className="grid gap-1 text-xs font-medium text-ink-2">
          Skill to add
          <Input value={skill} onChange={(event) => setSkill(event.target.value)} placeholder="e.g. Kubernetes" data-testid="gap-skill" />
        </label>
      ) : kind ? (
        <label className="grid gap-1 text-xs font-medium text-ink-2">
          What did you do? Your own words, only what's true
          <Textarea
            rows={3}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder="e.g. Deployed our services on a Kubernetes cluster and wrote the Helm charts for staging"
            data-testid="gap-details"
          />
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? <Spinner className="text-accent-ink" label="Writing" /> : null}
          {kind === "skill" ? "Suggest adding this skill" : busy ? "Writing…" : "Write it for me"}
        </Button>
        <Button size="sm" variant="quiet" disabled={busy} onClick={() => void ctl.suggestionAction("reject", item)}>
          I haven't done this
        </Button>
      </div>
    </div>
  );
}

/** All open "missing" questions, shown together because they have no place in the resume yet. */
export function GapQuestions() {
  const items = gapQuestions(useSuggestionList());
  if (!items.length) return null;
  return (
    <section className="grid gap-2" aria-label="Missing requirements" data-testid="gap-questions">
      {items.map((item) => (
        <GapQuestionCard key={item.id} item={item} />
      ))}
    </section>
  );
}

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
            {item.claim_type === "user_stated" ? "From what you told us" : source ? "Supported by your verified profile" : "Supported by your resume"}
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
      {item.answer?.details ? (
        <p className="m-0 text-xs text-ink-2" data-testid="suggestion-answer">
          You said: “{item.answer.details}”
        </p>
      ) : item.reason ? (
        <p className="m-0 text-xs text-ink-2">{item.reason}</p>
      ) : null}
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
