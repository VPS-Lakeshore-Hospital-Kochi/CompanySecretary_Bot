"""CS Assistant - web server.

Run:  python app.py      then open http://localhost:8080 in the browser.
"""

from __future__ import annotations

import io
import json
import mimetypes
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
from cs_assistant import mailer, twofactor
from cs_assistant import board, documents, export, files, library, llm, records, registers, store
from cs_assistant.knowledge import OFFICIAL_LINKS


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

mimetypes.add_type("text/javascript", ".mjs")  # pdf.js is an ES module; older Pythons do not know .mjs
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 120 * 1024 * 1024
store.init()
library.init()
board.init()


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

OPEN_PATHS = {"/", "/api/me", "/api/login", "/api/login/code", "/api/setup", "/api/logout"}
# Someone who must set up two-step sign-in can do only that until it is done.
ENROL_PATHS = {"/api/two-step/start", "/api/two-step/confirm"}
# Directors sign in to the Board portal only: nothing of the Secretariat's tools is open to them.
DIRECTOR_PATHS = {"/", "/api/me", "/api/logout", "/api/me/password", "/api/two-step/start", "/api/two-step/confirm",
                  "/api/two-step/off"}
ROLES = ("admin", "member", "director")
_failures: dict[str, list[float]] = {}
_fail_lock = threading.Lock()


@app.before_request
def _require_login():
    g.user = None
    uid = session.get("uid")
    if uid:
        u = store.get_user(uid)
        # A password change, a two-step reset or switching the person off ends every older sign-in.
        if u and u["active"] and session.get("sv", 0) == u["session_version"]:
            g.user = u
        else:
            session.clear()
    if request.path.startswith("/static/") or request.path in OPEN_PATHS:
        return None
    if not g.user:
        return jsonify({"error": "Please sign in.", "login": True}), 401
    if _must_enrol():
        if request.path in ENROL_PATHS:
            return None
        return jsonify({"error": "Please set up two-step sign-in first.", "enrol": True}), 403
    is_director = g.user["role"] == "director"
    if is_director and request.path not in DIRECTOR_PATHS and not request.path.startswith("/api/portal/"):
        return jsonify({"error": "This page is not part of the Board portal."}), 403
    if not is_director and request.path.startswith("/api/portal/"):
        return jsonify({"error": "The Board portal is for directors. Use Board meetings instead."}), 403
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


def _must_enrol() -> bool:
    return bool(g.get("user")) and not g.user["two_step"] and twofactor.required_for(g.user["role"])


def _start_session(u: dict, how: str) -> None:
    session.clear()
    session.permanent = True
    session["uid"] = u["id"]
    session["sv"] = u["session_version"]
    store.update_user(u["id"], last_login=datetime.now().isoformat(timespec="seconds"))
    store.log(u["username"], how)


def _too_many(key: str) -> bool:
    now = time.time()
    with _fail_lock:
        recent = [t for t in _failures.get(key, []) if now - t < 300]
        _failures[key] = recent
        return len(recent) >= 5


def _failed(key: str) -> None:
    with _fail_lock:
        _failures.setdefault(key, []).append(time.time())


def _password_ok(pw: str) -> str | None:
    if len(pw or "") < 8:
        return "The password must be at least 8 characters."
    return None


@app.get("/api/me")
def me():
    user = {k: v for k, v in g.user.items() if k != "session_version"} if g.user else None
    return jsonify({"user": user, "needs_setup": store.user_count() == 0, "must_enrol": _must_enrol(),
                    "two_step_policy": twofactor.policy()})


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
    _start_session(store.get_user(uid), "Set up the site")
    return jsonify({"ok": True})


@app.post("/api/login")
def login():
    b = request.get_json(force=True)
    username = (b.get("username") or "").strip()
    key = f"{username.lower()}|{request.remote_addr}"
    if _too_many(key):
        return jsonify({"error": "Too many wrong attempts. Please wait five minutes and try again."}), 429
    u = store.user_with_hash(username)
    if not u or not u["active"] or not check_password_hash(u["password_hash"], b.get("password") or ""):
        _failed(key)
        return jsonify({"error": "The username or password is not right."}), 401
    if u["totp_secret"]:
        # Password right; the code from the authenticator app comes next.
        session.clear()
        session["pending_uid"] = u["id"]
        session["pending_at"] = time.time()
        return jsonify({"needs_code": True})
    _start_session(u, "Signed in")
    return jsonify({"ok": True, "must_enrol": twofactor.required_for(u["role"])})


