import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const noteVariants = cva("rounded-sm border-l-[3px] px-3 py-2 text-sm", {
  variants: {
    tone: {
      info: "border-accent bg-accent-soft text-ink",
      warn: "border-warn bg-warn-soft text-ink",
      danger: "border-danger bg-danger-soft text-ink",
      success: "border-success bg-success-soft text-ink",
      neutral: "border-line-strong bg-surface-2 text-ink-2",
    },
  },
  defaultVariants: { tone: "info" },
});

/** Inline guidance or a problem stated next to what it is about (not a toast). */
export function Note({ tone, className, ...props }: ComponentProps<"div"> & VariantProps<typeof noteVariants>) {
  return <div className={cn(noteVariants({ tone }), className)} {...props} />;
}
