export type Timing = "later" | "upcoming" | "due" | "missed";

export const UPCOMING_MINUTES = 5;
/** Keep in step with MISSED_AFTER_MINUTES in applydock/outreach.py. */
export const MISSED_MINUTES = 30;

/** Where a still-pending message sits relative to its reminder time. Pure, so it is easy to test. */
export function timing(sendAt: string, now: number): Timing {
  const due = new Date(sendAt).getTime();
  if (Number.isNaN(due)) return "later";
  const minutes = (now - due) / 60000;
  if (minutes >= MISSED_MINUTES) return "missed";
  if (minutes >= 0) return "due";
  return -minutes <= UPCOMING_MINUTES ? "upcoming" : "later";
}

/** Statuses a reminder applies to: the user has not acted on them yet. */
export const isWaiting = (status: string) => status === "scheduled" || status === "ready";
