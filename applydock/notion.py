"""Two-way Notion sync: schema mapping, pushing application fields, importing edits, and trash reconciliation."""
from __future__ import annotations

import datetime as dt
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import applications, config, database


NOTION_VERSION = "2026-03-11"


NOTION_CHECK_INTERVAL = 120


NOTION_CHECK_LOCK = threading.Lock()


NOTION_CHECK_STATE = {"last_run": 0.0, "checked_at": "", "error": ""}


NOTION_REQUEST_LOCK = threading.Lock()


NOTION_LAST_REQUEST = 0.0


def notion_request(method, path, payload=None):
    global NOTION_LAST_REQUEST
    token = config.unprotect(config.SETTINGS.get("notion_token", ""))
    if not token:
        raise RuntimeError("Notion is not connected.")
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request("https://api.notion.com/v1" + path, data=body, method=method,
        headers={"Authorization": "Bearer " + token, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json"})
    for attempt in range(3):
        with NOTION_REQUEST_LOCK:
            delay = max(0.0, 0.35 - (time.monotonic() - NOTION_LAST_REQUEST))
            if delay:
                time.sleep(delay)
            NOTION_LAST_REQUEST = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if method == "GET" and error.code in (429, 529, 500, 502, 503, 504) and attempt < 2:
                try: wait = max(0, int(error.headers.get("Retry-After", "")))
                except (TypeError, ValueError): wait = 2 ** attempt
                error.close()
                time.sleep(min(wait, 60))
                continue
            try: detail = json.load(error).get("message", error.reason)
            except Exception: detail = error.reason
            raise RuntimeError(f"Notion {error.code}: {detail}") from None


NOTION_FIELDS = {
    "position": ("Position", [], "rich_text"),
    "kind": ("Kind", [], "rich_text"),
    "url": ("Source URL", ["Link"], "url"),
    "company": ("Company", [], "rich_text"),
    "excerpt": ("Excerpt", [], "rich_text"),
    "recipient": ("Recipient", ["Email"], "email"),
    "subject": ("Subject", [], "rich_text"),
    "body": ("Email Body", [], "rich_text"),
    "send_at": ("Send At", [], "date"),
    "approved": ("Approved", [], "checkbox"),
    "status": ("Status", [], "rich_text"),
    "application_stage": ("Stage", ["Application Stage"], ("status", "select")),
    "sent_at": ("Sent At", [], "date"),
    "apply_method": ("Application Method", [], "select"),
    "apply_url": ("Apply Link", [], "url"),
    "needs_review": ("Needs Review", [], "checkbox"),
    "contact_emails": ("Contact Emails", [], "rich_text"),
    "post_details": ("Post Details", [], "rich_text"),
    "resume_name": ("Resume Name", [], "rich_text"),
    "resume_category": ("Resume Category", [], "rich_text"),
    "resume_link": ("Resume Link", [], "url"),
    "resume_status": ("Resume Status", [], "rich_text"),
    "ats_match": ("ATS Match", [], "number"),
    "ats_analysis_status": ("ATS Analysis Status", [], "rich_text"),
    "ats_missing_required": ("ATS Missing Required", [], "number"),
    "ats_analyzed_at": ("ATS Analyzed At", [], "date")
}


def ensure_notion_schema(source_id):
    source = notion_request("GET", "/data_sources/" + source_id)
    props = source.get("properties", {})
    title_names = [name for name, prop in props.items() if prop.get("type") == "title"]
    if not title_names:
        raise RuntimeError("The Notion data source needs a title column.")
    title_name = title_names[0]
    mapping = {"title": title_name}
    missing = {}
    for logical, (preferred, aliases, kind) in NOTION_FIELDS.items():
        if logical == "company" and title_name.lower() == "company":
            continue
        kinds = kind if isinstance(kind, tuple) else (kind,)
        candidates = [preferred, *aliases]
        found = next((name for name in candidates if props.get(name, {}).get("type") in kinds), None)
        if found:
            mapping[logical] = found
            if logical == "application_stage":
                stage_type = props[found]["type"]
                mapping["application_stage_type"] = stage_type
                stage_schema = props[found].get(stage_type, {})
                stage_options = list(stage_schema.get("options", []))
                grouped = stage_schema.get("groups", props[found].get("groups", {}))
                if isinstance(grouped, dict):
                    ordered_groups = [grouped.get(name, []) for name in ("to_do", "in_progress", "complete", "current", "future")]
                    ordered_groups.extend(value for name, value in grouped.items() if name not in {"to_do", "in_progress", "complete", "current", "future"})
                    for group_options in ordered_groups:
                        if isinstance(group_options, list):
                            stage_options.extend(group_options)
                elif isinstance(grouped, list):
                    for group in grouped:
                        if isinstance(group, dict) and isinstance(group.get("options"), list):
                            stage_options.extend(group["options"])
                names = []
                for option in stage_options:
                    name = str(option.get("name", "")).strip() if isinstance(option, dict) else ""
                    if name and name.lower() not in {value.lower() for value in names}:
                        names.append(name)
                mapping["application_stage_options"] = names
            continue
        name = preferred
        if name in props or name in missing:
            name = "Capture " + preferred
        while name in props or name in missing:
            name = "Capture " + name
        create_kind = "select" if logical == "application_stage" else kinds[0]
        missing[name] = {create_kind: {}}
        mapping[logical] = name
        if logical == "application_stage":
            mapping["application_stage_type"] = create_kind
            mapping["application_stage_options"] = []
    if missing:
        notion_request("PATCH", "/data_sources/" + source_id, {"properties": missing})
    source_column = props.get("Application Source", {})
    if source_column.get("type") == "select":
        options = source_column.get("select", {}).get("options", [])
        mapping["application_source"] = "Application Source"
        mapping["application_source_options"] = {option.get("name", "").lower(): option.get("name") for option in options}
        mapping["application_source_option"] = mapping["application_source_options"].get("linkedin")
    return mapping


def rich(value):
    text = str(value or "")
    return {"rich_text": [{"type": "text", "text": {"content": text[i:i+1900]}} for i in range(0, len(text), 1900)]}


def notion_properties(entry):
    mapping = config.SETTINGS.get("notion_mapping")
    required_mapping = ("apply_method", "apply_url", "needs_review", "contact_emails", "post_details", "resume_name", "resume_category",
                        "resume_link", "resume_status", "application_stage", "ats_match", "ats_analysis_status", "ats_missing_required", "ats_analyzed_at")
    if not mapping or not all(name in mapping for name in required_mapping):
        mapping = ensure_notion_schema(config.SETTINGS["notion_data_source_id"])
        config.SETTINGS["notion_mapping"] = mapping
        config.save_config(config.SETTINGS)
    title_name = mapping["title"]
    title_value = entry["company"] or entry["title"] if title_name.lower() == "company" else entry["title"]
    props = {
        title_name: {"title": [{"type": "text", "text": {"content": title_value[:1900]}}]},
        mapping["position"]: rich(entry["title"]),
        mapping["kind"]: rich(entry["kind"]),
        mapping["url"]: {"url": entry["url"]},
        mapping["excerpt"]: rich(entry["excerpt"]),
        mapping["recipient"]: {"email": entry["recipient"] or None},
        mapping["subject"]: rich(entry["subject"]),
        mapping["body"]: rich(entry["body"]),
        mapping["send_at"]: {"date": {"start": entry["send_at"]} if entry["send_at"] else None},
        mapping["approved"]: {"checkbox": entry["status"] in ("approved", "sending", "sent")},
        mapping["status"]: rich(entry["status"]),
        mapping["sent_at"]: {"date": {"start": entry["sent_at"]} if entry["sent_at"] else None}
    }
    props[mapping["apply_method"]] = {"select": {"name": {"email": "Email", "external_form": "External form", "unknown": "Unknown"}[entry["apply_method"]]}}
    props[mapping["apply_url"]] = {"url": entry["apply_url"] or None}
    props[mapping["needs_review"]] = {"checkbox": bool(entry["needs_review"])}
    props[mapping["contact_emails"]] = rich("\n".join(entry["contact_emails"]))
    props[mapping["post_details"]] = rich(entry["post_details"])
    resume = entry.get("resume") or {}
    props[mapping["resume_name"]] = rich(resume.get("name", ""))
    props[mapping["resume_category"]] = rich(resume.get("category", ""))
    pinned = entry.get("resume_version") or {}
    props[mapping["resume_link"]] = {"url": (pinned.get("file_url") if pinned.get("pinned") else resume.get("file_url")) or None}
    props[mapping["resume_status"]] = rich(entry.get("resume_status", "Resume Missing"))
    analysis = entry.get("analysis") or {}
    props[mapping["ats_match"]] = {"number": analysis.get("overall_score")}
    props[mapping["ats_analysis_status"]] = rich(analysis.get("label", "Not Analyzed"))
    props[mapping["ats_missing_required"]] = {"number": analysis.get("missing_mandatory") if analysis.get("id") else None}
    analyzed_at = analysis.get("analyzed_at", "")
    props[mapping["ats_analyzed_at"]] = {"date": {"start": analyzed_at} if analyzed_at else None}
    stage_type = mapping.get("application_stage_type", "select")
    stage_value = entry.get("application_stage", "")
    props[mapping["application_stage"]] = {stage_type: {"name": stage_value} if stage_value else None}
    if "company" in mapping:
        props[mapping["company"]] = rich(entry["company"])
    if "application_source" in mapping:
        option = mapping["application_source_options"].get(entry["platform"].lower()) or mapping["application_source_options"].get("other")
        if option:
            props[mapping["application_source"]] = {"select": {"name": option}}
    return props


def notion_text_value(prop):
    kind = prop.get("type", "")
    if kind not in ("title", "rich_text"):
        return ""
    return "".join(item.get("plain_text") or item.get("text", {}).get("content", "") for item in prop.get(kind, []))


def notion_page_updates(entry, page, mapping):
    """Read user-editable fields from one linked Notion page.

    Delivery status, approval, Gmail state, and resume file references remain controlled locally.
    """
    props = page.get("properties", {})
    updates = {}

    def mapped(logical):
        name = mapping.get(logical, "")
        return props.get(name) if name and name in props else None

    position = mapped("position")
    if position is not None:
        updates["title"] = notion_text_value(position).strip()[:300]
    elif mapping.get("title", "").lower() != "company":
        title_prop = props.get(mapping.get("title", ""))
        if title_prop is not None:
            updates["title"] = notion_text_value(title_prop).strip()[:300]

    company = mapped("company")
    if company is not None:
        updates["company"] = notion_text_value(company).strip()[:300]
    elif mapping.get("title", "").lower() == "company":
        title_prop = props.get(mapping.get("title", ""))
        if title_prop is not None:
            updates["company"] = notion_text_value(title_prop).strip()[:300]

    for logical, limit in (("excerpt", 8000), ("subject", 1000), ("body", 12000), ("post_details", 4000)):
        prop = mapped(logical)
        if prop is not None:
            updates[logical] = notion_text_value(prop).strip()[:limit]

    kind_prop = mapped("kind")
    if kind_prop is not None:
        kind = notion_text_value(kind_prop).strip().lower()
        if kind in ("job", "post"):
            updates["kind"] = kind

    recipient = mapped("recipient")
    if recipient is not None:
        value = str(recipient.get("email") or "").strip()
        if not value or re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            updates["recipient"] = value

    send_at = mapped("send_at")
    if send_at is not None:
        value = (send_at.get("date") or {}).get("start", "")
        try:
            if value:
                dt.datetime.fromisoformat(value).astimezone(dt.timezone.utc)
            updates["send_at"] = value
        except (TypeError, ValueError):
            pass

    method_prop = mapped("apply_method")
    if method_prop is not None:
        name = str((method_prop.get("select") or {}).get("name") or "").strip().lower().replace(" ", "_")
        method = {"email": "email", "external_form": "external_form", "unknown": "unknown", "not_decided": "unknown"}.get(name)
        if method:
            updates["apply_method"] = method

    apply_url = mapped("apply_url")
    if apply_url is not None:
        value = str(apply_url.get("url") or "").strip()
        try:
            if value:
                applications.public_https_url(value)
            updates["apply_url"] = value
        except ValueError:
            pass

    needs_review = mapped("needs_review")
    if needs_review is not None:
        updates["needs_review"] = int(bool(needs_review.get("checkbox")))

    contacts = mapped("contact_emails")
    if contacts is not None:
        updates["contact_emails"] = applications.contact_emails(notion_text_value(contacts))

    stage_prop = mapped("application_stage")
    if stage_prop is not None:
        stage_type = mapping.get("application_stage_type") or stage_prop.get("type")
        updates["application_stage"] = str((stage_prop.get(stage_type) or {}).get("name") or "").strip()[:120]
        if applications.stage_is_after_apply(updates["application_stage"]):
            updates["needs_review"] = 0

    return updates


def import_notion_page(entry, page, mapping):
    edited_at = str(page.get("last_edited_time") or "")
    if not edited_at or edited_at == entry.get("notion_edited_at", ""):
        return False
    updates = notion_page_updates(entry, page, mapping)
    editable = entry["status"] not in ("sending", "sent") and entry["delivery_mode"] != "gmail_scheduled"
    if not editable:
        updates = {key: value for key, value in updates.items() if key == "application_stage"}
    changed = {}
    for key, value in updates.items():
        current = entry.get(key)
        if key == "contact_emails":
            if list(current or []) != value:
                changed[key] = json.dumps(value)
        elif str(current or "") != str(value or ""):
            changed[key] = value
    content_keys = {"title", "company", "kind", "excerpt", "post_details", "recipient", "subject", "body", "send_at", "apply_method", "apply_url", "needs_review", "contact_emails"}
    if entry["status"] == "approved" and content_keys.intersection(changed):
        changed["status"] = "draft"
    if entry["gmail_draft_id"] and {"recipient", "subject", "body", "apply_method"}.intersection(changed):
        changed["gmail_dirty"] = 1
    changed["notion_edited_at"] = edited_at
    changed["sync_error"] = ""
    if len(changed) > 2:
        changed["updated_at"] = config.now_iso()
    with database.LOCK, database.connect() as db:
        assignments = ",".join(f"{key}=?" for key in changed)
        db.execute(f"UPDATE entries SET {assignments} WHERE id=? AND notion_id=?", (*changed.values(), entry["id"], entry["notion_id"]))
    return len(changed) > 2


def notion_page_trashed(entry):
    page = notion_request("GET", "/pages/" + entry["notion_id"])
    if page.get("object") != "page" or page.get("id", "").replace("-", "") != entry["notion_id"].replace("-", ""):
        raise RuntimeError("Notion returned an unexpected page; the local item was kept.")
    return page.get("in_trash") is True or page.get("archived") is True


def reconcile_notion_deletions(force=False):
    """Pull supported Notion edits and remove pages explicitly reported as in trash.

    Missing access and API failures leave the local record untouched. ApplyDock never
    sends a delete or archive request to Notion.
    """
    if not config.SETTINGS.get("notion_token") or not config.SETTINGS.get("notion_data_source_id"):
        return {"checked": 0, "updated": 0, "removed": 0, "error": ""}
    with NOTION_CHECK_LOCK:
        if not force and time.monotonic() - NOTION_CHECK_STATE["last_run"] < NOTION_CHECK_INTERVAL:
            return {"checked": 0, "updated": 0, "removed": 0, "error": NOTION_CHECK_STATE["error"]}
        NOTION_CHECK_STATE["last_run"] = time.monotonic()
        checked = updated = removed = 0
        errors = []
        mapping = config.SETTINGS.get("notion_mapping") or {}
        try:
            refreshed_mapping = ensure_notion_schema(config.SETTINGS["notion_data_source_id"])
            if refreshed_mapping != mapping:
                mapping = refreshed_mapping
                config.SETTINGS["notion_mapping"] = mapping
                config.save_config(config.SETTINGS)
            else:
                mapping = refreshed_mapping
        except Exception as error:
            NOTION_CHECK_STATE["checked_at"] = config.now_iso()
            NOTION_CHECK_STATE["error"] = str(error)[:300]
            return {"checked": 0, "updated": 0, "removed": 0, "error": NOTION_CHECK_STATE["error"]}
        for entry in applications.entries():
            if not entry["notion_id"]:
                continue
            try:
                page = notion_request("GET", "/pages/" + entry["notion_id"])
                if page.get("object") != "page" or page.get("id", "").replace("-", "") != entry["notion_id"].replace("-", ""):
                    raise RuntimeError("Notion returned an unexpected page; the local item was kept.")
                checked += 1
                if page.get("in_trash") is True or page.get("archived") is True:
                    removed += applications.delete_local_entry(entry["id"], entry["notion_id"])
                elif import_notion_page(entry, page, mapping):
                    updated += 1
                    # Push generated fields, including a newly stale ATS status, without
                    # treating those generated values as user-editable inbound data.
                    sync_entry(entry["id"])
            except Exception as error:
                errors.append(str(error)[:300])
                if not str(error).startswith("Notion 404:"):
                    break
        NOTION_CHECK_STATE["checked_at"] = config.now_iso()
        NOTION_CHECK_STATE["error"] = errors[0] if errors else ""
        return {"checked": checked, "updated": updated, "removed": removed, "error": NOTION_CHECK_STATE["error"]}


def sync_entry(entry_id):
    if not config.SETTINGS.get("notion_token") or not config.SETTINGS.get("notion_data_source_id"):
        return
    entry = applications.get_entry(entry_id)
    if not entry:
        return
    try:
        if entry["notion_id"] and notion_page_trashed(entry):
            applications.delete_local_entry(entry_id, entry["notion_id"])
            return
        props = notion_properties(entry)
        if entry["notion_id"]:
            page = notion_request("PATCH", "/pages/" + entry["notion_id"], {"properties": props})
        else:
            page = notion_request("POST", "/pages", {"parent": {"type": "data_source_id", "data_source_id": config.SETTINGS["notion_data_source_id"]}, "properties": props})
            with database.connect() as db:
                db.execute("UPDATE entries SET notion_id=? WHERE id=?", (page["id"], entry_id))
        with database.connect() as db:
            db.execute("UPDATE entries SET sync_error='',notion_edited_at=? WHERE id=?", (str(page.get("last_edited_time") or ""), entry_id))
    except Exception as error:
        with database.connect() as db:
            db.execute("UPDATE entries SET sync_error=? WHERE id=?", (str(error)[:1000], entry_id))
