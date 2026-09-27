"""End-to-end test of the web app against a local fake of the Claude API."""

import io
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

CAPTURED = []


def sse(name, data):
    return f"event: {name}\ndata: {json.dumps(data)}\n\n"


class FakeClaude(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        CAPTURED.append({"path": self.path, "headers": dict(self.headers), "body": body})
        msg = {"id": "msg_1", "type": "message", "role": "assistant", "model": body["model"], "content": [],
               "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1}}
        out = sse("message_start", {"type": "message_start", "message": msg})
        out += sse("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
        for piece in ["## Verdict\n", "AMBER - sign after the changes below."]:
            out += sse("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": piece}})
        out += sse("content_block_stop", {"type": "content_block_stop", "index": 0})
        out += sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 12}})
        out += sse("message_stop", {"type": "message_stop"})
        data = out.encode()
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
    yield app_module.app.test_client()
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
