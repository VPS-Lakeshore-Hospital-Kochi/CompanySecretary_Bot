"""CS Assistant - web server.

Run:  python app.py      then open http://localhost:8080 in the browser.
"""

from __future__ import annotations

import io
import json
import os
import re
import secrets
import tempfile
import threading
import time
import zipfile
from datetime import date, datetime, timedelta

from flask import (Flask, Response, abort, g, jsonify, request, send_file, send_from_directory, session,
                   stream_with_context)
from werkzeug.security import check_password_hash, generate_password_hash

from cs_assistant import calendar as cal
from cs_assistant import documents, export, files, library, llm, store


def _load_dotenv() -> None:
    path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()
llm.MODEL = os.environ.get("CS_MODEL", llm.MODEL)
llm.WEB_SEARCH = os.environ.get("CS_WEB_SEARCH", "1") != "0"
llm.USE_FALLBACKS = os.environ.get("CS_FALLBACKS", "1") != "0"

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 120 * 1024 * 1024
store.init()
library.init()


def _secret_key() -> str:
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = os.path.join(store.DATA_DIR, "secret_key")
    if not os.path.exists(path):
        os.makedirs(store.DATA_DIR, exist_ok=True)
        with open(path, "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


app.config.update(
    SECRET_KEY=_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "0") == "1",  # set 1 when served over HTTPS
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)

# Optional first administrator from the environment (otherwise created on the setup screen).
if os.environ.get("ADMIN_USERNAME") and os.environ.get("ADMIN_PASSWORD") and not store.user_count():
    store.create_user(os.environ["ADMIN_USERNAME"], os.environ.get("ADMIN_NAME", os.environ["ADMIN_USERNAME"]),
                      generate_password_hash(os.environ["ADMIN_PASSWORD"]), "admin")

OPEN_PATHS = {"/", "/api/me", "/api/login", "/api/setup", "/api/logout"}
_failures: dict[str, list[float]] = {}
_fail_lock = threading.Lock()


@app.before_request
def _require_login():
    g.user = None
    uid = session.get("uid")
    if uid:
        u = store.get_user(uid)
        if u and u["active"]:
            g.user = u
        else:
            session.clear()
    if request.path.startswith("/static/") or request.path in OPEN_PATHS:
        return None
    if not g.user:
        return jsonify({"error": "Please sign in.", "login": True}), 401
    return None


@app.after_request
def _security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    return resp


def _who() -> str:
    return g.user["username"] if g.get("user") else ""


def _admin_only():
    if not g.user or g.user["role"] != "admin":
        abort(403)


def _password_ok(pw: str) -> str | None:
    if len(pw or "") < 8:
        return "The password must be at least 8 characters."
    return None


@app.get("/api/me")
def me():
    return jsonify({"user": g.user, "needs_setup": store.user_count() == 0})


@app.post("/api/setup")
def setup():
    """Create the first administrator. Only works while there are no users at all."""
    if store.user_count():
        abort(403)
    b = request.get_json(force=True)
    err = _password_ok(b.get("password", ""))
    if err or not (b.get("username") or "").strip() or not (b.get("full_name") or "").strip():
        return jsonify({"error": err or "Please fill in every box."}), 400
    uid = store.create_user(b["username"], b["full_name"], generate_password_hash(b["password"]), "admin")
    session.clear()
    session.permanent = True
    session["uid"] = uid
    store.log(b["username"], "Set up the site", "First administrator created")
    return jsonify({"ok": True})


@app.post("/api/login")
def login():
    b = request.get_json(force=True)
    username = (b.get("username") or "").strip()
    key = f"{username.lower()}|{request.remote_addr}"
    now = time.time()
    with _fail_lock:
        recent = [t for t in _failures.get(key, []) if now - t < 300]
        _failures[key] = recent
        if len(recent) >= 5:
            return jsonify({"error": "Too many wrong attempts. Please wait five minutes and try again."}), 429
    u = store.user_with_hash(username)
    if not u or not u["active"] or not check_password_hash(u["password_hash"], b.get("password") or ""):
        with _fail_lock:
            _failures.setdefault(key, []).append(now)
        return jsonify({"error": "The username or password is not right."}), 401
    session.clear()
    session.permanent = True
    session["uid"] = u["id"]
    store.update_user(u["id"], last_login=datetime.now().isoformat(timespec="seconds"))
    store.log(u["username"], "Signed in")
    return jsonify({"ok": True})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.post("/api/me/password")
