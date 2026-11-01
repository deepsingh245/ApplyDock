// The resume design controls (template, page, margins, spacing, header, text, color, sections). Used by the resume
// editor's Design tab (bound to one resume's draft) and by Settings → Resume design (bound to the default design for
// new resumes), so both always offer exactly the same choices.
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CheckLine, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export type LayoutValue = string | number | boolean;
export type Layout = Record<string, LayoutValue>;

export interface DesignMeta {
  template: string;
  paper: string;
  page_limit: number;
  layout: Layout;
}

export interface DesignOptions {
  presets: Record<string, Layout>;
  ranges: Record<string, [number, number]>;
  choices: { font: string[]; bullet: string[]; contact_separator: string[]; [key: string]: string[] };
  accents: string[];
  templates: { id: string; label: string; description: string }[];
}

export interface DesignHandlers {
  setLayout: (key: string, value: LayoutValue) => void;
  setMeta: (key: "paper" | "page_limit", value: string | number) => void;
  applyPreset: (template: string, layout: Layout) => void;
}

export const UNITS: Record<string, string> = { font_size: "pt", name_size: "pt", heading_size: "pt", margin_x: "mm", margin_y: "mm", line_height: "", section_gap: "em", entry_gap: "em", bullet_gap: "em" };
export const STEPS: Record<string, number> = { font_size: 0.25, name_size: 0.5, heading_size: 0.25, margin_x: 0.5, margin_y: 0.5, line_height: 0.05, section_gap: 0.05, entry_gap: 0.05, bullet_gap: 0.05 };
export const FONT_LABELS: Record<string, string> = { Carlito: "Sans · Carlito", "Libertinus Serif": "Serif · Libertinus", "New Computer Modern": "Classic · Computer Modern" };

