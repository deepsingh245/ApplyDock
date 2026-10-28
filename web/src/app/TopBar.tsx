import { useMutation } from "@tanstack/react-query";
import { MoonIcon, RefreshCwIcon, SettingsIcon, SunIcon } from "lucide-react";
import { Link, NavLink, useMatches } from "react-router";
import { useAppState, useReloadState } from "@/api/state";
import { IconButton } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { api, ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { setTheme, useTheme } from "@/lib/theme";

interface Reconciliation {
  reconciliation?: { error?: string; updated?: number; removed?: number };
}

export function syncMessage(result: Reconciliation, verb = "Notion changes refreshed") {
  const summary = result.reconciliation ?? {};
  return summary.error
    ? `Notion check needs attention: ${summary.error}`
    : `${verb}. Imported ${summary.updated ?? 0} update(s) and removed ${summary.removed ?? 0} trashed item(s) locally.`;
}

function ConnectionState() {
  const { data, error, isPending } = useAppState();
  const unpaired = error instanceof ApiError && error.status === 401;
  const connected = Boolean(data) && !error;
  const label = connected ? "Local helper connected" : unpaired ? "Pairing needed" : isPending ? "Connecting…" : "Helper offline";
  return (
    <span role="status" className="hidden items-center gap-2 text-xs text-ink-2 md:inline-flex" data-testid="connection-state">
      <span className={cn("size-2 rounded-pill", connected ? "bg-success" : unpaired || isPending ? "bg-warn" : "bg-danger")} aria-hidden />
      {label}
    </span>
  );
}

export function TopBar() {
  const theme = useTheme();
  const reload = useReloadState();
  const { data } = useAppState();
  const matches = useMatches();
  const title = [...matches].reverse().map((match) => (match.handle as { title?: string } | undefined)?.title).find(Boolean) ?? "Applications";
  const sync = useMutation({
    mutationFn: () => api<Reconciliation>("/api/sync", "POST"),
    onSuccess: async (result) => {
      await reload();
      notify(syncMessage(result), Boolean(result.reconciliation?.error));
    },
    onError: (error) => notify(errorMessage(error), true),
  });

  return (
    <header className="grid h-(--topbar-h) shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-line bg-surface">
      <Link
        to="/"
        id="applications-button"
        aria-label="ApplyDock — applications"
        className="flex h-full items-center gap-2.5 border-r border-line px-4 text-ink no-underline hover:bg-surface-2 hover:text-ink md:w-(--list-w)"
      >
        <span className="inline-flex size-6 items-center justify-center rounded-sm bg-ink text-xs font-semibold text-canvas" aria-hidden>
          A
        </span>
        <strong className="text-md font-semibold">ApplyDock</strong>
      </Link>
      <div className="min-w-0 truncate px-4 text-sm font-semibold text-ink" data-testid="breadcrumb">
        {title}
      </div>
      <div className="topbar-actions flex items-center gap-1 pr-3">
        <ConnectionState />
        <IconButton label="Refresh from Notion" onClick={() => sync.mutate()} disabled={!data || sync.isPending} className="ml-2">
          <RefreshCwIcon className={cn(sync.isPending && "animate-spin")} aria-hidden />
        </IconButton>
        <IconButton id="theme-button" label="Switch color theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
        </IconButton>
        <NavLink
          to="/settings"
          id="settings-button"
          aria-label="Settings"
          title="Settings"
          className={({ isActive }) =>
            cn(
              "inline-flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-surface-2 hover:text-ink [&_svg]:size-4",
              isActive && "bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent",
            )
          }
        >
          <SettingsIcon aria-hidden />
        </NavLink>
      </div>
    </header>
  );
}
