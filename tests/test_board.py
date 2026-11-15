"""Board meetings, the directors' portal and resolutions by circulation."""

import io
import time

import pytest
from pypdf import PdfReader, PdfWriter


def _pdf(text_pages: int = 1) -> bytes:
    w = PdfWriter()
    for _ in range(text_pages):
        w.add_blank_page(612, 792)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


@pytest.fixture(scope="module")
def site():
    import app as app_module
    app_module.app.testing = True
    app_module._failures.clear()  # other tests try wrong passwords on purpose
    cs = app_module.app.test_client()
    if cs.get("/api/me").get_json()["needs_setup"]:
        assert cs.post("/api/setup", json={"full_name": "Company Secretary", "username": "cs", "password": "correct-horse"}).status_code == 200
    else:
        assert cs.post("/api/login", json={"username": "cs", "password": "correct-horse"}).status_code == 200
    ids = {}
    for u, name in (("chair", "Dr Chair Person"), ("idir", "Independent Director"), ("ned", "Interested Director")):
        r = cs.post("/api/users", json={"username": u, "full_name": name, "password": "board-pass-1", "role": "director"})
        assert r.status_code == 200, r.get_json()
        ids[u] = r.get_json()["id"]
    clients, secrets = {}, {}
    for u in ids:
        c = app_module.app.test_client()
        r = c.post("/api/login", json={"username": u, "password": "board-pass-1"})
        assert r.status_code == 200 and r.get_json()["must_enrol"] is True
        secrets[u] = enrol(c)
        clients[u] = c
    return {"cs": cs, "ids": ids, "d": clients, "secrets": secrets}


def enrol(c) -> str:
    """Set up two-step sign-in for the signed-in client; returns the secret."""
    from cs_assistant import twofactor
    start = c.post("/api/two-step/start").get_json()
    secret = start["secret"].replace(" ", "")
    assert start["uri"].startswith("otpauth://totp/") and start["qr_svg"].startswith("<svg")
    r = c.post("/api/two-step/confirm", json={"code": twofactor.code_now(secret)})
    assert r.status_code == 200 and len(r.get_json()["recovery_codes"]) == 8
    return secret


def sign_in(c, username, secret, password="board-pass-1", ahead=1):
    """Password, then a code. `ahead` uses a later 30-second step, as a code cannot be used twice."""
    from cs_assistant import twofactor
    r = c.post("/api/login", json={"username": username, "password": password})
    assert r.get_json() == {"needs_code": True}
    return c.post("/api/login/code", json={"code": twofactor.code_now(secret, time.time() + 30 * ahead)})


def test_directors_cannot_reach_secretariat_tools(site):
    d = site["d"]["chair"]
    assert d.get("/api/me").get_json()["user"]["role"] == "director"
    for path in ("/api/meta", "/api/library", "/api/board/meetings", "/api/calendar", "/api/register/decisions", "/api/users"):
        assert d.get(path).status_code == 403, path
    assert d.get("/api/portal/home").status_code == 200
    # ...and the Secretariat does not use the directors' portal.
    assert site["cs"].get("/api/portal/home").status_code == 403


