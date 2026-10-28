import { ChevronLeftIcon, LoaderCircleIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { scoreTone, type ScoreTone } from "@/lib/domain";
import { scoreLabel } from "@/lib/format";
import { Button } from "./button";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return <LoaderCircleIcon className={cn("size-4 animate-spin text-ink-3", className)} role="img" aria-label={label} />;
}

/** A small uppercase label above a block ("Next step", "Status"). */
export function Eyebrow({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("block text-xs font-semibold tracking-wide text-ink-3 uppercase", className)} {...props} />;
}

/** Counts and numbers shown inline next to headings and filters. */
export function Count({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("tabular text-xs font-medium text-ink-3", className)} {...props} />;
}

/** A definition list laid out as a two-column table: label | value. */
export function KeyValue({ items, className }: { items: (readonly [ReactNode, ReactNode] | null | false)[]; className?: string }) {
  return (
    <dl className={cn("m-0 grid grid-cols-[minmax(84px,auto)_1fr] gap-x-3 gap-y-1.5 text-sm", className)}>
      {items.filter(Boolean).map((item, index) => {
        const [label, value] = item as readonly [ReactNode, ReactNode];
        return (
          <div key={index} className="contents">
            <dt className="text-ink-3">{label}</dt>
            <dd className="m-0 min-w-0 break-words text-ink">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function EmptyState({ icon, title, children, actions, className }: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto grid max-w-md justify-items-center gap-2 px-4 py-12 text-center", className)}>
      {icon ? <div className="mb-1 text-ink-3 [&_svg]:size-8">{icon}</div> : null}
      <h2 className="m-0 text-lg font-semibold text-ink">{title}</h2>
      {children ? <div className="text-sm text-ink-2">{children}</div> : null}
      {actions ? <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

const TONE_TEXT: Record<ScoreTone, string> = { strong: "text-success", medium: "text-warn", weak: "text-danger", neutral: "text-ink-3" };
const TONE_BAR: Record<ScoreTone, string> = { strong: "bg-success", medium: "bg-warn", weak: "bg-danger", neutral: "bg-line-strong" };

export function ScoreFigure({ score, size = "lg", className }: { score?: number | null; size?: "md" | "lg"; className?: string }) {
  const tone = scoreTone(score);
  return (
    <div className={cn("flex items-baseline gap-1", className)} data-tone={tone}>
      <strong className={cn("tabular font-semibold", size === "lg" ? "text-2xl" : "text-xl", TONE_TEXT[tone])}>{scoreLabel(score)}</strong>
      <span className="text-xs text-ink-3">/ 100</span>
    </div>
  );
}

/** A horizontal bar for a 0–100 value. */
export function Meter({ value, tone, className, label }: { value?: number | null; tone?: ScoreTone; className?: string; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-pill bg-surface-3", className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
    >
      <div className={cn("h-full rounded-pill transition-[width] duration-(--duration)", TONE_BAR[tone ?? scoreTone(value)])} style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** "‹ Applications" style link back to a parent screen. */
export function BackButton({ children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button variant="quiet" size="sm" className="-ml-2 text-ink-2" {...props}>
      <ChevronLeftIcon aria-hidden />
      {children}
    </Button>
  );
}

/** The heading of a full page: title, one-line purpose, optional actions on the right. */
export function PageHeading({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="m-0 text-xl font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-1 mb-0 max-w-[72ch] text-sm text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Page container for every non-workspace screen: full width with fluid side padding. */
export function Page({ className, ...props }: ComponentProps<"main">) {
  return <main className={cn("min-h-0 flex-1 overflow-y-auto px-[clamp(16px,3vw,48px)] pt-6 pb-12", className)} {...props} />;
}