export function DesignCard({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid content-start gap-3 rounded-md border border-line bg-surface p-4", className)}>
      <h3 className="m-0 text-md font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const SmallLabel = ({ children }: { children: ReactNode }) => <span className="text-xs font-medium text-ink-2">{children}</span>;

interface Bound {
  layout: Layout;
  options: DesignOptions;
  handlers: DesignHandlers;
  idPrefix: string;
}

function Slider({ name, label, layout, options, handlers, idPrefix }: Bound & { name: string; label: string }) {
  const value = layout[name];
  const [min, max] = options.ranges[name] ?? [0, 1];
  const id = `${idPrefix}-layout-${name}`;
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
        onChange={(event) => handlers.setLayout(name, Number(event.target.value))}
      />
    </div>
  );
}

function Choices({ name, choices, layout, handlers }: Pick<Bound, "layout" | "handlers"> & { name: string; choices: [string, string][] }) {
  const value = layout[name];
  return (
    <div className="flex flex-wrap gap-1 rounded-sm border border-line-strong bg-surface p-0.5" role="group">
      {choices.map(([option, label]) => {
        const active = String(value) === String(option);
        return (
          <button
            key={option}
            type="button"
            data-layout-choice={name}
            data-value={option}
            aria-pressed={active}
            onClick={() => handlers.setLayout(name, option)}
            className={cn("h-7 min-w-10 flex-1 cursor-pointer rounded-[3px] px-2 text-xs font-medium", active ? "bg-ink text-canvas" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ name, label, layout, handlers }: Pick<Bound, "layout" | "handlers"> & { name: string; label: string }) {
  return (
    <CheckLine data-layout={name} checked={Boolean(layout[name])} onChange={(event) => handlers.setLayout(name, event.target.checked)}>
      {label}
    </CheckLine>
  );
}

export function DesignControls({
  meta,
  options,
  handlers,
  idPrefix = "re",
  fitAction,
  orderCard,
}: {
  meta: DesignMeta;
  options: DesignOptions;
  handlers: DesignHandlers;
  /** Distinguishes control ids when two sets could be on one page. */
  idPrefix?: string;
  /** Extra page action (the editor's "Fit to N pages"). */
  fitAction?: ReactNode;
  /** The section order card, which differs between a resume (its own sections) and the default design. */
  orderCard?: ReactNode;
}) {
  const layout = meta.layout;
  const preset = options.presets[meta.template] ?? {};
  const customized = Object.keys(preset).some((key) => String(preset[key]) !== String(layout[key]));
  const accent = String(layout.accent ?? "");
  const bound = { layout, options, handlers, idPrefix };
  return (
    <>
      <div className="grid content-start gap-3">
        <DesignCard title="Template">
          <div className="grid gap-2 md:grid-cols-2">
            {options.templates.map((template) => (
              <button
                key={template.id}
                type="button"
                data-preset={template.id}
                aria-pressed={template.id === meta.template}
                onClick={() => handlers.applyPreset(template.id, options.presets[template.id] ?? {})}
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
            <Button variant="text" className="justify-self-start text-sm" onClick={() => handlers.applyPreset(meta.template, preset)}>
              Reset design to {options.templates.find((template) => template.id === meta.template)?.label ?? "template"} defaults
            </Button>
          ) : null}
        </DesignCard>
        <DesignCard title="Page">
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1">
              <SmallLabel>Paper</SmallLabel>
              <Select data-meta="paper" value={meta.paper} onChange={(event) => handlers.setMeta("paper", event.target.value)}>
                <option value="a4">A4</option>
                <option value="us-letter">US Letter</option>
              </Select>
            </label>
            <label className="grid gap-1">
              <SmallLabel>Page limit</SmallLabel>
              <Select data-meta="page_limit" value={String(meta.page_limit)} onChange={(event) => handlers.setMeta("page_limit", Number(event.target.value))}>
                <option value="0">No limit</option>
                <option value="1">1 page</option>
                <option value="2">2 pages</option>
                <option value="3">3 pages</option>
              </Select>
            </label>
          </div>
          {fitAction}
        </DesignCard>
        <DesignCard title="Margins">
          <Slider name="margin_x" label="Left & right" {...bound} />
          <Slider name="margin_y" label="Top & bottom" {...bound} />
        </DesignCard>
        <DesignCard title="Spacing">
          <Slider name="section_gap" label="Between sections" {...bound} />
          <Slider name="entry_gap" label="Between entries" {...bound} />
          <Slider name="bullet_gap" label="Between bullet points" {...bound} />
        </DesignCard>
        <DesignCard title="Header">
          <SmallLabel>Alignment</SmallLabel>
          <Choices
            name="header_align"
            layout={layout}
            handlers={handlers}
            choices={[
              ["left", "Left"],
              ["center", "Center"],
              ["right", "Right"],
            ]}
          />
          <SmallLabel>Contact separator</SmallLabel>
          <Choices name="contact_separator" layout={layout} handlers={handlers} choices={options.choices.contact_separator.map((value) => [value, value])} />
        </DesignCard>
      </div>
      <div className="grid content-start gap-3">
        <DesignCard title="Text">
          <div className="grid gap-2 md:grid-cols-3">
            {options.choices.font.map((font) => (
              <button
                key={font}
                type="button"
                data-layout-choice="font"
                data-value={font}
                aria-pressed={layout.font === font}
                onClick={() => handlers.setLayout("font", font)}
                style={{ fontFamily: font === "Carlito" ? "Calibri, Carlito, sans-serif" : "Georgia, serif" }}
                className={cn("min-h-10 cursor-pointer rounded-sm border px-2 text-sm", layout.font === font ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:bg-surface-2")}
              >
                {FONT_LABELS[font] ?? font}
              </button>
            ))}
          </div>
          <Slider name="font_size" label="Font size" {...bound} />
          <Slider name="line_height" label="Line height" {...bound} />
          <Slider name="name_size" label="Name size" {...bound} />
          <Slider name="heading_size" label="Section heading size" {...bound} />
        </DesignCard>
        <DesignCard title="Color">
          <div className="flex flex-wrap items-center gap-2">
            {options.accents.map((color) => (
              <button
                key={color}
                type="button"
                data-layout-choice="accent"
                data-value={color}
                aria-label={`Accent ${color}`}
                aria-pressed={accent.toLowerCase() === color}
                onClick={() => handlers.setLayout("accent", color)}
                style={{ background: color }}
                className={cn("size-7 cursor-pointer rounded-pill border-2", accent.toLowerCase() === color ? "border-ink" : "border-surface")}
              />
            ))}
            <label className="inline-flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-pill border border-line-strong" title="Custom color">
              <input type="color" aria-label="Custom accent color" data-layout="accent" value={accent} onChange={(event) => handlers.setLayout("accent", event.target.value)} className="size-10 cursor-pointer border-0 p-0" />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Toggle name="accent_name" label="Name" layout={layout} handlers={handlers} />
            <Toggle name="accent_headings" label="Section headings" layout={layout} handlers={handlers} />
            <Toggle name="accent_links" label="Links" layout={layout} handlers={handlers} />
          </div>
        </DesignCard>
        <DesignCard title="Sections & entries">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Toggle name="heading_upper" label="Uppercase headings" layout={layout} handlers={handlers} />
            <Toggle name="heading_rule" label="Line under headings" layout={layout} handlers={handlers} />
            <Toggle name="skills_inline" label="Skills on one line" layout={layout} handlers={handlers} />
          </div>
          <SmallLabel>Dates</SmallLabel>
          <Choices
            name="date_position"
            layout={layout}
            handlers={handlers}
            choices={[
              ["right", "Right-aligned"],
              ["below", "Below title"],
            ]}
          />
          <SmallLabel>Bullet style</SmallLabel>
          <Choices name="bullet" layout={layout} handlers={handlers} choices={options.choices.bullet.map((value) => [value, value])} />
        </DesignCard>
      </div>
      {orderCard}
    </>
  );
}
