"""Two-step sign-in: a 6-digit code from an authenticator app (TOTP, RFC 6238) after the password.

Works with Google Authenticator, Microsoft Authenticator, Authy and similar apps. Nothing is
sent by SMS or e-mail. Each person also gets eight one-time recovery codes for a lost phone.

Who must use it is set by TWO_STEP in .env:
    directors  (default)  directors must set it up at their first sign-in; others may choose to
    all                   everyone must
    off                   no one is asked (people who already set it up still use it)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from urllib.parse import quote

import segno
from werkzeug.security import check_password_hash, generate_password_hash

STEP = 30
DIGITS = 6
WINDOW = 1  # accept the code for the previous and next 30 seconds too (phone clocks drift)


def policy() -> str:
    v = os.environ.get("TWO_STEP", "directors").strip().lower()
    return v if v in ("directors", "all", "off") else "directors"


def required_for(role: str) -> bool:
    p = policy()
    return p == "all" or (p == "directors" and role == "director")


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10 ** DIGITS).zfill(DIGITS)


def code_now(secret: str, at: float | None = None) -> str:
    return _code(secret, int((time.time() if at is None else at) // STEP))


def verify(secret: str, code: str, last_step: int | None = None, at: float | None = None) -> int | None:
    """The time step the code belongs to, or None. A code already used (step <= last_step) is refused."""
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(code) != DIGITS or not secret:
        return None
    now = int((time.time() if at is None else at) // STEP)
    for step in range(now - WINDOW, now + WINDOW + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(_code(secret, step), code):
            return step
    return None


def otpauth_uri(secret: str, username: str, issuer: str) -> str:
    label = quote(f"{issuer}:{username}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits={DIGITS}&period={STEP}"


def qr_svg(uri: str) -> str:
    return segno.make(uri, error="m").svg_inline(scale=5, dark="#001E5F", light="#FFFFFF")


# ------------------------------------------------------------- recovery codes
def new_recovery_codes(n: int = 8) -> tuple[list[str], list[str]]:
    """(codes to show once, hashes to store)."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    codes = ["".join(secrets.choice(alphabet) for _ in range(4)) + "-" + "".join(secrets.choice(alphabet) for _ in range(4))
             for _ in range(n)]
    return codes, [generate_password_hash(c) for c in codes]


def use_recovery_code(code: str, hashes: list[str]) -> list[str] | None:
    """The remaining hashes if the code matches one (which is then used up), else None."""
    code = str(code or "").strip().lower().replace(" ", "")
    if len(code) == 8:
        code = code[:4] + "-" + code[4:]
    if len(code) != 9:
        return None
    for h in hashes:
        if check_password_hash(h, code):
            return [x for x in hashes if x != h]
    return None
