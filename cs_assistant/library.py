"""Document library: the CS office's own documents, organised in folders and searchable.

Files are kept on disk under data/library/<doc id>/; details, versions and the extracted
text (for search and for the assistant to read) are kept in the database. Every upload of a
changed document becomes a new version; older versions are never overwritten. Deleting only
hides a document, so it can be restored.
"""

from __future__ import annotations

import hashlib
import io
import mimetypes
import os
import re
from datetime import datetime

from pypdf import PdfReader

from . import store
from .files import docx_to_text

LIB_DIR = os.path.join(store.DATA_DIR, "library")
MAX_BYTES = 50 * 1024 * 1024

# (id, folder name, what usually goes in it)
CATEGORIES: list[tuple[str, str, str]] = [
    ("constitution", "Company constitution", "Certificate of incorporation, MOA, AOA, name-change and conversion certificates, share capital history."),
    ("board", "Board & committee meetings", "Notices, agenda papers, signed minutes, attendance registers, resolutions, circular resolutions."),
    ("general", "General meetings", "AGM / EGM notices, explanatory statements, minutes, scrutiniser reports, postal ballots."),
    ("registers", "Statutory registers", "Registers of members, directors & KMP, charges, contracts (MBP-4), loans & investments (MBP-2), SBO."),
    ("filings", "MCA filings & challans", "Filed e-forms with SRN and challans: AOC-4, MGT-7, DIR-12, MGT-14, CHG-1, PAS-3 and others."),
    ("directors", "Director records", "DIR-2 consents, DIR-8, MBP-1 disclosures, KYC, appointment letters, independence declarations."),
    ("policies", "Policies & delegation of powers", "RPT, CSR, vigil mechanism, POSH, code of conduct, delegation of powers and other approved policies."),
    ("contracts", "Contracts & agreements", "Executed NDAs, vendor, consultant, lease, MoU, clinical trial and empanelment agreements."),
    ("licences", "Licences & registrations", "Copies of hospital licences and renewals: CE registration, PCPNDT, AERB, BMW, fire, drugs, NABH."),
    ("fema", "FEMA / RBI", "FC-GPR, FC-TRS, FLA returns, valuation certificates, RBI correspondence."),
    ("litigation", "Litigation & notices", "Legal notices and replies, consumer cases, court orders, regulator notices and replies."),
    ("templates", "Templates & precedents", "Approved formats and good precedents to work from."),
    ("law", "Laws, circulars & opinions", "Bare acts, MCA / RBI / SEBI circulars, ICSI standards, legal opinions received."),
    ("assistant", "Saved from the Assistant", "Answers, reviews and drafts saved from the CS Assistant."),
    ("other", "Other", "Anything else."),
]
CATEGORY_NAMES = {c[0]: c[1] for c in CATEGORIES}

SCHEMA = """
CREATE TABLE IF NOT EXISTS lib_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL,
    description TEXT, tags TEXT, doc_date TEXT,
    created TEXT NOT NULL, created_by TEXT, updated TEXT NOT NULL, updated_by TEXT,
    current_version INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lib_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, version_no INTEGER NOT NULL,
    filename TEXT NOT NULL, stored_name TEXT NOT NULL, mime TEXT, size INTEGER, sha256 TEXT,
    uploaded TEXT NOT NULL, uploaded_by TEXT, note TEXT, text TEXT, text_status TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS lib_fts USING fts5(
    doc_id UNINDEXED, title, description, tags, category, body, tokenize='porter unicode61'
);
"""


class LibraryError(ValueError):
    pass


def init() -> None:
    os.makedirs(LIB_DIR, exist_ok=True)
    with store.db() as c:
        c.executescript(SCHEMA)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _safe_name(name: str) -> str:
    base = os.path.basename(name.replace("\\", "/")) or "document"
    base = re.sub(r"[^A-Za-z0-9 ._()-]+", "_", base).strip(" .") or "document"
    return base[:120]


