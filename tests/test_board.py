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
