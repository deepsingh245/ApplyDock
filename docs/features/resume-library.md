# Resume library

**What it does:** stores your resumes (PDF/DOCX) as reusable library items with immutable versions, and decides which exact file an application uses.

## Files

| File | Role |
|---|---|
| `applydock/resumes.py` | Upload validation, `create_resume`, `update_resume` (rename, default, replace file), `restore_version`, `delete_resume`, `resume_file_for_entry`, access links |
| `applydock/ats.py` | `install_document` (content-addressed storage plus text extraction), `add_resume_version`, `current_version`, `effective_version`, `list_versions` |
| `dashboard/js/resume-library.js` | Library table, preview and details form |

## Model

- **Library item:** a `resumes` row, either `kind='master'` or `kind='tailored'` (tailored copies are made in the [resume editor](resume-editor.md)).
- **Versions:** each version is a `resume_versions` row pointing at a content-addressed file `data/resumes/versions/{sha256}.ext`. Identical files share one document.
- **Current file:** `resumes.current_version_id` is the file new applications follow.
- **Pinned file:** an application with `entries.resume_version_id` set (by approval, Gmail export, or "Use for this application") keeps that exact file.

## Rules

- **Uploads:** PDF (`%PDF-` magic bytes) or DOCX (a zip containing `word/document.xml`), 8 MB maximum. The MIME type comes from the extension, not the client.
- **Replacing the file:** creates a version and rotates the current-file access token. Unpinned approved applications return to draft and their Gmail drafts are marked dirty.
- **Restore:** moves the current pointer. Nothing is copied or deleted.
- **Delete:** a soft delete, then a purge of that resume's versions, analyses, drafts and suggestions. Pins are cleared and tailored children survive.
- **While sending:** a resume attached to an email that is currently sending can't be replaced, restored or deleted.
- **Attaching:** `resume_file_for_entry` + `attachment_bytes` re-check the file's SHA-256 before every attachment.

## Limitations

- Files on disk aren't encrypted; they rely on the private `data/` folder.
- DOCX preview is text-only (`docx_preview`).
