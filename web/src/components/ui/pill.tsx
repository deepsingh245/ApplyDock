import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const pillVariants = cva("inline-flex max-w-full items-center gap-1 truncate rounded-pill border px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-transparent bg-surface-2 text-ink-2",
      accent: "border-transparent bg-accent-soft text-accent",
      success: "border-transparent bg-success-soft text-success",
      warn: "border-transparent bg-warn-soft text-warn",
      danger: "border-transparent bg-danger-soft text-danger",
      outline: "border-line-strong bg-transparent text-ink-2",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type PillTone = NonNullable<VariantProps<typeof pillVariants>["tone"]>;

export function Pill({ tone, className, ...props }: ComponentProps<"span"> & { tone?: PillTone | null }) {
  return <span className={cn(pillVariants({ tone }), className)} {...props} />;
}

const TONES: Record<string, PillTone> = {
  approved: "success",
  gmail_scheduled: "success",
  success: "success",
  demonstrated: "success",
  tailored: "success",
  represented: "success",
  complete: "success",
  gmail_draft: "accent",
  profile_only: "accent",
  gmail_schedule_pending: "warn",
  review: "warn",
  warn: "warn",
  partial: "warn",
  listed: "warn",
  weak: "warn",
  pending: "warn",
  analyzing: "warn",
  failed: "danger",
  sending: "danger",
  missing: "danger",
  uncertain: "danger",
  unsupported: "danger",
  danger: "danger",
};

/** The tone for a status/match/coverage key, so every badge in the app colors the same value the same way. */
export const toneFor = (key?: string | null): PillTone => TONES[String(key ?? "")] ?? "neutral";