def extract_text(filename: str, data: bytes) -> tuple[str, str]:
    """Return (text, status). Status: ok | scanned | picture | none."""
    ext = os.path.splitext(filename)[1].lower()
    try:
        if ext == ".pdf":
            reader = PdfReader(io.BytesIO(data))
            parts = []
            for n, page in enumerate(reader.pages, start=1):
                t = (page.extract_text() or "").strip()
                if t:
                    parts.append(f"[Page {n}]\n{t}")
            text = "\n\n".join(parts)
            return (text, "ok") if len(text) > 40 * max(1, len(reader.pages)) // 4 else (text, "scanned")
        if ext == ".docx":
            return docx_to_text(data), "ok"
        if ext in (".txt", ".md", ".csv", ".rtf"):
            return data.decode("utf-8", errors="replace"), "ok"
        if ext in (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"):
            return "", "picture"
    except Exception:
        return "", "none"
    return "", "none"


def _index(c, doc_id: int) -> None:
    d = c.execute("SELECT * FROM lib_docs WHERE id=?", (doc_id,)).fetchone()
    c.execute("DELETE FROM lib_fts WHERE doc_id=?", (doc_id,))
    if not d or d["deleted"]:
        return
    v = c.execute("SELECT text, filename FROM lib_versions WHERE doc_id=? AND version_no=?",
                  (doc_id, d["current_version"])).fetchone()
    body = (v["text"] or "") + "\n" + (v["filename"] if v else "")
    c.execute("INSERT INTO lib_fts (doc_id, title, description, tags, category, body) VALUES (?,?,?,?,?,?)",
              (doc_id, d["title"], d["description"] or "", d["tags"] or "",
               CATEGORY_NAMES.get(d["category"], d["category"]), body))


def _store_file(doc_id: int, version_no: int, filename: str, data: bytes) -> str:
    folder = os.path.join(LIB_DIR, str(doc_id))
    os.makedirs(folder, exist_ok=True)
    stored = f"v{version_no}_{_safe_name(filename)}"
    with open(os.path.join(folder, stored), "wb") as f:
        f.write(data)
    return stored


def _check(filename: str, data: bytes) -> None:
    if not data:
        raise LibraryError(f"'{filename}' is empty.")
    if len(data) > MAX_BYTES:
        raise LibraryError(f"'{filename}' is larger than 50 MB.")


def add_document(filename: str, data: bytes, *, category: str, user: str, title: str = "",
                 description: str = "", tags: str = "", doc_date: str = "", note: str = "",
                 text: str | None = None) -> int:
    _check(filename, data)
    if category not in CATEGORY_NAMES:
        category = "other"
    if text is None:
        text, status = extract_text(filename, data)
    else:
        status = "ok"
    title = (title or os.path.splitext(_safe_name(filename))[0].replace("_", " ")).strip()[:200]
    now = _now()
    with store.db() as c:
        cur = c.execute(
            "INSERT INTO lib_docs (title, category, description, tags, doc_date, created, created_by, updated, updated_by, current_version)"
            " VALUES (?,?,?,?,?,?,?,?,?,1)",
            (title, category, description.strip(), tags.strip(), doc_date or None, now, user, now, user))
        doc_id = int(cur.lastrowid)
        stored = _store_file(doc_id, 1, filename, data)
        c.execute(
            "INSERT INTO lib_versions (doc_id, version_no, filename, stored_name, mime, size, sha256, uploaded, uploaded_by, note, text, text_status)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (doc_id, 1, _safe_name(filename), stored, mimetypes.guess_type(filename)[0], len(data),
             hashlib.sha256(data).hexdigest(), now, user, note or "First version", text, status))
        _index(c, doc_id)
    return doc_id


def add_version(doc_id: int, filename: str, data: bytes, *, user: str, note: str = "") -> int:
    _check(filename, data)
    text, status = extract_text(filename, data)
    now = _now()
    with store.db() as c:
        d = c.execute("SELECT current_version FROM lib_docs WHERE id=?", (doc_id,)).fetchone()
        if not d:
            raise LibraryError("Document not found.")
        n = int(d["current_version"]) + 1
        stored = _store_file(doc_id, n, filename, data)
        c.execute(
            "INSERT INTO lib_versions (doc_id, version_no, filename, stored_name, mime, size, sha256, uploaded, uploaded_by, note, text, text_status)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (doc_id, n, _safe_name(filename), stored, mimetypes.guess_type(filename)[0], len(data),
             hashlib.sha256(data).hexdigest(), now, user, note, text, status))
        c.execute("UPDATE lib_docs SET current_version=?, updated=?, updated_by=? WHERE id=?", (n, now, user, doc_id))
        _index(c, doc_id)
    return n


def update_details(doc_id: int, data: dict, user: str) -> None:
    fields = {k: (str(data[k]).strip() if data.get(k) is not None else None)
              for k in ("title", "category", "description", "tags", "doc_date") if k in data}
    if "title" in fields and not fields["title"]:
        raise LibraryError("Please give the document a title.")
    if "category" in fields and fields["category"] not in CATEGORY_NAMES:
        raise LibraryError("Unknown folder.")
    if "doc_date" in fields and not fields["doc_date"]:
        fields["doc_date"] = None
    if not fields:
        return
    sets = ", ".join(f"{k}=?" for k in fields)
    with store.db() as c:
        c.execute(f"UPDATE lib_docs SET {sets}, updated=?, updated_by=? WHERE id=?",
                  (*fields.values(), _now(), user, doc_id))
        _index(c, doc_id)


def set_deleted(doc_id: int, deleted: bool, user: str) -> None:
    with store.db() as c:
        c.execute("UPDATE lib_docs SET deleted=?, updated=?, updated_by=? WHERE id=?",
                  (1 if deleted else 0, _now(), user, doc_id))
        _index(c, doc_id)