@app.post("/api/login/code")
def login_code():
    uid, at = session.get("pending_uid"), session.get("pending_at", 0)
    if not uid or time.time() - at > 300:
        session.clear()
        return jsonify({"error": "Please sign in again with your username and password.", "login": True}), 401
    u = store.get_user(uid)
    full = store.user_with_hash(u["username"]) if u else None
    if not full or not full["active"] or not full["totp_secret"]:
        session.clear()
        return jsonify({"error": "Please sign in again.", "login": True}), 401
    key = f"code|{uid}"
    if _too_many(key):
        return jsonify({"error": "Too many wrong codes. Please wait five minutes and try again."}), 429
    code = (request.get_json(force=True).get("code") or "").strip()
    step = twofactor.verify(full["totp_secret"], code, full["totp_last_step"])
    if step is not None:
        store.update_user(uid, totp_last_step=step)
        _start_session(store.get_user(uid), "Signed in (two-step)")
        return jsonify({"ok": True})
    remaining = twofactor.use_recovery_code(code, json.loads(full["recovery_codes"] or "[]"))
    if remaining is not None:
        store.update_user(uid, recovery_codes=json.dumps(remaining))
        _start_session(store.get_user(uid), "Signed in with a recovery code")
        return jsonify({"ok": True, "recovery_left": len(remaining)})
    _failed(key)
    return jsonify({"error": "That code is not right. Check the time on your phone and use the newest code."}), 401


# ---------------------------------------------------------------- two-step sign-in (own account)
@app.post("/api/two-step/start")
def two_step_start():
    """A new secret for the authenticator app. It is kept in the session until a code confirms it."""
    secret = twofactor.new_secret()
    session["totp_new"] = secret
    issuer = (store.get_profile().get("brand") or "VPS Lakeshore") + " Board"
    uri = twofactor.otpauth_uri(secret, g.user["username"], issuer)
    return jsonify({"secret": " ".join(secret[i:i + 4] for i in range(0, len(secret), 4)), "uri": uri,
                    "qr_svg": twofactor.qr_svg(uri)})


@app.post("/api/two-step/confirm")
def two_step_confirm():
    secret = session.get("totp_new")
    if not secret:
        return jsonify({"error": "Please start again."}), 400
    key = f"enrol|{g.user['id']}"
    if _too_many(key):
        return jsonify({"error": "Too many wrong codes. Please wait five minutes and try again."}), 429
    step = twofactor.verify(secret, request.get_json(force=True).get("code", ""))
    if step is None:
        _failed(key)
        return jsonify({"error": "That code is not right. Type the 6 digits the app shows now."}), 400
    codes, hashes = twofactor.new_recovery_codes()
    store.update_user(g.user["id"], totp_secret=secret, totp_last_step=step, recovery_codes=json.dumps(hashes),
                      bump_session=True)
    session.pop("totp_new", None)
    session["sv"] = store.get_user(g.user["id"])["session_version"]  # keep this sign-in; end all others
    store.log(_who(), "Turned on two-step sign-in")
    return jsonify({"ok": True, "recovery_codes": codes})


@app.post("/api/two-step/off")
def two_step_off():
    if twofactor.required_for(g.user["role"]):
        return jsonify({"error": "Two-step sign-in is required for your account, so it cannot be turned off."}), 400
    u = store.user_with_hash(g.user["username"])
    if not check_password_hash(u["password_hash"], request.get_json(force=True).get("password") or ""):
        return jsonify({"error": "Your password is not right."}), 400
    store.update_user(u["id"], totp_secret=None, totp_last_step=None, recovery_codes=None)
    store.log(_who(), "Turned off two-step sign-in")
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
    store.update_user(u["id"], password_hash=generate_password_hash(b["new"]), bump_session=True)
    session["sv"] = store.get_user(u["id"])["session_version"]  # keep this sign-in; end all others
    store.log(_who(), "Changed own password")
    return jsonify({"ok": True})