def test_meeting_pack_rsvp_and_withheld_paper(site):
    cs, ids, d = site["cs"], site["ids"], site["d"]
    everyone = list(ids.values())
    r = cs.post("/api/board/meetings", json={"title": "143rd Board Meeting", "body": "Board of Directors",
                                             "meeting_date": "2026-12-10", "notice_sent_on": "2026-12-06",
                                             "mode": "Video conference", "invitees": everyone})
    mid = r.get_json()["id"]

    # Cannot publish an empty meeting.
    assert cs.post(f"/api/board/meetings/{mid}/status", json={"status": "published"}).status_code == 400

    r = cs.post(f"/api/board/meetings/{mid}/items", data={"title": "Approve the half-yearly accounts", "kind": "For approval",
                                                           "resolution": "RESOLVED THAT the accounts be approved.",
                                                           "paper": (io.BytesIO(_pdf(2)), "accounts.pdf")},
                content_type="multipart/form-data")
    accounts = r.get_json()["id"]
    r = cs.post(f"/api/board/meetings/{mid}/items", data={
        "title": "Lease of premises from a director's relative (Sec. 188)", "withheld_from": f"[{ids['ned']}]",
        "paper": (io.BytesIO(_pdf(1)), "rpt.pdf")}, content_type="multipart/form-data")
    rpt = r.get_json()["id"]
    bad = cs.post(f"/api/board/meetings/{mid}/items", data={"title": "x", "paper": (io.BytesIO(b"MZ..."), "virus.exe")},
                  content_type="multipart/form-data")
    assert bad.status_code == 400

    # Not visible to directors until published.
    assert d["chair"].get(f"/api/portal/meetings/{mid}").status_code == 404
    assert cs.post(f"/api/board/meetings/{mid}/status", json={"status": "published"}).status_code == 200

    ov = cs.get(f"/api/board/meetings/{mid}").get_json()
    notice = next(c for c in ov["compliance"] if c["text"].startswith("Notice sent"))
    assert notice["level"] == "warn"  # 4 days' notice is short
    assert any("video conference link" in c["text"] for c in ov["compliance"])

    home = d["ned"].get("/api/portal/home").get_json()
    assert home["meetings"][0]["papers"] == 1 and home["meetings"][0]["unread"] == 1
    pm = d["ned"].get(f"/api/portal/meetings/{mid}").get_json()
    assert [i["id"] for i in pm["items"]] == [accounts]  # the RPT paper is withheld from the interested director
    assert d["ned"].get(f"/api/portal/items/{rpt}/paper").status_code == 404
    assert d["chair"].get(f"/api/portal/items/{rpt}/paper").status_code == 200

    # Opening a paper is recorded; the Secretariat sees it.
    r = d["ned"].get(f"/api/portal/items/{accounts}/paper")
    assert r.status_code == 200 and r.mimetype == "application/pdf" and "no-store" in r.headers["Cache-Control"]
    ov = cs.get(f"/api/board/meetings/{mid}").get_json()
    ned = next(p for p in ov["people"] if p["id"] == ids["ned"])
    assert (ned["opened"], ned["papers"]) == (1, 1)

    # RSVP and private notes.
    assert d["chair"].post(f"/api/portal/meetings/{mid}/rsvp", json={"response": "maybe"}).status_code == 400
    assert d["chair"].post(f"/api/portal/meetings/{mid}/rsvp", json={"response": "video"}).status_code == 200
    assert d["idir"].post(f"/api/portal/meetings/{mid}/rsvp", json={"response": "absent", "note": "Travelling"}).status_code == 200
    assert d["chair"].post(f"/api/portal/items/{accounts}/note", json={"text": "Ask about receivables ageing"}).status_code == 200
    assert d["chair"].get(f"/api/portal/meetings/{mid}").get_json()["items"][0]["note"] == "Ask about receivables ageing"
    assert d["idir"].get(f"/api/portal/meetings/{mid}").get_json()["items"][0]["note"] == ""  # notes are private
    ov = cs.get(f"/api/board/meetings/{mid}").get_json()
    assert ov["attending"] == 1

    # A replaced paper is flagged as revised and unread again.
    cs.post(f"/api/board/meetings/{mid}/items/{accounts}", data={"title": "Approve the half-yearly accounts",
                                                                  "paper": (io.BytesIO(_pdf(3)), "accounts-v2.pdf")},
            content_type="multipart/form-data")
    pm = d["ned"].get(f"/api/portal/meetings/{mid}").get_json()
    assert pm["items"][0]["revised"] is True and pm["items"][0]["read"] is False

    # The pack is one watermarked PDF with the director's name, without withheld papers.
    r = d["ned"].get(f"/api/portal/meetings/{mid}/pack")
    pdf = PdfReader(io.BytesIO(r.data))
    text = "\n".join(p.extract_text() for p in pdf.pages)
    assert "Prepared for Interested Director" in text and "Sec. 188" not in text
    assert [o.title for o in pdf.outline][1].startswith("1. Approve")
    full = PdfReader(io.BytesIO(cs.get(f"/api/board/meetings/{mid}/pack").data))
    assert len(full.pages) > len(pdf.pages)

    # Published meetings cannot be deleted; switching a director off ends their access at once.
    assert cs.delete(f"/api/board/meetings/{mid}").status_code == 400
    cs.post(f"/api/users/{ids['ned']}", json={"active": False})
    assert d["ned"].get("/api/portal/home").status_code == 401
    cs.post(f"/api/users/{ids['ned']}", json={"active": True})
    assert d["ned"].get("/api/portal/home").status_code == 401  # the old session stays ended
    assert sign_in(d["ned"], "ned", site["secrets"]["ned"]).status_code == 200


