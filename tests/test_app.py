"""End-to-end test of the web app against a local fake of the Claude API."""

import io
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

CAPTURED = []
SCRIPT = []  # queued fake replies; each is a list of content blocks; empty = the default text answer


def sse(name, data):
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


def _stream(model, blocks, stop_reason):
    msg = {"id": "msg_1", "type": "message", "role": "assistant", "model": model, "content": [],
           "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1}}
    out = sse("message_start", {"type": "message_start", "message": msg})
    for i, b in enumerate(blocks):
        if b["type"] == "text":
            out += sse("content_block_start", {"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}})
            out += sse("content_block_delta", {"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": b["text"]}})
        else:
            out += sse("content_block_start", {"type": "content_block_start", "index": i, "content_block":
                       {"type": "tool_use", "id": b["id"], "name": b["name"], "input": {}}})
            out += sse("content_block_delta", {"type": "content_block_delta", "index": i, "delta":
                       {"type": "input_json_delta", "partial_json": json.dumps(b["input"])}})
        out += sse("content_block_stop", {"type": "content_block_stop", "index": i})
    out += sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop_reason, "stop_sequence": None}, "usage": {"output_tokens": 12}})
    out += sse("message_stop", {"type": "message_stop"})
    return out.encode()


class FakeClaude(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        CAPTURED.append({"path": self.path, "headers": dict(self.headers), "body": body})
        if SCRIPT:
            blocks = SCRIPT.pop(0)
            stop = "tool_use" if any(b["type"] == "tool_use" for b in blocks) else "end_turn"
        else:
            blocks, stop = [{"type": "text", "text": "## Verdict\nAMBER - sign after the changes below."}], "end_turn"
        data = _stream(body["model"], blocks, stop)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


@pytest.fixture(scope="module")
def client(monkeypatch_module):
    srv = HTTPServer(("127.0.0.1", 0), FakeClaude)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch_module.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch_module.setenv("ANTHROPIC_BASE_URL", f"http://127.0.0.1:{srv.server_port}")
    import app as app_module
    from cs_assistant import llm
    llm._client = None
    app_module.app.testing = True
    c = app_module.app.test_client()
    assert c.get("/api/meta").status_code == 401  # nothing without signing in
    r = c.post("/api/setup", json={"full_name": "Company Secretary", "username": "cs", "password": "correct-horse"})
    assert r.status_code == 200
    yield c
    srv.shutdown()


@pytest.fixture(scope="module")
def monkeypatch_module():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


def events(resp):
    return [json.loads(l[6:]) for l in resp.get_data(as_text=True).split("\n") if l.startswith("data: ")]


def test_meta_and_calendar(client):
    m = client.get("/api/meta").get_json()
    assert m["ai_ready"] is True
    assert any(d["id"] == "nda" for d in m["draft_types"])
    c = client.get("/api/calendar?fy=2026").get_json()
    assert c["fy_label"] == "2026-27" and c["all"]


def test_vet_flow_sends_document_and_instructions(client):
    up = client.post("/api/upload", data={"files": (io.BytesIO(b"This NDA is governed by the laws of Singapore."), "nda.txt")},
                     content_type="multipart/form-data").get_json()
    doc_id = up["files"][0]["id"]
    r = client.post("/api/chat", json={"mode": "vet", "doc_ids": [doc_id],
                                       "form": {"type": "nda", "role": "Both sides share information / obligations equally"},
                                       "turns": [{"role": "user", "text": "Check: nda.txt"}]})
    ev = events(r)
    text = "".join(e["text"] for e in ev if e["type"] == "text")
    assert "AMBER" in text and ev[-1]["type"] == "done"

    req = CAPTURED[-1]
    assert req["path"].startswith("/v1/messages")
    body = req["body"]
    assert body["model"] == "claude-opus-5"
    assert body["thinking"] == {"type": "adaptive"}
    assert body["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in req["headers"].get("anthropic-beta", "")
    assert body["system"][0]["cache_control"] == {"type": "ephemeral"}
    first = body["messages"][0]["content"]
    assert first[0]["type"] == "document" and "Singapore" in first[0]["source"]["data"]
    assert first[0]["cache_control"] == {"type": "ephemeral"}
    assert "NDA / Confidentiality Agreement" in first[-1]["text"]
    assert "tools" not in body  # web search only for questions


def test_ask_uses_web_search_on_official_sites(client):
    r = client.post("/api/chat", json={"mode": "ask", "turns": [
        {"role": "user", "text": "When is MGT-7 due?"},
        {"role": "assistant", "text": "Within 60 days of the AGM."},
        {"role": "user", "text": "And AOC-4?"}]})
    assert events(r)[-1]["type"] == "done"
    body = CAPTURED[-1]["body"]
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user"]
    tool = body["tools"][0]
    assert tool["type"] == "web_search_20260209" and "mca.gov.in" in tool["allowed_domains"]


def test_expired_upload_is_reported(client):
    r = client.post("/api/chat", json={"mode": "draft", "doc_ids": ["nope"], "form": {"type": "nda", "answers": {}},
                                       "turns": [{"role": "user", "text": "Draft"}]})
    ev = events(r)
    assert ev[0]["type"] == "error" and "expired" in ev[0]["text"]


def test_mark_filing_and_licence_and_export(client):
    c = client.get("/api/calendar?fy=2026").get_json()
    row = next(r for r in c["all"] if r["id"] == "aoc4")
    client.post("/api/calendar/mark", json={"key": row["key"], "id": row["id"], "due": row["due"], "done_on": "2026-10-20", "srn": "AB1234"})
    row2 = next(r for r in client.get("/api/calendar?fy=2026").get_json()["all"] if r["id"] == "aoc4")
    assert row2["status"] == "done" and row2["srn"] == "AB1234"

    lid = client.post("/api/licences", json={"name": "Fire NOC", "expiry": "2020-01-01"}).get_json()["id"]
    lic = next(l for l in client.get("/api/licences").get_json() if l["id"] == lid)
    assert lic["status"] == "overdue"

    r = client.post("/api/export", json={"title": "Test", "markdown": "# Hello\n\nWorld"})
    assert r.status_code == 200 and r.data[:2] == b"PK"


def test_setup_only_once_and_members_are_limited(client):
    import app as app_module
    assert client.post("/api/setup", json={"full_name": "X", "username": "x", "password": "12345678"}).status_code == 403
    assert client.post("/api/users", json={"full_name": "Anita Menon", "username": "anita", "password": "short"}).status_code == 400
    assert client.post("/api/users", json={"full_name": "Anita Menon", "username": "anita", "password": "legal-team-1"}).status_code == 200
    other = app_module.app.test_client()
    assert other.post("/api/login", json={"username": "anita", "password": "wrong-one"}).status_code == 401
    assert other.post("/api/login", json={"username": "ANITA", "password": "legal-team-1"}).status_code == 200
    assert other.get("/api/me").get_json()["user"]["role"] == "member"
    assert other.get("/api/users").status_code == 403
    assert other.get("/api/backup").status_code == 403
    assert other.post("/api/profile", json={"name": "x"}).status_code == 403
    assert other.get("/api/calendar").status_code == 200
    # the only admin cannot be demoted
    me = client.get("/api/me").get_json()["user"]
    assert client.post(f"/api/users/{me['id']}", json={"role": "member"}).status_code == 400


def test_login_is_throttled():
    import app as app_module
    c = app_module.app.test_client()
    for _ in range(5):
        c.post("/api/login", json={"username": "cs", "password": "nope-nope"})
    assert c.post("/api/login", json={"username": "cs", "password": "correct-horse"}).status_code == 429


def test_library_upload_search_versions_and_restore(client):
    import docx as _docx
    src = _docx.Document()
    src.add_paragraph("Article 45. The quorum for a meeting of the Board shall be one-third of its total strength or two directors.")
    buf = io.BytesIO()
    src.save(buf)
    r = client.post("/api/library", data={"files": (io.BytesIO(buf.getvalue()), "AOA_2019.docx"), "folder": "constitution",
                                          "title": "Articles of Association", "doc_date": "2019-09-27"},
                    content_type="multipart/form-data").get_json()
    assert r["errors"] == [] and len(r["ids"]) == 1
    doc_id = r["ids"][0]

    found = client.get("/api/library?q=quorum board").get_json()
    assert found["docs"][0]["id"] == doc_id and "«quorum»" in found["docs"][0]["snippet"].lower()
    assert client.get("/api/library?q=quorum&folder=contracts").get_json()["docs"] == []
    assert found["counts"]["constitution"] == 1

    v = client.post(f"/api/library/{doc_id}/version", data={"file": (io.BytesIO(b"Amended articles: quorum is three directors."), "AOA_2026.txt"),
                                                             "note": "Amended at the 31st AGM"}, content_type="multipart/form-data")
    assert v.get_json()["version"] == 2
    d = client.get(f"/api/library/{doc_id}").get_json()
    assert [x["version_no"] for x in d["versions"]] == [2, 1] and d["filename"] == "AOA_2026.txt"
    assert client.get(f"/api/library/{doc_id}/file?v=1&download=1").status_code == 200
    assert "three directors" in client.get(f"/api/library/{doc_id}/text").get_json()["text"]
    assert client.get("/api/library?q=one-third").get_json()["docs"] == []  # search follows the current version
    assert client.get("/api/library?q=quorum nonexistentword").get_json()["docs"][0]["id"] == doc_id  # any-word fallback

    att = client.post(f"/api/library/{doc_id}/attach").get_json()
    assert att["name"] == "AOA_2026.txt" and att["id"]

    client.delete(f"/api/library/{doc_id}")
    assert client.get("/api/library?q=quorum").get_json()["docs"] == []
    assert client.get("/api/library?deleted=1").get_json()["docs"][0]["id"] == doc_id
    client.post(f"/api/library/{doc_id}/restore")
    assert client.get("/api/library?q=quorum").get_json()["docs"][0]["id"] == doc_id

    saved = client.post("/api/library/from-assistant", json={"markdown": "# Note on quorum\n\nQuorum is three.", "title": "Note on quorum",
                                                             "kind": "answer", "folder": "assistant"}).get_json()
    got = client.get(f"/api/library/{saved['id']}").get_json()
    assert got["filename"].endswith(".docx") and got["category"] == "assistant"

    backup = client.get("/api/backup")
    import zipfile
    names = zipfile.ZipFile(io.BytesIO(backup.data)).namelist()
    assert "cs_assistant.db" in names and any(n.startswith("library/") for n in names)
    acts = [a["action"] for a in client.get("/api/activity").get_json()]
    assert "Added to library" in acts and "Uploaded new version" in acts


def test_assistant_searches_and_reads_the_library(client):
    hit = next(d for d in client.get("/api/library?q=quorum").get_json()["docs"] if d["title"] == "Articles of Association")
    SCRIPT.extend([
        [{"type": "tool_use", "id": "toolu_1", "name": "search_library", "input": {"query": "quorum board"}}],
        [{"type": "tool_use", "id": "toolu_2", "name": "read_library_document", "input": {"doc_id": hit["id"]}}],
        [{"type": "text", "text": "Our Articles (version 2) set the quorum at three directors."}],
    ])
    start = len(CAPTURED)
    r = client.post("/api/chat", json={"mode": "ask", "turns": [{"role": "user", "text": "What is our quorum?"}]})
    ev = events(r)
    assert "three directors" in "".join(e["text"] for e in ev if e["type"] == "text")
    assert any(e["type"] == "sources" and any(i["url"] == f"#doc/{hit['id']}" for i in e["items"]) for e in ev)
    calls = CAPTURED[start:]
    assert len(calls) == 3
    names = [t["name"] for t in calls[0]["body"]["tools"]]
    assert names[:2] == ["search_library", "read_library_document"] and "web_search" in names
    search_result = calls[1]["body"]["messages"][-1]["content"][0]
    assert search_result["tool_use_id"] == "toolu_1" and f'"doc_id": {hit["id"]}' in search_result["content"]
    read_result = calls[2]["body"]["messages"][-1]["content"][0]
    assert "three directors" in read_result["content"]


def test_bad_tool_input_is_returned_as_error(client):
    SCRIPT.extend([
        [{"type": "tool_use", "id": "toolu_9", "name": "read_library_document", "input": {"doc_id": "abc"}}],
        [{"type": "text", "text": "Sorry."}],
    ])
    start = len(CAPTURED)
    events(client.post("/api/chat", json={"mode": "ask", "turns": [{"role": "user", "text": "x"}]}))
    res = CAPTURED[start + 1]["body"]["messages"][-1]["content"][0]
    assert res["is_error"] is True
