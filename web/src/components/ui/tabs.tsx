import { Tabs as Primitive } from "radix-ui";
import { createContext, use, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "underline" | "segmented";
const VariantContext = createContext<Variant>("underline");

export function Tabs(props: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root {...props} />;
}

/** underline: page-level sections. segmented: compact panel switchers (editor side panel, profile tabs). */
export function TabsList({ className, variant = "underline", ...props }: ComponentProps<typeof Primitive.List> & { variant?: Variant }) {
  return (
    <VariantContext value={variant}>
      <Primitive.List
        className={cn(
          variant === "underline"
            ? "scrollbar-none flex gap-1 overflow-x-auto border-b border-line"
            : "scrollbar-none inline-flex max-w-full overflow-x-auto rounded-sm border border-line-strong bg-surface p-0.5",
          className,
        )}
        {...props}
      />
    </VariantContext>
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  const variant = use(VariantContext);
  return (
    <Primitive.Trigger
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-sm font-medium whitespace-nowrap transition-ledger transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "underline"
          ? "-mb-px border-b-2 border-transparent px-3 py-2 text-ink-2 hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink"
          : "flex-1 rounded-[3px] px-3 py-1.5 text-ink-2 hover:text-ink data-[state=active]:bg-ink data-[state=active]:text-canvas",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content className={cn("outline-none", className)} {...props} />;
}

/** A dot after a tab label that says "this section needs your attention". */
export function AttentionDot({ label }: { label: string }) {
  return <span className="size-1.5 rounded-pill bg-warn" role="img" aria-label={label} />;
}
