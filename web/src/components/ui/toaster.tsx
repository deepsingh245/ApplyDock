import { Toaster as Sonner, toast } from "sonner";

/** One place for user-facing status messages; errors stay longer and are announced assertively. */
export function notify(message: string, isError = false) {
  if (isError) toast.error(message, { duration: 9000 });
  else toast(message, { duration: 6500 });
}

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "notice group flex w-[min(380px,calc(100vw-32px))] items-start gap-3 rounded-md border border-line bg-surface p-3 pr-8 text-sm text-ink shadow-popover",
          error: "border-danger bg-danger-soft text-danger",
          closeButton: "!left-auto !right-1 !top-1 !translate-x-0 !translate-y-0 !border-0 !bg-transparent text-ink-2",
          title: "leading-snug",
        },
      }}
    />
  );
}