def test_circular_resolution_majority_and_noting(site):
    cs, ids, d = site["cs"], site["ids"], site["d"]
    everyone = list(ids.values())
    r = cs.post("/api/board/circulars", json={"title": "Open a current account with Federal Bank",
                                              "resolution": "RESOLVED THAT a current account be opened...",
                                              "recipients": everyone, "interested": [ids["ned"]]})
    cid = r.get_json()["id"]
    assert d["chair"].get(f"/api/portal/circulars/{cid}").status_code == 404  # still a draft
    assert cs.post(f"/api/board/circulars/{cid}/circulate").status_code == 200
    assert cs.post(f"/api/board/circulars/{cid}", json={"title": "x", "resolution": "y"}).status_code == 400  # frozen

    # The interested director cannot vote for or against.
    assert d["ned"].post(f"/api/portal/circulars/{cid}/vote", json={"vote": "for"}).status_code == 400
    # Two entitled directors: both must approve for a majority.
    assert d["chair"].post(f"/api/portal/circulars/{cid}/vote", json={"vote": "for"}).status_code == 200
    t = cs.get(f"/api/board/circulars/{cid}").get_json()["tally"]
    assert (t["entitled"], t["needed"], t["state"]) == (2, 2, "waiting")
    assert cs.post(f"/api/board/circulars/{cid}/close", json={"outcome": "passed"}).status_code == 400
    d["idir"].post(f"/api/portal/circulars/{cid}/vote", json={"vote": "for", "comment": "Agreed"})
    t = cs.get(f"/api/board/circulars/{cid}").get_json()["tally"]
    assert t["state"] == "majority"
    assert cs.post(f"/api/board/circulars/{cid}/close", json={"outcome": "passed"}).status_code == 200
    assert d["chair"].post(f"/api/portal/circulars/{cid}/vote", json={"vote": "against"}).status_code == 400  # closed
    assert cs.delete(f"/api/board/circulars/{cid}").status_code == 400  # part of the record

    # It is put up for noting at the next meeting, once.
    mid = cs.post("/api/board/meetings", json={"title": "144th Board Meeting", "meeting_date": "2027-02-10",
                                               "invitees": everyone}).get_json()["id"]
    assert cs.post(f"/api/board/meetings/{mid}/note-circulars").status_code == 200
    assert cs.post(f"/api/board/meetings/{mid}/note-circulars").status_code == 400
    items = cs.get(f"/api/board/meetings/{mid}").get_json()["items"]
    assert "Federal Bank" in items[0]["summary"]


def test_one_third_can_demand_a_meeting(site):
    cs, ids, d = site["cs"], site["ids"], site["d"]
    cid = cs.post("/api/board/circulars", json={"title": "Change of auditors' remuneration", "resolution": "RESOLVED...",
                                                "recipients": list(ids.values())}).get_json()["id"]
    cs.post(f"/api/board/circulars/{cid}/circulate")
    d["chair"].post(f"/api/portal/circulars/{cid}/vote", json={"vote": "for"})
    d["idir"].post(f"/api/portal/circulars/{cid}/vote", json={"vote": "for"})
    d["ned"].post(f"/api/portal/circulars/{cid}/vote", json={"vote": "meeting"})
    t = cs.get(f"/api/board/circulars/{cid}").get_json()["tally"]
    assert t["state"] == "meeting"  # 1 of 3 directors is one-third
    assert cs.post(f"/api/board/circulars/{cid}/close", json={"outcome": "passed"}).status_code == 400
    assert cs.post(f"/api/board/circulars/{cid}/close", json={"outcome": "referred to meeting"}).status_code == 200


def test_last_admin_cannot_become_a_director(site):
    cs = site["cs"]
    me = cs.get("/api/me").get_json()["user"]
    r = cs.post(f"/api/users/{me['id']}", json={"role": "director"})
    assert r.status_code == 400


class FakeSMTP:
    sent: list = []

    def __init__(self, host, port, timeout=None):
        self.host = host

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self, context=None):
        pass

    def login(self, user, password):
        pass

    def send_message(self, msg):
        if "bounce" in msg["To"]:
            import smtplib
            raise smtplib.SMTPRecipientsRefused({msg["To"]: (550, b"no such user")})
        FakeSMTP.sent.append(msg)


