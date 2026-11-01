import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { designOf, sameDesign, useDesignSettings, useUpdateDesignSettings } from "@/api/design";
import { Button } from "@/components/ui/button";
import { Note } from "@/components/ui/note";
import { Pill } from "@/components/ui/pill";
import { notify } from "@/components/ui/toaster";
import { DesignCard, DesignControls, type DesignHandlers } from "@/features/resume-design/DesignControls";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useCtl } from "./controller";
import { sectionEmpty, sectionTitle } from "./model";
import { editor, useEditor } from "./store";
import type { Section } from "./types";

function OrderRow({ section, index, count, onKey }: { section: Section; index: number; count: number; onKey: (event: KeyboardEvent, section: Section) => void }) {
  const label = useEditor((state) => sectionTitle(state.content!, section));
  const empty = useEditor((state) => sectionEmpty(state.content!, section));
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({ id: section });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex touch-none items-center gap-2 rounded-sm border border-line bg-surface px-2 py-1.5 text-sm select-none", isDragging && "relative z-10 border-accent shadow-popover")}
      data-order-section={section}
      role="listitem"
      {...listeners}
    >
      <button
        type="button"
        className="inline-flex size-7 cursor-grab items-center justify-center rounded-sm text-ink-3 hover:bg-surface-2 hover:text-ink"
        data-drag-section={section}
        aria-label={`${label}, position ${index + 1} of ${count}. Use the arrow keys to move it.`}
        onKeyDown={(event) => onKey(event, section)}
      >
        <GripVerticalIcon className="size-4" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate">
        {label}
        {empty ? <small className="ml-1 text-xs text-ink-3">(empty — not printed until you add content)</small> : null}
      </span>
      <span className="tabular text-xs text-ink-3" aria-hidden>
        {index + 1}
      </span>
    </div>
  );
}

/** Section order: drag a row (pointer or touch) or focus its handle and use ↑/↓. Each move is one undo step. */
export function SectionOrder() {
  const order = useEditor((state) => state.content!.meta.section_order);
  const listRef = useRef<HTMLDivElement>(null);
  const refocus = useRef("");
  // A 4px threshold keeps a plain click on the handle from starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!refocus.current) return;
    listRef.current?.querySelector<HTMLElement>(`[data-drag-section="${refocus.current}"]`)?.focus();
    refocus.current = "";
  });

  const commit = (next: Section[], focus: Section) => {
    if (next.join() === order.join()) return;
    refocus.current = focus;
    editor().structural((content) => {
      content.meta.section_order = next;
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    commit(arrayMove(order, order.indexOf(active.id as Section), order.indexOf(over.id as Section)), active.id as Section);
  };

  const onKey = (event: KeyboardEvent, section: Section) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const index = order.indexOf(section);
    const target = index + (event.key === "ArrowUp" ? -1 : 1);
    if (target < 0 || target >= order.length) return;
    commit(arrayMove(order, index, target), section);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div ref={listRef} className="grid gap-1.5" role="list" data-testid="section-order">
          {order.map((section, index) => (
            <OrderRow key={section} section={section} index={index} count={order.length} onKey={onKey} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

const handlers: DesignHandlers = {
  setLayout: (key, value) => editor().setLayout(key, value),
  setMeta: (key, value) => editor().setMeta(key, value),
  applyPreset: (template, layout) => editor().applyPreset(template, layout),
};

/** Where new resumes get their design, and a one-click way to make this resume's design the default. */
function DefaultDesignNote() {
  const ctl = useCtl();
  const settings = useDesignSettings();
  const update = useUpdateDesignSettings();
  const meta = useEditor((state) => state.content!.meta);
  const isDefault = settings.data?.mode === "default" && sameDesign(designOf(meta), settings.data.default);
  const makeDefault = async () => {
    try {
      await ctl.flush();
      await update.mutateAsync({ from_resume_id: ctl.resumeId });
      notify("Saved as your default design. New tailored resumes will start with it.");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  };
  return (
    <Note tone="neutral" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 lg:col-span-2" data-testid="design-carry-over">
      <span>
        This resume keeps its own design.{" "}
        {settings.data?.mode === "default" ? "New tailored resumes start from your default design." : "New tailored resumes start from the last design you edited."}{" "}
        <Link to="/settings/design">Resume design settings</Link>
      </span>
      {isDefault ? (
        <Pill tone="success" data-testid="is-default-design">
          Your default design
        </Pill>
      ) : (
        <Button size="sm" onClick={() => void makeDefault()} disabled={update.isPending || !settings.data}>
          Make this my default design
        </Button>
      )}
    </Note>
  );
}

export function DesignPanel() {
  const ctl = useCtl();
  const { design, templates } = ctl.data;
  const meta = useEditor((state) => state.content!.meta);
  return (
    <div className="grid gap-3 lg:grid-cols-2" data-testid="design-panel" id="re-design">
      <DefaultDesignNote />
      <DesignControls
        meta={meta}
        options={{ ...design, templates }}
        handlers={handlers}
        fitAction={
          <>
            <Button className="justify-self-start" disabled={!meta.page_limit} onClick={() => void ctl.fit()}>
              {meta.page_limit ? `Fit to ${meta.page_limit} page${meta.page_limit > 1 ? "s" : ""}` : "Fit to page limit"}
            </Button>
            <p className="m-0 text-xs text-ink-3">Fit tightens spacing first, then margins, then text size, and never goes below readable minimums.</p>
          </>
        }
        orderCard={
          <DesignCard title="Section order" className="lg:col-span-2">
            <p className="m-0 text-xs text-ink-3">Drag a section to move it. With the keyboard, focus its handle and use the up and down arrow keys.</p>
            <SectionOrder />
          </DesignCard>
        }
      />
    </div>
  );
}
