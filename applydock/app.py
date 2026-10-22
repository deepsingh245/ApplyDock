"""Startup: load settings, migrate the database, start background workers, and serve HTTP."""
from __future__ import annotations

import http.server
import threading

from . import ats, config, database, delivery, events, http_server, notion, resume_store


def prepare():
    """Load settings and bring the database up to date. Safe to call more than once."""
    config.load_settings()
    database.backup_before_migration()
    database.init_db()


def start_workers():
    events.on_application_changed(notion.sync_entry)
    threading.Thread(target=delivery.scheduler, daemon=True).start()
    threading.Thread(target=ats.worker, args=(config.DB, config.DATA, config.SCHEMA_DIR, events.application_changed), daemon=True).start()
    threading.Thread(target=resume_store.job_worker, args=(config.DB, config.DATA, config.SCHEMA_DIR), daemon=True).start()


def create_server(port=None):
    return http.server.ThreadingHTTPServer((config.HOST, config.PORT if port is None else port), http_server.Handler)


def main():
    prepare()
    try:
        server = create_server()
    except OSError as error:
        if getattr(error, "winerror", None) == 10048 or getattr(error, "errno", None) in (48, 98, 10048):
            print(f"ApplyDock could not start because port {config.PORT} is already in use.", flush=True)
            print("Close the other ApplyDock helper window, then run start.cmd again.", flush=True)
            return
        raise
    start_workers()
    print(f"Local dashboard: http://{config.HOST}:{config.PORT}/", flush=True)
    print(f"Pairing key: {config.SETTINGS['pairing_key']}", flush=True)
    print("Keep this window open for the 9 AM sender. The computer must be awake and connected.", flush=True)
    server.serve_forever()
