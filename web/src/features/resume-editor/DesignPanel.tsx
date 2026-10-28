import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CheckLine, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { useCtl } from "./controller";
import { FONT_LABELS, sectionEmpty, sectionTitle, STEPS, UNITS } from "./model";
import { editor, useEditor } from "./store";
import type { Section } from "./types";

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid content-start gap-3 rounded-md border border-line bg-surface p-4", className)}>
      <h3 className="m-0 text-md font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const SmallLabel = ({ children }: { children: ReactNode }) => <span className="text-xs font-medium text-ink-2">{children}</span>;

function Slider({ name, label }: { name: string; label: string }) {
  const { data } = useCtl();
  const value = useEditor((state) => state.content!.meta.layout[name]);
  const [min, max] = data.design.ranges[name] ?? [0, 1];
  const id = `re-layout-${name}`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      <output htmlFor={id} className="tabular text-xs text-ink-2" data-layout-value={name}>
        {String(value)}
        {UNITS[name] ? ` ${UNITS[name]}` : ""}
      </output>
      <input
        id={id}
        type="range"
        className="col-span-2 w-full cursor-pointer accent-(--accent)"
        min={min}
        max={max}
        step={STEPS[name] ?? 0.05}
        value={Number(value)}
        data-layout={name}
        onChange={(event) => editor().setLayout(name, Number(event.target.value))}
      />
    </div>
  );
}

