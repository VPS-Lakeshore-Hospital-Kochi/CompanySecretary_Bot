"""Build the claude.ai artifact version of the CS Assistant.

    python artifact/build.py        ->  artifact/dist/index.html (+ brand/, fonts/)

The page is one self-contained HTML file. Its legal knowledge, filing calendar, event
checklists, document types, registers, records-sharing rules and the CS responsibilities guide
are taken from the same Python modules (and static/registers.js) the self-hosted site uses,
so both versions stay in step. The logo and DM Sans font
files are published beside the page (the Word export fetches them).
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from cs_assistant import calendar as cal  # noqa: E402
from cs_assistant import documents, library, records, registers  # noqa: E402
from cs_assistant.knowledge import OFFICIAL_LINKS, SYSTEM_PROMPT  # noqa: E402

HERE = os.path.join(ROOT, "artifact")
SRC = os.path.join(HERE, "src")
DIST = os.path.join(HERE, "dist")

# On claude.ai the assistant has no web search; say so in its standing instructions.
ARTIFACT_NOTE = """

# Where you are running
You are answering inside the CS Assistant page on claude.ai. You cannot browse the web. When a \
point depends on a recent amendment, a notification or a threshold, say so plainly and tell the \
user which official portal to confirm it on. Documents the user attached, and the company's \
document library, are available through the tools described in the request.
"""


def data() -> dict:
    items = []
    for it in cal.ITEMS:
        d = dict(it.__dict__)
        d["rule"] = [d["rule"][0], [list(x) for x in d["rule"][1]] if isinstance(d["rule"][1], list) else d["rule"][1]]
        items.append(d)
    with open(os.path.join(ROOT, "config", "company.json"), encoding="utf-8") as f:
        profile = json.load(f)
    with open(os.path.join(ROOT, "docs", "CS_RESPONSIBILITIES.md"), encoding="utf-8") as f:
        guide = f.read()
    return {
        "items": items,
        "categories": cal.CATEGORIES,
        "flags": cal.PROFILE_FLAGS,
        "events": cal.EVENTS,
        "licences": [{"name": n, "authority": a} for n, a in cal.DEFAULT_LICENCES],
        "draftTypes": [{**d, "questions": [list(q) for q in d["questions"]]} for d in documents.DRAFT_TYPES],
        "commonQuestions": [list(q) for q in documents.COMMON_QUESTIONS],
        "vetTypes": documents.VET_TYPES,
        "roles": documents.OUR_ROLE_OPTIONS,
        "refCodes": documents.REF_CODES,
        "folders": [{"id": c[0], "name": c[1], "hint": c[2]} for c in library.CATEGORIES],
        "links": OFFICIAL_LINKS,
        "systemPrompt": SYSTEM_PROMPT + ARTIFACT_NOTE,
        "guide": guide,
        "profileDefaults": profile,
        "registers": registers.spec(),
        "transplantChecklist": [list(x) for x in registers.TRANSPLANT_CHECKLIST],
        "transplantVerify": registers.TRANSPLANT_VERIFY,
        "directorsVerify": registers.DIRECTORS_VERIFY,
        "committeePresets": registers.COMMITTEE_PRESETS,
        "records": {
            "requesters": [list(x) for x in records.REQUESTERS],
            "types": [{k: r[k] for k in ("id", "title", "examples", "group")} for r in records.RECORDS],
            "matrix": records.matrix(),
            "generalSteps": records.GENERAL_STEPS,
            "retention": records.RETENTION,
            "destructionSteps": records.DESTRUCTION_STEPS,
        },
    }


def read(*parts: str) -> str:
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


def main() -> None:
    os.makedirs(DIST, exist_ok=True)
    with open(os.path.join(ROOT, "static", "brand", "logo-lakeshore-white.png"), "rb") as f:
        logo_white = "data:image/png;base64," + base64.b64encode(f.read()).decode()
    vendor = read(HERE, "vendor", "lakeshore_docx.js")
    script = "\n".join([
        "const DATA = " + json.dumps(data(), ensure_ascii=False) + ";",
        # The brand's docx library, wrapped so it runs in the browser without Node's require.
        "function __lakeshoreFactory(require, module, exports, __dirname, process) {\n" + vendor + "\n}",
        read(SRC, "wordexport.js"),
        read(ROOT, "static", "registers.js").replace('"use strict";', ""),
        read(SRC, "app.js"),
    ]).replace("</script", "<\\/script")
    page = read(SRC, "page.html")
    page = page.replace("/*__CSS__*/", read(SRC, "style.css"))
    page = page.replace("__LOGO_WHITE__", logo_white)
    page = page.replace("/*__SCRIPT__*/", script)
    with open(os.path.join(DIST, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    for sub, names in (("brand", ["logo-lakeshore-colour.png", "logo-lakeshore-white.png"]),
                       ("fonts", ["DMSans.ttf", "DMSansItalic.ttf", "DMSansLight.ttf", "DMSansMedium.ttf",
                                  "DMSansSemiBold.ttf", "OFL-DM-Sans.txt"])):
        os.makedirs(os.path.join(DIST, sub), exist_ok=True)
        for n in names:
            shutil.copy(os.path.join(ROOT, "static", sub, n), os.path.join(DIST, sub, n))
    size = os.path.getsize(os.path.join(DIST, "index.html"))
    print(f"Built artifact/dist/index.html ({size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
