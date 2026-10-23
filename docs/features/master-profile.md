# Master Profile, career intelligence and submission history

**What it does:**
- keeps one verified record of your career (experience, projects you built, skills, achievements, education and certifications);
- checks your project links on request;
- tells you which job requirements your profile can support that a resume leaves out;
- adds that evidence to a tailored resume only with your approval;
- permanently records which exact resume file went to which company.

## Where it lives

| Area | Files |
|---|---|
| Profile storage and evidence | `applydock/profile.py` (tables `profile_items`, `profile_link_checks`) |
| Link checks | `applydock/linkcheck.py` |
| Submission history | `applydock/submissions.py` (table `application_submissions`) |
| Workflows over HTTP | `applydock/career.py`; routes under `/api/profile*`, `/api/entries/{id}/submissions`, `/api/resumes/{id}/usage`, `/api/submissions/{id}/file` |
| Profile-aware analysis | `ats.queue_analysis(profile_blocks=…)` and `_validated_matches`; see [ats-analysis](ats-analysis.md) |
| Profile-sourced suggestions | `resume_store.validated_suggestions` / `accept_suggestion` (operation `add_project`, `source_profile_id`) |
| UI | `dashboard/js/profile.js` (Settings → Master Profile), `analysis.js` (coverage), `resume-editor.js` (suggestion cards), `applications.js` (Submitted resume card, Applied filter), `resume-library.js` (usage) |
| Tests | `tests/test_career.py`, `tests/test_ats.py`, `tests/ui/flow-master-profile.mjs` |

## Audit before this work (October 2026)

| Requirement | Before | Now |
|---|---|---|
| Structured profile and project inventory | Missing; one free-text "AI writing background" setting | Settings → Master Profile, with 7 entry kinds, verification states, archive and import |
| Link verification | Missing | On-demand, SSRF-safe checks; your own functional test is recorded separately |
| Job ↔ resume ↔ profile matching | Resume only; the requirement list was regenerated every run | Fixed checklist per JD; four coverage categories; potential score |
| Actionable profile suggestions | Suggestions could only reword resume text | Add a bullet or a whole project from a cited profile entry; Add to resume / Edit / Dismiss / View source |
| Exact file per application | Partial: pinned version and attachment SHA on the entry, overwritten on each draft or send | Immutable submission rows with an audit trail; the file survives resume edits and deletion |
| Submission vs draft | Not distinguished | A draft is never a submission. SMTP sends are `verified`; everything else is `user_reported` |
| Where a resume was used | A count of linked applications | Library lists the companies, versions, dates and channels; opens the exact PDF |

## Data model and relationships

```text
profile_items (kind = personal | experience | project | skill | achievement | education | certification)
  data_json  ── skill.evidence_ids / experience.project_ids / project.experience_id / achievement.related_ids → other profile_items.id
  verification (verified | unverified | needs_review), archived, revision
profile_link_checks (item_id, field) → latest result per project link

resumes (master | tailored) ── resume_versions ── resume_documents (content-addressed file, sha256)
entries.resume_id / resume_version_id (pin) / attachment_sha256 (last attached)
application_submissions: entry_id, resume_id, resume_version_id, document_id, sha256, filename,
                         channel, evidence, submitted_at, message_ref, active, replaced_by/replaced_at, access_token
analysis_runs.profile_json: snapshot of the P-evidence a run used
resume_suggestions.source_item_id / payload_json: profile entry a suggestion came from (and fixed project data)
```

**Rules:**
- **Profile changes don't touch resumes.** Editing, archiving or deleting a profile entry never changes a resume, a version or a submission. A resume only changes through an accepted editor suggestion. Deleting an entry only removes references to it from other profile entries.
- **Suggestions come from the profile record.** A suggestion that adds a project copies its name, link, stack and dates from the profile entry, never from AI output. Projects marked "not for resumes" can't be added.
- **Only verified entries count as facts.** Verified entries, and their verified achievement bullets, form the fact-guard corpus. Unverified entries can be suggested but always require your confirmation. Entries marked "needs review" are left out of matching.
- **Submissions are immutable:**
  - Changing a submission adds a new row; the old row is kept with `replaced_by`.
  - Resume deletion keeps every document a submission references (`submissions.kept_document_ids`).
  - Recording a submission cancels a pending local 9 AM send, so nothing is emailed twice.
  - Once submitted, the delivery actions are hidden.
