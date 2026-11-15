"""Two-step sign-in and ending old sign-ins."""

import time

import pytest

from cs_assistant import twofactor


def test_totp_matches_rfc_6238_vector():
    # RFC 6238 appendix B, SHA-1, secret "12345678901234567890", T = 59 s -> 94287082 (8 digits); 6 digits = 287082
    import base64
    secret = base64.b32encode(b"12345678901234567890").decode()
    assert twofactor.code_now(secret, 59) == "287082"
    assert twofactor.verify(secret, "287082", at=59) == 1
    assert twofactor.verify(secret, "287082", last_step=1, at=59) is None  # cannot be used twice
    assert twofactor.verify(secret, "000000", at=59) is None


def test_recovery_codes_work_once():
    codes, hashes = twofactor.new_recovery_codes(3)
    left = twofactor.use_recovery_code(codes[1].upper().replace("-", ""), hashes)
    assert left is not None and len(left) == 2
    assert twofactor.use_recovery_code(codes[1], left) is None


@pytest.fixture(scope="module")
def app_module():
    import app as m
    m.app.testing = True
    m._failures.clear()
    return m


def _admin(app_module):
    cs = app_module.app.test_client()
    if cs.get("/api/me").get_json()["needs_setup"]:
        cs.post("/api/setup", json={"full_name": "Company Secretary", "username": "cs", "password": "correct-horse"})
    else:
        assert cs.post("/api/login", json={"username": "cs", "password": "correct-horse"}).status_code == 200
    return cs


def test_director_must_enrol_then_needs_code(app_module):
    from test_board import enrol, sign_in
    cs = _admin(app_module)
    uid = cs.post("/api/users", json={"username": "tsdir", "full_name": "Two Step Director", "password": "board-pass-1",
                                      "role": "director", "email": "tsdir@example.org"}).get_json()["id"]
    d = app_module.app.test_client()
    assert d.post("/api/login", json={"username": "tsdir", "password": "board-pass-1"}).get_json()["must_enrol"] is True
    assert d.get("/api/me").get_json()["must_enrol"] is True
    r = d.get("/api/portal/home")
    assert r.status_code == 403 and r.get_json()["enrol"] is True  # nothing until two-step is set up
    assert d.post("/api/two-step/confirm", json={"code": "123456"}).status_code == 400  # no secret started
    secret = enrol(d)
    assert d.get("/api/portal/home").status_code == 200
    assert d.post("/api/two-step/off", json={"password": "board-pass-1"}).status_code == 400  # required for directors

    # Next time: password alone is not enough.
    d2 = app_module.app.test_client()
    assert d2.post("/api/login", json={"username": "tsdir", "password": "board-pass-1"}).get_json() == {"needs_code": True}
    assert d2.get("/api/portal/home").status_code == 401
    assert d2.post("/api/login/code", json={"code": "000000"}).status_code == 401
    assert sign_in(d2, "tsdir", secret).status_code == 200
    assert d2.get("/api/portal/home").status_code == 200

    # The administrator resets two-step (lost phone): every sign-in ends, and the director enrols again.
    users = {u["username"]: u for u in cs.get("/api/users").get_json()}
    assert users["tsdir"]["two_step"] == 1 and users["tsdir"]["email"] == "tsdir@example.org"
    assert "totp_secret" not in users["tsdir"]
    assert cs.post(f"/api/users/{uid}", json={"reset_two_step": True}).status_code == 200
    assert d.get("/api/portal/home").status_code == 401 and d2.get("/api/portal/home").status_code == 401
    d3 = app_module.app.test_client()
    assert d3.post("/api/login", json={"username": "tsdir", "password": "board-pass-1"}).get_json()["must_enrol"] is True


def test_password_change_ends_other_sign_ins(app_module):
    cs = _admin(app_module)
    other = _admin(app_module)
    assert cs.post("/api/me/password", json={"current": "correct-horse", "new": "correct-horse-2"}).status_code == 200
    assert cs.get("/api/meta").status_code == 200      # this sign-in carries on
    assert other.get("/api/meta").status_code == 401   # the other one is ended
    assert cs.post("/api/me/password", json={"current": "correct-horse-2", "new": "correct-horse"}).status_code == 200


def test_staff_can_turn_on_and_off(app_module):
    from test_board import enrol
    cs = _admin(app_module)
    enrol(cs)
    assert cs.get("/api/me").get_json()["user"]["two_step"] == 1
    assert cs.post("/api/two-step/off", json={"password": "nope"}).status_code == 400
    assert cs.post("/api/two-step/off", json={"password": "correct-horse"}).status_code == 200
    assert cs.get("/api/me").get_json()["user"]["two_step"] == 0


def test_bad_email_refused(app_module):
    cs = _admin(app_module)
    r = cs.post("/api/users", json={"username": "x1", "full_name": "X", "password": "board-pass-1", "email": "not-an-email"})
    assert r.status_code == 400
