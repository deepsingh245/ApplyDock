export interface OutreachOverview {
  total_contacts: number;
  total_scheduled: number;
  awaiting_action: number;
  sent_successfully: number;
  failed_or_skipped: number;
  today_scheduled: number;
  upcoming_outreach: number;
  missed: number;
  pending_followups: number;
  resume_usage: Record<string, number>;
}

export interface OutreachContact {
  id: string;
  full_name: string;
  phone: string;
  company: string;
  designation: string;
  email: string;
  linkedin_url: string;
  source: string;
  status: string;
  consent: boolean;
  job_title: string;
  notes: string;
  last_contacted_at: string;
}

export interface OutreachTemplate {
  id: string;
  name: string;
  body: string;
  category: string;
  is_default: boolean;
}

export interface OutreachSchedule {
  id: string;
  contact?: OutreachContact;
  template?: OutreachTemplate;
  resume?: { id: string; name?: string; original_filename?: string; available?: boolean };
  resume_file_url?: string;
  message: string;
  send_at: string;
  opened_at: string;
  sent_at: string;
  status: string;
  result: string;
  notes?: string;
  batch_id: string;
  auto_send: boolean;
  sent_by: string;
  resume_filename?: string;
}

export interface OutreachBatch {
  id: string;
  name: string;
  scheduled_date: string;
  window_start: string;
  window_end: string;
  recipient_count: number;
  status: string;
}

export interface OutreachFollowup {
  id: string;
  step: number;
  due_at: string;
  message: string;
  status: string;
  contact?: OutreachContact;
}

export const CONTACT_STATUSES = [
  "Not Sent", "Mailed/Messaged", "Application Sent", "Reached / In Discussion", "Scheduled", "On Hold", "Rejected", "No Response",
  "New", "Interested", "Contacted", "Replied", "Follow-up required", "Not interested", "Do not contact",
];

export const TEMPLATE_CATEGORIES = ["Initial application", "Follow-up", "Referral", "Other"];

export function formatDate(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
