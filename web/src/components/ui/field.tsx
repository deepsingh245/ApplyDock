import { cloneElement, isValidElement, useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full min-w-0 rounded-sm border border-line-strong bg-surface px-2.5 text-sm text-ink placeholder:text-ink-3 transition-ledger transition-colors hover:border-ink-3 focus-visible:border-accent disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3 aria-invalid:border-danger";

export const inputClass = cn(control, "h-(--control-h)");

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 resize-y py-2 leading-relaxed", className)} {...props} />;
}

/** Native select: accessible, keyboard- and form-friendly, and styled to match the inputs. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(inputClass, "cursor-pointer pr-7", className)} {...props} />;
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return <input type="checkbox" className={cn("size-4 cursor-pointer accent-(--accent)", className)} {...props} />;
}

/**
 * A labelled control. The <label> wraps the control, so clicking the label focuses it without ids. The help
 * text sits outside the label (so it is not part of the control's name) and describes the control instead;
 * CSS order places it between the label text and the control. error replaces help and is announced.
 */
export function Field({ label, help, error, children, className, wide }: {
  label: ReactNode;
  help?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  const helpId = useId();
  const described = help && !error ? helpId : undefined;
  const control =
    described && isValidElement<{ "aria-describedby"?: string }>(children) && typeof children.type === "string"
      ? cloneElement(children, { "aria-describedby": described })
      : children;
  return (
    <div className={cn("grid min-w-0 content-start gap-1 text-sm font-medium text-ink", wide && "col-span-full", className)}>
      <label className="contents">
        <span className="order-1">{label}</span>
        <span className="order-3 grid min-w-0">{control}</span>
      </label>
      {described ? (
        <span id={helpId} className="order-2 -mt-0.5 text-xs font-normal text-ink-3">
          {help}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="order-4 text-xs font-normal text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function CheckLine({ children, className, ...props }: Omit<ComponentProps<"input">, "type"> & { children: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-ink", className)}>
      <Checkbox {...props} />
      <span>{children}</span>
    </label>
  );
}

export function FieldGrid({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid gap-3 md:grid-cols-2", className)} {...props} />;
}