def _email_or_error(v: str) -> str:
    v = str(v or "").strip()
    if v and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
        raise ValueError("That e-mail address does not look right.")
    return v


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
    role = b.get("role") if b.get("role") in ROLES else "member"
    try:
        uid = store.create_user(b["username"], b["full_name"], generate_password_hash(b["password"]), role,
                                _email_or_error(b.get("email", "")))
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
        fields["role"] = b["role"] if b["role"] in ROLES else "member"
    if "active" in b:
        fields["active"] = 1 if b["active"] else 0
    if "email" in b:
        try:
            fields["email"] = _email_or_error(b["email"]) or None
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
    if b.get("reset_two_step"):
        fields.update(totp_secret=None, totp_last_step=None, recovery_codes=None)
    if b.get("password"):
        err = _password_ok(b["password"])
        if err:
            return jsonify({"error": err}), 400
        fields["password_hash"] = generate_password_hash(b["password"])
    losing_admin = target["role"] == "admin" and target["active"] and (
        fields.get("role", "admin") != "admin" or fields.get("active") == 0)
    if losing_admin and store.active_admins() <= 1:
        return jsonify({"error": "There must always be at least one active administrator."}), 400
    # Resetting the password or two-step, or switching someone off, signs them out everywhere.
    bump = bool({"password_hash", "totp_secret"} & set(fields)) or fields.get("active") == 0
    store.update_user(uid, bump_session=bump, **fields)
    if uid == g.user["id"] and bump and fields.get("active") != 0:
        session["sv"] = store.get_user(uid)["session_version"]
    what = ", ".join({"password_hash": "password reset", "totp_secret": "two-step reset"}.get(k, k)
                     for k in fields if k not in ("totp_last_step", "recovery_codes"))
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
            for folder in (library.LIB_DIR, board.BOARD_DIR):
                for root, _, names in os.walk(folder):
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
        "registers": registers.spec(),
        "transplant_checklist": [list(x) for x in registers.TRANSPLANT_CHECKLIST],
        "transplant_verify": registers.TRANSPLANT_VERIFY,
        "directors_verify": registers.DIRECTORS_VERIFY,
        "committee_presets": registers.COMMITTEE_PRESETS,
        "board": board.spec(),
        "records": {
            "requesters": [list(x) for x in records.REQUESTERS],
            "types": [{k: r[k] for k in ("id", "title", "examples", "group")} for r in records.RECORDS],
            "matrix": records.matrix(),
            "general_steps": records.GENERAL_STEPS,
            "retention": records.RETENTION,
            "destruction_steps": records.DESTRUCTION_STEPS,
        },
    })


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


# ---------------------------------------------------------------- registers
def _kind_or_404(kind: str) -> str:
    if kind not in registers.REGISTERS:
        abort(404)
    return kind


@app.get("/api/register/<kind>")
def register_list(kind: str):
    return jsonify(store.list_rows(_kind_or_404(kind)))


@app.post("/api/register/<kind>")
def register_save(kind: str):
    _kind_or_404(kind)
    b = request.get_json(force=True)
    try:
        data = registers.validate(kind, b)
        row_id = store.save_row(kind, data, int(b["id"]) if b.get("id") else None, _who())
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    label = data.get(registers.REGISTERS[kind]["required"], "")
    store.log(_who(), f"Saved {registers.REGISTERS[kind]['singular']}", f"{kind}: {label}")
    return jsonify({"id": row_id})


@app.delete("/api/register/<kind>/<int:row_id>")
def register_delete(kind: str, row_id: int):
    _kind_or_404(kind)
    store.delete_row(kind, row_id)
    store.log(_who(), f"Deleted {registers.REGISTERS[kind]['singular']}", f"{kind} #{row_id}")
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


# ---------------------------------------------------------------- board meetings (Secretariat)
def _board_error(e: Exception):
    return jsonify({"error": str(e)}), 400


def _meeting_or_404(mid: int) -> dict:
    m = board.get_meeting(mid)
    if not m:
        abort(404)
    return m


def _paper_upload() -> tuple[str, bytes] | None:
    up = request.files.get("paper")
    return (up.filename or "paper", up.read()) if up and up.filename else None


def _form_or_json() -> dict:
    if request.is_json:
        return request.get_json(force=True)
    b = request.form.to_dict()
    for k in ("invitees", "withheld_from", "recipients", "interested"):
        if k in b:
            try:
                b[k] = json.loads(b[k] or "[]")
            except ValueError:
                b[k] = []
    return b


def _send_paper(stored: str | None, name: str | None, mime: str | None, download: bool = False):
    path = board.file_path(stored)
    if not path:
        abort(404)
    mime = mime or "application/octet-stream"
    inline = not download and mime in ("application/pdf", "image/png", "image/jpeg")
    resp = send_file(path, mimetype=mime, as_attachment=not inline, download_name=name or os.path.basename(path))
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


