# Capture and Chrome extension

**What it does:** saves a specific job or hiring post you choose into ApplyDock. Nothing is captured automatically.

**Workflow:** open a posting, then click **Capture this page** in the side panel (or right-click a link and choose **Review this job or hiring link**). Check the editable preview and click **Save selected item**. The dashboard's **+** button opens the same form for manual entry.

## Files

| File | Role |
|---|---|
| `extension/manifest.json` | MV3 manifest; host access to `127.0.0.1:8765` and LinkedIn, optional `https://*/*` requested per site |
| `extension/background.js` | Opens the side panel; context-menu capture |
| `extension/sidepanel.js` | Page extraction (`extractPage`: JSON-LD JobPosting, site selectors, selection, mailto/apply links), capture form, entries list, settings, resume library |
| `applydock/applications.py` | `capture()`, `canonical_url()`, `public_https_url()`, `platform_for_host()`, contact email detection |
| `tests/test_post_extraction.js` | Runs `extractPage` against a LinkedIn post fixture |

## Rules

- **Deduplication:** URLs are canonicalized (LinkedIn job and post IDs, tracking parameters stripped). The same canonical URL returns the existing entry (`duplicate: true`).
- **Accepted URLs:** only public HTTPS URLs. Localhost, IP addresses and non-443 ports are rejected.
- **Hiring posts:** detected emails are kept as reference (`contact_emails`). The first one becomes the recipient only for posts.
- **Default resume:** new entries get the default master resume. Tailored resumes are rejected at capture.

## Limitations

- Extraction is best effort and breaks when sites change their markup.
- The extension keeps its own copy of the API client and UI helpers (MV3 cannot load the dashboard's scripts). See [TECH_DEBT](../TECH_DEBT.md).
- The extension pairs by storing the pairing key in `chrome.storage.local`. **Open in web** injects it into the dashboard tab, never into a URL.