def test_email_notices_and_reminders(site, monkeypatch):
    from cs_assistant import mailer
    cs, ids, d = site["cs"], site["ids"], site["d"]
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    FakeSMTP.sent = []
    everyone = list(ids.values())
    mid = cs.post("/api/board/meetings", json={"title": "145th Board Meeting", "meeting_date": "2027-03-10",
                                               "invitees": everyone}).get_json()["id"]
    cs.post(f"/api/board/meetings/{mid}/items", data={"title": "Budget", "paper": (io.BytesIO(_pdf()), "budget.pdf")},
            content_type="multipart/form-data")

    # Without SMTP settings nothing is sent, and the reminder button says why.
    monkeypatch.delenv("SMTP_HOST", raising=False)
    r = cs.post(f"/api/board/meetings/{mid}/status", json={"status": "published"})
    assert r.status_code == 200 and r.get_json()["email"] is None
    r = cs.post(f"/api/board/meetings/{mid}/email", json={"kind": "remind_reply"})
    assert r.status_code == 400 and "not set up" in r.get_json()["error"]

    monkeypatch.setenv("SMTP_HOST", "mail.example.org")
    monkeypatch.setenv("SMTP_FROM", "cs@example.org")
    monkeypatch.setenv("SITE_URL", "https://board.example.org/")
    cs.post(f"/api/users/{ids['chair']}", json={"email": "chair@example.org"})
    cs.post(f"/api/users/{ids['idir']}", json={"email": "bounce@example.org"})
    cs.post(f"/api/users/{ids['ned']}", json={"email": ""})
    d["chair"].post(f"/api/portal/meetings/{mid}/rsvp", json={"response": "in_person"})

    r = cs.post(f"/api/board/meetings/{mid}/email", json={"kind": "remind_reply"}).get_json()
    # The chair has replied, so only the other two are chased; one bounces, one has no address.
    assert r["sent"] == 0 and r["failed"] == ["Independent Director"] and r["no_email"] == ["Interested Director"]
    r = cs.post(f"/api/board/meetings/{mid}/email", json={"kind": "remind_read"}).get_json()
    assert r["sent"] == 1
    msg = FakeSMTP.sent[-1]
    body = msg.get_content()
    assert msg["To"] == "Dr Chair Person <chair@example.org>"
    assert "145th Board Meeting" in msg["Subject"] and "https://board.example.org" in body
    assert "budget" not in body.lower()  # papers and their contents never go by e-mail

    ov = cs.get(f"/api/board/meetings/{mid}").get_json()
    assert {e["kind"] for e in ov["emails"]} == {"remind_reply", "remind_read"}
    assert any(e["error"] for e in ov["emails"])

    # Circulating sends the notice; a reminder goes only to those entitled who have not replied.
    cid = cs.post("/api/board/circulars", json={"title": "Bank signatories", "resolution": "RESOLVED...",
                                                "recipients": everyone}).get_json()["id"]
    r = cs.post(f"/api/board/circulars/{cid}/circulate").get_json()
    assert r["email"]["sent"] == 1
    d["chair"].post(f"/api/portal/circulars/{cid}/vote", json={"vote": "for"})
    r = cs.post(f"/api/board/circulars/{cid}/email").get_json()
    assert r["sent"] == 0 and r["no_email"] == ["Interested Director"]
    assert "Bank signatories" in FakeSMTP.sent[-1]["Subject"]


