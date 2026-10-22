"""Application-changed notifications.

Domain modules (resumes, applications, gmail, delivery, the ATS worker) report that an
application changed; the app registers Notion sync as the listener at startup. This keeps
the domain modules independent of Notion and avoids an import cycle between resumes and
applications. Tests run with no listeners, so nothing is synced.
"""
from __future__ import annotations

_listeners = []


def on_application_changed(listener) -> None:
    _listeners.append(listener)


def clear_listeners() -> None:
    _listeners.clear()


def application_changed(entry_id: str) -> None:
    for listener in list(_listeners):
        listener(entry_id)
