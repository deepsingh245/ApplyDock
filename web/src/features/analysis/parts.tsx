import { useEffect, useRef } from "react";
import type { AnalysisQueueItem } from "@/api/types";
import { Card, CardHeader } from "@/components/ui/card";
import { Count, Meter } from "@/components/ui/misc";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { stageLabel } from "./model";

interface LogSource {
  events?: { created_at: string; stage: string; message: string; level: string }[];
  progress_stage?: string;
  progress_percent?: number;
}

const LEVEL_TEXT: Record<string, string> = {
  info: "text-ink-2",
  success: "text-success",
  warning: "text-warn",
  error: "text-danger",
  muted: "text-ink-3",
};

function timeLabel(iso: string) {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? "--:--:--" : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The run's progress events, newest at the bottom; follows new lines while the run is live. */
export function ActivityLog({ analysis, live }: { analysis: LogSource; live: boolean }) {
  const output = useRef<HTMLDivElement>(null);
  const events = analysis.events ?? [];
  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [events.length]);
  const percent = Number(analysis.progress_percent ?? 0);
  return (
    <section className="overflow-hidden rounded-md border border-line bg-surface" data-testid="activity-log">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <strong className="text-sm">Activity log</strong>
        <Pill tone={live ? "accent" : "neutral"} className="tabular">
          {live ? "LIVE" : "LOG"}
        </Pill>
      </div>
      <div className="grid gap-1.5 border-b border-line px-3 py-2">
        <div className="flex items-center justify-between text-xs text-ink-2">
          <span>{stageLabel(analysis.progress_stage)}</span>
          <strong className="tabular text-ink">{percent}%</strong>
        </div>
        <Meter value={percent} tone="neutral" label="Analysis progress" />
        <small className="text-xs text-ink-3">Stage estimate · validated results appear after completion</small>
      </div>
      <div ref={output} role="log" aria-live="polite" className="max-h-72 overflow-y-auto bg-surface-2 px-3 py-2 font-mono text-xs">
        {events.length ? (
          events.map((event, index) => (
            <div key={index} className={cn("grid grid-cols-[auto_auto_1fr] gap-2 py-0.5", LEVEL_TEXT[event.level] ?? LEVEL_TEXT.info)}>
              <time className="text-ink-3">{timeLabel(event.created_at)}</time>
              <span className="font-medium">{stageLabel(event.stage)}</span>
              <p className="m-0 break-words">{event.message}</p>
            </div>
          ))
        ) : (
          <div className="grid grid-cols-[auto_auto_1fr] gap-2 py-0.5 text-ink-3">
            <time>--:--:--</time>
            <span className="font-medium">Waiting</span>
            <p className="m-0">No progress events were recorded for this older run.</p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Analyses waiting or running; only shown while there is something in it. */
export function QueueCard({ queue, currentId, onOpen }: { queue: AnalysisQueueItem[]; currentId: string; onOpen: (id: string) => void }) {
  if (!queue.length) return null;
  return (
    <Card className="mb-4" aria-labelledby="analysis-queue-title" data-testid="analysis-queue">
      <CardHeader title={<span id="analysis-queue-title">Analysis queue</span>} aside={<Count>{queue.length} active</Count>} />
      <div className="grid gap-1.5" aria-live="polite">
        {queue.map((item) => {
          const progress = Math.max(0, Math.min(100, Number(item.progress_percent || 0)));
          const running = item.status === "analyzing";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpen(item.id)}
              aria-current={item.id === currentId ? "true" : undefined}
              className={cn(
                "grid cursor-pointer grid-cols-[56px_minmax(0,1fr)_120px] items-center gap-3 rounded-sm border border-line px-3 py-2 text-left hover:bg-surface-2",
                item.id === currentId && "border-accent bg-accent-soft",
              )}
            >
              <span className={cn("tabular text-xs font-semibold", running ? "text-accent" : "text-ink-3")}>{running ? "NOW" : `#${item.position ?? ""}`}</span>
              <span className="min-w-0">
                <strong className="block truncate text-sm">{item.title || "Untitled application"}</strong>
                <small className="block truncate text-xs text-ink-2">
                  {item.company || "Company not set"} · {stageLabel(item.progress_stage)}
                </small>
              </span>
              <span className="flex items-center gap-2">
                <Meter value={progress} tone="neutral" label={`${item.title} progress`} />
                <b className="tabular text-xs">{progress}%</b>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