def change_password():
    b = request.get_json(force=True)
    u = store.user_with_hash(g.user["username"])
    if not check_password_hash(u["password_hash"], b.get("current") or ""):
        return jsonify({"error": "Your current password is not right."}), 400
    err = _password_ok(b.get("new", ""))
    if err:
        return jsonify({"error": err}), 400
    store.update_user(u["id"], password_hash=generate_password_hash(b["new"]))
    store.log(_who(), "Changed own password")
    return jsonify({"ok": True})


# ---------------------------------------------------------------- users (admin)
@app.get("/api/users")
def users_list():
    _admin_only()
    return jsonify(store.list_users())


@app.post("/api/users")
def users_create():
    _admin_only()
    b = request.get_json(force=True)
    err = _password_ok(b.get("password", ""))
    if err or not (b.get("username") or "").strip() or not (b.get("full_name") or "").strip():
        return jsonify({"error": err or "Please fill in every box."}), 400
    role = "admin" if b.get("role") == "admin" else "member"
    try:
        uid = store.create_user(b["username"], b["full_name"], generate_password_hash(b["password"]), role)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    store.log(_who(), "Added user", f"{b['username']} ({role})")
    return jsonify({"id": uid})


@app.post("/api/users/<int:uid>")
def users_update(uid: int):
    _admin_only()
    b = request.get_json(force=True)
    target = store.get_user(uid)
    if not target:
        abort(404)
    fields = {}
    if "full_name" in b and str(b["full_name"]).strip():
        fields["full_name"] = str(b["full_name"]).strip()
    if "role" in b:
        fields["role"] = "admin" if b["role"] == "admin" else "member"
    if "active" in b:
        fields["active"] = 1 if b["active"] else 0
    if b.get("password"):
        err = _password_ok(b["password"])
        if err:
            return jsonify({"error": err}), 400
        fields["password_hash"] = generate_password_hash(b["password"])
    losing_admin = target["role"] == "admin" and target["active"] and (
        fields.get("role") == "member" or fields.get("active") == 0)
    if losing_admin and store.active_admins() <= 1:
        return jsonify({"error": "There must always be at least one active administrator."}), 400
    store.update_user(uid, **fields)
    what = ", ".join(k.replace("password_hash", "password reset") for k in fields)
    store.log(_who(), "Changed user", f"{target['username']}: {what}")
    return jsonify({"ok": True})


@app.get("/api/activity")
def activity():
    _admin_only()
    return jsonify(store.recent_activity())


@app.get("/api/backup")
def backup():
    """Zip of the database and every library file - for IT to keep safely."""
    _admin_only()
    buf = io.BytesIO()
    with tempfile.TemporaryDirectory() as tmp:
        db_copy = os.path.join(tmp, "cs_assistant.db")
        store.backup_database(db_copy)
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(db_copy, "cs_assistant.db")
            for root, _, names in os.walk(library.LIB_DIR):
                for n in names:
                    full = os.path.join(root, n)
                    z.write(full, os.path.relpath(full, store.DATA_DIR))
    store.log(_who(), "Downloaded a backup")
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name=f"CS_Assistant_backup_{date.today().isoformat()}.zip",
                     mimetype="application/zip")


def _today() -> date:
    override = os.environ.get("CS_TODAY")  # for testing only
    return date.fromisoformat(override) if override else date.today()