def test_minutes_workflow(site, monkeypatch):
    cs, ids, d = site["cs"], site["ids"], site["d"]
    monkeypatch.delenv("SMTP_HOST", raising=False)
    everyone = list(ids.values())
    mid = cs.post("/api/board/meetings", json={"title": "146th Board Meeting", "meeting_date": "2026-11-01",
                                               "invitees": everyone}).get_json()["id"]
    cs.post(f"/api/board/meetings/{mid}/items", json={"title": "Any other business"})
    cs.post(f"/api/board/meetings/{mid}/status", json={"status": "published"})
    up = lambda name="draft.pdf": {"paper": (io.BytesIO(_pdf()), name)}  # noqa: E731

    # Minutes only after the meeting is held.
    r = cs.post(f"/api/board/meetings/{mid}/minutes/draft", data=up(), content_type="multipart/form-data")
    assert r.status_code == 400 and "held" in r.get_json()["error"]
    cs.post(f"/api/board/meetings/{mid}/status", json={"status": "held"})
    assert cs.post(f"/api/board/meetings/{mid}/minutes/circulate").status_code == 400  # nothing to send yet
    assert cs.post(f"/api/board/meetings/{mid}/minutes/draft", data=up(), content_type="multipart/form-data").status_code == 200

    mo = cs.get(f"/api/board/meetings/{mid}").get_json()["minutes"]
    assert mo["stage"] == "drafted" and "draft_stored" not in mo["minutes"]
    assert any("Circulate the draft minutes by 16 November 2026" in c["text"] for c in mo["checks"])
    assert d["chair"].get(f"/api/portal/meetings/{mid}").get_json()["minutes"] is None  # not sent yet
    assert d["chair"].get(f"/api/portal/meetings/{mid}/minutes/file").status_code == 404

    # Cannot sign before circulating.
    r = cs.post(f"/api/board/meetings/{mid}/minutes/sign", data={"signed_on": "2026-11-20", "signed_by": "Chair", **up("s.pdf")},
                content_type="multipart/form-data")
    assert r.status_code == 400
    assert cs.post(f"/api/board/meetings/{mid}/minutes/circulate").status_code == 200

    home = d["chair"].get("/api/portal/home").get_json()
    mine = next(x for x in home["meetings"] if x["id"] == mid)
    assert mine["minutes"]["reply_needed"] is True
    assert d["chair"].get(f"/api/portal/meetings/{mid}/minutes/file").status_code == 200
    assert d["chair"].post(f"/api/portal/meetings/{mid}/minutes/comment", json={"kind": "comment", "text": ""}).status_code == 400
    assert d["chair"].post(f"/api/portal/meetings/{mid}/minutes/comment", json={"kind": "comment", "text": "Item 1: add my query"}).status_code == 200
    assert d["idir"].post(f"/api/portal/meetings/{mid}/minutes/comment", json={"kind": "no_comments"}).status_code == 200
    mo = cs.get(f"/api/board/meetings/{mid}").get_json()["minutes"]
    replies = {r["name"]: r["reply"] for r in mo["replies"]}
    assert replies["Dr Chair Person"]["text"] == "Item 1: add my query" and replies["Independent Director"]["kind"] == "no_comments"
    assert replies["Interested Director"] is None

    # A revised draft goes out again; replies to the old draft no longer count as replies to the new one.
    cs.post(f"/api/board/meetings/{mid}/minutes/draft", data=up("draft-v2.pdf"), content_type="multipart/form-data")
    cs.post(f"/api/board/meetings/{mid}/minutes/circulate")
    mo = cs.get(f"/api/board/meetings/{mid}").get_json()["minutes"]
    assert mo["minutes"]["version"] == 2 and all(r["reply"] is None for r in mo["replies"]) and len(mo["comments"]) == 2

    # Signing needs a signed copy, and files it in the library.
    r = cs.post(f"/api/board/meetings/{mid}/minutes/sign", data={"signed_on": "2026-11-20", "signed_by": "Dr Chair Person"},
                content_type="multipart/form-data")
    assert r.status_code == 400
    r = cs.post(f"/api/board/meetings/{mid}/minutes/sign",
                data={"signed_on": "2026-11-20", "signed_by": "Dr Chair Person, Chairman", **up("signed.pdf")},
                content_type="multipart/form-data")
    assert r.status_code == 200 and r.get_json()["library_doc_id"]
    doc = cs.get(f"/api/library/{r.get_json()['library_doc_id']}").get_json()
    assert doc["category"] == "board" and "146th" in doc["title"]
    mo = cs.get(f"/api/board/meetings/{mid}").get_json()["minutes"]
    assert mo["stage"] == "signed" and any(c["text"].startswith("Signed by Dr Chair Person") for c in mo["checks"])
    assert cs.post(f"/api/board/meetings/{mid}/minutes/draft", data=up(), content_type="multipart/form-data").status_code == 400

    pm = d["ned"].get(f"/api/portal/meetings/{mid}").get_json()["minutes"]
    assert pm["stage"] == "signed"
    assert d["ned"].get(f"/api/portal/meetings/{mid}/minutes/file?which=signed").status_code == 200
    assert d["ned"].get(f"/api/portal/meetings/{mid}/minutes/file?which=draft").status_code == 404
    assert d["ned"].post(f"/api/portal/meetings/{mid}/minutes/comment", json={"kind": "no_comments"}).status_code == 400
