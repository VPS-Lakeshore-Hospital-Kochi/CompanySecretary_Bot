"""Calls to Claude, streamed back to the browser piece by piece."""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import date

import anthropic

from . import files
from .knowledge import SYSTEM_PROMPT, profile_block

MODEL = os.environ.get("CS_MODEL", "claude-opus-5")
USE_FALLBACKS = os.environ.get("CS_FALLBACKS", "1") != "0"
WEB_SEARCH = os.environ.get("CS_WEB_SEARCH", "1") != "0"

# Deeper thinking for checking and drafting documents; a little quicker for questions.
EFFORT = {
    "ask": os.environ.get("CS_EFFORT_ASK", "medium"),
    "vet": os.environ.get("CS_EFFORT_DOCS", "high"),
    "draft": os.environ.get("CS_EFFORT_DOCS", "high"),
}

# Web look-ups are limited to official and professional sources.
OFFICIAL_DOMAINS = [
    "mca.gov.in", "sebi.gov.in", "rbi.org.in", "indiacode.nic.in", "egazette.gov.in",
    "incometaxindia.gov.in", "incometax.gov.in", "cbic-gst.gov.in", "gst.gov.in", "labour.gov.in",
    "cdsco.gov.in", "aerb.gov.in", "meity.gov.in", "cert-in.org.in", "nmc.org.in", "icsi.edu",
    "icai.org", "kerala.gov.in", "keralapcb.nic.in", "sci.gov.in", "ncdrc.nic.in", "mohfw.gov.in",
    "nabh.co", "pib.gov.in", "dpiit.gov.in", "cpcb.nic.in", "icmr.gov.in", "legislative.gov.in",
]

_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(max_retries=3)
    return _client


def api_ready() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def build_messages(turns: list[dict], doc_ids: list[str], first_prompt: str | None) -> list[dict]:
    """Rebuild the conversation. Documents go in the first user message.

    `turns` holds only plain text from the browser: [{"role": "user"|"assistant", "text": ...}].
    If `first_prompt` is given it replaces the text of the first user turn (it is built on the
    server from the form, so the browser never has to hold the long instructions).
    """
    messages: list[dict] = []
    docs = [d for d in (files.get(i) for i in doc_ids) if d]
    for n, t in enumerate(turns):
        text = (t.get("text") or "").strip()
        if n == 0:
            if t.get("role") != "user":
                raise ValueError("Conversation must start with the user.")
            content: list[dict] = []
            for d in docs:
                content.extend(files.to_content_blocks(d))
            if content:
                # Cache the documents so follow-up questions on them are quick and cheap.
                content[-1]["cache_control"] = {"type": "ephemeral"}
            content.append({"type": "text", "text": first_prompt or text})
            messages.append({"role": "user", "content": content})
        elif text:
            messages.append({"role": t["role"], "content": text})
    if len(doc_ids) != len(docs):
        raise LookupError("One of the uploaded files has expired. Please upload it again.")
    return messages


def stream_reply(mode: str, messages: list[dict], profile: dict) -> Iterator[dict]:
    """Yield events: {"type": "status"|"text"|"sources"|"notice"|"error"|"done", ...}."""
    if not api_ready():
        yield {"type": "error", "text": "The AI service is not set up yet. Ask your IT team to add the "
                                        "ANTHROPIC_API_KEY (see the README file). The Filing Calendar, "
                                        "'Something happened?' and Licences screens work without it."}
        return

    system = [
        {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": profile_block(profile, date.today().strftime("%d %B %Y (%A)"))},
    ]
    params: dict = {
        "model": MODEL,
        "max_tokens": 64000,
        "system": system,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": EFFORT.get(mode, "high")},
    }
    if mode == "ask" and WEB_SEARCH:
        params["tools"] = [{
            "type": "web_search_20260209", "name": "web_search", "max_uses": 5,
            "allowed_domains": OFFICIAL_DOMAINS,
            "user_location": {"type": "approximate", "country": "IN", "region": "Kerala", "city": "Kochi"},
        }]
    if USE_FALLBACKS:
        params["betas"] = ["server-side-fallback-2026-07-01"]
        params["fallbacks"] = "default"

    convo = list(messages)
    sources: dict[str, str] = {}
    yield {"type": "status", "text": "Reading and thinking - this can take a minute for long documents..."}
    try:
        for _ in range(4):  # a server-side web search may pause the turn; resume it
            with client().beta.messages.stream(messages=convo, **params) as stream:
                for event in stream:
                    if event.type == "content_block_start":
                        block = event.content_block
                        if block.type == "server_tool_use":
                            yield {"type": "status", "text": "Checking official sources (MCA, RBI, India Code...)"}
                    elif event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield {"type": "text", "text": event.delta.text}
                final = stream.get_final_message()
            _collect_sources(final, sources)
            if final.stop_reason == "pause_turn":
                convo.append({"role": "assistant", "content": final.content})
                continue
            if final.stop_reason == "refusal":
                yield {"type": "notice", "text": "The assistant could not complete this request. "
                                                  "Please rephrase it, or remove any unusual content, and try again."}
            elif final.stop_reason == "max_tokens":
                yield {"type": "notice", "text": "The answer was cut short because it was very long. "
                                                  "Type 'please continue' below to get the rest."}
            break
    except anthropic.AuthenticationError:
        yield {"type": "error", "text": "The AI service rejected the access key. Ask IT to check ANTHROPIC_API_KEY."}
        return
    except anthropic.PermissionDeniedError:
        yield {"type": "error", "text": "This access key is not allowed to use the chosen model. Ask IT to check CS_MODEL."}
        return
    except anthropic.RateLimitError:
        yield {"type": "error", "text": "The AI service is busy right now. Please wait a minute and press the button again."}
        return
    except anthropic.BadRequestError as e:
        msg = str(getattr(e, "message", e))
        if "too long" in msg.lower() or "too large" in msg.lower():
            yield {"type": "error", "text": "The documents are too large to read in one go. Please upload fewer "
                                            "or shorter files (for example, only the agreement, not the annexures)."}
        else:
            yield {"type": "error", "text": f"The request could not be processed: {msg}"}
        return
    except anthropic.APIStatusError as e:
        yield {"type": "error", "text": f"The AI service had a problem (code {e.status_code}). Please try again in a few minutes."}
        return
    except anthropic.APIConnectionError:
        yield {"type": "error", "text": "Could not reach the AI service. Please check the internet connection."}
        return
    if sources:
        yield {"type": "sources", "items": [{"url": u, "title": t} for u, t in sources.items()]}
    yield {"type": "done"}


def _collect_sources(message, sources: dict[str, str]) -> None:
    for block in message.content:
        if block.type == "text" and getattr(block, "citations", None):
            for c in block.citations:
                url = getattr(c, "url", None)
                if url:
                    sources.setdefault(url, getattr(c, "title", None) or url)
