"""Small SQLite database: settings, filings marked done, licences and saved work."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime

from .calendar import DEFAULT_LICENCES

DATA_DIR = os.environ.get("CS_DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data"))
DB_PATH = os.path.join(DATA_DIR, "cs_assistant.db")
PROFILE_SEED = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "company.json")

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS filings (
    key TEXT PRIMARY KEY, item_id TEXT NOT NULL, due TEXT NOT NULL,
    done_on TEXT, srn TEXT, notes TEXT, updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS licences (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, authority TEXT, number TEXT,
    expiry TEXT, owner TEXT, notes TEXT, updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL,
    markdown TEXT NOT NULL, created TEXT NOT NULL
);
"""


@contextmanager
def db():
    os.makedirs(DATA_DIR, exist_ok=True)
    with _lock:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def init() -> None:
    with db() as c:
        c.executescript(SCHEMA)
        if not c.execute("SELECT 1 FROM settings WHERE key='profile'").fetchone():
            with open(PROFILE_SEED, encoding="utf-8") as f:
                c.execute("INSERT INTO settings VALUES ('profile', ?)", (f.read(),))
        if not c.execute("SELECT 1 FROM settings WHERE key='tracking_since'").fetchone():
            # Dates before the tool was first used are not shown as overdue.
            c.execute("INSERT INTO settings VALUES ('tracking_since', ?)", (json.dumps(datetime.now().date().isoformat()),))
        if not c.execute("SELECT 1 FROM licences LIMIT 1").fetchone():
            c.executemany(
                "INSERT INTO licences (name, authority, updated) VALUES (?, ?, ?)",
                [(n, a, _now()) for n, a in DEFAULT_LICENCES],
            )


# ------------------------------------------------------------------ settings
def get_setting(key: str, default=None):
    with db() as c:
        row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def set_setting(key: str, value) -> None:
    with db() as c:
        c.execute("INSERT OR REPLACE INTO settings VALUES (?, ?)", (key, json.dumps(value)))


def get_profile() -> dict:
    return get_setting("profile", {}) or {}


# ------------------------------------------------------------------- filings
def filings_done() -> dict[str, dict]:
    with db() as c:
        rows = c.execute("SELECT * FROM filings WHERE done_on IS NOT NULL").fetchall()
    return {r["key"]: dict(r) for r in rows}


def mark_filing(key: str, item_id: str, due: str, done_on: str | None, srn: str = "", notes: str = "") -> None:
    with db() as c:
        c.execute(
            "INSERT OR REPLACE INTO filings (key, item_id, due, done_on, srn, notes, updated) VALUES (?,?,?,?,?,?,?)",
            (key, item_id, due, done_on, srn, notes, _now()),
        )


# ------------------------------------------------------------------ licences
def list_licences() -> list[dict]:
    with db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM licences ORDER BY (expiry IS NULL), expiry, name")]


def save_licence(data: dict) -> int:
    fields = ("name", "authority", "number", "expiry", "owner", "notes")
    vals = [str(data.get(f) or "").strip() or None for f in fields]
    if not vals[0]:
        raise ValueError("Please give the licence a name.")
    with db() as c:
        if data.get("id"):
            c.execute(
                "UPDATE licences SET name=?, authority=?, number=?, expiry=?, owner=?, notes=?, updated=? WHERE id=?",
                (*vals, _now(), int(data["id"])),
            )
            return int(data["id"])
        cur = c.execute(
            "INSERT INTO licences (name, authority, number, expiry, owner, notes, updated) VALUES (?,?,?,?,?,?,?)",
            (*vals, _now()),
        )
        return int(cur.lastrowid)


def delete_licence(lic_id: int) -> None:
    with db() as c:
        c.execute("DELETE FROM licences WHERE id=?", (lic_id,))


# ---------------------------------------------------------------- saved work
def save_work(kind: str, title: str, markdown: str) -> int:
    with db() as c:
        cur = c.execute("INSERT INTO work (kind, title, markdown, created) VALUES (?,?,?,?)",
                        (kind, title[:200], markdown, _now()))
        return int(cur.lastrowid)


def list_work(limit: int = 50) -> list[dict]:
    with db() as c:
        rows = c.execute("SELECT id, kind, title, created FROM work ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]


def get_work(work_id: int) -> dict | None:
    with db() as c:
        row = c.execute("SELECT * FROM work WHERE id=?", (work_id,)).fetchone()
    return dict(row) if row else None


def delete_work(work_id: int) -> None:
    with db() as c:
        c.execute("DELETE FROM work WHERE id=?", (work_id,))
