"""Shared test setup: run the whole app against a temporary data folder, never the real data/."""
import gc
from pathlib import Path
import tempfile
from unittest.mock import patch

from applydock import config, database, events

TEST_SETTINGS = {"pairing_key": "test", "notion_data_source_id": "", "smtp": {"password": "encrypted"}, "smtp_verified": True}


def isolate_app(test, settings=None):
    """Point config at a fresh temp folder, use in-memory settings, and create the schema.

    Returns the temp folder. Everything is restored when the test finishes.
    """
    scratch = config.ROOT / ".tmp"
    scratch.mkdir(exist_ok=True)
    tmp = tempfile.TemporaryDirectory(prefix="applydock-test-", dir=scratch)
    test.addCleanup(tmp.cleanup)
    test.addCleanup(gc.collect)  # release sqlite handles before Windows deletes the folder
    root = Path(tmp.name)
    for name, value in (("DATA", root), ("DB", root / "test.sqlite3"), ("CONFIG", root / "config.json"),
                        ("SETTINGS", dict(settings if settings is not None else TEST_SETTINGS))):
        patcher = patch.object(config, name, value)
        patcher.start()
        test.addCleanup(patcher.stop)
    events.clear_listeners()  # no Notion sync from tests
    database.init_db()
    return root
