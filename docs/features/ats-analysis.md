# ATS analysis

**What it does:** estimates how well an application's resume matches its job description, and where your Master Profile holds evidence the resume leaves out. Codex extracts a requirement checklist and assesses it with cited evidence; Python calculates the score. It runs only when you click **Run analysis**.

## Files

| File | Role |
|---|---|
| `applydock/ats.py` | Text extraction, `queue_analysis`, `jd_requirements`, `process_one` (worker), `_run_codex`, `_validated_matches`, `score_result`, summaries and history |
| `applydock/schemas/resume-analysis-schema.json`, `jd-requirements-schema.json`, `ats-analysis-schema.json` | Codex structured-output contracts |
| `applydock/profile.py` → `evidence_blocks` | Master Profile evidence (`P1…`) sent with each run |
| `web/src/features/analysis/` | `AnalysisView` (shared by the page and the dialog over the editor): queue, live progress log, results, requirements explorer, history |

## Flow

1. **Queue.** `queue_analysis(entry, profile_blocks=…)` resolves the application's effective resume version (pinned, else current) and the job text (`canonical_jd`).
   - The HTTP route passes a snapshot of the Master Profile evidence. It is stored in `analysis_runs.profile_json`.
   - The cache key is the resume SHA, the job hash, the profile-evidence hash, and the parser, schema, scoring and model versions. A completed identical run is reused.
2. **Resume profile.** Codex `resume_parse` runs once per unique resume file. The result is cached in `resume_documents.parsed_json`.
3. **Requirement checklist.** Codex `jd_requirements` runs **once per job-description version**. The result is cached in `job_description_versions.parsed_json`.
   - The checklist has 6–18 merged requirements with stable IDs (`J1…`), categories, mandatory flags and 1–4 `terms`.
   - Every rerun on the same job text scores the **same** requirements.
4. **Assessment.** Codex `jd_match` returns one assessment per checklist ID:
   - a resume status, with R evidence;
   - a profile status, with P evidence;
   - a recommendation.
5. **Validation:**
   - A claimed match without valid evidence is downgraded to `missing`.
   - A requirement Codex skipped stays in the score as `uncertain`.
   - If all of a requirement's `terms` appear in a resume evidence block, it can't be reported as missing; it becomes at least `listed`.
   - The same term check finds profile evidence the model missed.
6. **Coverage.** Each requirement is classified as:
   - `represented` (demonstrated in the resume);
   - `weak` (partial or listed);
   - `profile_only` (missing from the resume, but the profile has evidence);
   - `unsupported` (missing from both).
7. **Score.** `score_result` applies the `SCORE_WEIGHTS` categories. Mandatory items count double.
   - Categories the job never mentions are **left out**, not scored as zero.
   - Overall = 95% relevance + 5% readability.
   - `potential_score` re-scores as if the profile evidence were added to the resume. It is informational only.
8. **Draft checks.** `queue_analysis(document=…, draft_resume_id=…)` scores an unsaved editor draft. It has no resume version, never becomes an application's analysis unless its file matches the attached version, and is attached to that version when identical content is saved.
9. **Compare.** `previous` points to the latest earlier completed run of the same job version. Each requirement carries `previous_status`, so the UI shows exactly what improved or regressed.
10. **Store and sync.** Results go to `analysis_runs.result_json`, recommendations to `analysis_checklist`, and progress to `analysis_events`. The worker reports `events.application_changed`, which syncs the summary to Notion.

## Why scores used to drift (fixed in scoring v2)

Scoring v1 asked Codex to invent the requirement list and judge it in the same call, on every run. In one real case, the same job description produced 21, then 22, then 27 requirements (16 → 22 mandatory) across three runs. The score fell each time even though the resume improved, and fixed points came back reworded. A JD with no education or preferred-skills section also lost those weights as zeros.

Scoring v2 fixes all of this:
- the checklist is frozen per job version;
- one assessment is given per fixed ID;
- local term checks are applied;
- absent categories are excluded.

The UI never compares scores across scoring versions.

## Stable verdicts and score checks (2026-10-27)

Real runs showed the AI re-judging every requirement from scratch each time: the same file analyzed twice scored 41.1 and 39.9,
and one profile entry more moved an identical resume from 31.6 to 77.0. After accepting suggestions, untouched requirements
drifted down and hid the gain. Three rules now keep verdicts steady:

- **Same file, same job:** a new analysis reuses the previous run's resume verdicts exactly (only the profile part is redone).
- **Unchanged text keeps its verdict:** `ats.stabilize` restores a requirement's previous status when the AI lowers it but the
  lines that supported it are still in the resume (`evidence_kept`: at least 80% of the cited lines, ignoring layout).
- **Anchored prompt:** the previous verdicts are shown to Codex (`PREVIOUS ASSESSMENT`) for consistency.

**Check score** (resume editor → Job match) re-scores the draft against the *current* analysis without creating a new one
(`POST /api/analyses/{id}/score-check` with `{resume_id, expected_revision, full}` → a `score_check` job; result on
`GET /api/resume-jobs/{id}`). It renders the **unsaved draft** (no version is created), so accepted suggestions count right away.
Only requirements an accepted suggestion targeted (from any analysis of this resume; requirement ids are stable per job
description), whose supporting text changed, or whose key terms newly appear are re-checked (`ats.recheck_ids`); the rest keep
their verdict, and a re-checked one never drops while its text is unchanged (`ats.score_check`). `full: true` (**Re-check all
requirements**) re-judges every requirement instead. The result lists every re-checked requirement with its old and new status and
the AI's reason (`rechecked_items`), including ones that stayed the same, so a reworded bullet that the AI judged no stronger is
visible as "unchanged" rather than looking like nothing was checked. Checks are cached per analysis, rendered file and re-check
set, and are **not** added to the analysis history; a new analysis only runs from **New analysis**, **Save version & new
analysis**, or **Run analysis again**.

## Addressed recommendations

Setting a recommendation's checklist state to **Addressed** moves that requirement out of the open list and Priority improvements
into a collapsed *Addressed (n)* section with **Reopen**; the editor's Job match hides it from Gaps, and suggestions are no longer
generated for it (`resume_workflows.queue_suggestions`). Marks carry over to the next analysis of the same job description when the
requirement is unchanged. Addressing is your judgment: it does not change the score.

## Rules

- **AI path:** Codex CLI only, through your ChatGPT Plus sign-in. No API key or billing setting exists; `tests/test_ats.py` enforces this.
- **Untrusted input:** job, resume and profile text are wrapped as untrusted data in prompts.
- **Truthfulness:** the resume score only counts the resume, since that is what gets sent. Profile evidence never raises the score, only `potential_score`.
- **Plan limit:** reaching the limit pauses the queue (`PLAN_LIMIT_PAUSED`) until you retry manually.
- **Staleness:** a result is stale when the effective resume file's SHA or the job text changes (`analysis_summary`). Editing the profile allows a fresh run but does not mark old ones stale.
- **Wording:** scores are always called an *estimate*, never "ATS compatible".

## Limitations

- **Scanned PDFs:** they produce `extraction_limited`; there is no OCR.
- **Progress:** the percentage reflects processing stages, not model tokens.
- **Model judgment:** statuses remain a model's judgment, now anchored to a fixed checklist. Two runs on an identical file are served from cache.
