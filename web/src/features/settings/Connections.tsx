import { useId, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { settingsApi } from "@/api/settings";
import { useLoadedState, useReloadState } from "@/api/state";
import type { AppState } from "@/api/types";
import { syncMessage } from "@/app/TopBar";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Pill, type PillTone } from "@/components/ui/pill";
import { Switch } from "@/components/ui/switch";
import { notify } from "@/components/ui/toaster";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { resumeChoices } from "@/lib/domain";
import { setTheme, useTheme, type Theme } from "@/lib/theme";

/** Run one settings action with the button disabled; report success or the helper's error as a toast. */
function useAction() {
  const [busy, setBusy] = useState("");
  const run = async (name: string, action: () => Promise<string | [string, boolean] | void>) => {
    setBusy(name);
    try {
      const result = await action();
      if (Array.isArray(result)) notify(result[0], result[1]);
      else if (result) notify(result);
    } catch (error) {
      notify(errorMessage(error), true);
    } finally {
      setBusy("");
    }
  };
  return { busy, run };
}

/**
 * A connection card: heading row with its status chip, and the configuration hidden behind "Configure"
 * so the page reads as a status overview first.
 */
function ConfigCard({ title, status, tone, children }: { title: string; status: string; tone: PillTone; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className={cn("settings-config-card rounded-md border border-line bg-surface p-4", open && "expanded")} aria-label={title}>
      <div className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3", open && "border-b border-line pb-3")}>
        <h2 className="m-0 text-lg font-semibold">{title}</h2>
        <Pill tone={tone} data-testid="status-chip">
          {status}
        </Pill>
        <Button variant="quiet" size="sm" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((value) => !value)}>
          {open ? "Close" : "Configure"}
        </Button>
      </div>
      <div id={bodyId} hidden={!open} className="grid gap-3 pt-3 text-sm text-ink-2">
        {children}
      </div>
    </section>
  );
}

function CodexCard({ state }: { state: AppState }) {
  const reload = useReloadState();
  const { busy, run } = useAction();
  const codex = state.codex ?? { installed: false, connected: false };
  const status = codex.connected ? "Connected" : !codex.checked && codex.installed ? "Not checked" : codex.installed ? "Sign in needed" : "Not installed";
  const usage = state.ats_usage ?? {};
  return (
    <ConfigCard title="ATS analysis with Codex" status={status} tone={codex.connected ? "success" : "warn"}>
      <p className="m-0">
        {codex.connected
          ? "Connected to ChatGPT Plus through Codex. Uses your included Codex allowance; no API key is configured."
          : codex.message || "Install Codex CLI and sign in with ChatGPT Plus."}
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-sm border border-line px-2 py-1">
          <strong className="tabular text-ink">{Number(usage.uncached_calls ?? 0)}</strong> Codex calls
        </span>
        <span className="rounded-sm border border-line px-2 py-1">
          <strong className="tabular text-ink">{Number(usage.cache_hits ?? 0)}</strong> cached results
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={busy === "codex"}
          onClick={() =>
            run("codex", async () => {
              const result = await settingsApi.checkCodex();
              await reload();
              return result.codex.connected ? "Connected to ChatGPT Plus through Codex." : [result.codex.message || "Codex is not connected.", true];
            })
          }
        >
          Check Codex connection
        </Button>
        <a className="text-sm" href="https://chatgpt.com/#settings/usage" target="_blank" rel="noopener noreferrer">
          ChatGPT usage ↗
        </a>
      </div>
      <p className="m-0 text-xs text-ink-3">Keep optional credits and automatic credit purchases disabled. ApplyDock pauses its queue when the plan limit is reached.</p>
    </ConfigCard>
  );
}

