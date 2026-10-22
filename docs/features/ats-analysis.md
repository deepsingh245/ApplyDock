# ATS analysis

**What it does:** estimates how well an application's resume matches its job description. Codex extracts requirements with cited evidence, and Python calculates the score. Runs only when you click **Run analysis**.

## Files

| File | Role |
|---|---|
| `applydock/ats.py` | Text extraction, `queue_analysis`, `process_one` (worker), `_run_codex`, `_validated_matches`, `score_result`, summaries and history |
| `applydock/schemas/resume-analysis-schema.json`, `ats-analysis-schema.json` | Codex structured-output contracts |
| `dashboard/js/analysis.js` | Queue, live progress console, results, requirements explorer, history |

## Flow

1. **Queue:** `queue_analysis(entry)` resolves the application's effective resume version (pinned, else current) and the job text (`canonical_jd`). The cache key is the resume SHA + job hash + parser, schema, scoring and model versions; a completed identical run is reused.
2. **Run:** the worker calls Codex `resume_parse` once per unique resume file (cached in `resume_documents.parsed_json`), then `jd_match` per job.
3. **Validate:** claimed matches without valid evidence IDs are downgraded to `missing`.
4. **Score:** `score_result` applies the `SCORE_WEIGHTS` categories with mandatory items counted double; overall = 95% relevance + 5% readability.
5. **Store and sync:** the result goes to `analysis_runs.result_json`, recommendations to `analysis_checklist`, and progress to `analysis_events`. The worker reports `events.application_changed`, which syncs the summary to Notion.

## Rules

- **AI path:** Codex CLI only, through your ChatGPT Plus sign-in. No API key or billing setting exists; `tests/test_ats.py` enforces this.
- **Untrusted input:** job and resume text is wrapped as untrusted data in prompts.
- **Plan limit:** reaching the limit pauses the queue (`PLAN_LIMIT_PAUSED`) until you retry manually.
- **Staleness:** a result is stale when the effective resume file's SHA or the job text changes (`analysis_summary`).
- **Wording:** scores are always called an *estimate*, never "ATS compatible".

## Limitations

- **Scanned PDFs:** they produce `extraction_limited`; there is no OCR.
- **Progress:** the percentage reflects processing stages, not model tokens.