# ---------------------------------------------------------------- pages
@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/meta")
def meta():
    return jsonify({
        "ai_ready": llm.api_ready(),
        "model": llm.MODEL,
        "profile": store.get_profile(),
        "tracking_since": store.get_setting("tracking_since"),
        "flags": cal.PROFILE_FLAGS,
        "categories": cal.CATEGORIES,
        "draft_types": [{k: d[k] for k in ("id", "group", "title")} | {
            "questions": [{"key": q[0], "label": q[1], "kind": q[2]} for q in d["questions"] + documents.COMMON_QUESTIONS]
        } for d in documents.DRAFT_TYPES],
        "vet_types": [{"id": v["id"], "title": v["title"]} for v in documents.VET_TYPES],
        "roles": documents.OUR_ROLE_OPTIONS,
        "events": cal.EVENTS,
        "library_folders": [{"id": c[0], "name": c[1], "hint": c[2]} for c in library.CATEGORIES],
        "links": OFFICIAL_LINKS,
    })


OFFICIAL_LINKS = [
    ("Company law", [
        ("MCA - Acts, Rules, e-forms and filing", "https://www.mca.gov.in"),
        ("ICSI - Secretarial Standards SS-1 and SS-2", "https://www.icsi.edu"),
        ("India Code - every central Act, as amended", "https://www.indiacode.nic.in"),
        ("e-Gazette of India - notifications", "https://egazette.gov.in"),
        ("SEBI (if securities are listed)", "https://www.sebi.gov.in"),
    ]),
    ("Foreign investment", [
        ("RBI - FEMA Master Directions and circulars", "https://www.rbi.org.in"),
        ("RBI FIRMS portal - FC-GPR and FC-TRS", "https://firms.rbi.org.in"),
        ("RBI FLAIR portal - annual FLA return", "https://flair.rbi.org.in"),
    ]),
    ("Hospital regulators", [
        ("AERB eLORA - radiation licences", "https://elora.aerb.gov.in"),
        ("CDSCO - drugs, blood centres, clinical trials", "https://cdsco.gov.in"),
        ("National Medical Commission", "https://www.nmc.org.in"),
        ("NABH - accreditation standards", "https://nabh.co"),
        ("Kerala State Pollution Control Board", "https://keralapcb.nic.in"),
        ("Central Pollution Control Board - BMW Rules", "https://cpcb.nic.in"),
        ("Ministry of Health and Family Welfare", "https://mohfw.gov.in"),
        ("Government of Kerala", "https://kerala.gov.in"),
    ]),
    ("Data, tax, labour and courts", [
        ("MeitY - DPDP Act and Rules", "https://www.meity.gov.in"),
        ("CERT-In - report a cyber incident", "https://www.cert-in.org.in"),
        ("Income Tax e-filing", "https://www.incometax.gov.in"),
        ("GST portal", "https://www.gst.gov.in"),
        ("Ministry of Labour - Labour Codes", "https://labour.gov.in"),
        ("e-Daakhil - consumer complaints", "https://edaakhil.nic.in"),
        ("NCDRC - National Consumer Commission", "https://ncdrc.nic.in"),
        ("Supreme Court of India", "https://www.sci.gov.in"),
    ]),
]


@app.get("/api/guide")
def guide():
    with open(os.path.join(os.path.dirname(__file__), "docs", "CS_RESPONSIBILITIES.md"), encoding="utf-8") as f:
        return jsonify({"markdown": f.read()})


# ---------------------------------------------------------------- uploads
@app.post("/api/upload")
def upload():
    out, errors = [], []
    for f in request.files.getlist("files"):
        try:
            d = files.read_upload(f.filename or "document", f.read())
            out.append({"id": d["id"], "name": d["name"], "summary": d["summary"]})
        except files.UploadError as e:
            errors.append(str(e))
    pasted = (request.form.get("pasted") or "").strip()
    if pasted:
        d = files.text_document("Pasted text", pasted)
        out.append({"id": d["id"], "name": d["name"], "summary": d["summary"]})
    return jsonify({"files": out, "errors": errors})


