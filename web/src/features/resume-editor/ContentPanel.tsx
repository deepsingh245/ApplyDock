import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { useProfileEntries } from "@/api/drafts";
import { Button, IconButton } from "@/components/ui/button";
import { CheckLine, inputClass, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { useCtl } from "./controller";
import { ADD_LABELS, findTarget, ITEM_FIELDS, itemFilled, itemTitle, moveInList, newId, newItem, SECTION_LABELS, sectionEmpty, sectionTitle, type FieldSpec } from "./model";
import { editor, useEditor } from "./store";
import { addProjectSuggestions, SuggestionCard, Suggestions, useSuggestionList } from "./SuggestionCard";
import type { Item, ListSection, ResumeContent, Section, Suggestion } from "./types";

const readValue = (content: ResumeContent | null, target: string, field: string): unknown => (content ? findTarget(content, target)?.node[field] : undefined);

function FieldShell({ label, htmlFor, wide, children }: { label: string; htmlFor: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1", wide && "col-span-full")}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Comma-separated list fields keep the raw text while typing, so "React, " is not trimmed under the cursor. */
function ListInput({ id, target, field, placeholder }: { id: string; target: string; field: string; placeholder?: string }) {
  const value = useEditor((state) => readValue(state.content, target, field)) as string[] | undefined;
  const [local, setLocal] = useState<string | null>(null);
  return (
    <input
      id={id}
      className={inputClass}
      data-target={target}
      data-field={field}
      placeholder={placeholder}
      value={local ?? (value ?? []).join(", ")}
      onChange={(event) => {
        setLocal(event.target.value);
        editor().setField(target, field, event.target.value);
      }}
      onBlur={() => setLocal(null)}
    />
  );
}

export function EditField({ target, spec, wide, rows = 3 }: { target: string; spec: FieldSpec; wide?: boolean; rows?: number }) {
  const id = `re-${target}-${spec.name}`;
  const value = useEditor((state) => (spec.kind === "keywords" ? null : readValue(state.content, target, spec.name)));
  const common = { id, "data-target": target, "data-field": spec.name, placeholder: spec.placeholder };
  return (
    <FieldShell label={spec.label} htmlFor={id} wide={wide ?? spec.kind !== "text"}>
      {spec.kind === "keywords" ? (
        <ListInput id={id} target={target} field={spec.name} placeholder={spec.placeholder} />
      ) : spec.kind === "textarea" ? (
        <Textarea {...common} rows={rows} value={String(value ?? "")} onChange={(event) => editor().setField(target, spec.name, event.target.value)} />
      ) : (
        <input {...common} className={inputClass} value={String(value ?? "")} onChange={(event) => editor().setField(target, spec.name, event.target.value)} />
      )}
      <Suggestions target={target} field={spec.name} />
    </FieldShell>
  );
}

function MoveButtons({ index, count, onMove, label }: { index: number; count: number; onMove: (dir: number) => void; label: string }) {
  return (
    <>
      <IconButton label={`Move ${label} up`} disabled={!index} onClick={() => onMove(-1)} className="size-7">
        <ArrowUpIcon aria-hidden />
      </IconButton>
      <IconButton label={`Move ${label} down`} disabled={index >= count - 1} onClick={() => onMove(1)} className="size-7">
        <ArrowDownIcon aria-hidden />
      </IconButton>
    </>
  );
}

function LineList({ item, listKey, sectionLabel }: { item: Item; listKey: "highlights" | "items"; sectionLabel: string }) {
  const lines = item[listKey] ?? [];
  const structural = editor().structural;
  return (
    <div className="col-span-full grid gap-2">
      <span className="text-xs font-medium text-ink-2">{listKey === "highlights" ? "Bullet points" : "Lines"}</span>
      {lines.map((line, index) => (
        <div key={line.id} className="grid gap-1" data-line={line.id}>
          <div className="flex items-start gap-1">
            <Textarea
              rows={2}
              data-target={line.id}
              data-field="text"
              aria-label={`${sectionLabel} line ${index + 1}`}
              placeholder="Describe what you did and the result"
              value={line.text}
              onChange={(event) => editor().setField(line.id, "text", event.target.value)}
            />
            <div className="flex shrink-0">
              <MoveButtons
                index={index}
                count={lines.length}
                label="line"
                onMove={(dir) =>
                  structural((content) => {
                    const found = findTarget(content as ResumeContent, line.id);
                    if (found?.list) moveInList(found.list, found.list.findIndex((entry) => entry.id === line.id), dir);
                  })
                }
              />
              <IconButton
                label="Remove line"
                className="size-7"
                onClick={() =>
                  structural((content) => {
                    const found = findTarget(content as ResumeContent, line.id);
                    if (found?.list) found.list.splice(found.list.findIndex((entry) => entry.id === line.id), 1);
                  })
                }
              >
                <XIcon aria-hidden />
              </IconButton>
            </div>
          </div>
          <Suggestions target={line.id} field="text" />
          <Suggestions target={line.id} field="text" structural />
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="quiet"
          onClick={() =>
            structural((content) => {
              const found = findTarget(content as ResumeContent, item.id);
              if (!found) return;
              const node = found.node as Item;
              node[listKey] = [...(node[listKey] ?? []), { id: newId(listKey === "highlights" ? "h" : "ci"), text: "" }];
            })
          }
        >
          <PlusIcon aria-hidden /> Add {listKey === "highlights" ? "bullet" : "line"}
        </Button>
      </div>
    </div>
  );
}

const ItemCard = memo(function ItemCard({ section, item, index, count, hidden }: { section: ListSection; item: Item; index: number; count: number; hidden: boolean }) {
  const ctl = useCtl();
  const structural = editor().structural;
  return (
    <div className={cn("grid gap-3 rounded-md border border-line bg-surface p-3", hidden && "hidden")} data-item={item.id}>
      <div className="flex items-center justify-between gap-2">
        <strong className="min-w-0 truncate text-sm">{itemTitle(section, item)}</strong>
        <div className="flex shrink-0">
          <MoveButtons
            index={index}
            count={count}
            label="entry"
            onMove={(dir) => structural((content) => moveInList(content[section], content[section].findIndex((entry) => entry.id === item.id), dir))}
          />
          <IconButton
            label="Remove entry"
            className="size-7 text-danger"
            onClick={async () => {
              if (itemFilled(item) && !(await ctl.removeItemConfirmed("Remove this entry? You can undo this."))) return;
              structural((content) => {
                content[section] = content[section].filter((entry) => entry.id !== item.id);
              });
            }}
          >
            <XIcon aria-hidden />
          </IconButton>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {ITEM_FIELDS[section].map((spec) => (
          <EditField key={spec.name} target={item.id} spec={spec} />
        ))}
        {section === "skills" || section === "projects" ? (
          <div className="col-span-full">
            <Suggestions target={item.id} field="keywords" structural />
          </div>
        ) : null}
        {section === "work" || section === "projects" ? <LineList item={item} listKey="highlights" sectionLabel={SECTION_LABELS[section]} /> : null}
        {section === "custom" ? <LineList item={item} listKey="items" sectionLabel={String(item.title || "Section")} /> : null}
      </div>
      <Suggestions target={item.id} field="text" structural />
    </div>
  );
});

function itemHasSuggestion(item: Item, suggestions: Suggestion[]) {
  const ids = new Set([item.id, ...(item.highlights ?? []).map((line) => line.id), ...(item.items ?? []).map((line) => line.id)]);
  return suggestions.some((suggestion) => suggestion.status !== "rejected" && ids.has(suggestion.target_id));
}

function SectionBlock({ section, position, total, revealRef }: { section: Section; position: number; total: number; revealRef?: (node: HTMLDetailsElement | null) => void }) {
  const content = useEditor((state) => state.content)!;
  const onlySuggested = useEditor((state) => state.onlySuggested);
  const suggestions = useSuggestionList();
  const ctl = useCtl();
  const { data: profileEntries } = useProfileEntries(ctl.resumeId);
  const structural = editor().structural;
  const title = sectionTitle(content, section);
  let body: ReactNode;
  let hasSuggestion: boolean;
  if (section === "summary") {
    const fromProfile = profileEntries?.find((entry) => entry.key === "personal:summary" && !entry.in_resume);
    hasSuggestion = suggestions.some((item) => item.status !== "rejected" && item.target_id === "basics" && item.field === "summary");
    body = (
      <>
        <EditField target="basics" spec={{ name: "summary", label: "Professional summary", kind: "textarea" }} rows={4} />
        {fromProfile ? (
          <div>
            <Button size="sm" variant="quiet" onClick={() => void ctl.addFromProfile(fromProfile)}>
              {content.basics.summary ? "Replace with my profile summary" : "Use my profile summary"}
            </Button>
          </div>
        ) : null}
      </>
    );
  } else {
    const items = content[section];
    const projectCards = section === "projects" ? addProjectSuggestions(suggestions) : [];
    hasSuggestion = projectCards.length > 0 || items.some((item) => itemHasSuggestion(item, suggestions));
    body = (
      <>
        {section !== "custom" ? (
          <div className="grid gap-1">
            <label htmlFor={`re-title-${section}`} className="text-xs font-medium text-ink-2">
              Heading shown on the resume
            </label>
            <input
              id={`re-title-${section}`}
              className={inputClass}
              data-section-title={section}
              value={content.meta.section_titles[section] ?? ""}
              onChange={(event) => editor().setSectionTitle(section, event.target.value)}
            />
          </div>
        ) : null}
        {items.map((item, index) => (
          <ItemCard key={item.id} section={section} item={item} index={index} count={items.length} hidden={onlySuggested && !itemHasSuggestion(item, suggestions)} />
        ))}
        {projectCards.map((item) => (
          <SuggestionCard key={item.id} item={item} />
        ))}
        <div>
          <Button
            size="sm"
            onClick={() =>
              structural((draft) => {
                draft[section].push(newItem(section));
              })
            }
          >
            <PlusIcon aria-hidden /> Add {ADD_LABELS[section]}
          </Button>
        </div>
      </>
    );
  }
  const count = section === "summary" ? (content.basics.summary ? 1 : 0) : content[section].length;
  return (
    <details ref={revealRef} open className={cn("group rounded-md border border-line bg-canvas", onlySuggested && !hasSuggestion && "hidden")} data-section={section}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm font-semibold select-none">
        <span>{title}</span>
        <small className="tabular text-xs font-normal text-ink-3">{count}</small>
      </summary>
      <div className="grid gap-3 border-t border-line p-3">
        {/* Kept out of <summary>: controls inside it are nested interactive elements. */}
        <div className="-mt-1 -mb-2 flex items-center justify-end gap-1 text-xs text-ink-3">
          <span>Section position</span>
          <MoveButtons
            index={position}
            count={total}
            label="section"
            onMove={(dir) => structural((draft) => moveInList(draft.meta.section_order, draft.meta.section_order.indexOf(section), dir))}
          />
        </div>
        {body}
      </div>
    </details>
  );
}

function PersonalSection() {
  const profiles = useEditor((state) => state.content!.basics.profiles);
  const structural = editor().structural;
  const field = (name: string, label: string, placeholder = "") => <EditField target="basics" spec={{ name, label, placeholder, kind: "text" }} wide={false} />;
  return (
    <details open className="rounded-md border border-line bg-canvas" data-section="basics">
      <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold select-none">Personal information</summary>
      <div className="grid gap-3 border-t border-line p-3">
        <div className="grid gap-3 md:grid-cols-2">
          {field("name", "Full name")}
          {field("label", "Headline", "Frontend Engineer")}
          {field("email", "Email")}
          {field("phone", "Phone")}
          {field("location", "Location", "City, Country")}
          {field("url", "Website", "https://")}
        </div>
        <div className="grid gap-2">
          <span className="text-xs font-medium text-ink-2">Profiles</span>
          {profiles.map((profile) => (
            <div key={profile.id} className="flex gap-2">
              <input
                className={cn(inputClass, "max-w-40")}
                data-target={profile.id}
                data-field="network"
                aria-label="Profile name"
                placeholder="LinkedIn"
                value={profile.network}
                onChange={(event) => editor().setField(profile.id, "network", event.target.value)}
              />
              <input
                className={inputClass}
                data-target={profile.id}
                data-field="url"
                aria-label="Profile link"
                placeholder="https://"
                value={profile.url}
                onChange={(event) => editor().setField(profile.id, "url", event.target.value)}
              />
              <IconButton
                label="Remove profile"
                onClick={() =>
                  structural((content) => {
                    content.basics.profiles = content.basics.profiles.filter((entry) => entry.id !== profile.id);
                  })
                }
              >
                <XIcon aria-hidden />
              </IconButton>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="quiet"
              onClick={() =>
                structural((content) => {
                  content.basics.profiles.push({ id: newId("p"), network: "", url: "" });
                })
              }
            >
              <PlusIcon aria-hidden /> Add profile link
            </Button>
          </div>
        </div>
      </div>
    </details>
  );
}

/** Empty sections stay out of the form until revealed, unless a suggestion targets them. */
function sectionVisible(content: ResumeContent, section: Section, revealed: string[], suggestions: Suggestion[]) {
  if (!sectionEmpty(content, section) || revealed.includes(section)) return true;
  const pending = suggestions.filter((item) => item.status !== "rejected");
  if (section === "summary") return pending.some((item) => item.target_id === "basics" && item.field === "summary");
  if (section === "projects") return pending.some((item) => item.operation === "add_project");
  return false;
}

function SuggestionSummary() {
  const suggestions = useSuggestionList();
  const onlySuggested = useEditor((state) => state.onlySuggested);
  if (!suggestions.length) return null;
  const pending = suggestions.filter((item) => item.status === "pending" && !item.stale);
  const verify = pending.filter((item) => item.needs_verification).length;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-accent bg-accent-soft px-3 py-2 text-sm" data-testid="suggestion-summary">
      <strong>
        {pending.length} {pending.length === 1 ? "suggestion" : "suggestions"} to review
      </strong>
      <span className="text-ink-2">{verify} need your verification · shown next to the text they change</span>
      <CheckLine className="ml-auto" checked={onlySuggested} onChange={(event) => editor().set({ onlySuggested: event.target.checked })}>
        Show only items with suggestions
      </CheckLine>
    </div>
  );
}

export function ContentPanel() {
  const content = useEditor((state) => state.content)!;
  const revealed = useEditor((state) => state.revealed);
  const suggestions = useSuggestionList();
  const order = content.meta.section_order;
  const hidden = order.filter((section) => !sectionVisible(content, section, revealed, suggestions));
  // A revealed section appears on the next render; open, scroll to and focus it then.
  const focusSection = useRef("");
  const sectionRefs = useRef(new Map<string, HTMLDetailsElement>());

  useEffect(() => {
    if (!focusSection.current) return;
    const block = sectionRefs.current.get(focusSection.current);
    focusSection.current = "";
    if (block) {
      block.open = true;
      block.scrollIntoView({ block: "start" });
      block.querySelector<HTMLElement>("input, textarea")?.focus();
    }
  });

  return (
    <div className="grid gap-3">
      <SuggestionSummary />
      <form className="grid gap-3" autoComplete="off" onSubmit={(event) => event.preventDefault()} data-testid="resume-form">
        <PersonalSection />
        {hidden.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2" data-testid="add-section-strip">
            <span className="text-xs font-semibold text-ink-3 uppercase">Add a section</span>
            {hidden.map((section) => (
              <Button
                key={section}
                size="sm"
                variant="quiet"
                data-reveal-section={section}
                onClick={() => {
                  focusSection.current = section;
                  editor().reveal(section);
                }}
              >
                + {sectionTitle(content, section)}
              </Button>
            ))}
          </div>
        ) : null}
        {order.map((section, index) =>
          hidden.includes(section) ? null : (
            <SectionBlock
              key={section}
              section={section}
              position={index}
              total={order.length}
              revealRef={(node) => {
                if (node) sectionRefs.current.set(section, node);
                else sectionRefs.current.delete(section);
              }}
            />
          ),
        )}
      </form>
    </div>
  );
}