def _pack_response(data: bytes, m: dict):
    safe = re.sub(r"[^A-Za-z0-9 _-]+", "", m["title"]).strip().replace(" ", "_")[:60] or "Board_pack"
    resp = send_file(io.BytesIO(data), mimetype="application/pdf", as_attachment=request.args.get("download") == "1",
                     download_name=f"{safe}_{m['meeting_date']}_pack.pdf")
    resp.headers["Cache-Control"] = "private, no-store"
    return resp


@app.get("/api/board/directors")
def board_directors():
    return jsonify(board.directors())


@app.get("/api/board/meetings")
def board_meetings():
    return jsonify({"meetings": board.list_meetings(), "next_due": board.next_board_due(_today()),
                    "circulars": board.list_circulars()})


@app.post("/api/board/meetings")
def board_meeting_create():
    try:
        mid = board.save_meeting(request.get_json(force=True), _who())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Created meeting", f"#{mid}")
    return jsonify({"id": mid})


@app.get("/api/board/meetings/<int:mid>")
def board_meeting_get(mid: int):
    return jsonify(board.meeting_overview(mid) or abort(404))


@app.post("/api/board/meetings/<int:mid>")
def board_meeting_update(mid: int):
    m = _meeting_or_404(mid)
    try:
        board.save_meeting(request.get_json(force=True), _who(), mid)
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Changed meeting", f"#{mid} {m['title']}")
    return jsonify({"ok": True})


@app.delete("/api/board/meetings/<int:mid>")
def board_meeting_delete(mid: int):
    m = _meeting_or_404(mid)
    try:
        board.delete_meeting(mid)
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Deleted meeting", f"#{mid} {m['title']}")
    return jsonify({"ok": True})


@app.post("/api/board/meetings/<int:mid>/status")
def board_meeting_status(mid: int):
    m = _meeting_or_404(mid)
    status = request.get_json(force=True).get("status", "")
    try:
        board.set_status(mid, status, _who())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), f"Meeting marked {status}", f"#{mid} {m['title']}")
    kind = {"published": "published", "cancelled": "cancelled"}.get(status)
    if kind == "cancelled" and m["status"] != "published":
        kind = None  # directors never saw it
    if kind == "published" and m["published_at"]:
        kind = None  # re-publishing after taking back to draft: send "revised" by hand if needed
    return jsonify({"ok": True, "email": _auto_email(kind, "meeting", board.get_meeting(mid), m["invitees"]) if kind else None})


def _auto_email(kind: str, ref_type: str, ref: dict, user_ids: list[int]) -> dict | None:
    """Send the notice if e-mail is set up; a mail failure never undoes the action itself."""
    if not mailer.ready():
        return None
    try:
        r = board.send_notice(kind, ref_type, ref, user_ids, _who())
    except board.BoardError as e:
        return {"error": str(e), "sent": 0, "failed": [], "no_email": []}
    store.log(_who(), "E-mailed directors", f"{kind} {ref_type} #{ref['id']}: {r['sent']} sent")
    return r


@app.post("/api/board/meetings/<int:mid>/email")
def board_meeting_email(mid: int):
    m = _meeting_or_404(mid)
    kind = request.get_json(force=True).get("kind", "")
    if kind not in ("published", "revised", "remind_reply", "remind_read"):
        abort(400)
    if m["status"] != "published":
        return jsonify({"error": "Publish the meeting first."}), 400
    who = {"remind_reply": "reply", "remind_read": "read"}.get(kind, "all")
    targets = board.reminder_targets(mid, who)
    if not targets:
        return jsonify({"error": "No one needs this reminder."}), 400
    try:
        r = board.send_notice(kind, "meeting", m, targets, _who())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "E-mailed directors", f"{kind} meeting #{mid}: {r['sent']} sent")
    return jsonify(r)


@app.post("/api/board/meetings/<int:mid>/items")
def board_item_create(mid: int):
    _meeting_or_404(mid)
    try:
        iid = board.save_item(mid, _form_or_json(), _who(), paper=_paper_upload())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Added agenda item", f"meeting #{mid} item #{iid}")
    return jsonify({"id": iid})