function Choices({ name, options }: { name: string; options: [string, string][] }) {
  const value = useEditor((state) => state.content!.meta.layout[name]);
  return (
    <div className="flex flex-wrap gap-1 rounded-sm border border-line-strong bg-surface p-0.5" role="group">
      {options.map(([option, label]) => {
        const active = String(value) === String(option);
        return (
          <button
            key={option}
            type="button"
            data-layout-choice={name}
            data-value={option}
            aria-pressed={active}
            onClick={() => editor().setLayout(name, option)}
            className={cn("h-7 min-w-10 flex-1 cursor-pointer rounded-[3px] px-2 text-xs font-medium", active ? "bg-ink text-canvas" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ name, label }: { name: string; label: string }) {
  const checked = useEditor((state) => Boolean(state.content!.meta.layout[name]));
  return (
    <CheckLine data-layout={name} checked={checked} onChange={(event) => editor().setLayout(name, event.target.checked)}>
      {label}
    </CheckLine>
  );
}

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

export function DesignPanel() {
  const ctl = useCtl();
  const { design, templates } = ctl.data;
  const meta = useEditor((state) => state.content!.meta);
  const layout = meta.layout;
  const preset = design.presets[meta.template] ?? {};
  const customized = Object.keys(preset).some((key) => String(preset[key]) !== String(layout[key]));
  const accent = String(layout.accent ?? "");
  return (
    <div className="grid gap-3 lg:grid-cols-2" data-testid="design-panel" id="re-design">
      <div className="grid content-start gap-3">
        <Card title="Template">
          <div className="grid gap-2 md:grid-cols-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                data-preset={template.id}
                aria-pressed={template.id === meta.template}
                onClick={() => editor().applyPreset(template.id, design.presets[template.id] ?? {})}
                className={cn(
                  "grid cursor-pointer gap-0.5 rounded-sm border p-2.5 text-left",
                  template.id === meta.template ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:bg-surface-2",
                )}
              >
                <strong className="text-sm">{template.label}</strong>
                <span className="text-xs text-ink-2">{template.description}</span>
              </button>
            ))}
          </div>
          {customized ? (
            <Button variant="text" className="justify-self-start text-sm" onClick={() => editor().applyPreset(meta.template, preset)}>
              Reset design to {templates.find((template) => template.id === meta.template)?.label ?? "template"} defaults
            </Button>
          ) : null}
        </Card>
        <Card title="Page">
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <SmallLabel>Paper</SmallLabel>
              <Select data-meta="paper" value={meta.paper} onChange={(event) => editor().setMeta("paper", event.target.value)}>
                <option value="a4">A4</option>
                <option value="us-letter">US Letter</option>
              </Select>
            </label>
            <label className="grid gap-1">
              <SmallLabel>Page limit</SmallLabel>
              <Select data-meta="page_limit" value={String(meta.page_limit)} onChange={(event) => editor().setMeta("page_limit", Number(event.target.value))}>
                <option value="0">No limit</option>
                <option value="1">1 page</option>
                <option value="2">2 pages</option>
                <option value="3">3 pages</option>
              </Select>
            </label>
          </div>
          <Button className="justify-self-start" disabled={!meta.page_limit} onClick={() => void ctl.fit()}>
            {meta.page_limit ? `Fit to ${meta.page_limit} page${meta.page_limit > 1 ? "s" : ""}` : "Fit to page limit"}
          </Button>
          <p className="m-0 text-xs text-ink-3">Fit tightens spacing first, then margins, then text size, and never goes below readable minimums.</p>
        </Card>
        <Card title="Margins">
          <Slider name="margin_x" label="Left & right" />
          <Slider name="margin_y" label="Top & bottom" />
        </Card>
        <Card title="Spacing">
          <Slider name="section_gap" label="Between sections" />
          <Slider name="entry_gap" label="Between entries" />
          <Slider name="bullet_gap" label="Between bullet points" />
        </Card>
        <Card title="Header">
          <SmallLabel>Alignment</SmallLabel>
          <Choices
            name="header_align"
            options={[
              ["left", "Left"],
              ["center", "Center"],
              ["right", "Right"],
            ]}
          />
          <SmallLabel>Contact separator</SmallLabel>
          <Choices name="contact_separator" options={design.choices.contact_separator.map((value) => [value, value])} />
        </Card>
      </div>
      <div className="grid content-start gap-3">
        <Card title="Text">
          <div className="grid gap-2 md:grid-cols-3">
            {design.choices.font.map((font) => (
              <button
                key={font}
                type="button"
                data-layout-choice="font"
                data-value={font}
                aria-pressed={layout.font === font}
                onClick={() => editor().setLayout("font", font)}
                style={{ fontFamily: font === "Carlito" ? "Calibri, Carlito, sans-serif" : "Georgia, serif" }}
                className={cn("min-h-10 cursor-pointer rounded-sm border px-2 text-sm", layout.font === font ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:bg-surface-2")}
              >
                {FONT_LABELS[font] ?? font}
              </button>
            ))}
          </div>
          <Slider name="font_size" label="Font size" />
          <Slider name="line_height" label="Line height" />
          <Slider name="name_size" label="Name size" />
          <Slider name="heading_size" label="Section heading size" />
        </Card>
        <Card title="Color">
          <div className="flex flex-wrap items-center gap-2">
            {design.accents.map((color) => (
              <button
                key={color}
                type="button"
                data-layout-choice="accent"
                data-value={color}
                aria-label={`Accent ${color}`}
                aria-pressed={accent.toLowerCase() === color}
                onClick={() => editor().setLayout("accent", color)}
                style={{ background: color }}
                className={cn("size-7 cursor-pointer rounded-pill border-2", accent.toLowerCase() === color ? "border-ink" : "border-surface")}
              />
            ))}
            <label className="inline-flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-pill border border-line-strong" title="Custom color">
              <input type="color" aria-label="Custom accent color" data-layout="accent" value={accent} onChange={(event) => editor().setLayout("accent", event.target.value)} className="size-10 cursor-pointer border-0 p-0" />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Toggle name="accent_name" label="Name" />
            <Toggle name="accent_headings" label="Section headings" />
            <Toggle name="accent_links" label="Links" />
          </div>
        </Card>
        <Card title="Sections & entries">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Toggle name="heading_upper" label="Uppercase headings" />
            <Toggle name="heading_rule" label="Line under headings" />
            <Toggle name="skills_inline" label="Skills on one line" />
          </div>
          <SmallLabel>Dates</SmallLabel>
          <Choices
            name="date_position"
            options={[
              ["right", "Right-aligned"],
              ["below", "Below title"],
            ]}
          />
          <SmallLabel>Bullet style</SmallLabel>
          <Choices name="bullet" options={design.choices.bullet.map((value) => [value, value])} />
        </Card>
      </div>
      <Card title="Section order" className="lg:col-span-2">
        <p className="m-0 text-xs text-ink-3">Drag a section to move it. With the keyboard, focus its handle and use the up and down arrow keys.</p>
        <SectionOrder />
      </Card>
    </div>
  );
}
