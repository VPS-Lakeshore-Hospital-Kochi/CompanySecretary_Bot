"""Small SQLite database: settings, filings marked done, licences, users and the activity log."""

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
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
    active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, last_login TEXT
);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, username TEXT, action TEXT NOT NULL, detail TEXT
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
        cols = {r["name"] for r in c.execute("PRAGMA table_info(filings)")}
        if "done_by" not in cols:
            c.execute("ALTER TABLE filings ADD COLUMN done_by TEXT")
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


def mark_filing(key: str, item_id: str, due: str, done_on: str | None, srn: str = "", notes: str = "",
                user: str = "") -> None:
    with db() as c:
        c.execute(
            "INSERT OR REPLACE INTO filings (key, item_id, due, done_on, srn, notes, updated, done_by) VALUES (?,?,?,?,?,?,?,?)",
            (key, item_id, due, done_on, srn, notes, _now(), user or None),
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


# --------------------------------------------------------------------- users
USER_FIELDS = "id, username, full_name, role, active, created, last_login"


def user_count() -> int:
    with db() as c:
        return int(c.execute("SELECT COUNT(*) FROM users").fetchone()[0])


def list_users() -> list[dict]:
    with db() as c:
        return [dict(r) for r in c.execute(f"SELECT {USER_FIELDS} FROM users ORDER BY full_name")]


def get_user(user_id: int) -> dict | None:
    with db() as c:
        r = c.execute(f"SELECT {USER_FIELDS} FROM users WHERE id=?", (user_id,)).fetchone()
    return dict(r) if r else None


def user_with_hash(username: str) -> dict | None:
    with db() as c:
        r = c.execute("SELECT * FROM users WHERE username=?", (username.strip(),)).fetchone()
    return dict(r) if r else None


def create_user(username: str, full_name: str, password_hash: str, role: str = "member") -> int:
    with db() as c:
        try:
            cur = c.execute("INSERT INTO users (username, full_name, password_hash, role, created) VALUES (?,?,?,?,?)",
                            (username.strip(), full_name.strip(), password_hash, role, _now()))
        except sqlite3.IntegrityError as e:
            raise ValueError("That username is already taken.") from e
        return int(cur.lastrowid)


def update_user(user_id: int, **fields) -> None:
    allowed = {k: v for k, v in fields.items() if k in ("full_name", "role", "active", "password_hash", "last_login")}
    if not allowed:
        return
    with db() as c:
        c.execute(f"UPDATE users SET {', '.join(f'{k}=?' for k in allowed)} WHERE id=?", (*allowed.values(), user_id))


def active_admins() -> int:
    with db() as c:
        return int(c.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1").fetchone()[0])


# ---------------------------------------------------------------- activity log
def log(username: str, action: str, detail: str = "") -> None:
    with db() as c:
        c.execute("INSERT INTO audit (at, username, action, detail) VALUES (?,?,?,?)", (_now(), username, action, detail[:500]))


def recent_activity(limit: int = 200) -> list[dict]:
    with db() as c:
        return [dict(r) for r in c.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,))]


# ------------------------------------------------------------------- backup
def backup_database(dest_path: str) -> None:
    """Consistent copy of the live database (safe while the site is in use)."""
    with _lock:
        src = sqlite3.connect(DB_PATH)
        dst = sqlite3.connect(dest_path)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
