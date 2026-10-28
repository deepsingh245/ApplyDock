import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-md border border-line bg-surface p-4", className)} {...props} />;
}

/** A card heading row: title on the left, status or actions on the right. */
export function CardHeader({ title, aside, description, className, as: Heading = "h2" }: {
  title: ReactNode;
  aside?: ReactNode;
  description?: ReactNode;
  className?: string;
  as?: "h2" | "h3" | "strong";
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-start justify-between gap-2", className)}>
      <div className="min-w-0">
        <Heading className="m-0 text-lg font-semibold text-ink">{title}</Heading>
        {description ? <p className="mt-1 mb-0 max-w-[72ch] text-sm text-ink-2">{description}</p> : null}
      </div>
      {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
    </div>
  );
}
