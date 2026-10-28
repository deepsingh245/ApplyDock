import { AlertDialog } from "radix-ui";
import { createContext, use, useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { Textarea } from "./field";

interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions extends ConfirmOptions {
  initialValue?: string;
  label?: string;
}

type Request =
  | ({ kind: "confirm"; resolve: (value: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; resolve: (value: string | null) => void } & PromptOptions);

interface DialogsApi {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const DialogsContext = createContext<DialogsApi | null>(null);

/** Replaces window.confirm/prompt with accessible, styled dialogs that return promises. */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [text, setText] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback(
    (options: ConfirmOptions | string) =>
      new Promise<boolean>((resolve) => setRequest({ kind: "confirm", resolve, ...(typeof options === "string" ? { message: options } : options) })),
    [],
  );
  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setText(options.initialValue ?? "");
        setRequest({ kind: "prompt", resolve, ...options });
      }),
    [],
  );

  const finish = (accepted: boolean) => {
    if (!request) return;
    if (request.kind === "confirm") request.resolve(accepted);
    else request.resolve(accepted ? text : null);
    setRequest(null);
  };

  return (
    <DialogsContext value={{ confirm, prompt }}>
      {children}
      <AlertDialog.Root open={request !== null} onOpenChange={(open) => !open && finish(false)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-[rgb(0_0_0/0.45)]" />
          <AlertDialog.Content
            data-testid="confirm-dialog"
            className="fixed top-1/2 left-1/2 z-[61] grid w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-md border border-line bg-surface p-5 shadow-popover"
            onOpenAutoFocus={(event) => {
              if (request?.kind === "confirm") {
                event.preventDefault();
                confirmRef.current?.focus();
              }
            }}
          >
            <AlertDialog.Title className="m-0 text-lg font-semibold">{request?.title ?? (request?.kind === "prompt" ? "Edit" : "Please confirm")}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="text-sm text-ink-2">{request?.message}</div>
            </AlertDialog.Description>
            {request?.kind === "prompt" ? (
              <label className="grid gap-1 text-sm font-medium">
                {request.label ?? "Text"}
                <Textarea rows={5} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
              </label>
            ) : null}
            <div className="mt-1 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="quiet">{request?.cancelLabel ?? "Cancel"}</Button>
              </AlertDialog.Cancel>
              <Button ref={confirmRef} variant={request?.danger ? "danger" : "primary"} onClick={() => finish(true)}>
                {request?.confirmLabel ?? "OK"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </DialogsContext>
  );
}

export function useDialogs(): DialogsApi {
  const value = use(DialogsContext);
  if (!value) throw new Error("useDialogs must be used inside <DialogsProvider>");
  return value;
}
