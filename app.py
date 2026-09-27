"""CS Assistant - web server.

Run:  python app.py      then open http://localhost:8080 in the browser.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date

from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory, stream_with_context

from cs_assistant import calendar as cal
from cs_assistant import documents, export, files, llm, store


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
app.config["MAX_CONTENT_LENGTH"] = 60 * 1024 * 1024
store.init()

PASSWORD = os.environ.get("APP_PASSWORD", "")


@app.before_request
def _check_password():
    if not PASSWORD:
        return None
    auth = request.authorization
    if auth and auth.password == PASSWORD:
        return None
    return Response("Please sign in.", 401, {"WWW-Authenticate": 'Basic realm="CS Assistant"'})


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
    })


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


# ---------------------------------------------------------------- export & saved work
def _filename(title: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9 _-]+", "", title).strip().replace(" ", "_")[:80] or "document"
    return f"{safe}_{date.today().isoformat()}.docx"


@app.post("/api/export")
def export_docx():
    body = request.get_json(force=True)
    title = body.get("title") or "Document"
    kind = body.get("kind") or "draft"
    doc_type = body.get("doc_type")
    group = ref = None
    if kind == "draft" and doc_type in documents.DRAFT_BY_ID:
        group = documents.DRAFT_BY_ID[doc_type]["group"]
        ref = export.reference_for(*documents.REF_CODES.get(doc_type, ("LEG", "GEN")))
    data = export.markdown_to_docx(body.get("markdown", ""), title, store.get_profile().get("name", ""),
                                   kind=kind, group=group, ref=ref)
    from io import BytesIO
    return send_file(BytesIO(data), as_attachment=True, download_name=_filename(title),
                     mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.get("/api/work")
def work_list():
    return jsonify(store.list_work())


@app.post("/api/work")
def work_save():
    body = request.get_json(force=True)
    if not (body.get("markdown") or "").strip():
        abort(400)
    wid = store.save_work(body.get("kind", "note"), body.get("title") or "Untitled", body["markdown"])
    return jsonify({"id": wid})


@app.get("/api/work/<int:wid>")
def work_get(wid: int):
    w = store.get_work(wid)
    return jsonify(w) if w else abort(404)


@app.delete("/api/work/<int:wid>")
def work_delete(wid: int):
    store.delete_work(wid)
    return jsonify({"ok": True})


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
    store.mark_filing(b["key"], b["id"], b["due"], b.get("done_on") or None, b.get("srn", ""), b.get("notes", ""))
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
        return jsonify({"id": store.save_licence(request.get_json(force=True))})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.delete("/api/licences/<int:lic_id>")
def licence_delete(lic_id: int):
    store.delete_licence(lic_id)
    return jsonify({"ok": True})


# ---------------------------------------------------------------- settings
@app.post("/api/profile")
def profile_save():
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
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"\n  CS Assistant is running. Open http://localhost:{port} in your browser.\n")
    app.run(host=host, port=port, threaded=True)
