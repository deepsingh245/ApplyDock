import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { notify } from "@/components/ui/toaster";
import { api } from "@/lib/api";
import { isWaiting, timing } from "./reminders";
import type { OutreachFollowup, OutreachSchedule } from "./types";

/**
 * Mounted once in the app shell. It only reminds: toast always, a browser notification when the user allowed it.
 * It runs only while ApplyDock is open in a tab; a closed browser cannot be woken by a web page.
 */
export function OutreachReminders() {
  const schedules = useQuery({ queryKey: ["outreach-schedules"], queryFn: () => api<{ schedules: OutreachSchedule[] }>("/api/outreach/schedules"), refetchInterval: 60_000 });
  const followups = useQuery({ queryKey: ["outreach-followups"], queryFn: () => api<{ followups: OutreachFollowup[] }>("/api/outreach/followups"), refetchInterval: 60_000 });
  const [now, setNow] = useState(() => Date.now());
  const announced = useRef(new Set<string>());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const announce = (key: string, message: string) => {
      if (announced.current.has(key)) return;
      announced.current.add(key);
      notify(message);
      if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("ApplyDock outreach", { body: message });
    };
    for (const item of schedules.data?.schedules ?? []) {
      if (!isWaiting(item.status)) continue;
      const who = `${item.contact?.full_name ?? "a contact"} at ${item.contact?.company ?? "a company"}`;
      const state = timing(item.send_at, now);
      if (state === "upcoming") announce(`${item.id}:upcoming`, `Coming up: message ${who} in a few minutes.`);
      else if (state === "due") announce(`${item.id}:due`, `Time to message ${who}. Open the Outreach queue.`);
      else if (state === "missed") announce(`${item.id}:missed`, `Missed: the reminder for ${who} passed. Reschedule or send it now.`);
    }
    for (const item of followups.data?.followups ?? []) {
      if (item.status === "pending" && new Date(item.due_at).getTime() <= now) {
        announce(`${item.id}:followup`, `Follow-up due: ${item.contact?.full_name ?? "a contact"}. Review it in the Outreach queue.`);
      }
    }
  }, [schedules.data, followups.data, now]);

  return null;
}
