"""Board portal: meetings, agenda papers, board packs, attendance and resolutions by circulation.

Two sides use this module:

* the Secretariat (CS team members and administrators) builds each meeting: details, who is
  invited, the agenda items and their papers, then publishes it. They also send resolutions by
  circulation (Sec. 175) and see who has replied, who will attend and who has opened the papers.
* directors (users with the role "director") sign in to a portal that shows only the meetings
  and circular resolutions sent to them. They read the papers, keep private notes, say whether
  they will attend, and approve or dissent on circular resolutions.

Papers are kept on disk under data/board/; everything else is in the main database. Replacing a
paper keeps the old file and marks the item as revised, so directors can see what changed after
the pack went out.
"""

from __future__ import annotations

import io
import json
import mimetypes
import os
import re
import uuid
from datetime import date, datetime, timedelta

from pypdf import PageObject, PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from . import mailer, store

BOARD_DIR = os.path.join(store.DATA_DIR, "board")
MAX_BYTES = 50 * 1024 * 1024
PAPER_TYPES = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".png", ".jpg", ".jpeg"}

BODIES = ["Board of Directors", "Audit Committee", "Nomination and Remuneration Committee", "CSR Committee",
          "Executive Committee", "Other committee"]
MODES = ["In person", "Video conference", "In person, with video conference for those who ask"]
ITEM_KINDS = ["For approval", "For noting", "For information", "For discussion"]
RSVP_CHOICES = {
    "in_person": "Will attend in person",
    "video": "Will attend by video conference",
    "absent": "Cannot attend - please grant leave of absence",
}
VOTES = {
    "for": "I approve",
    "against": "I do not approve (dissent)",
    "abstain": "I abstain",
    "meeting": "I want this decided at a Board meeting",
}

# Sec. 179(3) and Rule 8 of the Companies (Meetings of Board and its Powers) Rules, 2014:
# powers the Board can use only by a resolution passed AT A MEETING (not by circulation).
MEETING_ONLY_MATTERS = [
    "Making calls on shareholders for money unpaid on shares",
    "Authorising buy-back of securities (Sec. 68)",
    "Issuing securities, including debentures, in or outside India",
    "Borrowing money",
    "Investing the company's funds",
    "Granting loans, giving guarantees or providing security for loans",
    "Approving financial statements and the Board's report",
    "Diversifying the business of the company",
    "Approving amalgamation, merger or reconstruction",
    "Taking over a company or acquiring a controlling or substantial stake in another company",
    "Making political contributions",
    "Appointing or removing key managerial personnel",
    "Appointing internal auditors and secretarial auditor",
]
# Matters that may NOT be dealt with at a video-conference meeting were removed from Rule 4 in 2021;
# the CS should confirm the current Rules before relying on that.

