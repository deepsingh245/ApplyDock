import { XIcon } from "lucide-react";
import { Dialog as Primitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;

const SIZES = {
  sm: "w-[min(440px,calc(100vw-32px))]",
  md: "w-[min(640px,calc(100vw-32px))]",
  // The full analysis over the resume editor: nearly the whole window.
  full: "h-[calc(100vh-48px)] w-[min(1400px,calc(100vw-32px))]",
};

export function DialogContent({
  title,
  description,
  size = "md",
  className,
  children,
  closeLabel = "Close",
  ...props
}: ComponentProps<typeof Primitive.Content> & {
  title: ReactNode;
  description?: ReactNode;
  size?: keyof typeof SIZES;
  closeLabel?: string;
}) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-[rgb(0_0_0/0.45)]" />
      <Primitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-md border border-line bg-surface shadow-popover focus:outline-none",
          SIZES[size],
          className,
        )}
        {...(description ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <Primitive.Title className="m-0 text-lg font-semibold text-ink">{title}</Primitive.Title>
            {description ? <Primitive.Description className="m-0 text-sm text-ink-2">{description}</Primitive.Description> : null}
          </div>
          <Primitive.Close
            aria-label={closeLabel}
            title={`${closeLabel} (Esc)`}
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <XIcon className="size-4" aria-hidden />
          </Primitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
