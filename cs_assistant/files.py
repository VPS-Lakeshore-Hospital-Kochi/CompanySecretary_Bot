"""Reading uploaded documents so they can be sent to Claude.

PDFs and images are sent as they are (Claude reads scanned pages too).
Word files are converted to text here, including their tables.
Uploaded files are kept only in memory, and only for a few hours.
"""

from __future__ import annotations

import base64
import io
import threading
import time
import uuid

import docx
from pypdf import PdfReader

MAX_BYTES = 25 * 1024 * 1024
TTL_SECONDS = 8 * 3600

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
TEXT_TYPES = {".txt", ".md", ".rtf", ".csv"}


class UploadError(ValueError):
    pass


_store: dict[str, dict] = {}
_lock = threading.Lock()


def _ext(name: str) -> str:
    return ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""


def docx_to_text(data: bytes) -> str:
    d = docx.Document(io.BytesIO(data))
    out: list[str] = []
    # Walk the body in order so tables appear where they are in the document.
    for block in d.element.body.iterchildren():
        tag = block.tag.rsplit("}", 1)[-1]
        if tag == "p":
            text = "".join(t.text or "" for t in block.iter() if t.tag.endswith("}t"))
            out.append(text)
        elif tag == "tbl":
            for row in block.iter():
                if not row.tag.endswith("}tr"):
                    continue
                cells = []
                for cell in row.iterchildren():
                    if cell.tag.endswith("}tc"):
                        cells.append(" ".join(t.text or "" for t in cell.iter() if t.tag.endswith("}t")).strip())
                out.append(" | ".join(cells))
            out.append("")
    return "\n".join(out).strip()


def read_upload(name: str, data: bytes) -> dict:
    if len(data) > MAX_BYTES:
        raise UploadError(f"'{name}' is larger than 25 MB. Please send a smaller file or split it.")
    if not data:
        raise UploadError(f"'{name}' is empty.")
    ext = _ext(name)
    doc = {"id": uuid.uuid4().hex, "name": name, "created": time.time()}
    if ext == ".pdf":
        try:
            pages = len(PdfReader(io.BytesIO(data)).pages)
        except Exception as exc:  # damaged or password-protected
            raise UploadError(f"Could not open '{name}'. If it is password protected, remove the password and try again.") from exc
        doc.update(kind="pdf", data=base64.standard_b64encode(data).decode(), summary=f"PDF, {pages} page(s)")
    elif ext == ".docx":
        try:
            text = docx_to_text(data)
        except Exception as exc:
            raise UploadError(f"Could not read the Word file '{name}'.") from exc
        if not text:
            raise UploadError(f"'{name}' has no text in it.")
        doc.update(kind="text", data=text, summary=f"Word document, about {len(text.split()):,} words")
    elif ext == ".doc":
        raise UploadError("Old-style Word files (.doc) cannot be read. In Word, choose File > Save As > "
                          "'Word Document (.docx)' or 'PDF', then upload again.")
    elif ext in IMAGE_TYPES:
        doc.update(kind="image", media_type=IMAGE_TYPES[ext],
                   data=base64.standard_b64encode(data).decode(), summary="Picture / scan")
    elif ext in TEXT_TYPES:
        text = data.decode("utf-8", errors="replace").strip()
        doc.update(kind="text", data=text, summary=f"Text, about {len(text.split()):,} words")
    else:
        raise UploadError(f"'{name}' is not a file type this tool can read. Please use PDF, Word (.docx), "
                          "a picture (JPG / PNG) or a text file.")
    with _lock:
        _purge()
        _store[doc["id"]] = doc
    return doc


def text_document(name: str, text: str) -> dict:
    """Pasted text is handled like an uploaded text file."""
    doc = {"id": uuid.uuid4().hex, "name": name, "created": time.time(), "kind": "text",
           "data": text.strip(), "summary": "Pasted text"}
    with _lock:
        _purge()
        _store[doc["id"]] = doc
    return doc


def get(doc_id: str) -> dict | None:
    with _lock:
        return _store.get(doc_id)


def _purge() -> None:
    cutoff = time.time() - TTL_SECONDS
    for k in [k for k, v in _store.items() if v["created"] < cutoff]:
        del _store[k]


def to_content_blocks(doc: dict) -> list[dict]:
    """Turn a stored document into Claude message content blocks."""
    if doc["kind"] == "pdf":
        return [{"type": "document", "title": doc["name"],
                 "source": {"type": "base64", "media_type": "application/pdf", "data": doc["data"]}}]
    if doc["kind"] == "image":
        return [{"type": "text", "text": f"The next picture is the file '{doc['name']}'."},
                {"type": "image", "source": {"type": "base64", "media_type": doc["media_type"], "data": doc["data"]}}]
    return [{"type": "document", "title": doc["name"],
             "source": {"type": "text", "media_type": "text/plain", "data": doc["data"]}}]