def _doc_row(r) -> dict:
    d = dict(r)
    d["category_name"] = CATEGORY_NAMES.get(d["category"], d["category"])
    return d


LIST_SQL = """
SELECT d.*, v.filename, v.size, v.mime, v.text_status, v.uploaded AS version_uploaded
FROM lib_docs d LEFT JOIN lib_versions v ON v.doc_id = d.id AND v.version_no = d.current_version
"""


def _fts_query(q: str, any_word: bool = False) -> str:
    words = re.findall(r"[\w\-/]+", q.lower())
    words = [w.replace('"', "") for w in words if len(w) > 1 or w.isdigit()]
    return (" OR " if any_word else " ").join(f'"{w}"*' for w in words[:12])


def search(q: str = "", category: str = "", deleted: bool = False, limit: int = 200) -> list[dict]:
    with store.db() as c:
        if q.strip():
            if not _fts_query(q):
                return []
            sql = ("SELECT f.doc_id, snippet(lib_fts, 5, '«', '»', ' … ', 14) AS snip,"
                   " bm25(lib_fts, 0, 10.0, 4.0, 4.0, 2.0, 1.0) AS rank FROM lib_fts f WHERE lib_fts MATCH ? ORDER BY rank LIMIT ?")
            # Every word first; if nothing has all of them, any of the words (best matches first).
            rows = c.execute(sql, (_fts_query(q), limit)).fetchall() or \
                c.execute(sql, (_fts_query(q, any_word=True), limit)).fetchall()
            ids = [r["doc_id"] for r in rows]
            snips = {r["doc_id"]: r["snip"] for r in rows}
            if not ids:
                return []
            marks = ",".join("?" * len(ids))
            docs = {r["id"]: _doc_row(r) for r in c.execute(f"{LIST_SQL} WHERE d.id IN ({marks})", ids)}
            out = []
            for i in ids:
                d = docs.get(int(i))
                if d and (not category or d["category"] == category):
                    d["snippet"] = snips[i]
                    out.append(d)
            return out
        where, args = ["d.deleted=?"], [1 if deleted else 0]
        if category:
            where.append("d.category=?")
            args.append(category)
        rows = c.execute(f"{LIST_SQL} WHERE {' AND '.join(where)} ORDER BY COALESCE(d.doc_date, substr(d.created,1,10)) DESC, d.id DESC LIMIT ?",
                         (*args, limit)).fetchall()
        return [_doc_row(r) for r in rows]


def counts() -> dict[str, int]:
    with store.db() as c:
        rows = c.execute("SELECT category, COUNT(*) AS n FROM lib_docs WHERE deleted=0 GROUP BY category").fetchall()
    return {r["category"]: r["n"] for r in rows}


def total() -> int:
    with store.db() as c:
        return int(c.execute("SELECT COUNT(*) FROM lib_docs WHERE deleted=0").fetchone()[0])


def get(doc_id: int) -> dict | None:
    with store.db() as c:
        r = c.execute(f"{LIST_SQL} WHERE d.id=?", (doc_id,)).fetchone()
        if not r:
            return None
        d = _doc_row(r)
        d["versions"] = [dict(v) for v in c.execute(
            "SELECT id, version_no, filename, mime, size, uploaded, uploaded_by, note, text_status"
            " FROM lib_versions WHERE doc_id=? ORDER BY version_no DESC", (doc_id,))]
    return d


def version_file(doc_id: int, version_no: int | None = None) -> tuple[str, dict] | None:
    with store.db() as c:
        if version_no is None:
            r = c.execute("SELECT v.* FROM lib_versions v JOIN lib_docs d ON d.id=v.doc_id AND v.version_no=d.current_version"
                          " WHERE d.id=?", (doc_id,)).fetchone()
        else:
            r = c.execute("SELECT * FROM lib_versions WHERE doc_id=? AND version_no=?", (doc_id, version_no)).fetchone()
    if not r:
        return None
    path = os.path.join(LIB_DIR, str(doc_id), r["stored_name"])
    return (path, dict(r)) if os.path.exists(path) else None


def read_text(doc_id: int, start: int = 0, length: int = 40000) -> dict | None:
    """The current version's text, in chunks - used by the assistant and the preview."""
    d = get(doc_id)
    if not d or d["deleted"]:
        return None
    with store.db() as c:
        v = c.execute("SELECT text, text_status FROM lib_versions WHERE doc_id=? AND version_no=?",
                      (doc_id, d["current_version"])).fetchone()
    text = (v["text"] or "") if v else ""
    start = max(0, int(start))
    chunk = text[start:start + length]
    return {"doc_id": doc_id, "title": d["title"], "folder": d["category_name"], "date": d["doc_date"],
            "version": d["current_version"], "text_status": v["text_status"] if v else "none",
            "total_chars": len(text), "start": start, "text": chunk,
            "next_start": start + length if start + length < len(text) else None}
