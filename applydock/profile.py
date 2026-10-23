"""Master Profile: the candidate's own career records and the evidence ApplyDock compares jobs against.

Database helpers take an open connection. Invariants:
- Profile items are reusable source records. Editing, archiving, or deleting one never rewrites a resume,
  a resume version, or a submitted file; resumes only change through an accepted editor suggestion.
- Every item carries a verification state. Only verified items count as known facts when AI suggestions
  are checked; unverified items can be suggested but always need the user's confirmation.
- Each item has a revision number; a stale write raises ConflictError (HTTP 409).
- Link checks are stored separately from the item, so checking links never conflicts with editing.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import uuid

from . import resume_model, resume_store
from .resume_store import ConflictError

KINDS = ("personal", "experience", "project", "skill", "achievement", "education", "certification")
VERIFICATION = ("verified", "unverified", "needs_review")
PROJECT_STATUSES = ("planning", "in_development", "completed", "maintained", "archived")
FUNCTIONAL_STATUSES = ("not_verified", "working", "partial", "not_working")
SKILL_CATEGORIES = ("languages", "frameworks", "backend", "databases", "cloud", "devops", "testing",
                    "architecture_security", "domain", "other")
EMPLOYMENT_TYPES = ("", "full_time", "part_time", "contract", "internship", "freelance", "other")
LINK_FIELDS = ("live_url", "repo_url", "docs_url")
LIMITS = {"text": 200, "long": 3000, "line": 600, "lines": 30, "list": 60, "ids": 40}
MAX_ITEMS = 400
MAX_EVIDENCE_CHARS = 14000

# Field types: text, long, url, lines (list of strings), list (short tags), claims (achievement bullets
# with their own verified flag and evidence note), ids (references to other profile items), bool, or a choice tuple.
FIELDS = {
    "personal": {"name": "text", "headline": "text", "email": "text", "phone": "text", "location": "text", "website": "url",
                 "github": "url", "linkedin": "url", "summary": "long", "preferred_roles": "list"},
    "experience": {"company": "text", "title": "text", "start": "text", "end": "text", "employment_type": EMPLOYMENT_TYPES,
                   "location": "text", "summary": "long", "responsibilities": "lines", "technologies": "list",
                   "achievements": "claims", "project_ids": "ids"},
    "project": {"name": "text", "summary": "text", "description": "long", "category": "text", "role": "long", "technologies": "list",
                "architecture": "long", "features": "lines", "challenges": "long", "deployment": "text", "repo_url": "url",
                "live_url": "url", "docs_url": "url", "start": "text", "end": "text", "status": PROJECT_STATUSES,
                "resume_ready": "bool", "achievements": "claims", "evidence": "long", "functional_status": FUNCTIONAL_STATUSES,
                "functional_checked_at": "text", "experience_id": "ids"},
    "skill": {"name": "text", "category": SKILL_CATEGORIES, "evidence_ids": "ids", "notes": "text"},
    "achievement": {"text": "long", "date": "text", "evidence": "long", "related_ids": "ids"},
    "education": {"institution": "text", "degree": "text", "field": "text", "start": "text", "end": "text", "details": "long"},
    "certification": {"name": "text", "issuer": "text", "date": "text", "url": "url", "credential_id": "text"},
}
REQUIRED = {"experience": ("company", "title"), "project": ("name",), "skill": ("name",), "achievement": ("text",),
            "education": ("institution",), "certification": ("name",)}
LABELS = {"experience": "Experience", "project": "Project", "skill": "Skill", "achievement": "Achievement",
          "education": "Education", "certification": "Certification", "personal": "Personal details"}


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def init_schema(db):
    db.execute("""CREATE TABLE IF NOT EXISTS profile_items (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, data_json TEXT NOT NULL, verification TEXT NOT NULL DEFAULT 'unverified',
      archived INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS profile_items_kind ON profile_items(kind, archived, position)")
    db.execute("""CREATE TABLE IF NOT EXISTS profile_link_checks (
      item_id TEXT NOT NULL, field TEXT NOT NULL, url TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER NOT NULL DEFAULT 0,
      final_url TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', checked_at TEXT NOT NULL,
      PRIMARY KEY(item_id, field)
    )""")


# ---------------------------------------------------------------- validation

def _text(value, limit):
    return resume_model.clean_text(value, limit)


def _url(value):
    value = _text(value, 500)
    if not value:
        return ""
    if re.match(r"^[a-z][a-z0-9+.-]*:(?!\d)", value, re.I) and not re.match(r"^https?://", value, re.I):
        raise ValueError(f"Enter a valid http(s) link: {value[:80]}")
    if not re.match(r"^https?://", value, re.I):
        value = "https://" + value
    if not re.fullmatch(r"https?://[^\s<>\"']+", value, re.I) or "@" in value.split("/")[2]:
        raise ValueError(f"Enter a valid http(s) link: {value[:80]}")
    return value


def _lines(value, limit=LIMITS["line"], count=LIMITS["lines"]):
    values = value if isinstance(value, list) else str(value or "").splitlines()
    result = []
    for line in values:
        line = _text(re.sub(r"^\s*[-•*▪◦]\s*", "", str(line)), limit)
        if line and line not in result:
            result.append(line)
    return result[:count]


def _tags(value):
    values = value if isinstance(value, list) else re.split(r"[,\n]", str(value or ""))
    result = []
    for tag in values:
        tag = _text(tag, 80)
        if tag and tag.lower() not in {item.lower() for item in result}:
            result.append(tag)
    return result[:LIMITS["list"]]


def _claims(value, existing=()):
    known = {item.get("id"): item for item in existing if isinstance(item, dict)}
    result = []
    for raw in value if isinstance(value, list) else []:
        if isinstance(raw, str):
            raw = {"text": raw}
        if not isinstance(raw, dict):
            continue
        text = _text(raw.get("text"), LIMITS["line"])
        if not text:
            continue
        claim_id = raw.get("id") if isinstance(raw.get("id"), str) and re.fullmatch(r"c_[A-Za-z0-9]{8,24}", raw.get("id", "")) else ""
        claim_id = claim_id or "c_" + uuid.uuid4().hex[:12]
        result.append({"id": claim_id, "text": text, "verified": bool(raw.get("verified", known.get(claim_id, {}).get("verified", False))),
                       "evidence": _text(raw.get("evidence"), LIMITS["line"])})
    return result[:LIMITS["lines"]]


def _ids(value):
    values = value if isinstance(value, list) else [value] if value else []
    return [item for item in dict.fromkeys(str(v) for v in values) if re.fullmatch(r"[a-f0-9-]{36}", item)][:LIMITS["ids"]]


def clean(kind: str, data: dict, existing: dict | None = None) -> dict:
    """Validate one item's fields for its kind. Unknown fields are dropped."""
    if kind not in FIELDS:
        raise ValueError("Unknown profile section.")
    if not isinstance(data, dict):
        raise ValueError("Profile data must be an object.")
    existing = existing or {}
    result = {}
    for field, kind_of in FIELDS[kind].items():
        value = data.get(field, existing.get(field))
        if isinstance(kind_of, tuple):
            result[field] = value if value in kind_of else kind_of[0]
        elif kind_of == "text":
            result[field] = _text(value, LIMITS["text"])
        elif kind_of == "long":
            result[field] = _text(value, LIMITS["long"])
        elif kind_of == "url":
            result[field] = _url(value)
        elif kind_of == "lines":
            result[field] = _lines(value)
        elif kind_of == "list":
            result[field] = _tags(value)
        elif kind_of == "claims":
            result[field] = _claims(value, existing.get(field, []))
        elif kind_of == "ids":
            result[field] = _ids(value)
        elif kind_of == "bool":
            # Projects are usable in resumes unless the user says otherwise.
            result[field] = (field == "resume_ready") if value is None else bool(value)
    for field in REQUIRED.get(kind, ()):
        if not result.get(field):
            raise ValueError(f"{LABELS[kind]}: {field.replace('_', ' ')} is required.")
    return result


def label_for(kind: str, data: dict) -> str:
    if kind == "experience":
        return " — ".join(filter(None, [data.get("title"), data.get("company")]))
    if kind == "education":
        return " — ".join(filter(None, [data.get("degree"), data.get("institution")]))
    if kind == "achievement":
        return data.get("text", "")[:80]
    return data.get("name") or LABELS.get(kind, kind)


# ---------------------------------------------------------------- reading

def public_item(row) -> dict:
    data = json.loads(row["data_json"])
    return {"id": row["id"], "kind": row["kind"], "data": data, "label": label_for(row["kind"], data),
            "verification": row["verification"], "archived": bool(row["archived"]), "revision": row["revision"],
            "source": row["source"], "created_at": row["created_at"], "updated_at": row["updated_at"]}


def _row(db, item_id):
    return db.execute("SELECT * FROM profile_items WHERE id=?", (item_id,)).fetchone()


def get_item(db, item_id):
    row = _row(db, item_id)
    return public_item(row) if row else None


def personal(db) -> dict:
    row = db.execute("SELECT * FROM profile_items WHERE kind='personal' LIMIT 1").fetchone()
    if row:
        return public_item(row)
    return {"id": "", "kind": "personal", "data": clean("personal", {}), "label": LABELS["personal"], "verification": "verified",
            "archived": False, "revision": 0, "source": "manual", "created_at": "", "updated_at": ""}


def link_checks(db) -> dict:
    result = {}
    for row in db.execute("SELECT * FROM profile_link_checks"):
        result.setdefault(row["item_id"], {})[row["field"]] = {key: row[key] for key in ("url", "status", "http_status", "final_url", "detail", "checked_at")}
    return result


def project_usage(db) -> dict:
    """Which saved resumes already contain each profile project (matched by name), for the project cards."""
    projects = {item["id"]: _fold(item["data"]["name"]) for item in items(db, "project")}
    usage = {item_id: [] for item_id in projects}
    if not projects:
        return usage
    rows = db.execute("""SELECT r.id,r.name,COALESCE(NULLIF(d.content_json,''),rv.content_json,'') AS content_json FROM resumes r
                         LEFT JOIN resume_drafts d ON d.resume_id=r.id LEFT JOIN resume_versions rv ON rv.id=r.current_version_id
                         WHERE r.deleted_at=''""")
    for row in rows:
        if not row["content_json"]:
            continue
        names = {_fold(project.get("name", "")) for project in json.loads(row["content_json"]).get("projects", [])}
        for item_id, name in projects.items():
            if name and name in names:
                usage[item_id].append({"resume_id": row["id"], "name": row["name"]})
    return usage


def items(db, kind=None, include_archived=True) -> list:
    query = "SELECT * FROM profile_items WHERE kind<>'personal'" + (" AND kind=?" if kind else "") + ("" if include_archived else " AND archived=0")
    query += " ORDER BY kind, position, created_at"
    return [public_item(row) for row in db.execute(query, (kind,) if kind else ())]


def get_profile(db) -> dict:
    all_items = items(db)
    return {"personal": personal(db), "items": all_items, "link_checks": link_checks(db), "project_usage": project_usage(db),
            "counts": {kind: sum(1 for item in all_items if item["kind"] == kind and not item["archived"]) for kind in KINDS if kind != "personal"},
            "choices": {"verification": VERIFICATION, "project_status": PROJECT_STATUSES, "functional_status": FUNCTIONAL_STATUSES,
                        "skill_category": SKILL_CATEGORIES, "employment_type": EMPLOYMENT_TYPES}}


# ---------------------------------------------------------------- writing

def _check_revision(row, expected_revision):
    if expected_revision not in (None, "") and int(expected_revision) != row["revision"]:
        raise ConflictError("This profile entry changed in another window. Reload it before saving.")


def save_personal(db, data: dict, expected_revision=None) -> dict:
    row = db.execute("SELECT * FROM profile_items WHERE kind='personal' LIMIT 1").fetchone()
    if row:
        _check_revision(row, expected_revision)
        cleaned = clean("personal", data, json.loads(row["data_json"]))
        db.execute("UPDATE profile_items SET data_json=?,revision=revision+1,updated_at=? WHERE id=?",
                   (json.dumps(cleaned, ensure_ascii=False), now_iso(), row["id"]))
        return get_item(db, row["id"])
    return create_item(db, "personal", data, "verified")


def create_item(db, kind: str, data: dict, verification="unverified", source="manual") -> dict:
    if kind == "personal" and db.execute("SELECT 1 FROM profile_items WHERE kind='personal'").fetchone():
        raise ValueError("Personal details already exist; update them instead.")
    if db.execute("SELECT COUNT(*) FROM profile_items").fetchone()[0] >= MAX_ITEMS:
        raise ValueError(f"The profile holds at most {MAX_ITEMS} entries. Archive or delete some first.")
    cleaned = clean(kind, data)
    if kind == "project" and cleaned["functional_status"] != "not_verified":
        cleaned["functional_checked_at"] = now_iso()
    item_id = str(uuid.uuid4())
    stamp = now_iso()
    position = db.execute("SELECT COALESCE(MAX(position),0)+1 FROM profile_items WHERE kind=?", (kind,)).fetchone()[0]
    db.execute("""INSERT INTO profile_items(id,kind,data_json,verification,position,source,created_at,updated_at)
                  VALUES(?,?,?,?,?,?,?,?)""",
               (item_id, kind, json.dumps(cleaned, ensure_ascii=False), verification if verification in VERIFICATION else "unverified",
                position, source, stamp, stamp))
    return get_item(db, item_id)


def update_item(db, item_id: str, changes: dict) -> dict:
    row = _row(db, item_id)
    if not row or row["kind"] == "personal":
        raise ValueError("Profile entry not found.")
    _check_revision(row, changes.get("expected_revision"))
    before = json.loads(row["data_json"])
    data = clean(row["kind"], changes["data"], before) if isinstance(changes.get("data"), dict) else before
    if row["kind"] == "project" and data.get("functional_status") != before.get("functional_status"):
        # The date of the user's own functional check; link reachability is tracked separately.
        data["functional_checked_at"] = now_iso() if data["functional_status"] != "not_verified" else ""
    verification = changes.get("verification", row["verification"])
    if verification not in VERIFICATION:
        raise ValueError("Choose verified, unverified, or needs review.")
    archived = int(bool(changes["archived"])) if "archived" in changes else row["archived"]
    db.execute("UPDATE profile_items SET data_json=?,verification=?,archived=?,revision=revision+1,updated_at=? WHERE id=?",
               (json.dumps(data, ensure_ascii=False), verification, archived, now_iso(), item_id))
    if row["kind"] == "project":
        for field in LINK_FIELDS:
            if data.get(field) != before.get(field):
                db.execute("DELETE FROM profile_link_checks WHERE item_id=? AND field=?", (item_id, field))
    return get_item(db, item_id)


def delete_item(db, item_id: str):
    row = _row(db, item_id)
    if not row or row["kind"] == "personal":
        raise ValueError("Profile entry not found.")
    db.execute("DELETE FROM profile_items WHERE id=?", (item_id,))
    db.execute("DELETE FROM profile_link_checks WHERE item_id=?", (item_id,))
    # Drop references from skills, experience, and achievements; nothing else depends on profile items.
    for other in db.execute("SELECT id,data_json FROM profile_items WHERE kind<>'personal'").fetchall():
        data = json.loads(other["data_json"])
        changed = False
        for field in ("evidence_ids", "project_ids", "related_ids", "experience_id"):
            if item_id in data.get(field, []):
                data[field] = [value for value in data[field] if value != item_id]
                changed = True
        if changed:
            db.execute("UPDATE profile_items SET data_json=?,revision=revision+1,updated_at=? WHERE id=?",
                       (json.dumps(data, ensure_ascii=False), now_iso(), other["id"]))


def save_link_check(db, item_id: str, field: str, result: dict):
    db.execute("""INSERT INTO profile_link_checks(item_id,field,url,status,http_status,final_url,detail,checked_at) VALUES(?,?,?,?,?,?,?,?)
                  ON CONFLICT(item_id,field) DO UPDATE SET url=excluded.url,status=excluded.status,http_status=excluded.http_status,
                  final_url=excluded.final_url,detail=excluded.detail,checked_at=excluded.checked_at""",
               (item_id, field, result["url"], result["status"], int(result.get("http_status") or 0), result.get("final_url", ""),
                result.get("detail", ""), result["checked_at"]))


def project_links(db, item_id=None) -> list:
    """[(item_id, field, url)] for one project or every non-archived project."""
    rows = [get_item(db, item_id)] if item_id else items(db, "project", include_archived=False)
    links = []
    for item in rows:
        if not item or item["kind"] != "project":
            raise ValueError("Project not found.")
        for field in LINK_FIELDS:
            if item["data"].get(field):
                links.append((item["id"], field, item["data"][field]))
    return links


# ---------------------------------------------------------------- import from a resume

def _fold(value) -> str:
    return re.sub(r"[^a-z0-9+#]", "", str(value or "").lower())


def resume_content(db, resume_id: str) -> dict:
    """The resume's best structured content: its editor draft, else its current version or a local import."""
    draft = resume_store.get_draft(db, resume_id)
    if draft:
        return draft["content"]
    content, _, _, _ = resume_store.seed_content(db, resume_id)
    return content


def import_from_content(db, content: dict, verified: bool, source: str) -> dict:
    """Merge resume content into the profile without overwriting anything the user already has.

    Personal fields are filled only where empty; entries already present (same company and title,
    project name, skill, institution, or certification) are skipped, so importing twice adds nothing.
    """
    content = resume_model.normalize(content, strict=False)
    verification = "verified" if verified else "unverified"
    added = {kind: 0 for kind in KINDS}
    basics = content["basics"]
    current = personal(db)
    networks = {_fold(profile["network"]): profile["url"] for profile in basics.get("profiles", [])}
    candidates = {"name": basics.get("name"), "headline": basics.get("label"), "email": basics.get("email"), "phone": basics.get("phone"),
                  "location": basics.get("location"), "website": basics.get("url"), "summary": basics.get("summary"),
                  "github": networks.get("github", ""), "linkedin": networks.get("linkedin", "")}
    fill = {key: value for key, value in candidates.items() if value and not current["data"].get(key)}
    if fill:
        save_personal(db, {**current["data"], **fill}, current["revision"] if current["id"] else None)
        added["personal"] = len(fill)
    existing = items(db)
    keys = {(item["kind"], _fold(item["label"])) for item in existing}

    def add(kind, data):
        key = (kind, _fold(label_for(kind, data)))
        if key in keys or not key[1]:
            return None
        keys.add(key)
        added[kind] += 1
        return create_item(db, kind, data, verification, source)

    for work in content.get("work", []):
        if work.get("name") and work.get("position"):
            add("experience", {"company": work["name"], "title": work["position"], "start": work.get("startDate"), "end": work.get("endDate"),
                               "location": work.get("location"), "summary": work.get("summary"),
                               "achievements": [{"text": line["text"], "verified": verified} for line in work.get("highlights", [])]})
    for project in content.get("projects", []):
        if project.get("name"):
            url = project.get("url", "")
            add("project", {"name": project["name"], "description": project.get("description"), "technologies": project.get("keywords", []),
                            "repo_url": url if "github.com" in url or "gitlab.com" in url else "", "live_url": "" if "github.com" in url or "gitlab.com" in url else url,
                            "start": project.get("startDate"), "end": project.get("endDate"), "status": "completed", "resume_ready": True,
                            "achievements": [{"text": line["text"], "verified": verified} for line in project.get("highlights", [])]})
    for group in content.get("skills", []):
        category = _skill_category(group.get("name", ""))
        for keyword in group.get("keywords", []) or [group.get("name")]:
            if keyword:
                add("skill", {"name": keyword, "category": category})
    for school in content.get("education", []):
        if school.get("institution"):
            add("education", {"institution": school["institution"], "degree": school.get("studyType"), "field": school.get("area"),
                              "start": school.get("startDate"), "end": school.get("endDate"), "details": school.get("score")})
    for certificate in content.get("certificates", []):
        if certificate.get("name"):
            add("certification", {"name": certificate["name"], "issuer": certificate.get("issuer"), "date": certificate.get("date"),
                                  "url": certificate.get("url")})
    for award in content.get("awards", []):
        if award.get("title"):
            add("achievement", {"text": " — ".join(filter(None, [award["title"], award.get("awarder"), award.get("summary")])),
                                "date": award.get("date")})
    return added


def _skill_category(group_name: str) -> str:
    name = group_name.lower()
    for words, category in ((("language",), "languages"), (("framework", "librar", "frontend"), "frameworks"),
                            (("backend", "server", "api"), "backend"), (("database", "data", "sql"), "databases"),
                            (("cloud", "aws", "gcp", "azure"), "cloud"), (("devops", "tool", "ci"), "devops"),
                            (("test",), "testing"), (("security", "architecture"), "architecture_security")):
        if any(word in name for word in words):
            return category
    return "other"


# ---------------------------------------------------------------- evidence for analysis and suggestions

def _item_text(item: dict, names: dict) -> str:
    data, kind = item["data"], item["kind"]
    parts = []
    if kind == "experience":
        parts.append(f"{data['title']} at {data['company']}" + (f" ({data['start']} – {data['end'] or 'present'})" if data["start"] else ""))
        parts += [data["summary"], "; ".join(data["responsibilities"]), "Technologies: " + ", ".join(data["technologies"]) if data["technologies"] else ""]
        parts += [claim["text"] + ("" if claim["verified"] else " [unconfirmed]") for claim in data["achievements"]]
    elif kind == "project":
        parts.append(f"Project {data['name']}" + (f" ({data['category']})" if data["category"] else "") + f", status {data['status'].replace('_', ' ')}")
        parts += [data["summary"], data["description"], "Role: " + data["role"] if data["role"] else "",
                  "Technologies: " + ", ".join(data["technologies"]) if data["technologies"] else "",
                  "Architecture: " + data["architecture"] if data["architecture"] else "", "Features: " + "; ".join(data["features"]) if data["features"] else "",
                  "Challenges: " + data["challenges"] if data["challenges"] else "", "Deployment: " + data["deployment"] if data["deployment"] else "",
                  "Evidence: " + data["evidence"] if data["evidence"] else ""]
        parts += [claim["text"] + ("" if claim["verified"] else " [unconfirmed]") for claim in data["achievements"]]
    elif kind == "skill":
        shown = [names[value] for value in data["evidence_ids"] if value in names]
        parts.append(f"Skill {data['name']} ({data['category'].replace('_', ' ')})" + (" — shown in " + ", ".join(shown) if shown else ""))
    elif kind == "achievement":
        parts += [data["text"], "Evidence: " + data["evidence"] if data["evidence"] else ""]
    elif kind == "personal":
        parts += ["Headline: " + data["headline"] if data["headline"] else "", "Summary: " + data["summary"] if data["summary"] else ""]
    elif kind == "education":
        parts.append(" ".join(filter(None, [data["degree"], data["field"], "at", data["institution"], data["end"]])))
    elif kind == "certification":
        parts.append(" ".join(filter(None, ["Certification", data["name"], "from " + data["issuer"] if data["issuer"] else "", data["date"]])))
    return " ".join(part for part in parts if part)[:1500]


def evidence_blocks(db) -> list:
    """Profile evidence for Codex: [{id: 'P1', item_id, kind, label, verified, text}].

    Archived entries and entries marked 'needs review' are left out. Order is stable, so the same
    profile always produces the same blocks (and the same analysis cache key).
    """
    usable = [item for item in items(db, include_archived=False) if item["verification"] != "needs_review"]
    names = {item["id"]: item["label"] for item in usable}
    blocks, total = [], 0
    order = {"personal": -1, "experience": 0, "project": 1, "achievement": 2, "certification": 3, "education": 4, "skill": 5}
    own = personal(db)
    if own["id"]:
        usable.append(own)  # the headline and summary are evidence too (sorted first)
    for item in sorted(usable, key=lambda value: (order.get(value["kind"], 9), value["created_at"], value["id"])):
        text = _item_text(item, names)
        if not text or total + len(text) > MAX_EVIDENCE_CHARS:
            continue
        total += len(text)
        block = {"id": f"P{len(blocks) + 1}", "item_id": item["id"], "kind": item["kind"], "label": item["label"][:120],
                 "verified": item["verification"] == "verified", "text": text}
        if item["kind"] == "project" and item["data"]["resume_ready"]:
            data = item["data"]
            # Fixed facts used when a suggestion adds this project to a resume (never generated by AI).
            block["project"] = {"name": data["name"], "url": data["live_url"] or data["repo_url"], "description": data["summary"],
                                "keywords": data["technologies"][:8], "start": data["start"], "end": data["end"]}
        blocks.append(block)
    return blocks


def verified_corpus(db) -> str:
    """Text of verified profile entries (and their verified achievement bullets): facts AI suggestions may reuse."""
    names = {item["id"]: item["label"] for item in items(db, include_archived=False)}
    texts = []
    for item in items(db, include_archived=False):
        if item["verification"] != "verified":
            continue
        data = dict(item["data"])
        if "achievements" in data:
            data["achievements"] = [claim for claim in data["achievements"] if claim["verified"]]
        texts.append(_item_text({**item, "data": data}, names).replace(" [unconfirmed]", ""))
    personal_data = personal(db)["data"]
    texts.append(" ".join(filter(None, [personal_data.get("headline"), personal_data.get("summary")])))
    return "\n".join(texts)


def evidence_hash(blocks: list) -> str:
    return hashlib.sha256(json.dumps(blocks, sort_keys=True, ensure_ascii=False).encode()).hexdigest() if blocks else ""