CIRCULAR_VERIFY = (
    "Sec. 175: the draft and the papers must go to ALL directors (including interested ones) at their "
    "addresses in India, by hand, post, courier or e-mail - this portal counts as e-mail delivery only if "
    "the director has agreed to receive papers this way. It is passed when approved by a majority of the "
    "directors entitled to vote (interested directors are not counted). If at least one-third of all the "
    "directors ask for it to be decided at a meeting, the Chairperson must put it to a meeting. SS-1 allows "
    "at most 7 days to reply. It must be noted at the next Board meeting and recorded in its minutes."
)
MEETING_VERIFY = (
    "Sec. 173 and SS-1: at least 7 days' written notice to every director, and the agenda papers at least 7 "
    "days before the meeting (shorter notice for urgent business needs at least one independent director "
    "present, or their later ratification). At least four Board meetings a year, with no more than 120 days "
    "between two meetings. For a video-conference meeting keep the roll call, the recording and its safe "
    "custody (Rule 3)."
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS board_meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, title TEXT NOT NULL,
    meeting_date TEXT NOT NULL, start_time TEXT, venue TEXT, mode TEXT, video_link TEXT,
    invitees TEXT NOT NULL DEFAULT '[]', notice_sent_on TEXT, notes TEXT,
    status TEXT NOT NULL DEFAULT 'draft', published_at TEXT,
    created TEXT NOT NULL, created_by TEXT, updated TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS board_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL, seq INTEGER NOT NULL,
    title TEXT NOT NULL, kind TEXT, presenter TEXT, summary TEXT, resolution TEXT,
    withheld_from TEXT NOT NULL DEFAULT '[]',
    paper_name TEXT, paper_stored TEXT, paper_mime TEXT, paper_size INTEGER, paper_updated TEXT,
    paper_versions TEXT NOT NULL DEFAULT '[]', updated TEXT NOT NULL, updated_by TEXT
);
CREATE INDEX IF NOT EXISTS board_items_meeting ON board_items (meeting_id);
CREATE TABLE IF NOT EXISTS board_rsvps (
    meeting_id INTEGER NOT NULL, user_id INTEGER NOT NULL, response TEXT NOT NULL, note TEXT, at TEXT NOT NULL,
    PRIMARY KEY (meeting_id, user_id)
);
CREATE TABLE IF NOT EXISTS board_views (
    item_id INTEGER NOT NULL, user_id INTEGER NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL,
    times INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (item_id, user_id)
);
CREATE TABLE IF NOT EXISTS board_notes (
    item_id INTEGER NOT NULL, user_id INTEGER NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL,
    PRIMARY KEY (item_id, user_id)
);
CREATE TABLE IF NOT EXISTS board_circulars (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, resolution TEXT NOT NULL, explanation TEXT,
    recipients TEXT NOT NULL DEFAULT '[]', interested TEXT NOT NULL DEFAULT '[]',
    respond_by TEXT, status TEXT NOT NULL DEFAULT 'draft', circulated_at TEXT, closed_at TEXT, outcome TEXT,
    noted_meeting_id INTEGER, paper_name TEXT, paper_stored TEXT, paper_mime TEXT,
    created TEXT NOT NULL, created_by TEXT, updated TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS board_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, ref_type TEXT NOT NULL,
    ref_id INTEGER NOT NULL, user_id INTEGER, address TEXT, subject TEXT, error TEXT, sent_by TEXT
);
CREATE INDEX IF NOT EXISTS board_emails_ref ON board_emails (ref_type, ref_id);
CREATE TABLE IF NOT EXISTS board_votes (
    circular_id INTEGER NOT NULL, user_id INTEGER NOT NULL, vote TEXT NOT NULL, comment TEXT, at TEXT NOT NULL,
    PRIMARY KEY (circular_id, user_id)
);
"""


class BoardError(ValueError):
    pass


def init() -> None:
    os.makedirs(BOARD_DIR, exist_ok=True)
    with store.db() as c:
        c.executescript(SCHEMA)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _stamp() -> str:
    """Finer time for publishing and paper changes, so a paper replaced just after publishing counts as revised."""
    return datetime.now().isoformat(timespec="microseconds")


def _ids(v) -> list[int]:
    if isinstance(v, str):
        try:
            v = json.loads(v or "[]")
        except ValueError:
            v = []
    out = []
    for x in v or []:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return sorted(set(out))


def _text(v, limit: int = 20000) -> str:
    return str(v or "").strip()[:limit]


def _date(v, label: str, required: bool = False) -> str | None:
    v = _text(v, 20)
    if not v:
        if required:
            raise BoardError(f"Please enter {label}.")
        return None
    try:
        return date.fromisoformat(v).isoformat()
    except ValueError:
        raise BoardError(f"{label[0].upper() + label[1:]} is not a valid date.") from None


# ------------------------------------------------------------------ directors
def directors(active_only: bool = True) -> list[dict]:
    with store.db() as c:
        q = "SELECT id, username, full_name, active FROM users WHERE role='director'"
        if active_only:
            q += " AND active=1"
        return [dict(r) for r in c.execute(q + " ORDER BY full_name")]


def _names() -> dict[int, str]:
    with store.db() as c:
        return {r["id"]: r["full_name"] for r in c.execute("SELECT id, full_name FROM users")}


# ------------------------------------------------------------------- files
def _store_file(folder: str, filename: str, data: bytes) -> tuple[str, str, str, int]:
    name = os.path.basename((filename or "paper").replace("\\", "/"))[:150] or "paper"
    ext = os.path.splitext(name)[1].lower()
    if ext not in PAPER_TYPES:
        raise BoardError(f"{name}: please upload a PDF, Word, Excel, PowerPoint or picture file.")
    if not data:
        raise BoardError(f"{name} is empty.")
    if len(data) > MAX_BYTES:
        raise BoardError(f"{name} is larger than 50 MB.")
    if ext == ".pdf" and not data.startswith(b"%PDF"):
        raise BoardError(f"{name} does not look like a PDF file.")
    path = os.path.join(BOARD_DIR, folder)
    os.makedirs(path, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(path, stored), "wb") as f:
        f.write(data)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    return name, os.path.join(folder, stored), mime, len(data)


def file_path(stored: str | None) -> str | None:
    if not stored:
        return None
    full = os.path.normpath(os.path.join(BOARD_DIR, stored))
    if not full.startswith(os.path.normpath(BOARD_DIR) + os.sep) or not os.path.exists(full):
        return None
    return full


# ------------------------------------------------------------------ meetings
MEETING_FIELDS = ("body", "title", "meeting_date", "start_time", "venue", "mode", "video_link", "notice_sent_on", "notes")


def save_meeting(data: dict, user: str, meeting_id: int | None = None) -> int:
    clean = {
        "body": _text(data.get("body"), 200) or BODIES[0],
        "title": _text(data.get("title"), 300),
        "meeting_date": _date(data.get("meeting_date"), "the date of the meeting", required=True),
        "start_time": _text(data.get("start_time"), 20),
        "venue": _text(data.get("venue"), 500),
        "mode": _text(data.get("mode"), 200) or MODES[0],
        "video_link": _text(data.get("video_link"), 1000),
        "notice_sent_on": _date(data.get("notice_sent_on"), "the date the notice was sent"),
        "notes": _text(data.get("notes")),
    }
    if not clean["title"]:
        raise BoardError("Please give the meeting a name, e.g. 143rd Board Meeting.")
    if clean["video_link"] and not re.match(r"^https://", clean["video_link"]):
        raise BoardError("The video conference link must start with https://")
    invitees = _ids(data.get("invitees"))
    with store.db() as c:
        if meeting_id:
            cur = c.execute(
                f"UPDATE board_meetings SET {', '.join(f'{k}=?' for k in clean)}, invitees=?, updated=?, updated_by=? WHERE id=?",
                (*clean.values(), json.dumps(invitees), _now(), user, meeting_id))
            if not cur.rowcount:
                raise BoardError("That meeting no longer exists.")
            return meeting_id
        cur = c.execute(
            f"INSERT INTO board_meetings ({', '.join(clean)}, invitees, created, created_by, updated, updated_by) "
            f"VALUES ({', '.join('?' for _ in clean)}, ?, ?, ?, ?, ?)",
            (*clean.values(), json.dumps(invitees), _now(), user, _now(), user))
        return int(cur.lastrowid)


def _meeting_row(r) -> dict:
    m = dict(r)
    m["invitees"] = _ids(m["invitees"])
    return m


def get_meeting(meeting_id: int) -> dict | None:
    with store.db() as c:
        r = c.execute("SELECT * FROM board_meetings WHERE id=?", (meeting_id,)).fetchone()
    return _meeting_row(r) if r else None


def list_meetings() -> list[dict]:
    with store.db() as c:
        rows = c.execute("SELECT * FROM board_meetings ORDER BY meeting_date DESC, id DESC").fetchall()
        counts = {r["meeting_id"]: r["n"] for r in c.execute(
            "SELECT meeting_id, COUNT(*) n FROM board_items GROUP BY meeting_id")}
    out = []
    for r in rows:
        m = _meeting_row(r)
        m["item_count"] = counts.get(m["id"], 0)
        out.append(m)
    return out


def set_status(meeting_id: int, status: str, user: str) -> None:
    if status not in ("draft", "published", "held", "cancelled"):
        raise BoardError("Unknown status.")
    m = get_meeting(meeting_id)
    if not m:
        raise BoardError("That meeting no longer exists.")
    if status == "published":
        if not m["invitees"]:
            raise BoardError("Choose who is invited before publishing.")
        if not items(meeting_id):
            raise BoardError("Add at least one agenda item before publishing.")
    with store.db() as c:
        c.execute("UPDATE board_meetings SET status=?, published_at=COALESCE(published_at, ?), updated=?, updated_by=? WHERE id=?",
                  (status, _stamp() if status == "published" else None, _now(), user, meeting_id))


def delete_meeting(meeting_id: int) -> None:
    m = get_meeting(meeting_id)
    if not m:
        return
    if m["status"] != "draft":
        raise BoardError("Only a meeting that has not been published can be deleted. Mark it as cancelled instead.")
    with store.db() as c:
        ids = [r["id"] for r in c.execute("SELECT id FROM board_items WHERE meeting_id=?", (meeting_id,))]
        c.execute("DELETE FROM board_items WHERE meeting_id=?", (meeting_id,))
        c.execute("DELETE FROM board_rsvps WHERE meeting_id=?", (meeting_id,))
        c.executemany("DELETE FROM board_views WHERE item_id=?", [(i,) for i in ids])
        c.executemany("DELETE FROM board_notes WHERE item_id=?", [(i,) for i in ids])
        c.execute("DELETE FROM board_meetings WHERE id=?", (meeting_id,))


def compliance(m: dict, all_meetings: list[dict] | None = None) -> list[dict]:
    """SS-1 / Sec. 173 checks for one meeting: [{level: ok|warn|error, text}]."""
    out = []
    md = date.fromisoformat(m["meeting_date"])
    if m.get("notice_sent_on"):
        gap = (md - date.fromisoformat(m["notice_sent_on"])).days
        out.append({"level": "ok" if gap >= 7 else "warn",
                    "text": f"Notice sent {gap} day{'s' if gap != 1 else ''} before the meeting"
                            + ("." if gap >= 7 else " - less than the 7 days SS-1 asks for. Record why it was urgent, "
                               "and make sure at least one independent director attends (or ratifies).")})
    elif m["status"] != "cancelled":
        out.append({"level": "warn", "text": "Enter the date the notice was sent (at least 7 days before the meeting)."})
    if m.get("published_at"):
        gap = (md - date.fromisoformat(m["published_at"][:10])).days
        out.append({"level": "ok" if gap >= 7 else "warn",
                    "text": f"Papers published {gap} day{'s' if gap != 1 else ''} before the meeting"
                            + ("." if gap >= 7 else " - SS-1 asks for 7 days. Papers sent late need the directors' consent, "
                               "recorded in the minutes.")})
    if m["body"] == BODIES[0] and all_meetings is not None:
        earlier = sorted(x["meeting_date"] for x in all_meetings if x["body"] == BODIES[0]
                         and x["status"] in ("held", "published") and x["meeting_date"] < m["meeting_date"] and x["id"] != m["id"])
        if earlier:
            gap = (md - date.fromisoformat(earlier[-1])).days
            out.append({"level": "ok" if gap <= 120 else "error",
                        "text": f"{gap} days after the previous Board meeting"
                                + ("." if gap <= 120 else " - more than the 120 days allowed by Sec. 173(1).")})
    if "video" in (m.get("mode") or "").lower():
        out.append({"level": "ok" if m.get("video_link") else "warn",
                    "text": "Video conference link added." if m.get("video_link")
                    else "Add the video conference link. Keep the roll call and the recording (Rule 3)."})
    return out


def next_board_due(today: date) -> dict | None:
    """When the next Board meeting must be held by (120-day rule)."""
    with store.db() as c:
        r = c.execute("SELECT MAX(meeting_date) d FROM board_meetings WHERE body=? AND status='held' AND meeting_date<=?",
                      (BODIES[0], today.isoformat())).fetchone()
        nxt = c.execute("SELECT MIN(meeting_date) d FROM board_meetings WHERE body=? AND status IN ('draft','published') AND meeting_date>=?",
                        (BODIES[0], today.isoformat())).fetchone()
    if not r or not r["d"]:
        return None
    last = date.fromisoformat(r["d"])
    by = last + timedelta(days=120)
    return {"last_held": last.isoformat(), "must_meet_by": by.isoformat(), "days_left": (by - today).days,
            "next_scheduled": nxt["d"] if nxt else None}


# ------------------------------------------------------------- agenda items
def items(meeting_id: int) -> list[dict]:
    with store.db() as c:
        rows = c.execute("SELECT * FROM board_items WHERE meeting_id=? ORDER BY seq, id", (meeting_id,)).fetchall()
    out = []
    for r in rows:
        it = dict(r)
        it["withheld_from"] = _ids(it["withheld_from"])
        it["paper_versions"] = json.loads(it["paper_versions"] or "[]")
        out.append(it)
    return out


def get_item(item_id: int) -> dict | None:
    with store.db() as c:
        r = c.execute("SELECT * FROM board_items WHERE id=?", (item_id,)).fetchone()
    if not r:
        return None
    it = dict(r)
    it["withheld_from"] = _ids(it["withheld_from"])
    it["paper_versions"] = json.loads(it["paper_versions"] or "[]")
    return it


def save_item(meeting_id: int, data: dict, user: str, item_id: int | None = None,
              paper: tuple[str, bytes] | None = None, remove_paper: bool = False) -> int:
    if not get_meeting(meeting_id):
        raise BoardError("That meeting no longer exists.")
    clean = {
        "title": _text(data.get("title"), 500),
        "kind": _text(data.get("kind"), 100) or ITEM_KINDS[0],
        "presenter": _text(data.get("presenter"), 200),
        "summary": _text(data.get("summary")),
        "resolution": _text(data.get("resolution")),
    }
    if not clean["title"]:
        raise BoardError("Please give the agenda item a title.")
    withheld = _ids(data.get("withheld_from"))
    stored = None
    if paper:
        stored = _store_file(f"m{meeting_id}", *paper)
    with store.db() as c:
        if item_id:
            row = c.execute("SELECT * FROM board_items WHERE id=? AND meeting_id=?", (item_id, meeting_id)).fetchone()
            if not row:
                raise BoardError("That agenda item no longer exists.")
            versions = json.loads(row["paper_versions"] or "[]")
            sets = {**clean, "withheld_from": json.dumps(withheld), "updated": _now(), "updated_by": user}
            if (stored or remove_paper) and row["paper_stored"]:
                versions.append({"name": row["paper_name"], "stored": row["paper_stored"], "replaced": _now(), "by": user})
                sets["paper_versions"] = json.dumps(versions)
            if stored:
                sets.update(paper_name=stored[0], paper_stored=stored[1], paper_mime=stored[2], paper_size=stored[3],
                            paper_updated=_stamp())
            elif remove_paper:
                sets.update(paper_name=None, paper_stored=None, paper_mime=None, paper_size=None, paper_updated=_stamp())
            c.execute(f"UPDATE board_items SET {', '.join(f'{k}=?' for k in sets)} WHERE id=?", (*sets.values(), item_id))
            if stored:
                c.execute("DELETE FROM board_views WHERE item_id=?", (item_id,))  # a new paper is unread again
            return item_id
        seq = (c.execute("SELECT MAX(seq) s FROM board_items WHERE meeting_id=?", (meeting_id,)).fetchone()["s"] or 0) + 1
        cols = {**clean, "meeting_id": meeting_id, "seq": seq, "withheld_from": json.dumps(withheld),
                "updated": _now(), "updated_by": user}
        if stored:
            cols.update(paper_name=stored[0], paper_stored=stored[1], paper_mime=stored[2], paper_size=stored[3],
                        paper_updated=_stamp())
        cur = c.execute(f"INSERT INTO board_items ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                        tuple(cols.values()))
        return int(cur.lastrowid)


def delete_item(meeting_id: int, item_id: int) -> None:
    with store.db() as c:
        c.execute("DELETE FROM board_items WHERE id=? AND meeting_id=?", (item_id, meeting_id))
        c.execute("DELETE FROM board_views WHERE item_id=?", (item_id,))
        c.execute("DELETE FROM board_notes WHERE item_id=?", (item_id,))
        rest = [r["id"] for r in c.execute("SELECT id FROM board_items WHERE meeting_id=? ORDER BY seq, id", (meeting_id,))]
        c.executemany("UPDATE board_items SET seq=? WHERE id=?", [(n + 1, i) for n, i in enumerate(rest)])


def reorder(meeting_id: int, order: list[int]) -> None:
    current = [it["id"] for it in items(meeting_id)]
    order = [int(i) for i in order if int(i) in current]
    order += [i for i in current if i not in order]
    with store.db() as c:
        c.executemany("UPDATE board_items SET seq=? WHERE id=? AND meeting_id=?",
                      [(n + 1, i, meeting_id) for n, i in enumerate(order)])


# ------------------------------------------------------- what a director sees
def can_see_meeting(m: dict | None, user_id: int) -> bool:
    return bool(m) and m["status"] in ("published", "held") and user_id in m["invitees"]


def items_for(meeting_id: int, user_id: int) -> list[dict]:
    """Agenda items a director may see: papers withheld from interested directors (Sec. 184) are left out."""
    return [it for it in items(meeting_id) if user_id not in it["withheld_from"]]


def record_view(item_id: int, user_id: int) -> None:
    with store.db() as c:
        c.execute("INSERT INTO board_views (item_id, user_id, first_at, last_at) VALUES (?,?,?,?) "
                  "ON CONFLICT(item_id, user_id) DO UPDATE SET last_at=excluded.last_at, times=times+1",
                  (item_id, user_id, _now(), _now()))


def views(meeting_id: int) -> dict[int, dict[int, dict]]:
    """{item_id: {user_id: view}}"""
    with store.db() as c:
        rows = c.execute("SELECT v.* FROM board_views v JOIN board_items i ON i.id=v.item_id WHERE i.meeting_id=?",
                         (meeting_id,)).fetchall()
    out: dict[int, dict[int, dict]] = {}
    for r in rows:
        out.setdefault(r["item_id"], {})[r["user_id"]] = dict(r)
    return out


def save_note(item_id: int, user_id: int, text: str) -> None:
    text = _text(text, 20000)
    with store.db() as c:
        if text:
            c.execute("INSERT OR REPLACE INTO board_notes (item_id, user_id, text, at) VALUES (?,?,?,?)",
                      (item_id, user_id, text, _now()))
        else:
            c.execute("DELETE FROM board_notes WHERE item_id=? AND user_id=?", (item_id, user_id))


def notes_for(meeting_id: int, user_id: int) -> dict[int, str]:
    with store.db() as c:
        return {r["item_id"]: r["text"] for r in c.execute(
            "SELECT n.item_id, n.text FROM board_notes n JOIN board_items i ON i.id=n.item_id WHERE i.meeting_id=? AND n.user_id=?",
            (meeting_id, user_id))}


def set_rsvp(meeting_id: int, user_id: int, response: str, note: str = "") -> None:
    if response not in RSVP_CHOICES:
        raise BoardError("Please choose whether you will attend.")
    with store.db() as c:
        c.execute("INSERT OR REPLACE INTO board_rsvps (meeting_id, user_id, response, note, at) VALUES (?,?,?,?,?)",
                  (meeting_id, user_id, response, _text(note, 1000), _now()))


def rsvps(meeting_id: int) -> dict[int, dict]:
    with store.db() as c:
        return {r["user_id"]: dict(r) for r in c.execute("SELECT * FROM board_rsvps WHERE meeting_id=?", (meeting_id,))}


def is_revised(it: dict, m: dict) -> bool:
    return bool(m.get("published_at") and it.get("paper_updated") and it["paper_updated"] > m["published_at"])


def meeting_overview(meeting_id: int) -> dict | None:
    """Everything the Secretariat sees about one meeting."""
    m = get_meeting(meeting_id)
    if not m:
        return None
    its = items(meeting_id)
    names = _names()
    v = views(meeting_id)
    r = rsvps(meeting_id)
    people = []
    for uid in m["invitees"]:
        visible = [it for it in its if uid not in it["withheld_from"] and it["paper_stored"]]
        opened = sum(1 for it in visible if uid in v.get(it["id"], {}))
        people.append({"id": uid, "name": names.get(uid, f"User {uid}"), "rsvp": r.get(uid),
                       "papers": len(visible), "opened": opened})
    for it in its:
        it["revised"] = is_revised(it, m)
        it["withheld_names"] = [names.get(u, f"User {u}") for u in it["withheld_from"]]
        it.pop("paper_stored", None)
        for pv in it["paper_versions"]:
            pv.pop("stored", None)
    attending = sum(1 for p in people if p["rsvp"] and p["rsvp"]["response"] != "absent")
    for p in people:
        p["email"] = next((x["email"] for x in _people([p["id"]])), None)
    return {"meeting": m, "items": its, "people": people, "attending": attending,
            "compliance": compliance(m, list_meetings()), "emails": email_log("meeting", meeting_id)}


# -------------------------------------------------------- circular resolutions
def save_circular(data: dict, user: str, circular_id: int | None = None,
                  paper: tuple[str, bytes] | None = None) -> int:
    clean = {
        "title": _text(data.get("title"), 300),
        "resolution": _text(data.get("resolution")),
        "explanation": _text(data.get("explanation")),
        "respond_by": _date(data.get("respond_by"), "the date to reply by"),
    }
    if not clean["title"] or not clean["resolution"]:
        raise BoardError("Please give the subject and the text of the resolution.")
    recipients = _ids(data.get("recipients"))
    interested = [i for i in _ids(data.get("interested")) if i in recipients]
    stored = _store_file("circulars", *paper) if paper else None
    with store.db() as c:
        if circular_id:
            row = c.execute("SELECT status FROM board_circulars WHERE id=?", (circular_id,)).fetchone()
            if not row:
                raise BoardError("That resolution no longer exists.")
            if row["status"] != "draft":
                raise BoardError("This resolution has already been circulated, so it cannot be changed. "
                                 "Withdraw it and circulate a fresh one if the text must change.")
            sets = {**clean, "recipients": json.dumps(recipients), "interested": json.dumps(interested),
                    "updated": _now(), "updated_by": user}
            if stored:
                sets.update(paper_name=stored[0], paper_stored=stored[1], paper_mime=stored[2])
            c.execute(f"UPDATE board_circulars SET {', '.join(f'{k}=?' for k in sets)} WHERE id=?", (*sets.values(), circular_id))
            return circular_id
        cols = {**clean, "recipients": json.dumps(recipients), "interested": json.dumps(interested),
                "created": _now(), "created_by": user, "updated": _now(), "updated_by": user}
        if stored:
            cols.update(paper_name=stored[0], paper_stored=stored[1], paper_mime=stored[2])
        cur = c.execute(f"INSERT INTO board_circulars ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                        tuple(cols.values()))
        return int(cur.lastrowid)


def _circ_row(r) -> dict:
    x = dict(r)
    x["recipients"] = _ids(x["recipients"])
    x["interested"] = _ids(x["interested"])
    return x


def get_circular(circular_id: int) -> dict | None:
    with store.db() as c:
        r = c.execute("SELECT * FROM board_circulars WHERE id=?", (circular_id,)).fetchone()
    return _circ_row(r) if r else None


def list_circulars() -> list[dict]:
    with store.db() as c:
        rows = c.execute("SELECT * FROM board_circulars ORDER BY id DESC").fetchall()
    out = []
    for r in rows:
        x = _circ_row(r)
        x["tally"] = tally(x)
        x.pop("paper_stored", None)
        out.append(x)
    return out


def votes(circular_id: int) -> dict[int, dict]:
    with store.db() as c:
        return {r["user_id"]: dict(r) for r in c.execute("SELECT * FROM board_votes WHERE circular_id=?", (circular_id,))}


def tally(cr: dict, vs: dict[int, dict] | None = None) -> dict:
    """Sec. 175 count. Interested directors receive the papers but are not counted for the majority."""
    vs = votes(cr["id"]) if vs is None else vs
    entitled = [u for u in cr["recipients"] if u not in cr["interested"]]
    counts = {k: 0 for k in VOTES}
    for uid, v in vs.items():
        if uid in entitled or v["vote"] == "meeting":
            counts[v["vote"]] = counts.get(v["vote"], 0) + 1
    need = len(entitled) // 2 + 1 if entitled else 0
    # One-third of ALL directors (interested ones included) can ask for a meeting.
    meeting_need = -(-len(cr["recipients"]) // 3) if cr["recipients"] else 0
    replies = sum(1 for u in cr["recipients"] if u in vs)
    if meeting_need and counts["meeting"] >= meeting_need:
        state, label = "meeting", "At least one-third of the directors want a meeting: the Chairperson must put it to a Board meeting."
    elif need and counts["for"] >= need:
        state, label = "majority", f"Approved by a majority ({counts['for']} of {len(entitled)} directors entitled to vote)."
    elif need and len(entitled) - sum(1 for u in entitled if u in vs and vs[u]["vote"] != "for") < need:
        state, label = "failed", "A majority can no longer be reached."
    else:
        state, label = "waiting", f"{counts['for']} of the {need} approvals needed so far."
    return {"entitled": len(entitled), "needed": need, "meeting_needed": meeting_need, "counts": counts,
            "replies": replies, "of": len(cr["recipients"]), "state": state, "label": label}


def circulate(circular_id: int, user: str) -> None:
    cr = get_circular(circular_id)
    if not cr:
        raise BoardError("That resolution no longer exists.")
    if cr["status"] != "draft":
        raise BoardError("This resolution has already been circulated.")
    if not cr["recipients"]:
        raise BoardError("Choose the directors it goes to. Sec. 175 needs it sent to all of them.")
    if not [u for u in cr["recipients"] if u not in cr["interested"]]:
        raise BoardError("Every director is marked as interested, so no one can vote on it.")
    respond_by = cr["respond_by"] or (date.today() + timedelta(days=7)).isoformat()
    with store.db() as c:
        c.execute("UPDATE board_circulars SET status='open', circulated_at=?, respond_by=?, updated=?, updated_by=? WHERE id=?",
                  (_now(), respond_by, _now(), user, circular_id))


def cast_vote(circular_id: int, user_id: int, vote: str, comment: str = "") -> None:
    cr = get_circular(circular_id)
    if not cr or user_id not in cr["recipients"]:
        raise BoardError("This resolution was not sent to you.")
    if cr["status"] != "open":
        raise BoardError("This resolution is closed, so replies can no longer be given.")
    if vote not in VOTES:
        raise BoardError("Please choose your reply.")
    if user_id in cr["interested"] and vote != "meeting":
        raise BoardError("You are recorded as interested in this matter, so you do not vote on it. "
                         "Please contact the Company Secretary if this is not right.")
    with store.db() as c:
        c.execute("INSERT OR REPLACE INTO board_votes (circular_id, user_id, vote, comment, at) VALUES (?,?,?,?,?)",
                  (circular_id, user_id, vote, _text(comment, 2000), _now()))


def close_circular(circular_id: int, outcome: str, user: str) -> None:
    if outcome not in ("passed", "not passed", "referred to meeting", "withdrawn"):
        raise BoardError("Unknown result.")
    cr = get_circular(circular_id)
    if not cr:
        raise BoardError("That resolution no longer exists.")
    if cr["status"] == "closed":
        raise BoardError("This resolution is already closed.")
    if outcome == "passed" and tally(cr)["state"] != "majority":
        raise BoardError("It cannot be recorded as passed: a majority of the directors entitled to vote has not "
                         "approved it, or one-third of the directors have asked for a meeting.")
    with store.db() as c:
        c.execute("UPDATE board_circulars SET status='closed', outcome=?, closed_at=?, updated=?, updated_by=? WHERE id=?",
                  (outcome, _now(), _now(), user, circular_id))


def delete_circular(circular_id: int) -> None:
    cr = get_circular(circular_id)
    if cr and cr["status"] != "draft":
        raise BoardError("A circulated resolution is part of the record and cannot be deleted. Close it as withdrawn instead.")
    with store.db() as c:
        c.execute("DELETE FROM board_circulars WHERE id=? AND status='draft'", (circular_id,))


def circular_overview(circular_id: int) -> dict | None:
    cr = get_circular(circular_id)
    if not cr:
        return None
    names = _names()
    vs = votes(circular_id)
    cr["tally"] = tally(cr, vs)
    cr["replies"] = [{"id": u, "name": names.get(u, f"User {u}"), "interested": u in cr["interested"],
                      "vote": vs.get(u)} for u in cr["recipients"]]
    cr.pop("paper_stored", None)
    cr["emails"] = email_log("circular", circular_id)
    return cr


def note_circulars_at(meeting_id: int, user: str) -> int | None:
    """Add one 'for noting' agenda item listing circular resolutions passed and not yet noted (Sec. 175(2))."""
    with store.db() as c:
        rows = c.execute("SELECT * FROM board_circulars WHERE status='closed' AND outcome='passed' "
                         "AND noted_meeting_id IS NULL ORDER BY closed_at").fetchall()
    if not rows:
        return None
    lines = [f"{n + 1}. {r['title']} - passed on {r['closed_at'][:10]}" for n, r in enumerate(rows)]
    item_id = save_item(meeting_id, {
        "title": "To note the resolutions passed by circulation",
        "kind": "For noting",
        "summary": "Resolutions passed by circulation since the last meeting (Sec. 175(2)):\n" + "\n".join(lines),
        "resolution": "RESOLVED THAT the resolutions passed by circulation, as placed before the Board, be and are hereby noted.",
    }, user)
    with store.db() as c:
        c.executemany("UPDATE board_circulars SET noted_meeting_id=? WHERE id=?", [(meeting_id, r["id"]) for r in rows])
    return item_id


# ----------------------------------------------------------------- board pack
def _pdf_str(s: str) -> str:
    s = re.sub(r"₹\s*", "Rs ", s or "").replace("–", "-").replace("—", "-")
    s = s.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')
    s = s.encode("cp1252", "replace").decode("cp1252")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _wrap(text: str, size: float, width: float) -> list[str]:
    per = max(10, int(width / (size * 0.52)))
    out = []
    for para in (text or "").split("\n"):
        words, line = para.split(), ""
        if not words:
            out.append("")
            continue
        for w in words:
            if line and len(line) + 1 + len(w) > per:
                out.append(line)
                line = w
            else:
                line = f"{line} {w}".strip()
        out.append(line)
    return out


def _fonts() -> DictionaryObject:
    def font(base):
        return DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
                                 NameObject("/BaseFont"): NameObject(base), NameObject("/Encoding"): NameObject("/WinAnsiEncoding")})
    return DictionaryObject({NameObject("/F1"): font("/Helvetica"), NameObject("/F2"): font("/Helvetica-Bold")})


def _page(ops: list[str], w: float = 595.28, h: float = 841.89) -> PageObject:
    page = PageObject.create_blank_page(None, w, h)
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): _fonts()})
    stream = DecodedStreamObject()
    stream.set_data("\n".join(ops).encode("latin-1"))
    page[NameObject("/Contents")] = stream
    return page


NAVY = "0 0.118 0.373"
MAGENTA = "0.71 0.09 0.353"


def _text_pages(blocks: list[tuple[str, float, str, str]]) -> list[PageObject]:
    """Lay out (text, size, font, colour) blocks on A4 pages."""
    pages, ops, y = [], [], 790.0
    left, width = 56.0, 483.0
    for text, size, font, colour in blocks:
        lines = _wrap(text, size, width) if text else [""]
        for ln in lines:
            if y - size < 60:
                pages.append(_page(ops))
                ops, y = [], 790.0
            y -= size
            if ln:
                ops.append(f"BT /{font} {size} Tf {colour} rg {left} {y:.1f} Td ({_pdf_str(ln)}) Tj ET")
            y -= size * 0.35
        y -= size * 0.4
    pages.append(_page(ops))
    return pages


def _footer_overlay(text: str, w: float, h: float) -> PageObject:
    size = 7
    ops = [f"q 1 1 1 rg 0 0 {w:.1f} 16 re f Q",
           f"BT /F1 {size} Tf {MAGENTA} rg 20 5 Td ({_pdf_str(text)}) Tj ET"]
    return _page(ops, w, h)


def build_pack(meeting_id: int, viewer_name: str, user_id: int | None = None) -> bytes:
    """One PDF: cover with the agenda, then each paper in order with bookmarks. Every page carries a
    footer naming the person it was made for. Non-PDF papers get a page saying to open them in the portal."""
    m = get_meeting(meeting_id)
    if not m:
        raise BoardError("That meeting no longer exists.")
    its = items(meeting_id) if user_id is None else items_for(meeting_id, user_id)
    profile = store.get_profile()
    when = date.fromisoformat(m["meeting_date"]).strftime("%A, %d %B %Y")
    blocks = [
        ((profile.get("name") or "").upper(), 9, "F2", MAGENTA),
        (m["title"], 22, "F2", NAVY),
        (f"{m['body']}  |  {when}{('  |  ' + m['start_time']) if m.get('start_time') else ''}", 11, "F1", NAVY),
        (f"{m.get('mode') or ''}{('  |  ' + m['venue']) if m.get('venue') else ''}", 10, "F1", NAVY),
        ("", 6, "F1", NAVY),
        ("AGENDA", 9, "F2", MAGENTA),
    ]
    for n, it in enumerate(its, 1):
        blocks.append((f"{n}.  {it['title']}", 11, "F2", NAVY))
        sub = " | ".join(x for x in (it.get("kind"), it.get("presenter") and f"Presented by {it['presenter']}",
                                      it.get("paper_name") and f"Paper: {it['paper_name']}") if x)
        if sub:
            blocks.append((f"     {sub}", 8.5, "F1", "0.3 0.3 0.3"))
    blocks.append(("", 8, "F1", NAVY))
    blocks.append(("Strictly confidential. For the use of the addressee only. Do not copy or forward. "
                   "Papers may contain unpublished price-sensitive information.", 8, "F1", MAGENTA))

    writer = PdfWriter()
    for p in _text_pages(blocks):
        writer.add_page(p)
    writer.add_outline_item(title="Cover and agenda", page_number=0)

    for n, it in enumerate(its, 1):
        start = len(writer.pages)
        head = [(f"ITEM {n}  |  {(it.get('kind') or '').upper()}", 9, "F2", MAGENTA), (it["title"], 16, "F2", NAVY)]
        if it.get("presenter"):
            head.append((f"Presented by {it['presenter']}", 10, "F1", NAVY))
        if it.get("summary"):
            head.append((it["summary"], 10, "F1", "0.1 0.1 0.1"))
        if it.get("resolution"):
            head += [("DRAFT RESOLUTION", 9, "F2", MAGENTA), (it["resolution"], 10, "F1", "0.1 0.1 0.1")]
        path = file_path(it.get("paper_stored"))
        is_pdf = path and path.lower().endswith(".pdf")
        if path and not is_pdf:
            head.append((f"The paper for this item ({it['paper_name']}) is not a PDF. Open it in the Board portal.", 10, "F2", MAGENTA))
        if not path:
            head.append(("No paper for this item." if not it.get("summary") else "", 10, "F1", NAVY))
        for p in _text_pages(head):
            writer.add_page(p)
        if is_pdf:
            try:
                reader = PdfReader(path)
                if reader.is_encrypted:
                    reader.decrypt("")
                for p in reader.pages:
                    writer.add_page(p)
            except Exception:  # a damaged or password-protected PDF should not stop the whole pack
                for p in _text_pages([(f"The paper {it['paper_name']} could not be added to the pack. Open it in the portal.", 10, "F2", MAGENTA)]):
                    writer.add_page(p)
        writer.add_outline_item(title=f"{n}. {it['title'][:90]}", page_number=start)

    stamp = f"CONFIDENTIAL  |  {m['title']}  |  Prepared for {viewer_name}  |  {datetime.now().strftime('%d %b %Y %H:%M')}"
    total = len(writer.pages)
    for i, page in enumerate(writer.pages):
        try:
            page.transfer_rotation_to_content()
        except Exception:
            pass
        box = page.mediabox
        page.merge_page(_footer_overlay(f"{stamp}  |  Page {i + 1} of {total}", float(box.width), float(box.height)))
    writer.page_mode = "/UseOutlines"
    writer.add_metadata({"/Title": f"{m['title']} - Board pack", "/Author": profile.get("name", "")})
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


# --------------------------------------------------------------- the portal
def portal_home(user_id: int, today: date) -> dict:
    meetings = []
    for m in list_meetings():
        if not can_see_meeting(m, user_id):
            continue
        if m["meeting_date"] < (today - timedelta(days=400)).isoformat():
            continue
        r = rsvps(m["id"]).get(user_id)
        its = items_for(m["id"], user_id)
        v = views(m["id"])
        with_paper = [it for it in its if it["paper_stored"]]
        meetings.append({k: m[k] for k in ("id", "body", "title", "meeting_date", "start_time", "venue", "mode", "status")}
                        | {"rsvp": r["response"] if r else None, "papers": len(with_paper),
                           "unread": sum(1 for it in with_paper if user_id not in v.get(it["id"], {})),
                           "revised": sum(1 for it in its if is_revised(it, m))})
    circulars = []
    for cr in list_circulars():
        if user_id not in cr["recipients"] or cr["status"] == "draft":
            continue
        mine = votes(cr["id"]).get(user_id)
        circulars.append({k: cr[k] for k in ("id", "title", "respond_by", "status", "outcome", "circulated_at", "closed_at")}
                         | {"my_vote": mine["vote"] if mine else None, "interested": user_id in cr["interested"]})
    return {"meetings": meetings, "circulars": circulars}


def portal_meeting(meeting_id: int, user_id: int) -> dict | None:
    m = get_meeting(meeting_id)
    if not can_see_meeting(m, user_id):
        return None
    its = items_for(meeting_id, user_id)
    v = views(meeting_id)
    notes = notes_for(meeting_id, user_id)
    r = rsvps(meeting_id).get(user_id)
    out_items = []
    for it in its:
        out_items.append({k: it[k] for k in ("id", "seq", "title", "kind", "presenter", "summary", "resolution",
                                              "paper_name", "paper_mime", "paper_size")}
                         | {"revised": is_revised(it, m), "read": user_id in v.get(it["id"], {}),
                            "note": notes.get(it["id"], "")})
    return {"meeting": {k: m[k] for k in ("id", "body", "title", "meeting_date", "start_time", "venue", "mode",
                                          "video_link", "status", "published_at")},
            "items": out_items, "rsvp": r}


def portal_circular(circular_id: int, user_id: int) -> dict | None:
    cr = get_circular(circular_id)
    if not cr or user_id not in cr["recipients"] or cr["status"] == "draft":
        return None
    mine = votes(circular_id).get(user_id)
    t = tally(cr)
    return {k: cr[k] for k in ("id", "title", "resolution", "explanation", "respond_by", "status", "outcome",
                               "circulated_at", "closed_at", "paper_name")} | {
        "interested": user_id in cr["interested"], "my_vote": mine,
        "result": t["label"] if cr["status"] == "closed" else None}


# ------------------------------------------------------------------ e-mail
EMAIL_KINDS = {
    "published": "Papers ready",
    "revised": "Paper revised",
    "remind_reply": "Reminder: attendance",
    "remind_read": "Reminder: papers not opened",
    "cancelled": "Meeting cancelled",
    "circular": "Circular resolution sent",
    "remind_vote": "Reminder: circular resolution",
    "minutes_draft": "Draft minutes for comments",
    "minutes_final": "Signed minutes available",
}


def _people(user_ids: list[int]) -> list[dict]:
    if not user_ids:
        return []
    with store.db() as c:
        q = f"SELECT id, full_name, email, active FROM users WHERE id IN ({','.join('?' for _ in user_ids)})"
        return [dict(r) for r in c.execute(q, tuple(user_ids))]


def _email_text(kind: str, ref: dict, name: str, company: str) -> tuple[str, str]:
    link = mailer.site_url() or "the Board portal"
    date_txt = lambda iso: date.fromisoformat(iso[:10]).strftime("%d %B %Y") if iso else ""  # noqa: E731
    title = ref.get("title", "")
    when = f"{date_txt(ref.get('meeting_date'))}{' at ' + ref['start_time'] if ref.get('start_time') else ''}"
    lines = {
        "published": (f"Papers for the {title} are ready",
                      f"The agenda and papers for the {title} on {when} are now in the Board portal."),
        "revised": (f"A paper for the {title} has been revised",
                    f"One or more papers for the {title} on {when} have been revised. Revised items are marked in the portal."),
        "remind_reply": (f"Reminder: will you attend the {title}?",
                         f"Please let the Company Secretary know in the Board portal whether you will attend the {title} on {when}."),
        "remind_read": (f"Reminder: papers for the {title}",
                        f"Some papers for the {title} on {when} are waiting for you in the Board portal."),
        "cancelled": (f"The {title} has been cancelled", f"The {title} that was to be held on {when} has been cancelled."),
        "circular": (f"Resolution by circulation: {title}",
                     f"A resolution by circulation has been sent to you: \"{title}\". Please reply in the Board portal"
                     f"{' by ' + date_txt(ref.get('respond_by')) if ref.get('respond_by') else ''}."),
        "remind_vote": (f"Reminder: resolution by circulation - {title}",
                        f"We have not yet received your reply to the resolution by circulation \"{title}\". Please reply in the Board portal"
                        f"{' by ' + date_txt(ref.get('respond_by')) if ref.get('respond_by') else ''}."),
        "minutes_draft": (f"Draft minutes of the {title} for your comments",
                          f"The draft minutes of the {title} held on {date_txt(ref.get('meeting_date'))} are in the Board portal. "
                          f"Please send any comments through the portal{' by ' + date_txt(ref.get('comments_by')) if ref.get('comments_by') else ' within 7 days'} (SS-1)."),
        "minutes_final": (f"Signed minutes of the {title}",
                          f"The signed minutes of the {title} held on {date_txt(ref.get('meeting_date'))} are now in the Board portal."),
    }
    subject, line = lines[kind]
    body = (f"Dear {name},\n\n{line}\n\nSign in here: {link}\n\n"
            "For confidentiality, papers are not attached to this e-mail. Please do not forward it.\n\n"
            f"Company Secretary\n{company}\n")
    return subject, body


def send_notice(kind: str, ref_type: str, ref: dict, user_ids: list[int], sent_by: str) -> dict:
    """E-mail directors about a meeting, circular resolution or minutes. Logs each attempt."""
    if kind not in EMAIL_KINDS:
        raise BoardError("Unknown kind of e-mail.")
    if not mailer.ready():
        raise BoardError("E-mail is not set up on the server yet. Ask IT to fill in the SMTP settings (see README).")
    company = store.get_profile().get("name", "")
    people = [p for p in _people(user_ids) if p["active"]]
    to_send, skipped = [], []
    for p in people:
        if p["email"]:
            subject, body = _email_text(kind, ref, p["full_name"], company)
            to_send.append((p, subject, body))
        else:
            skipped.append(p["full_name"])
    errors = mailer.send_many([(p["email"], p["full_name"], sub, body) for p, sub, body in to_send],
                              sender_name=f"{store.get_profile().get('brand') or 'Company'} Secretariat")
    with store.db() as c:
        c.executemany("INSERT INTO board_emails (at, kind, ref_type, ref_id, user_id, address, subject, error, sent_by) "
                      "VALUES (?,?,?,?,?,?,?,?,?)",
                      [(_now(), kind, ref_type, ref["id"], p["id"], p["email"], sub, err, sent_by)
                       for (p, sub, _), err in zip(to_send, errors)])
    failed = [p["full_name"] for (p, _, _), err in zip(to_send, errors) if err]
    return {"sent": len(to_send) - len(failed), "failed": failed, "no_email": skipped,
            "error": next((e for e in errors if e), None)}


def email_log(ref_type: str, ref_id: int) -> list[dict]:
    names = _names()
    with store.db() as c:
        rows = c.execute("SELECT * FROM board_emails WHERE ref_type=? AND ref_id=? ORDER BY id DESC LIMIT 200",
                         (ref_type, ref_id)).fetchall()
    return [dict(r) | {"name": names.get(r["user_id"], ""), "kind_label": EMAIL_KINDS.get(r["kind"], r["kind"])} for r in rows]


def reminder_targets(meeting_id: int, who: str) -> list[int]:
    m = get_meeting(meeting_id)
    if not m:
        return []
    if who == "reply":
        r = rsvps(meeting_id)
        return [u for u in m["invitees"] if u not in r]
    if who == "read":
        v = views(meeting_id)
        its = [it for it in items(meeting_id) if it["paper_stored"]]
        return [u for u in m["invitees"] if any(u not in it["withheld_from"] and u not in v.get(it["id"], {}) for it in its)]
    return list(m["invitees"])


def circular_reminder_targets(circular_id: int) -> list[int]:
    cr = get_circular(circular_id)
    if not cr:
        return []
    vs = votes(circular_id)
    return [u for u in cr["recipients"] if u not in cr["interested"] and u not in vs]


def spec() -> dict:
    return {"email_ready": mailer.ready(), "email_kinds": EMAIL_KINDS, "bodies": BODIES, "modes": MODES, "item_kinds": ITEM_KINDS, "rsvp": RSVP_CHOICES, "votes": VOTES,
            "meeting_only": MEETING_ONLY_MATTERS, "circular_verify": CIRCULAR_VERIFY, "meeting_verify": MEETING_VERIFY}
