# ApplyDock ATS Analyzer

## Product constraints

ApplyDock uses `codex exec` with the Codex CLI session signed into the user's ChatGPT Plus account. It does not accept or store an OpenAI API key, enable API billing, buy credits, or fall back to another paid provider. Analysis runs only after the user selects **Run analysis**. When Codex reports an included plan limit, the local queue pauses until the user retries after the limit resets.

The helper and computer must be running during analysis. Existing capture, Notion, Gmail, SMTP, application stage, and Resume Library features continue to work when Codex is unavailable.

## Execution boundary

Each invocation uses:

- `codex exec`
- an ephemeral session
- a temporary empty working directory
- a read only sandbox
- low reasoning effort
- `gpt-6-luna`
- a strict JSON output schema
- sanitized extracted text through standard input

Codex receives no resume path, project path, stored credential, or writable project directory. Prompts label resumes and job descriptions as untrusted data and prohibit tools, browsing, file access, instruction following from document content, and invented qualifications.

## Local data model

- `resume_documents`: content addressed files, extraction state, evidence blocks, and a cached structured parse.
- `resume_versions`: immutable versions for a logical Resume Library item.
- `resumes.current_version_id`: the current immutable version for each reusable resume.
- `job_description_versions`: canonical job snapshots based on title, kind, captured text, and application instructions.
- `analysis_runs`: cache key, exact resume and JD versions, scores, status, model, output, and sanitized errors.
- `analysis_checklist`: pending, reviewed, or addressed state for recommendations.
- `analysis_events`: durable, sanitized stage updates and percentage estimates for the live activity console.
- `ai_runs`: purpose, model, input character estimate, duration, exit status, and failure category without document text.

Files are stored at `data/resumes/versions/<sha256>.<extension>`. Identical uploads reuse one document. Replacing a file creates or selects an immutable version and marks previous complete results stale without deleting their history. Deleting a logical resume shows affected application count in the existing confirmation, removes its private versions and dependent analyses, and leaves applications with **Resume Missing**.

A timestamped SQLite backup is created before the ATS schema migration. The migration is transactional.

## Extraction, analysis, and scoring

PDF extraction uses `pypdf`. DOCX extraction uses ZIP/XML and includes document text, tables, headers, and footers. Extracted text is normalized and divided into stable evidence blocks. PDFs with insufficient selectable text are treated as scanned or image based and require a text PDF or DOCX; version 1 has no OCR.

One Codex call parses each unique resume document. A second call extracts JD requirements and classifies matches against validated resume evidence. Reusing the same resume parse for another job saves one call. Unchanged analyses are returned from the local cache with no Codex call.

Python rejects unknown evidence IDs and removes unsupported resume claims. Python calculates the final score:

| Category | Weight |
| --- | ---: |
| Required technical skills | 35% |
| Relevant work experience | 25% |
| Responsibilities and projects | 20% |
| Preferred skills | 10% |
| Education and qualifications | 5% |
| ATS readability and structure | 5% |

Requirement credit is 1.0 for demonstrated evidence, 0.5 for partial evidence, 0.25 when listed without supporting experience, and 0 for missing, uncertain, or unsupported claims. Mandatory requirements have twice the internal weight within their category. **Job relevance** is the first five categories normalized to 100. **Estimated match** is 95% relevance plus 5% deterministic readability.

Fewer than two scorable requirements or fewer than 200 meaningful JD characters produces **Insufficient Job Description**. Scanned PDFs produce **Resume Extraction Limited** rather than a score.

## Queue and interfaces

Each run records safe operational events for queueing, resume parsing, job comparison, evidence validation, Python scoring, result preparation, and Notion synchronization. The dashboard displays these events in a live activity sidebar and polls while work is active. Its percentage is a stage estimate because Codex CLI does not expose a reliable token level completion percentage. Partial model output, resume text, job text, prompts, and internal model reasoning are never streamed to the browser. Validated results appear only after schema and evidence checks finish.

A single durable worker processes one analysis at a time. Cache key uniqueness prevents duplicate concurrent work. Temporary Codex failures retry once. Authentication and plan limit failures do not retry automatically. Active runs found after a helper restart become **Analysis Failed — Interrupted** and require manual retry.

The dashboard shows match or analysis status on application cards, filters and score sorting, missing mandatory count, last analysis time, Run and Run again actions, live activity, detailed scoring, evidence, recommendations, checklist state, immutable resume versions, prior runs, and score change. A stopped run has a dedicated failure view rather than an unvalidated zero score. Loading or refreshing the dashboard never queues an analysis.

Settings shows the Codex executable and sign in state, the configured Luna model, uncached call count, cache hit count, and a link to ChatGPT Usage. It explicitly states that no API key is configured.

## Notion boundary

ApplyDock generates and owns four Notion fields:

- `ATS Match`
- `ATS Analysis Status`
- `ATS Missing Required`
- `ATS Analyzed At`

Inbound changes to these generated values are ignored. Detailed evidence, parsed document data, recommendations, usage information, and resume text remain local. Resume or JD changes preserve the prior score locally and sync a stale status to Notion.

## Verification plan

Automated tests will cover resume parse reuse, content deduplication, per job JD isolation, cache behavior, stale states, preserved history, concurrent queue uniqueness, plan limit pausing, evidence validation, prompt injection resistance, scanned PDFs, the absence of API key settings, email isolation, and compatibility with existing integrations. Per the user's instruction, these tests are not run unless explicitly requested.
