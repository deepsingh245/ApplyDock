# ApplyDock

A local-first Chrome Manifest V3 sidebar with a Windows helper. You choose each job or hiring post to capture. The helper saves it in a local SQLite queue and syncs structured fields to your connected Notion database. For email applications, you can save a Gmail draft with a resume, prepare it for Gmail's own Schedule send, or approve local SMTP sending at 9:00 AM.

The extension recognizes LinkedIn, Indeed, Wellfound, Naukri, Greenhouse, Lever, Ashby, and Workday URLs. A manual review form also supports a specific job or hiring-post page on another public HTTPS site. Extraction is best effort; always check the preview. It does not submit external application forms or collect saved items automatically.

## Start and open the sidebar

1. Install the local PDF parser once with `py -3 -m pip install -r requirements.txt`.
2. Double-click `start.cmd` or run `py -3 server.py` in this folder. Keep its window open.
3. Copy the **pairing key** printed in that window.
4. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's `extension` folder. If Chrome has the earlier extension loaded from another folder, remove that unpacked copy and load the `extension` folder here. The extension is named **ApplyDock**.
5. Pin the extension to Chrome's toolbar and click its icon. The **Applications** sidebar opens. Select **Settings**, enter the pairing key, and save it. Clicking the toolbar icon again toggles the sidebar.

Open a specific job or hiring post and click **Capture this page**, or right-click a job link and choose **Review this job or hiring link**. On sites other than LinkedIn, Chrome asks for access to that site when you request extraction. If access is declined or the page cannot be read, the preview stays editable for manual entry. **Save selected item** is the only action that creates a record. For LinkedIn hiring posts, the preview keeps detected addresses and post instructions as reference data. Open the separate **Email application** panel only when you intend to prepare an email. Review all extracted details before saving; page layouts can change. The sidebar's top-right **Night** switch remembers your choice.

Click a captured row to expand it, then **Review application** to edit its stage, details, contact emails, and post instructions. The application stage is your real progress, such as **To apply**, **Applied**, or **Interviewing**; it is separate from ApplyDock's email delivery state. Saving changes updates the same Notion page. Job email fields stay collapsed until you choose **Email application**. Hiring-post addresses remain clearly separated from the recipient, message, resume, and delivery controls. **Remove from ApplyDock** deletes only the local record; the Notion page stays as it is. It also cancels any pending local SMTP send for that record, but it does not remove or cancel a Gmail draft or scheduled message. **Settings** contains the local connection, Notion, email, and your writing background. The Resume Library has a refresh icon for immediately loading resumes added in the web workspace. Once a local email has status **Sent**, it leaves the extension list; its record remains in Notion. A Gmail message that you scheduled manually remains visible because the helper cannot detect when Gmail later sends it.

The header's square arrow icon, labeled **Open in web**, opens the full workspace at <http://127.0.0.1:8765/>. If the sidebar is paired, it passes the pairing key to the new local tab through Chrome scripting, not through the URL. If the web page cannot pair automatically, enter the same key printed by `start.cmd`. After a successful connection, this browser profile remembers the key across refreshes and restarts.

## Full web workspace

The web page uses a permanent workspace sidebar for **Applications**, **Resume Library**, **ATS Analysis**, and **Settings**, with a global application search and matching light and dark themes. Applications keep the searchable active queue, **Review**, **Applied**, and **Scheduled** filters, a full application editor, a live email preview, manual job or post capture, and delivery and AI actions. The Resume Library uses a selectable document table with local PDF preview, version and usage details, and focused edit controls. Settings groups integrations, preferences, and live local status without exposing saved secrets. **Applied** shows applications at Applied, No Answer, Offer, or Rejected. Moving an application to one of those stages automatically clears **Needs Review**, including when the stage change comes from Notion. On startup, ApplyDock also repairs older records that already had one of those stages before this rule was introduced. **Scheduled** is limited to email applications prepared or scheduled through Gmail. Application stage appears in the queue, editor heading, form, and status inspector, and it is included in search. Apply links include a compact open-link icon. Email content and delivery controls stay inside an optional panel and appear only when the application uses email. **Ctrl+S** saves the selected application. It asks before discarding unsaved editor changes.

The web queue also leaves out locally sent applications so Notion becomes their record. Gmail's API does not tell this helper when a manually scheduled draft was sent, so those entries stay visible until a future explicit archive workflow. A browser page cannot read the contents of another hiring-site tab; use the extension to extract a page or enter its details manually on the web page.

The helper uses Python plus `pypdf` for local PDF text extraction. Runtime data is under `data/` and is excluded from Git. Keep that folder private and back it up if needed.

## Local repository and privacy