# ---------------------------------------------------------------- AI
def _sse(gen):
    def run():
        for event in gen:
            yield f"data: {json.dumps(event)}\n\n"
    return Response(stream_with_context(run()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/chat")
def chat():
    body = request.get_json(force=True)
    mode = body.get("mode", "ask")
    turns = body.get("turns") or []
    doc_ids = body.get("doc_ids") or []
    form = body.get("form") or {}
    if not turns or turns[0].get("role") != "user":
        abort(400)
    names = [d["name"] for d in (files.get(i) for i in doc_ids) if d]
    first_prompt = None
    if mode == "vet":
        if not doc_ids:
            return _sse(iter([{"type": "error", "text": "Please add the document to check first."}]))
        first_prompt = documents.build_vet_prompt(form.get("type", "other"), form.get("role", ""),
                                                  form.get("concerns", ""), names)
    elif mode == "draft":
        first_prompt = documents.build_draft_prompt(form.get("type", "other"), form.get("answers") or {}, names)

    try:
        messages = llm.build_messages(turns, doc_ids, first_prompt)
    except (LookupError, ValueError) as e:
        return _sse(iter([{"type": "error", "text": str(e)}]))
    return _sse(llm.stream_reply(mode, messages, store.get_profile()))


# ---------------------------------------------------------------- export
def _filename(title: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9 _-]+", "", title).strip().replace(" ", "_")[:80] or "document"
    return f"{safe}_{date.today().isoformat()}.docx"


def _branded_docx(body: dict) -> tuple[bytes, str]:
    title = body.get("title") or "Document"
    kind = body.get("kind") or "draft"
    doc_type = body.get("doc_type")
    group = ref = None
    if kind == "draft" and doc_type in documents.DRAFT_BY_ID:
        group = documents.DRAFT_BY_ID[doc_type]["group"]
        ref = export.reference_for(*documents.REF_CODES.get(doc_type, ("LEG", "GEN")))
    data = export.markdown_to_docx(body.get("markdown", ""), title, store.get_profile().get("name", ""),
                                   kind=kind, group=group, ref=ref)
    return data, title


DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@app.post("/api/export")
def export_docx():
    data, title = _branded_docx(request.get_json(force=True))
    return send_file(io.BytesIO(data), as_attachment=True, download_name=_filename(title), mimetype=DOCX_MIME)


# ---------------------------------------------------------------- library
@app.get("/api/library")
def library_list():
    q = request.args.get("q", "")
    folder = request.args.get("folder", "")
    deleted = request.args.get("deleted") == "1"
    return jsonify({"docs": library.search(q, folder, deleted), "counts": library.counts(), "total": library.total()})


@app.post("/api/library")
def library_upload():
    f = request.form
    out, errors = [], []
    uploads = request.files.getlist("files")
    for up in uploads:
        try:
            doc_id = library.add_document(
                up.filename or "document", up.read(), category=f.get("folder", "other"), user=_who(),
                title=f.get("title", "") if len(uploads) == 1 else "", description=f.get("description", ""),
                tags=f.get("tags", ""), doc_date=f.get("doc_date", ""))
            out.append(doc_id)
            store.log(_who(), "Added to library", f"#{doc_id} {up.filename}")
        except library.LibraryError as e:
            errors.append(str(e))
    return jsonify({"ids": out, "errors": errors})


@app.post("/api/library/from-assistant")
def library_from_assistant():
    body = request.get_json(force=True)
    if not (body.get("markdown") or "").strip():
        abort(400)
    data, title = _branded_docx(body)
    doc_id = library.add_document(
        _filename(title), data, category=body.get("folder") or "assistant", user=_who(), title=title,
        description=body.get("description", ""), tags=body.get("kind", ""), doc_date=date.today().isoformat(),
        note="Saved from the CS Assistant", text=body["markdown"])
    store.log(_who(), "Saved to library from the Assistant", f"#{doc_id} {title}")
    return jsonify({"id": doc_id})


def _doc_or_404(doc_id: int) -> dict:
    d = library.get(doc_id)
    if not d:
        abort(404)
    return d


@app.get("/api/library/<int:doc_id>")
def library_get(doc_id: int):
    return jsonify(_doc_or_404(doc_id))


@app.post("/api/library/<int:doc_id>")
def library_update(doc_id: int):
    _doc_or_404(doc_id)
    try:
        library.update_details(doc_id, request.get_json(force=True), _who())
    except library.LibraryError as e:
        return jsonify({"error": str(e)}), 400
    store.log(_who(), "Edited library details", f"#{doc_id}")
    return jsonify({"ok": True})


@app.post("/api/library/<int:doc_id>/version")
def library_new_version(doc_id: int):
    _doc_or_404(doc_id)
    up = request.files.get("file")
    if not up:
        return jsonify({"error": "Please choose the new file."}), 400
    try:
        n = library.add_version(doc_id, up.filename or "document", up.read(), user=_who(),
                                note=request.form.get("note", ""))
    except library.LibraryError as e:
        return jsonify({"error": str(e)}), 400
    store.log(_who(), "Uploaded new version", f"#{doc_id} v{n}")
    return jsonify({"version": n})


@app.delete("/api/library/<int:doc_id>")
def library_delete(doc_id: int):
    d = _doc_or_404(doc_id)
    library.set_deleted(doc_id, True, _who())
    store.log(_who(), "Removed from library", f"#{doc_id} {d['title']}")
    return jsonify({"ok": True})


@app.post("/api/library/<int:doc_id>/restore")
def library_restore(doc_id: int):
    d = _doc_or_404(doc_id)
    library.set_deleted(doc_id, False, _who())
    store.log(_who(), "Restored to library", f"#{doc_id} {d['title']}")
    return jsonify({"ok": True})


@app.get("/api/library/<int:doc_id>/file")
def library_file(doc_id: int):
    v = request.args.get("v")
    found = library.version_file(doc_id, int(v) if v else None)
    if not found:
        abort(404)
    path, ver = found
    mime = ver["mime"] or "application/octet-stream"
    # Only PDFs and ordinary pictures open in the browser; everything else downloads.
    inline = request.args.get("download") != "1" and (
        mime == "application/pdf" or mime in ("image/png", "image/jpeg", "image/webp"))
    return send_file(path, mimetype=mime, as_attachment=not inline,
                     download_name=ver["filename"])


@app.get("/api/library/<int:doc_id>/text")
def library_text(doc_id: int):
    t = library.read_text(doc_id, int(request.args.get("start", 0)), 200000)
    return jsonify(t) if t else abort(404)


@app.post("/api/library/<int:doc_id>/attach")
def library_attach(doc_id: int):
    """Hand a library document to Ask / Check / Write, like a fresh upload."""
    found = library.version_file(doc_id)
    if not found:
        abort(404)
    path, ver = found
    with open(path, "rb") as fh:
        data = fh.read()
    try:
        d = files.read_upload(ver["filename"], data)
    except files.UploadError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"id": d["id"], "name": d["name"], "summary": d["summary"]})