@app.post("/api/board/meetings/<int:mid>/items/<int:iid>")
def board_item_update(mid: int, iid: int):
    _meeting_or_404(mid)
    b = _form_or_json()
    paper = _paper_upload()
    try:
        board.save_item(mid, b, _who(), iid, paper=paper, remove_paper=str(b.get("remove_paper")) in ("1", "true", "True"))
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Changed agenda item" + (" and uploaded a new paper" if paper else ""), f"meeting #{mid} item #{iid}")
    return jsonify({"ok": True})


@app.delete("/api/board/meetings/<int:mid>/items/<int:iid>")
def board_item_delete(mid: int, iid: int):
    _meeting_or_404(mid)
    board.delete_item(mid, iid)
    store.log(_who(), "Removed agenda item", f"meeting #{mid} item #{iid}")
    return jsonify({"ok": True})


@app.post("/api/board/meetings/<int:mid>/order")
def board_item_order(mid: int):
    _meeting_or_404(mid)
    board.reorder(mid, request.get_json(force=True).get("order") or [])
    return jsonify({"ok": True})


@app.post("/api/board/meetings/<int:mid>/note-circulars")
def board_note_circulars(mid: int):
    _meeting_or_404(mid)
    iid = board.note_circulars_at(mid, _who())
    if not iid:
        return jsonify({"error": "There are no passed circular resolutions waiting to be noted."}), 400
    store.log(_who(), "Added circular resolutions for noting", f"meeting #{mid}")
    return jsonify({"id": iid})


@app.post("/api/board/meetings/<int:mid>/minutes/draft")
def board_minutes_draft(mid: int):
    m = _meeting_or_404(mid)
    paper = _paper_upload()
    if not paper:
        return jsonify({"error": "Please choose the draft minutes file."}), 400
    try:
        board.save_minutes_draft(mid, paper, _who())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Uploaded draft minutes", f"#{mid} {m['title']}")
    return jsonify({"ok": True})


@app.post("/api/board/meetings/<int:mid>/minutes/circulate")
def board_minutes_circulate(mid: int):
    m = _meeting_or_404(mid)
    try:
        mn = board.circulate_minutes(mid, _who(), _today())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Circulated draft minutes", f"#{mid} {m['title']} v{mn['version']}")
    return jsonify({"ok": True, "email": _auto_email("minutes_draft", "meeting", m | {"comments_by": mn["comments_by"]},
                                                      m["invitees"])})


@app.post("/api/board/meetings/<int:mid>/minutes/sign")
def board_minutes_sign(mid: int):
    m = _meeting_or_404(mid)
    f = request.form
    paper = _paper_upload()
    try:
        mn = board.sign_minutes(mid, f.get("signed_on", ""), f.get("signed_by", ""), paper, _who())
    except board.BoardError as e:
        return _board_error(e)
    # Keep the signed minutes in the document library too, in the Board meetings folder.
    try:
        doc_id = library.add_document(paper[0], paper[1], category="board", user=_who(),
                                      title=f"Signed minutes - {m['title']} ({m['meeting_date']})",
                                      description=f"Signed by {mn['signed_by']} on {mn['signed_on']}. Added from Board meetings.",
                                      tags="minutes, signed", doc_date=m["meeting_date"])
        board.set_minutes_library_doc(mid, doc_id)
    except library.LibraryError:
        doc_id = None
    store.log(_who(), "Recorded signed minutes", f"#{mid} {m['title']} signed {mn['signed_on']} by {mn['signed_by']}")
    return jsonify({"ok": True, "library_doc_id": doc_id,
                    "email": _auto_email("minutes_final", "meeting", m, m["invitees"])})


def _minutes_file(mid: int, which: str):
    mn = board.get_minutes(mid) or {}
    if which == "signed":
        return _send_paper(mn.get("signed_stored"), mn.get("signed_name"), mn.get("signed_mime"), request.args.get("download") == "1")
    return _send_paper(mn.get("draft_stored"), mn.get("draft_name"), mn.get("draft_mime"), request.args.get("download") == "1")


@app.get("/api/board/meetings/<int:mid>/minutes/file")
def board_minutes_file(mid: int):
    _meeting_or_404(mid)
    return _minutes_file(mid, request.args.get("which", "draft"))


@app.get("/api/board/items/<int:iid>/paper")
def board_item_paper(iid: int):
    it = board.get_item(iid)
    if not it:
        abort(404)
    return _send_paper(it["paper_stored"], it["paper_name"], it["paper_mime"], request.args.get("download") == "1")


