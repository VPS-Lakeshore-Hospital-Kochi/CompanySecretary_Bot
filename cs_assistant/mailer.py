"""Sending e-mail through the hospital's own mail server (SMTP).

Set in .env:
    SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM
    SMTP_SECURITY   starttls (default), ssl, or none (only inside the hospital network)
    SITE_URL        the address directors use, e.g. https://board.lakeshorehospital.org

The e-mails never carry Board papers or their contents: only the meeting's name and date and a
link to sign in. That keeps confidential papers inside the portal, behind two-step sign-in.
"""

from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid


def ready() -> bool:
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM"))


def site_url() -> str:
    return os.environ.get("SITE_URL", "").rstrip("/")


def send_many(messages: list[tuple[str, str, str, str]], sender_name: str = "") -> list[str | None]:
    """messages: (to address, to name, subject, plain-text body). Returns an error text or None for each."""
    if not ready():
        return ["E-mail is not set up on the server (SMTP_HOST / SMTP_FROM)."] * len(messages)
    host = os.environ["SMTP_HOST"]
    security = os.environ.get("SMTP_SECURITY", "starttls").lower()
    port = int(os.environ.get("SMTP_PORT") or (465 if security == "ssl" else 587))
    user, password = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD")
    from_addr = os.environ["SMTP_FROM"]
    results: list[str | None] = []
    try:
        ctx = ssl.create_default_context()
        server = smtplib.SMTP_SSL(host, port, timeout=20, context=ctx) if security == "ssl" else smtplib.SMTP(host, port, timeout=20)
        with server:
            if security == "starttls":
                server.starttls(context=ctx)
            if user:
                server.login(user, password or "")
            for to, name, subject, body in messages:
                msg = EmailMessage()
                msg["From"] = formataddr((sender_name, from_addr)) if sender_name else from_addr
                msg["To"] = formataddr((name, to)) if name else to
                msg["Subject"] = subject
                msg["Message-ID"] = make_msgid()
                msg.set_content(body)
                try:
                    server.send_message(msg)
                    results.append(None)
                except smtplib.SMTPException as e:
                    results.append(f"Not accepted by the mail server: {e}")
    except (OSError, smtplib.SMTPException) as e:
        results += [f"Could not reach the mail server: {e}"] * (len(messages) - len(results))
    return results