# ---------------------------------------------------------------- calendar
@app.get("/api/calendar")
def calendar_view():
    today = _today()
    fy = int(request.args.get("fy") or cal.current_fy_start(today))
    profile = store.get_profile()
    agm_dates = store.get_setting("agm_dates", {}) or {}
    done = store.filings_done()
    since = date.fromisoformat(store.get_setting("tracking_since") or today.isoformat())

    def occ_for(y):
        agm = agm_dates.get(str(y))
        return cal.occurrences(y, profile.get("flags", {}), date.fromisoformat(agm) if agm else None)

    items = occ_for(fy)
    # For the "coming up" list look across the year boundary too.
    window = [o for o in occ_for(fy - 1) + items + occ_for(fy + 1)
              if -60 <= (o.due - today).days <= 60]
    seen = set()

    def row(o):
        d = done.get(o.key)
        code, label = cal.status_for(o.due, today, bool(d))
        if not d and o.due < since:
            code, label = "untracked", "Before tracking started"
        it = o.item
        return {
            "key": o.key, "id": it.id, "title": it.title, "what": it.what, "law": it.law,
            "category": it.category, "who": it.who, "form": it.form, "penalty": it.penalty,
            "verify": it.verify, "tip": it.tip, "due": o.due.isoformat(), "period": o.period,
            "status": code, "status_label": label, "agm_based": o.extra.get("agm_based", False),
            "done_on": d["done_on"] if d else None, "srn": d["srn"] if d else "", "notes": d["notes"] if d else "",
            "done_by": d["done_by"] if d else None,
        }

    coming = []
    for o in sorted(window, key=lambda o: o.due):
        if o.key in seen:
            continue
        seen.add(o.key)
        r = row(o)
        if r["status"] in ("overdue", "today", "soon", "upcoming"):
            coming.append(r)
    return jsonify({
        "today": today.isoformat(), "fy": fy, "fy_label": cal.fy_label(fy),
        "agm_date": agm_dates.get(str(fy)) or cal.default_agm_date(fy).isoformat(),
        "agm_is_default": str(fy) not in agm_dates, "tracking_since": since.isoformat(),
        "coming": coming, "all": [row(o) for o in items],
    })


