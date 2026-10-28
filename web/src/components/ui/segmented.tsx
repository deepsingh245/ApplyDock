import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Extra content after the label, e.g. a count. */
  suffix?: ReactNode;
}

/**
 * A single-choice button row (filters, small option sets). Radix ToggleGroup gives arrow-key movement and
 * aria-pressed state; an empty deselect is ignored so one option is always chosen.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  itemClassName,
  testId,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  className?: string;
  itemClassName?: string;
  testId?: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      aria-label={label}
      data-testid={testId}
      className={cn("scrollbar-none flex max-w-full gap-1 overflow-x-auto", className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          data-value={option.value}
          className={cn(
            "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-sm border border-transparent px-2.5 text-xs font-medium whitespace-nowrap text-ink-2 transition-ledger transition-colors hover:bg-surface-2 hover:text-ink data-[state=on]:border-line-strong data-[state=on]:bg-surface data-[state=on]:text-ink",
            itemClassName,
          )}
        >
          {option.label}
          {option.suffix}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
