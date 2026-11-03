# Database schema (outreach)

Migrations run in `database.init_db` (user_version 7, 8, 9; a backup is taken before migrating). All additions are additive.

**outreach_contacts** (v7): id, full_name, phone (unique, E.164 style), company, designation, email, linkedin_url, job_title, job_description, source, notes, status, contact_permission, consent, last_contacted_at, follow_up_at, created_at, updated_at, communication_history (JSON). Index on status.

**outreach_templates** (v7, v9): id, name, body, variables, created_at, updated_at, `category`, `is_default` (only one row is 1).

**outreach_schedules** (v7, v8): id, contact_id (FK), template_id (FK), resume_id, message (final text), send_at (UTC ISO), time_window_start/end, status, result, notes, opened_at, sent_at, created_at, updated_at, `batch_id`, `timezone`, `resume_version_id` (pinned), `cancelled_at`. Indexes on (contact_id, send_at), (status, send_at), batch_id.

**outreach_batches** (v8): id, name, scheduled_date, window_start, window_end, timezone, mode, recipient_count, status (active/paused/cancelled), created_at, updated_at.

**outreach_followups** (v9): id, schedule_id (FK, cascade), contact_id (FK, cascade), step, due_at, message, status (pending/done/dismissed), completed_at, created_at. Index on (status, due_at).

**Deletion:** `delete_contact` removes that contact's follow-ups and schedules first. Deleting a template that schedules reference is blocked by the foreign key. Statuses are validated in code (`outreach_schedule.TRANSITIONS`), not by CHECK constraints.

**v10:** `outreach_schedules.auto_send` (0/1, user opt-in per message) and `sent_by` ('' = user confirmed, 'extension' = verified by the extension).