- **Schema v5 and v6 are additive.** v6 adds `analysis_runs.document_id` and `draft_resume_id` for draft checks. It adds new tables and columns only, and `database.backup_before_migration` copies the database first (`capture.pre-v5-*.sqlite3`).

## Using an updated profile on existing applications

Each analysis stores the profile evidence it used (`analysis_runs.profile_json`); `/api/state.profile_hash` and each analysis's `profile_hash` let the dashboard show “Your Master Profile changed since this analysis” in the inspector, the analysis view, and the editor's Job match tab. Re-running (or **Re-analyze draft** in the editor) uses the current profile — no resume needs to be saved — and new suggestions come from that run. The evidence includes the personal headline and summary and the evidence notes on projects and achievements.

## Link verification

`linkcheck.check_url` only requests http(s) URLs on standard ports, with no credentials. Every resolved address must be public: loopback, private, link-local, CGNAT, multicast and reserved ranges, plus `.local` and `.internal` names, are refused.

**How a request is made:**
- The connection is pinned to the validated IP, which blocks DNS rebinding.
- Redirects are followed manually (at most 4) and re-validated at every hop.
- HEAD is tried first, falling back to GET on 405/501. Response bodies are never read, and requests time out after 8 seconds.
- Results are cached for 60 seconds per URL, and a request is capped at 30 URLs.

**Statuses:** reachable, redirected, authentication required (401/403), unreachable (DNS failure, 404/410, 5xx, TLS errors, refused connections) and could not verify (timeouts, 429, blocked targets). Checks never run in the background.

A reachable link is not proof the app works. "Your own test" (tested and working / partially working / not working) is recorded with its date on the project.

## Acceptance (all covered by tests)

1. **Profile entries.** They are validated, revisioned (a stale write returns 409), and archive or delete cleanly. Deletion removes references.
2. **Import.** It fills only empty personal fields and skips existing entries, so a second import adds nothing.
3. **Link checks:**
   - private, local and odd URLs are never requested;
   - redirects into private hosts are refused;
   - statuses map correctly;
   - a recent result is reused;
   - changing a link discards its old result.
4. **Analysis:**
   - the checklist is extracted once per JD;
   - reruns compare the same IDs, with `previous_status`;
   - requirements Codex skipped stay scored as uncertain;
   - visible terms are never "missing";
   - absent categories don't cap the score;
   - coverage and the potential score are computed;
   - the profile snapshot is part of the cache key.
5. **Suggestions:**
   - an unknown profile ID is dropped;
   - project data comes from the profile;
   - verified sources need no extra confirmation;
   - accept adds the project to the tailored draft only (the master is unchanged), and revert removes it.
6. **Submissions:**
   - the exact file is served (with its access token) after a new master version and after the master's deletion;
   - the record history is kept;
   - an invalid channel is refused;
   - a pending local send is cancelled;
   - an SMTP send records a `verified` submission with the Message-ID and sets the stage to Applied.
7. **Browser flow** (`flow-master-profile.mjs`): import → project → verify links → test result → analysis coverage → View source → profile suggestion → save version → record submission → open PDF → library usage → mobile layout.

## Risks and how they are handled

| Risk | Handling |
|---|---|
| AI invents experience | Assessments must cite R or P IDs; project data never comes from AI; the fact guard uses only verified text; unverified sources need confirmation; nothing is applied without your click |
| Score noise | Frozen checklist per JD; cached identical runs; scores only compared within one scoring version |
| SSRF through link checks | Public-IP-only, pinned connections, re-validated redirects, no bodies read, caps and a cooldown |
| Wrong file on record | The submission stores the document ID and SHA, re-hashes the file at record time, and serves that exact document |
| Lost history | Submission rows are never edited or deleted with a resume; files are kept |
| Gmail "sent" certainty | ApplyDock only has the `gmail.compose` scope, so it cannot see whether a draft was sent. You confirm it ("Confirm it was sent"), and it is stored as `user_reported` |

## Not done yet

- **Recurring link monitoring.** On-demand only, by design for now.
- **Verified Gmail sends.** This would need the `gmail.readonly` scope to look up sent messages.
- **Using profile entries for brand-new experience sections.** Profile suggestions add projects and bullets under existing roles. A whole new job entry is added by hand.
- **Import noise.** The local resume reader can mis-split a technology line into a "project" (for example "React, IndexedDB"). Delete it after import; Codex import avoids it.
