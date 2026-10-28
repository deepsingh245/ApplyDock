import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm font-medium whitespace-nowrap transition-ledger transition-colors select-none disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "border border-accent bg-accent text-accent-ink hover:border-accent-hover hover:bg-accent-hover",
        secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
        quiet: "border border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
        danger: "border border-danger bg-surface text-danger hover:bg-danger-soft",
        text: "h-auto border-0 bg-transparent p-0 text-accent underline-offset-2 hover:text-accent-hover hover:underline",
      },
      size: {
        md: "h-(--control-h) px-3 text-sm",
        sm: "h-7 px-2 text-xs",
        icon: "size-8 p-0 text-sm",
      },
    },
    compoundVariants: [{ variant: "text", className: "h-auto px-0" }],
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}

/** A square icon-only button; the label is required so screen readers and tooltips have it. */
export function IconButton({ label, className, ...props }: Omit<ButtonProps, "size" | "aria-label"> & { label: string }) {
  return <Button variant="quiet" size="icon" aria-label={label} title={label} className={cn("text-ink-2", className)} {...props} />;
}