function NotionCard({ state }: { state: AppState }) {
  const reload = useReloadState();
  const { register, handleSubmit, reset, formState } = useForm({ values: { data_source_id: state.notion_data_source_id || "", token: "" } });
  const status = state.notion_sync_error ? "Needs attention" : state.notion_connected ? "Connected" : "Not connected";
  const submit = handleSubmit(async (values) => {
    try {
      await settingsApi.saveNotion(values);
      await reload();
      reset({ ...values, token: "" });
      notify("Notion connection saved and queue synced.");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  });
  return (
    <ConfigCard title="Notion" status={status} tone={state.notion_sync_error ? "warn" : state.notion_connected ? "success" : "warn"}>
      <form className="grid gap-3" onSubmit={submit} aria-label="Notion connection">
        <p className="m-0">Captures sync to the connected Applications database.</p>
        <Field label="Data source ID">
          <Input required {...register("data_source_id")} />
        </Field>
        <Field label="Integration token" help="Leave blank to keep the saved token">
          <Input type="password" autoComplete="off" placeholder={state.notion_connected ? "Saved securely · leave blank to keep" : "Paste integration token"} {...register("token")} />
        </Field>
        <p className="m-0 text-xs text-ink-3">
          {state.notion_sync_error
            ? `Notion check: ${state.notion_sync_error}`
            : state.notion_sync_checked_at
              ? "Notion changes checked recently."
              : "Notion changes are checked while the local helper is open."}
        </p>
        <div>
          <Button type="submit" disabled={formState.isSubmitting}>
            Save Notion connection
          </Button>
        </div>
      </form>
    </ConfigCard>
  );
}

function SmtpCard({ state }: { state: AppState }) {
  const reload = useReloadState();
  const smtp = state.smtp ?? {};
  const { register, handleSubmit, reset, formState } = useForm({
    values: { host: smtp.host || "", port: String(smtp.port || "465"), username: smtp.username || "", from: smtp.from || "", password: "" },
  });
  const submit = handleSubmit(async (values) => {
    try {
      await settingsApi.saveSmtp(values);
      await reload();
      reset({ ...values, password: "" });
      notify("Email sign-in verified. No message was sent.");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  });
  return (
    <ConfigCard title="Local email" status={state.smtp_connected ? "Configured" : "Not configured"} tone={state.smtp_connected ? "success" : "neutral"}>
      <form className="grid gap-3" onSubmit={submit} aria-label="Local email">
        <p className="m-0">Used only for applications you approve for the local 9 AM sender.</p>
        <FieldGrid>
          <Field label="SMTP host">
            <Input placeholder="smtp.gmail.com" required {...register("host")} />
          </Field>
          <Field label="Port">
            <Select {...register("port")}>
              <option>465</option>
              <option>587</option>
            </Select>
          </Field>
        </FieldGrid>
        <Field label="Username">
          <Input autoComplete="username" required {...register("username")} />
        </Field>
        <Field label="From address">
          <Input type="email" required {...register("from")} />
        </Field>
        <Field label="App password" help="Leave blank to keep the verified password">
          <Input type="password" autoComplete="off" placeholder={state.smtp_connected ? "Saved securely · leave blank to keep" : "Enter app password"} {...register("password")} />
        </Field>
        <div>
          <Button type="submit" disabled={formState.isSubmitting}>
            Verify and save
          </Button>
        </div>
      </form>
    </ConfigCard>
  );
}

function GmailCard({ state }: { state: AppState }) {
  const reload = useReloadState();
  const { busy, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const status = state.gmail_connected ? "Connected" : state.gmail_client_ready ? "Configured" : "Setup needed";
  return (
    <ConfigCard title="Gmail drafts" status={status} tone={state.gmail_connected ? "success" : state.gmail_client_ready ? "warn" : "neutral"}>
      <p className="m-0">{state.gmail_connected ? `Connected account: ${state.gmail_address}` : "Create drafts with attachments in your connected Gmail account."}</p>
      <p className="m-0 text-xs text-ink-3">{state.gmail_client_ready ? `OAuth client saved: ${state.gmail_client_id}` : "No OAuth client saved yet."}</p>
      <form
        className="grid gap-3"
        aria-label="Google OAuth client"
        onSubmit={(event) => {
          event.preventDefault();
          void run("client", async () => {
            if (!file || file.size > 50_000) throw new Error("Choose a Google OAuth Desktop app client JSON file.");
            await settingsApi.saveGmailClient(JSON.parse(await file.text()));
            setFile(null);
            setFileKey((key) => key + 1);
            await reload();
            return "OAuth client saved locally. Connect Gmail next.";
          });
        }}
      >
        <Field label="Google OAuth Desktop app client JSON">
          <Input key={fileKey} type="file" accept=".json,application/json" required className="py-1" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </Field>
        <div>
          <Button type="submit" disabled={busy === "client"}>
            Save OAuth client
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!state.gmail_client_ready || busy === "connect"}
          onClick={() =>
            run("connect", async () => {
              const result = await settingsApi.connectGmail();
              window.location.assign(result.authorization_url);
            })
          }
        >
          Connect Gmail
        </Button>
        <Button
          variant="quiet"
          disabled={busy === "refresh"}
          onClick={() =>
            run("refresh", async () => {
              await reload();
              return "Gmail status refreshed.";
            })
          }
        >
          Refresh status
        </Button>
      </div>
    </ConfigCard>
  );
}

function BackgroundCard({ state }: { state: AppState }) {
  const reload = useReloadState();
  const { register, handleSubmit, formState } = useForm({ values: { profile: state.candidate_profile || "" } });
  const submit = handleSubmit(async (values) => {
    try {
      await settingsApi.saveProfileText(values);
      await reload();
      notify("Your background was saved locally.");
    } catch (error) {
      notify(errorMessage(error), true);
    }
  });
  return (
    <ConfigCard title="AI writing background" status={state.profile_saved ? "Saved" : "Not saved"} tone={state.profile_saved ? "success" : "neutral"}>
      <form className="grid gap-3" onSubmit={submit} aria-label="AI writing background">
        <p className="m-0">Factual experience used for Codex email drafts and suggestions.</p>
        <Field label="Your background">
          <Textarea rows={8} placeholder="Your real experience, skills, and relevant work" {...register("profile")} />
        </Field>
        <div>
          <Button type="submit" disabled={formState.isSubmitting}>
            Save background
          </Button>
        </div>
      </form>
    </ConfigCard>
  );
}

function readNotifications() {
  try {
    return localStorage.getItem("applydock-notifications") !== "off";
  } catch {
    return true;
  }
}

function SideColumn({ state }: { state: AppState }) {
  const theme = useTheme();
  const reload = useReloadState();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const [notifications, setNotifications] = useState(readNotifications);
  const defaultId = state.resumes.find((resume) => resume.is_default)?.id ?? "";
  const card = "grid gap-3 rounded-md border border-line bg-surface p-4";
  const heading = "m-0 text-md font-semibold";
  return (
    <aside className="settings-side grid content-start gap-4">
      <section className={card} aria-labelledby="settings-preferences">
        <h2 id="settings-preferences" className={heading}>
          Preferences
        </h2>
        <Field label="Appearance">
          <Select id="appearance-select" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Field>
        <Field label="Default resume" help="Used for new applications">
          <Select
            value={defaultId}
            disabled={busy === "default"}
            onChange={(event) => {
              const id = event.target.value;
              if (id)
                void run("default", async () => {
                  await settingsApi.setDefaultResume(id);
                  await reload();
                  return "Default resume updated.";
                });
            }}
          >
            <option value="">Choose a resume</option>
            {resumeChoices(state.resumes, "", defaultId).map(({ resume, label }) => (
              <option key={resume.id} value={resume.id} disabled={!resume.available}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <span className="grid gap-0.5">
            <strong className="text-sm font-medium">Notifications</strong>
            <small className="text-xs text-ink-3">Important local status updates</small>
          </span>
          <Switch
            aria-label="Notifications"
            checked={notifications}
            onCheckedChange={(checked) => {
              setNotifications(checked);
              try {
                localStorage.setItem("applydock-notifications", checked ? "on" : "off");
              } catch {
                /* storage blocked: the switch still reflects the choice for this visit */
              }
            }}
          />
        </label>
      </section>
      <section className={card} aria-labelledby="settings-library">
        <h2 id="settings-library" className={heading}>
          Resume library
        </h2>
        <p className="m-0 text-xs text-ink-2">Upload a resume, edit master resumes, and see where each version was sent.</p>
        <div>
          <Button id="settings-resume-library" onClick={() => navigate("/resumes")}>
            Open resume library
          </Button>
        </div>
      </section>
      <section className={card} aria-labelledby="settings-maintenance">
        <h2 id="settings-maintenance" className={heading}>
          Maintenance
        </h2>
        <p className="m-0 text-xs text-ink-2">Re-check every connection, or push all applications to Notion again.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy === "checks"}
            onClick={() =>
              run("checks", async () => {
                await Promise.all([settingsApi.checkCodex(), settingsApi.sync()]);
                await reload();
                return "Connection checks completed.";
              })
            }
          >
            Run connection checks
          </Button>
          <Button
            variant="quiet"
            disabled={busy === "sync"}
            onClick={() =>
              run("sync", async () => {
                const result = await settingsApi.sync();
                await reload();
                return [syncMessage(result, "Notion sync complete"), Boolean(result.reconciliation?.error)];
              })
            }
          >
            Retry Notion sync
          </Button>
        </div>
        <p className="m-0 text-xs text-ink-3">Gmail sends scheduled messages even when this computer is off. The local 9 AM sender needs the helper running.</p>
      </section>
    </aside>
  );
}

export function Connections() {
  const state = useLoadedState();
  return (
    <div className="settings-layout grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]" data-testid="settings-layout">
      <div className="settings-grid grid content-start gap-3">
        <CodexCard state={state} />
        <NotionCard state={state} />
        <SmtpCard state={state} />
        <GmailCard state={state} />
        <BackgroundCard state={state} />
      </div>
      <SideColumn state={state} />
    </div>
  );
}
