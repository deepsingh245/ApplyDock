"""Pure scheduling rules for assisted WhatsApp outreach: time-slot distribution and the status machine.

No database or HTTP here, so every rule is deterministic and unit-testable. Times are computed in the
user's timezone and returned as UTC ISO strings.
"""
from __future__ import annotations

import datetime as dt
import re

DEFAULT_TIMEZONE = "Asia/Kolkata"
# A fixed offset avoids needing the tzdata package on Windows. India has no daylight saving.
_NAMED_OFFSETS = {"Asia/Kolkata": 330, "UTC": 0}

STATUSES = ["draft", "scheduled", "ready", "opened", "awaiting_confirmation", "sent", "skipped", "failed", "cancelled"]
ACTIVE = ["scheduled", "ready", "opened", "awaiting_confirmation"]
_OPEN_OUTCOMES = ["ready", "opened", "awaiting_confirmation", "sent", "skipped", "failed", "cancelled"]
TRANSITIONS = {
    "draft": ["scheduled", "cancelled"],
    "scheduled": ["scheduled", "draft", *_OPEN_OUTCOMES],
    "ready": ["scheduled", "draft", *_OPEN_OUTCOMES],
    "opened": ["scheduled", "awaiting_confirmation", "sent", "skipped", "failed", "cancelled"],
    "awaiting_confirmation": ["scheduled", "sent", "skipped", "failed", "cancelled"],
    "failed": ["scheduled", "cancelled"],
    "skipped": ["scheduled"],
    "sent": [],
    "cancelled": [],
}


def can_transition(current, target):
    return target in TRANSITIONS.get(current, [])


def parse_timezone(name):
    name = str(name or DEFAULT_TIMEZONE).strip()
    if name in _NAMED_OFFSETS:
        return dt.timezone(dt.timedelta(minutes=_NAMED_OFFSETS[name]))
    match = re.fullmatch(r"([+-])(\d{2}):?(\d{2})", name)
    if not match:
        raise ValueError("Unsupported timezone. Use Asia/Kolkata, UTC or an offset such as +05:30.")
    minutes = int(match.group(2)) * 60 + int(match.group(3))
    return dt.timezone(dt.timedelta(minutes=minutes if match.group(1) == "+" else -minutes))


def _at(day, clock, zone):
    try:
        hour, minute = (int(part) for part in str(clock).split(":")[:2])
        return dt.datetime.combine(day, dt.time(hour, minute), tzinfo=zone)
    except (ValueError, TypeError):
        raise ValueError(f"'{clock}' is not a valid time. Use HH:MM.") from None


def compute_slots(day, start, end, count, mode="even", interval_minutes=None, manual_times=None,
                  max_per_window=None, skip_weekends=False, tz=DEFAULT_TIMEZONE):
    """Spread `count` messages inside [start, end] on `day`.

    Returns {"slots": [UTC ISO...], "overflow": n}. `overflow` is how many recipients did not get a slot.
    """
    zone = parse_timezone(tz)
    try:
        date = dt.date.fromisoformat(str(day))
    except ValueError:
        raise ValueError("Choose a valid date.") from None
    if skip_weekends and date.weekday() >= 5:
        raise ValueError("That date is a weekend and weekends are excluded. Pick a working day.")
    window_start, window_end = _at(date, start, zone), _at(date, end, zone)
    if window_end <= window_start:
        raise ValueError("End time must be after start time.")
    count = max(int(count), 0)

    if mode == "even":
        step = (window_end - window_start) / count if count else dt.timedelta(0)
        times = [window_start + step * index for index in range(count)]
        if step >= dt.timedelta(minutes=1):
            times = [value.replace(second=0, microsecond=0) for value in times]
    elif mode == "fixed":
        interval = int(interval_minutes or 0)
        if interval <= 0:
            raise ValueError("Enter an interval of at least 1 minute.")
        times, cursor = [], window_start
        while cursor <= window_end and len(times) < count:
            times.append(cursor)
            cursor += dt.timedelta(minutes=interval)
    elif mode == "manual":
        times = sorted(_at(date, value, zone) for value in (manual_times or []))
        if any(value < window_start or value > window_end for value in times):
            raise ValueError("Every manual time must fall inside the selected window.")
        times = times[:count]
    else:
        raise ValueError("Choose even, fixed or manual distribution.")

    if max_per_window:
        times = times[: max(int(max_per_window), 0)]
    return {"slots": [value.astimezone(dt.timezone.utc).isoformat() for value in times], "overflow": count - len(times)}


def add_working_days(day, count):
    """`day` plus `count` Monday-to-Friday days (weekends are skipped, holidays are not known)."""
    current = day
    while count > 0:
        current += dt.timedelta(days=1)
        if current.weekday() < 5:
            count -= 1
    return current


def render_template(body, values):
    """Fill {{variables}}; returns (text, missing). Unknown or empty variables stay visible and are reported."""
    missing = []

    def fill(match):
        key = match.group(1).lower()
        value = str(values.get(key) or "")
        if value:
            return value
        if key not in missing:
            missing.append(key)
        return match.group(0)

    return re.sub(r"\{\{\s*([a-z_]+)\s*\}\}", fill, str(body or ""), flags=re.I), missing
