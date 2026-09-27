"""Turn the assistant's Markdown answer into a Word (.docx) file."""

from __future__ import annotations

import io
import re

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor

NAVY = RGBColor(0x00, 0x1E, 0x5F)
INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)")
TABLE_SEP = re.compile(r"^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def _add_inline(par, text: str) -> None:
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            par.add_run(part[2:-2]).bold = True
        elif part.startswith("`") and part.endswith("`"):
            par.add_run(part[1:-1]).font.name = "Consolas"
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            par.add_run(part[1:-1]).italic = True
        else:
            par.add_run(part)


def _cells(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def markdown_to_docx(markdown: str, title: str, company: str = "") -> bytes:
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11.5)

    section = doc.sections[0]
    if company:
        hp = section.header.paragraphs[0]
        hp.text = company
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hp.runs[0].font.size = Pt(9)
        hp.runs[0].font.color.rgb = NAVY
    fp = section.footer.paragraphs[0]
    fp.text = "DRAFT - prepared with the CS Assistant. Review before use or signature."
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fp.runs[0].font.size = Pt(8)

    lines = markdown.replace("\r\n", "\n").split("\n")
    i = 0
    first_heading_done = False
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        # Tables
        if stripped.startswith("|") and i + 1 < len(lines) and TABLE_SEP.match(lines[i + 1].strip()):
            header = _cells(stripped)
            rows = []
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(_cells(lines[i]))
                i += 1
            table = doc.add_table(rows=1, cols=len(header))
            table.style = "Table Grid"
            for j, h in enumerate(header):
                cell = table.rows[0].cells[j]
                cell.text = ""
                run = cell.paragraphs[0].add_run(h.replace("**", ""))
                run.bold = True
            for r in rows:
                cells = table.add_row().cells
                for j in range(len(header)):
                    cells[j].text = ""
                    _add_inline(cells[j].paragraphs[0], r[j] if j < len(r) else "")
            doc.add_paragraph()
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            text = m.group(2).replace("**", "")
            if level == 1 and not first_heading_done:
                h = doc.add_heading(text, level=0)
            else:
                h = doc.add_heading(text, level=min(level, 4))
            first_heading_done = True
            for run in h.runs:
                run.font.color.rgb = NAVY
            i += 1
            continue
        if re.match(r"^(-{3,}|\*{3,}|_{3,})$", stripped):
            i += 1
            continue
        m = re.match(r"^(\s*)[-*+]\s+(.*)$", line)
        if m:
            depth = len(m.group(1)) // 2
            p = doc.add_paragraph(style="List Bullet 2" if depth else "List Bullet")
            _add_inline(p, m.group(2))
            i += 1
            continue
        m = re.match(r"^(\s*)(\d+|[a-z]|[ivx]+)[.)]\s+(.*)$", line)
        if m:
            # Keep the drafter's own numbering (legal documents cross-refer to it).
            p = doc.add_paragraph()
            if m.group(1):
                p.paragraph_format.left_indent = Pt(18 * (len(m.group(1)) // 2 + 1))
            _add_inline(p, f"{m.group(2)}. {m.group(3)}")
            i += 1
            continue
        if stripped.startswith(">"):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Pt(24)
            _add_inline(p, stripped.lstrip("> "))
            i += 1
            continue
        # Ordinary paragraph: join wrapped lines.
        buf = [stripped]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||[-*+]\s|\d+[.)]\s|>)", lines[i].strip()):
            buf.append(lines[i].strip())
            i += 1
        _add_inline(doc.add_paragraph(), " ".join(buf))

    if not first_heading_done:
        doc.paragraphs[0].insert_paragraph_before(title, style="Title") if doc.paragraphs else doc.add_heading(title, 0)
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()
