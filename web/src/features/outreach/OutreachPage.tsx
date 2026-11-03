import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon, DownloadIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/api/state";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Count, Eyebrow, Page, PageHeading } from "@/components/ui/misc";
import { Note } from "@/components/ui/note";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/api";
import { ContactsPanel } from "./ContactsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { QueuePanel } from "./QueuePanel";
import { ScheduleWizard } from "./ScheduleWizard";
import { TemplatesPanel } from "./TemplatesPanel";
import type { OutreachBatch, OutreachContact, OutreachFollowup, OutreachOverview, OutreachSchedule, OutreachTemplate } from "./types";

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <Eyebrow>{label}</Eyebrow>
      <div className={`tabular mt-1 text-2xl font-semibold ${alert && value > 0 ? "text-danger" : "text-ink"}`}>{value}</div>
    </div>
  );
}

export default function OutreachPage() {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ["outreach-overview"], queryFn: () => api<OutreachOverview>("/api/outreach/overview") });
  const contacts = useQuery({ queryKey: ["outreach-contacts"], queryFn: () => api<{ contacts: OutreachContact[] }>("/api/outreach/contacts") });
  const templates = useQuery({ queryKey: ["outreach-templates"], queryFn: () => api<{ templates: OutreachTemplate[] }>("/api/outreach/templates") });
  const schedules = useQuery({ queryKey: ["outreach-schedules"], queryFn: () => api<{ schedules: OutreachSchedule[] }>("/api/outreach/schedules"), refetchInterval: 60_000 });
  const followups = useQuery({ queryKey: ["outreach-followups"], queryFn: () => api<{ followups: OutreachFollowup[] }>("/api/outreach/followups"), refetchInterval: 60_000 });
  const batches = useQuery({ queryKey: ["outreach-batches"], queryFn: () => api<{ batches: OutreachBatch[] }>("/api/outreach/batches") });
  const appState = useAppState();

  const [tab, setTab] = useState("overview");
  const [now, setNow] = useState(() => Date.now());
  const [permission, setPermission] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const contactList = useMemo(() => contacts.data?.contacts ?? [], [contacts.data]);
  const templateList = useMemo(() => templates.data?.templates ?? [], [templates.data]);
  const resumeList = useMemo(() => appState.data?.resumes ?? [], [appState.data]);
  const queue = useMemo(() => schedules.data?.schedules ?? [], [schedules.data]);
  const followupList = useMemo(() => followups.data?.followups ?? [], [followups.data]);
  const stats = overview.data;
  const waiting = queue.filter((item) => item.result === "pending").length;
  const usage = Object.entries(stats?.resume_usage ?? {}).sort((a, b) => b[1] - a[1]);

  const refresh = async () => {
    await Promise.all(["outreach-contacts", "outreach-overview", "outreach-schedules", "outreach-templates", "outreach-followups", "outreach-batches"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
  };

  const exportContacts = async () => {
    try {
      const response = await api<{ csv: string }>("/api/outreach/contacts/export");
      const url = URL.createObjectURL(new Blob([response.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "applydock-contacts.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(errorMessage(error), true);
    }
  };

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") return;
    setPermission(await Notification.requestPermission());
  };

  return (
    <Page>
      <PageHeading
        title="Outreach"
        description="Keep recruiter contacts, prepare WhatsApp messages and queue them. At the due time the ApplyDock extension can open the chat and attach the resume for you, and send it if you opted in. Otherwise you press Send and confirm here."
        actions={<Button onClick={exportContacts}><DownloadIcon aria-hidden />Export contacts</Button>}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts <Count>{contactList.length}</Count></TabsTrigger>
          <TabsTrigger value="templates">Templates <Count>{templateList.length}</Count></TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="queue">Queue <Count>{waiting}</Count></TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-4 pt-4">
          {stats ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="HR contacts" value={stats.total_contacts} />
              <Stat label="Scheduled" value={stats.total_scheduled} />
              <Stat label="Awaiting you" value={stats.awaiting_action} />
              <Stat label="Sent" value={stats.sent_successfully} />
              <Stat label="Failed or skipped" value={stats.failed_or_skipped} />
              <Stat label="Due today" value={stats.today_scheduled} />
              <Stat label="Upcoming" value={stats.upcoming_outreach} />
              <Stat label="Missed" value={stats.missed} alert />
              <Stat label="Follow-ups due" value={stats.pending_followups} />
            </div>
          ) : null}
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Resume usage" description="How many queued or sent messages use each resume." />
              {usage.length ? (
                <ul className="m-0 grid list-none gap-1 p-0 text-sm">
                  {usage.map(([name, count]) => (
                    <li key={name} className="flex items-center justify-between gap-2"><span className="text-ink">{name}</span><Count>{count}</Count></li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-sm text-ink-2">No messages scheduled yet.</p>
              )}
            </Card>
            <Card>
              <CardHeader title="Reminders" />
              <p className="mt-0 mb-3 text-sm text-ink-2">Reminders appear as notices while ApplyDock is open in a browser tab, and as system notifications if you allow them. A closed browser cannot be woken by a web page, so a missed time shows up the next time you open the app.</p>
              {permission === "granted" ? (
                <Note tone="success">Browser notifications are on.</Note>
              ) : permission === "denied" ? (
                <Note tone="warn">Notifications are blocked in your browser settings. In-app notices still work.</Note>
              ) : permission === "unsupported" ? (
                <Note tone="neutral">This browser does not support notifications. In-app notices still work.</Note>
              ) : (
                <Button onClick={() => void enableNotifications()}><BellIcon aria-hidden />Turn on browser notifications</Button>
              )}
            </Card>
          </div>
          <Note tone="info" className="max-w-[72ch]">Nothing is marked Sent unless you confirm it or the extension sees WhatsApp deliver it. Extension sending needs Chrome open with the ApplyDock extension and WhatsApp Web logged in; messages missed by more than 30 minutes are left for you to decide on.</Note>
        </TabsContent>

        <TabsContent value="contacts"><ContactsPanel contacts={contactList} refresh={refresh} /></TabsContent>
        <TabsContent value="templates"><TemplatesPanel templates={templateList} contacts={contactList} refresh={refresh} /></TabsContent>
        <TabsContent value="schedule" className="pt-4">
          <ScheduleWizard contacts={contactList} templates={templateList} resumes={resumeList} onDone={() => { void refresh(); setTab("queue"); }} />
        </TabsContent>
        <TabsContent value="queue"><QueuePanel queue={queue} batches={batches.data?.batches ?? []} followups={followupList} now={now} refresh={refresh} /></TabsContent>
        <TabsContent value="history"><HistoryPanel queue={queue} followups={followupList} /></TabsContent>
      </Tabs>
    </Page>
  );
}