@app.post("/api/calendar/mark")
def calendar_mark():
    b = request.get_json(force=True)
    store.mark_filing(b["key"], b["id"], b["due"], b.get("done_on") or None, b.get("srn", ""), b.get("notes", ""), _who())
    store.log(_who(), "Marked filing done" if b.get("done_on") else "Marked filing not done", f"{b['id']} due {b['due']}")
    return jsonify({"ok": True})


@app.post("/api/calendar/agm")
def calendar_agm():
    b = request.get_json(force=True)
    agm = store.get_setting("agm_dates", {}) or {}
    if b.get("date"):
        date.fromisoformat(b["date"])
        agm[str(int(b["fy"]))] = b["date"]
    else:
        agm.pop(str(int(b["fy"])), None)
    store.set_setting("agm_dates", agm)
    store.log(_who(), "Set AGM date", f"FY {b['fy']}: {b.get('date') or 'cleared'}")
    return jsonify({"ok": True})


# ---------------------------------------------------------------- licences
@app.get("/api/licences")
def licences():
    today = _today()
    out = []
    for lic in store.list_licences():
        if lic["expiry"]:
            days = (date.fromisoformat(lic["expiry"]) - today).days
            if days < 0:
                lic["status"], lic["status_label"] = "overdue", f"EXPIRED {-days} days ago"
            elif days <= 30:
                lic["status"], lic["status_label"] = "soon", f"Expires in {days} days - renew now"
            elif days <= 90:
                lic["status"], lic["status_label"] = "upcoming", f"Expires in {days} days - start renewal"
            else:
                lic["status"], lic["status_label"] = "later", "Valid"
        else:
            lic["status"], lic["status_label"] = "unknown", "Enter expiry date"
        out.append(lic)
    return jsonify(out)


@app.post("/api/licences")
def licence_save():
    try:
        b = request.get_json(force=True)
        lic_id = store.save_licence(b)
        store.log(_who(), "Saved licence", f"{b.get('name', '')} expiry {b.get('expiry') or '-'}")
        return jsonify({"id": lic_id})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.delete("/api/licences/<int:lic_id>")
def licence_delete(lic_id: int):
    store.delete_licence(lic_id)
    store.log(_who(), "Deleted licence", f"#{lic_id}")
    return jsonify({"ok": True})


# ---------------------------------------------------------------- settings
@app.post("/api/profile")
def profile_save():
    _admin_only()
    b = request.get_json(force=True)
    current = store.get_profile()
    for k in ("name", "brand", "cin", "registered_office", "company_type", "parent", "pan", "gstin",
              "fy_end", "cs_name", "signatory", "notes"):
        if k in b:
            current[k] = str(b[k]).strip()
    if b.get("tracking_since"):
        store.set_setting("tracking_since", date.fromisoformat(b["tracking_since"]).isoformat())
    if "flags" in b:
        current["flags"] = {k: bool(b["flags"].get(k)) for k in cal.PROFILE_FLAGS}
    store.set_setting("profile", current)
    store.log(_who(), "Changed company details")
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"\n  CS Assistant is running. Open http://localhost:{port} in your browser.\n")
    app.run(host=host, port=port, threaded=True)
