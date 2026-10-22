"""Paths, constants, local settings, and Windows-protected secrets.

Importing this module has no side effects: nothing is read from or written to disk until
`load_settings()` runs at startup. Other modules must read values as attributes
(`config.DATA`, `config.SETTINGS`) rather than `from config import ...`, so tests and the
sandbox can point the whole app at a temporary folder.
"""
from __future__ import annotations

import base64
import ctypes
import datetime as dt
import json
import os
from pathlib import Path
import re
import secrets

ROOT = Path(__file__).resolve().parent.parent          # repository root (dashboard/, extension/)
PACKAGE = Path(__file__).resolve().parent
SCHEMA_DIR = PACKAGE / "schemas"                        # Codex structured-output schemas
DASHBOARD_DIR = ROOT / "dashboard"
# APPLYDOCK_DATA_DIR / APPLYDOCK_PORT let tests and sandboxes run without touching your real data.
DATA = Path(os.environ.get("APPLYDOCK_DATA_DIR") or ROOT / "data")
DB = DATA / "capture.sqlite3"
CONFIG = DATA / "config.json"
HOST = "127.0.0.1"
PORT = int(os.environ.get("APPLYDOCK_PORT") or 8765)

MAX_REQUEST_BYTES = 12_000_000     # JSON bodies; uploads arrive base64-encoded inside them
MAX_RESUME_BYTES = 8_000_000
EMAIL_PATTERN = re.compile(r"(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![A-Z0-9_-])", re.I)

# Local settings from data/config.json: pairing key, integration tokens (DPAPI-protected),
# Notion mapping, profile. Filled by load_settings(); tests replace it with a plain dict.
SETTINGS: dict = {}


def set_data_dir(path: Path) -> None:
    global DATA, DB, CONFIG
    DATA = Path(path)
    DB = DATA / "capture.sqlite3"
    CONFIG = DATA / "config.json"


def save_config(settings):
    tmp = CONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    os.replace(tmp, CONFIG)


def load_config():
    if CONFIG.exists():
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    settings = {"pairing_key": secrets.token_urlsafe(32), "notion_data_source_id": "", "smtp": {}}
    save_config(settings)
    return settings


def load_settings() -> dict:
    """Create the data folder if needed and load settings in place (other modules keep the same dict)."""
    DATA.mkdir(parents=True, exist_ok=True)
    SETTINGS.clear()
    SETTINGS.update(load_config())
    return SETTINGS


def protect(value):
    """Encrypt for the current Windows account; never persist a cleartext password."""
    if os.name != "nt":
        raise RuntimeError("Secret storage currently requires Windows DPAPI.")
    return base64.b64encode(_dpapi(value.encode("utf-8"), decrypt=False)).decode("ascii")


def unprotect(blob):
    if not blob:
        return ""
    if os.name != "nt":
        raise RuntimeError("Secret storage currently requires Windows DPAPI.")
    return _dpapi(base64.b64decode(blob), decrypt=True).decode("utf-8")


def _dpapi(raw, decrypt):
    class Blob(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ulong), ("data", ctypes.POINTER(ctypes.c_ubyte))]
    source = ctypes.create_string_buffer(raw)
    input_blob = Blob(len(raw), ctypes.cast(source, ctypes.POINTER(ctypes.c_ubyte)))
    output_blob = Blob()
    fn = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(Blob)]
    fn.restype = ctypes.c_bool
    if not fn(ctypes.byref(input_blob), None, None, None, None, 0, ctypes.byref(output_blob)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output_blob.data, output_blob.length)
    finally:
        free = ctypes.windll.kernel32.LocalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        free(output_blob.data)


def now_iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def tomorrow_nine():
    local = dt.datetime.now().astimezone()
    day = local.date() + dt.timedelta(days=1)
    return dt.datetime.combine(day, dt.time(9), tzinfo=local.tzinfo).astimezone(dt.timezone.utc).isoformat()