@app.get("/api/board/meetings/<int:mid>/pack")
def board_pack(mid: int):
    m = _meeting_or_404(mid)
    data = board.build_pack(mid, f"{g.user['full_name']} (Secretariat copy)")
    store.log(_who(), "Downloaded Board pack", f"#{mid} {m['title']}")
    return _pack_response(data, m)


@app.post("/api/board/circulars")
def board_circular_create():
    try:
        cid = board.save_circular(_form_or_json(), _who(), paper=_paper_upload())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Drafted circular resolution", f"#{cid}")
    return jsonify({"id": cid})


@app.get("/api/board/circulars/<int:cid>")
def board_circular_get(cid: int):
    return jsonify(board.circular_overview(cid) or abort(404))


@app.post("/api/board/circulars/<int:cid>")
def board_circular_update(cid: int):
    try:
        board.save_circular(_form_or_json(), _who(), cid, paper=_paper_upload())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Changed circular resolution", f"#{cid}")
    return jsonify({"ok": True})


@app.delete("/api/board/circulars/<int:cid>")
def board_circular_delete(cid: int):
    try:
        board.delete_circular(cid)
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Deleted draft circular resolution", f"#{cid}")
    return jsonify({"ok": True})


@app.post("/api/board/circulars/<int:cid>/circulate")
def board_circular_send(cid: int):
    try:
        board.circulate(cid, _who())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Circulated resolution", f"#{cid}")
    cr = board.get_circular(cid)
    return jsonify({"ok": True, "email": _auto_email("circular", "circular", cr, cr["recipients"])})


@app.post("/api/board/circulars/<int:cid>/email")
def board_circular_email(cid: int):
    cr = board.get_circular(cid)
    if not cr:
        abort(404)
    if cr["status"] != "open":
        return jsonify({"error": "Only an open resolution can be chased."}), 400
    targets = board.circular_reminder_targets(cid)
    if not targets:
        return jsonify({"error": "Every director entitled to vote has replied."}), 400
    try:
        r = board.send_notice("remind_vote", "circular", cr, targets, _who())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "E-mailed directors", f"remind_vote circular #{cid}: {r['sent']} sent")
    return jsonify(r)


@app.post("/api/board/circulars/<int:cid>/close")
def board_circular_close(cid: int):
    outcome = request.get_json(force=True).get("outcome", "")
    try:
        board.close_circular(cid, outcome, _who())
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Closed circular resolution", f"#{cid}: {outcome}")
    return jsonify({"ok": True})


@app.get("/api/board/circulars/<int:cid>/paper")
def board_circular_paper(cid: int):
    cr = board.get_circular(cid)
    if not cr:
        abort(404)
    return _send_paper(cr["paper_stored"], cr["paper_name"], cr["paper_mime"], request.args.get("download") == "1")


# ---------------------------------------------------------------- Board portal (directors)
def _uid() -> int:
    return int(g.user["id"])


def _portal_meeting_or_404(mid: int) -> dict:
    m = board.get_meeting(mid)
    if not board.can_see_meeting(m, _uid()):
        abort(404)
    return m


def _portal_item_or_404(iid: int) -> dict:
    it = board.get_item(iid)
    if not it or _uid() in it["withheld_from"]:
        abort(404)
    _portal_meeting_or_404(it["meeting_id"])
    return it


@app.get("/api/portal/home")
def portal_home():
    p = store.get_profile()
    return jsonify(board.portal_home(_uid(), _today()) | {
        "spec": {k: v for k, v in board.spec().items() if k in ("rsvp", "votes")},
        "company": {"name": p.get("name", ""), "brand": p.get("brand", ""), "cs_name": p.get("cs_name", "")}})


@app.get("/api/portal/meetings/<int:mid>")
def portal_meeting(mid: int):
    return jsonify(board.portal_meeting(mid, _uid()) or abort(404))


@app.post("/api/portal/meetings/<int:mid>/rsvp")
def portal_rsvp(mid: int):
    m = _portal_meeting_or_404(mid)
    b = request.get_json(force=True)
    try:
        board.set_rsvp(mid, _uid(), b.get("response", ""), b.get("note", ""))
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Replied to meeting", f"#{mid} {m['title']}: {b.get('response')}")
    return jsonify({"ok": True})