The source code lives in `Documents/repos/applydock`. Run `start.cmd` from that folder; it uses its own location, so the repository can be moved again. The extension's unpacked path changes when the project moves, so load the `extension` folder from the new location in Chrome. Your existing Notion and Gmail connections remain in the local `data/` folder when that folder is moved with the project.

`data/` contains your captured jobs, email drafts and application details, pairing key, encrypted credentials, and uploaded resumes. **Never add it to Git or GitHub.** `.gitignore` also excludes common credential files and local exports. The tracked source does not include your OAuth client JSON. A fresh clone starts with an empty local database and requires you to connect your own accounts.

Before a commit or GitHub upload, run `git status --short` and `git diff --cached --name-only` and check that only intended source and documentation appear. This repository has no license file; choose a license before making it public if you want to grant others reuse rights.

Run the checks from the repository root with `py -3 -m unittest discover -s tests -v`. If Node.js is installed, also run `node tests/test_post_extraction.js`, `node --check extension/sidepanel.js`, `node --check extension/background.js`, and `node --check dashboard/app.js`.

## Connect Notion

1. Create a private [Notion internal integration](https://www.notion.so/profile/integrations) with **Read content**, **Insert content**, and **Update content** capabilities.
2. Add the integration under your database's **Connections**.
3. Under **Manage data sources**, choose **Copy data source ID**. Paste it and the integration token into sidebar **Settings → Notion**.

The helper checks access and creates missing columns. In the existing **Job Application Tracker → Applications** database, it uses `Company` as the title, `Position` for the job title, `Link` for the source URL, `Email` for the recipient, and `Application Source` for the platform. The existing `Stage` status column is used as the editable application stage. Its current choices are **Initiated**, **To apply**, **No Answer**, **Applied**, **Offer**, and **Rejected**. ApplyDock reads grouped Notion status options as well as ordinary select options; if Stage is absent, it creates an `Application Stage` compatible column. `Contact Emails` stores all detected addresses, and `Post Details` stores editable instructions or notes. `Resume Name`, `Resume Category`, `Resume Link`, and `Resume Status` describe the currently assigned library resume. `ATS Match`, `ATS Analysis Status`, `ATS Missing Required`, and `ATS Analyzed At` contain the compact generated analysis summary. ApplyDock ignores inbound edits to those four ATS fields; detailed evidence and private document text stay local. Changing the assignment updates the same Notion page. Existing uploaded resume paths migrate into the versioned library when the helper starts with this update. `Application Method`, `Apply Link`, and `Needs Review` distinguish email applications from external forms and uncertain captures.

Captures are saved locally first, then synced to Notion. Saving the editor pushes the stage and supported application fields to the same Notion page. Changes made in Notion to Stage, position, company, captured text, notes, recipient, subject, email body, application method, apply link, contact emails, send date, or Needs Review are imported into ApplyDock while the helper runs. ApplyDock's approval, delivery state, Gmail state, source URL, and private resume file assignment remain controlled locally. A Notion content change to an approved application removes its local approval so it can be reviewed again; a stage-only change keeps the approval. If Notion is offline, the item remains local with a sync error. Use **Retry Notion sync** in Settings later. Editing a Notion checkbox never approves an email.

While the helper runs, it checks linked Notion pages for edits, current Stage options, and the explicit `in_trash` flag about every two minutes. The web workspace and sidebar refresh their local view periodically when no form is being edited. Use the refresh button or **Retry Notion sync** to pull newly added Notion Stage options immediately. A page moved to Notion Trash is removed from ApplyDock locally; ApplyDock never sends a delete or trash request to Notion. A 404, lost permission, or network error is ambiguous, so the local record is kept and the Settings screen reports the check error. Before a due local SMTP send, the helper checks its linked Notion page again and postpones sending if that check fails. This requires the helper and internet connection to be running; a Gmail message already scheduled in Gmail must be canceled in Gmail separately. See [Notion page properties](https://developers.notion.com/reference/page) and [retrieve a page](https://developers.notion.com/reference/retrieve-a-page).

Settings are loaded from the local helper each time the sidebar or web page opens. Saved data source ID, SMTP host, port, account, Gmail OAuth client ID, and writing background remain visible and editable. Tokens and passwords remain encrypted for the Windows account; those fields deliberately show a **Saved securely** placeholder instead of the secret, and can be left blank to retain it. File inputs cannot display the previously selected OAuth JSON, so the saved client ID and **Configured** status indicate that it is present.

## Resume Library

Open **Resumes** in the web workspace, or **Settings → Resume library** in the sidebar. Upload a PDF or DOCX, give it a useful name and category, and optionally make it the default. The first uploaded resume becomes the default automatically. The library supports preview, download, rename, category changes, file replacement, choosing a new default, and deletion. PDFs use the browser's local preview; DOCX files use a read-only text preview generated by the helper while the original remains available for download and email attachment.

Each application stores a resume ID rather than another copy of the file. Choose an existing resume in the application editor or during capture. The UI shows **Resume Selected**, **Resume Missing**, or **Ready to Send**. Resume files are content addressed under `data/resumes/versions/`; identical uploads reuse a stored document. Replacing a file creates an immutable version while preserving the reusable resume ID and all assignments. It removes local send approval, marks an existing Gmail draft as needing an update, and marks completed ATS results as needing reanalysis. Earlier runs retain the exact resume version they used. Deleting a resume keeps application records and marks affected applications **Resume Missing** while removing that resume's private versions and dependent analyses after confirmation. A file used by an email currently sending cannot be replaced or deleted.

Resume files live under the ignored `data/resumes/` directory. Notion receives a tokenized `127.0.0.1` link: it works only on this computer while the ApplyDock helper is running and is not a public internet URL. Replacing a resume rotates that access token and updates assigned Notion pages. The actual file, rather than its link, is attached to Gmail drafts and local SMTP messages. ApplyDock refuses approval or Gmail draft creation when the selected resume is missing.

## Connect email and approve

### Gmail drafts and Gmail's Schedule send

Gmail draft creation uses a separate Google OAuth connection. Your SMTP app password cannot create or schedule a Gmail draft. To connect:

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project, enable the **Gmail API**, and configure the OAuth consent screen for your own account. Add the `https://www.googleapis.com/auth/gmail.compose` scope. If the app is in **Testing**, add your Gmail address as a test user.
2. Create an OAuth client of type **Desktop app** and download its JSON file. This is only for authorization; no Firebase or hosted backend is needed.
3. In sidebar **Settings → Gmail drafts**, choose that JSON file and select **Save OAuth client locally**, then **Connect Gmail**. Complete consent in the browser tab. Return to the sidebar and select **Refresh connection status**. The local dashboard has the same setup.

The local helper stores the client secret and refresh token encrypted with Windows DPAPI. Neither is placed in the extension or the ZIP. The client JSON is read for setup and is not copied into the project. Google classifies `gmail.compose` as a restricted OAuth scope; personal apps can encounter an unverified-app warning. An External app left in Google's **Testing** status gets a refresh token that expires after seven days, so reconnecting may be necessary. See [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [personal-use verification](https://support.google.com/cloud/answer/13464323), and [OAuth token expiration](https://developers.google.com/identity/protocols/oauth2).

For a captured item, set **Application method → Email**, verify the recipient and message, and select a PDF or DOCX resume from the library. Then choose:

| Button | Result |
| --- | --- |
| **Save to Gmail Drafts** | Creates or updates an unsent draft with the resume in the connected Gmail account. |
| **Prepare Gmail schedule** | Creates or updates that draft and opens Gmail Drafts. Open the draft in the **connected account**, choose **Schedule send**, and set 9:00 AM in Gmail. After Gmail shows it under Scheduled, return and choose **I scheduled it in Gmail** to record your confirmation locally. |
| **Approve for local 9 AM** | Uses the existing local SMTP worker; the computer and helper must be running at send time. |

Gmail's public API exposes draft creation and sending, but no native Schedule send operation. The app therefore cannot set Gmail's scheduled time itself or verify that you completed scheduling. The confirmation button records what you did in Gmail. Check the **Scheduled** folder before marking it. Gmail says scheduled messages may send a few minutes after the selected time and uses the timezone chosen when scheduling. [Gmail API methods](https://developers.google.com/workspace/gmail/api/reference/rest), [Gmail scheduling help](https://support.google.com/mail/answer/9214606)

Creating or updating a Gmail draft clears any local SMTP approval for that item. Once it has a Gmail draft, the local 9 AM sender skips it, including if the computer is running. The helper needs to be running when you create or update the draft. After **you schedule it in Gmail**, Gmail handles delivery while the computer is off. If you edit the local message later, select **Update Gmail draft** before scheduling. If Gmail says the draft is missing, check **Scheduled** before taking further action; the app will not create a duplicate automatically.

### Local SMTP

In sidebar **Settings → Email account**, enter your SMTP host, port **465** (TLS) or **587** (STARTTLS), full username, From address, and a dedicated SMTP or app password. For Gmail: use `smtp.gmail.com`, port `465`, your **full Gmail address** as both username and From, and a [Google app password](https://support.google.com/accounts/answer/185833) after enabling 2-Step Verification. A display name or short regular password will not authenticate. Verification signs in without sending a message.

The Notion token and SMTP password are encrypted with Windows DPAPI for the current Windows account. They are not embedded in extension code. Resume files and email content are ordinary local files and records, not encrypted.

For each captured item using local SMTP, confirm the application method is **Email**. Enter the recipient, subject, body, future **9:00 AM local** date, select a library resume, then click **Approve for local 9 AM** and confirm. Each item needs its own approval and can use a separate message and resume. Editing an approved item or replacing its resume removes approval until you review it again. A failed send must also be reviewed and reapproved. An item left as `sending` after a crash is never automatically retried, because it might already have been delivered.

The local worker checks every ten seconds while the app runs. If the computer or process is off at 9:00 AM, an overdue locally approved item is attempted at the next 9:00 AM when it is running. **Reliable local SMTP delivery while the computer is off requires a cloud scheduler; Gmail's native Schedule send is the alternative above.** SMTP and Notion need internet access.

## ATS analysis with ChatGPT Plus and Codex

The ATS analyzer uses the Codex CLI session signed into your ChatGPT Plus account. ApplyDock has no OpenAI API key field, no API billing fallback, and no automatic analysis. It never purchases credits or switches to another paid provider.

1. Install the current Codex CLI.
2. Run `codex`, choose **Sign in with ChatGPT**, and use the account that has ChatGPT Plus.
3. In the web dashboard, open **Settings → ATS analysis with Codex** and choose **Check Codex connection**.
4. In ChatGPT **Settings → Usage**, keep optional credit use and automatic credit purchases disabled.
5. Select an application and choose **Run analysis**.

The analyzer page always shows the local analysis queue. Its running item is marked **NOW** and waiting items are numbered in processing order, with their application, current stage, and progress. While an analysis is running, the detail screen also shows a live activity sidebar with retry notices and completed steps. Safe Codex CLI error lines appear in that activity log and in the `start.cmd` terminal; local paths, email addresses, and token-like values are redacted. Progress is saved locally, so refreshing the dashboard does not lose the queue or activity log. The percentage measures completed processing stages rather than Codex tokens: Codex CLI does not provide a reliable token level completion percentage. ApplyDock never streams partial AI text, resume content, prompts, or internal model reasoning. The match result appears only after the structured response and cited evidence pass validation. Failed runs show where processing stopped and do not display an unvalidated 0% match score.

ApplyDock uses `gpt-6-luna` with low reasoning effort. The first analysis for a resume normally uses one Codex call to parse its unique document and another to compare it with that job. Later jobs using the same unchanged resume reuse the structured parse. Reopening an unchanged result uses the local cache and makes no Codex call. Exact plan consumption depends on document length and current plan limits.

Codex receives normalized extracted text as explicit UTF-8 through standard input in an ephemeral, empty, read only sandbox. Explicit UTF-8 avoids Windows console code-page corruption when resumes contain Unicode punctuation, symbols, or non-English text. Each call uses an isolated Codex process and a dedicated structured response file, so a stale shared Codex daemon cannot break the analyzer output. It receives no resume path, repository path, stored credential, or writable project directory. ApplyDock validates evidence IDs and calculates the final score in Python. The detailed dashboard shows job relevance, deterministic ATS readability, estimated match, missing mandatory requirements, evidence, recommendations, checklist state, resume versions, prior analyses, and score changes.

If Codex reports the included plan limit, ApplyDock marks the run **Plan limit reached**, pauses queued analyses, and does not retry or offer an API key. Retry manually after the allowance resets. The helper and computer must be running while analysis executes. Cached results remain available if Codex is later uninstalled or signed out.

PDF parsing uses `pypdf`; DOCX parsing stays local. A scanned or image based PDF with too little selectable text shows **Resume Extraction Limited** and asks for a text PDF or DOCX. OCR, bulk analysis, automatic resume rewriting, and automatic analysis are outside this version.

For email writing, enter factual experience in sidebar **Settings → My background for AI drafts**. **Copy AI prompt for this chat** keeps the interactive chat workflow. The web dashboard's **Draft with Codex** action remains separate from ATS analysis. Neither action approves, schedules, or sends email.

## Security and limits

- The helper listens only on `127.0.0.1:8765` and requires a random local pairing key. Keep it private. The extension stores it in Chrome extension storage; the web workspace stores it in this browser profile after successful pairing.
- Resume links contain a per-resume access token but point only to the loopback helper. Treat links copied from Notion as private. They do not expose a file to the public internet, and they stop working when the helper is closed.
- On other HTTPS sites, page extraction requires a Chrome site permission requested when you click capture. A denied request still allows manual preview.
- A Notion integration can write to the database shared with it. An SMTP credential can send from the configured address.
- SMTP acceptance does not guarantee receipt in the destination inbox; `sent` means the provider accepted the message.
- Site markup can change. Preview text and application method before saving and approving. Email recipients and apply links should be verified on the original posting.
- Local SQLite controls approval and email delivery state. The helper imports supported application fields from linked Notion pages, but the 9 AM worker never reads approval from Notion.
