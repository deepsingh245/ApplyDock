import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Note } from "@/components/ui/note";

export function PairingScreen({ error, onPair }: { error?: string; onPair: (key: string) => void }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onPair(value.trim());
  };
  return (
    <main className="grid flex-1 place-items-center px-4 py-12" data-testid="pair-screen">
      <div className="grid w-full max-w-md gap-4 rounded-md border border-line bg-surface p-6">
        <div>
          <h1 className="m-0 text-xl font-semibold">Connect to your helper</h1>
          <p className="mt-1 mb-0 text-sm text-ink-2">
            Paste the pairing key printed in the ApplyDock helper window. It is stored in this browser profile only, never in the URL.
          </p>
        </div>
        {error ? <Note tone="danger">{error}</Note> : null}
        <form onSubmit={submit} className="grid gap-1.5">
          <label htmlFor="pair-key" className="text-sm font-medium">
            Pairing key
          </label>
          <div className="flex gap-2">
            <Input
              id="pair-key"
              type="password"
              autoComplete="off"
              required
              placeholder="Paste the pairing key"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
            <Button type="submit" variant="primary">
              Connect
            </Button>
          </div>
        </form>
        <p className="m-0 text-xs text-ink-3">
          Helper not running? Start it with <code>start.cmd</code>.
        </p>
      </div>
    </main>
  );
}