@app.get("/api/portal/items/<int:iid>/paper")
def portal_paper(iid: int):
    it = _portal_item_or_404(iid)
    board.record_view(iid, _uid())
    store.log(_who(), "Opened Board paper", f"item #{iid} {it['paper_name'] or ''}")
    return _send_paper(it["paper_stored"], it["paper_name"], it["paper_mime"], request.args.get("download") == "1")


@app.post("/api/portal/items/<int:iid>/note")
def portal_note(iid: int):
    _portal_item_or_404(iid)
    board.save_note(iid, _uid(), request.get_json(force=True).get("text", ""))
    return jsonify({"ok": True})


@app.get("/api/portal/items/<int:iid>")
def portal_item(iid: int):
    """One agenda item for the paper viewer, with the director's own highlights."""
    it = _portal_item_or_404(iid)
    m = board.get_meeting(it["meeting_id"])
    return jsonify({"item": {k: it[k] for k in ("id", "meeting_id", "title", "kind", "paper_name", "paper_mime", "paper_size")}
                    | {"revised": board.is_revised(it, m)},
                    "meeting": {k: m[k] for k in ("id", "title", "meeting_date")},
                    "marks": board.marks_for(iid, _uid())})


@app.post("/api/portal/items/<int:iid>/marks")
def portal_mark_add(iid: int):
    _portal_item_or_404(iid)
    try:
        mark_id = board.add_mark(iid, _uid(), request.get_json(force=True))
    except board.BoardError as e:
        return _board_error(e)
    return jsonify({"id": mark_id})


@app.post("/api/portal/marks/<int:mark_id>")
def portal_mark_update(mark_id: int):
    r = board.update_mark(mark_id, _uid(), request.get_json(force=True))
    if not r:
        abort(404)
    _portal_item_or_404(r["item_id"])
    return jsonify({"ok": True})


@app.delete("/api/portal/marks/<int:mark_id>")
def portal_mark_delete(mark_id: int):
    if not board.delete_mark(mark_id, _uid()):
        abort(404)
    return jsonify({"ok": True})


@app.get("/api/portal/meetings/<int:mid>/pack")
def portal_pack(mid: int):
    m = _portal_meeting_or_404(mid)
    data = board.build_pack(mid, g.user["full_name"], _uid())
    for it in board.items_for(mid, _uid()):
        if it["paper_stored"]:
            board.record_view(it["id"], _uid())
    store.log(_who(), "Downloaded Board pack", f"#{mid} {m['title']}")
    return _pack_response(data, m)


@app.get("/api/portal/meetings/<int:mid>/minutes/file")
def portal_minutes_file(mid: int):
    m = _portal_meeting_or_404(mid)
    pm = board.portal_minutes(mid, _uid())
    which = request.args.get("which", "draft")
    if not pm or (which == "signed" and pm["stage"] != "signed") or (which == "draft" and pm["stage"] != "circulated"):
        abort(404)
    store.log(_who(), "Opened minutes", f"#{mid} {m['title']} ({which})")
    return _minutes_file(mid, which)


@app.post("/api/portal/meetings/<int:mid>/minutes/comment")
def portal_minutes_comment(mid: int):
    m = _portal_meeting_or_404(mid)
    b = request.get_json(force=True)
    try:
        board.comment_on_minutes(mid, _uid(), b.get("kind", ""), b.get("text", ""))
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Replied on draft minutes", f"#{mid} {m['title']}: {b.get('kind')}")
    return jsonify({"ok": True})


@app.get("/api/portal/circulars/<int:cid>")
def portal_circular(cid: int):
    return jsonify(board.portal_circular(cid, _uid()) or abort(404))


@app.get("/api/portal/circulars/<int:cid>/paper")
def portal_circular_paper(cid: int):
    if not board.portal_circular(cid, _uid()):
        abort(404)
    cr = board.get_circular(cid)
    return _send_paper(cr["paper_stored"], cr["paper_name"], cr["paper_mime"], request.args.get("download") == "1")


@app.post("/api/portal/circulars/<int:cid>/vote")
def portal_vote(cid: int):
    b = request.get_json(force=True)
    try:
        board.cast_vote(cid, _uid(), b.get("vote", ""), b.get("comment", ""))
    except board.BoardError as e:
        return _board_error(e)
    store.log(_who(), "Replied to circular resolution", f"#{cid}: {b.get('vote')}")
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"\n  CS Assistant is running. Open http://localhost:{port} in your browser.\n")
    app.run(host=host, port=port, threaded=True)
