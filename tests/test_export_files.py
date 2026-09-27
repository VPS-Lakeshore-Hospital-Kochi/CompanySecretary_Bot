import io

import docx

from cs_assistant import export, files

SAMPLE = """# Non-Disclosure Agreement

This Agreement is made on [DATE].

## 1. Definitions

1. **Confidential Information** means all information.
2. *Purpose* means the evaluation.

- bullet one
  - nested

| No. | Clause | Risk |
|---|---|---|
| 1 | 5.2 | High |
"""


def test_markdown_to_docx_uses_lakeshore_template():
    import zipfile
    data = export.markdown_to_docx(SAMPLE, "NDA", "Lakeshore Hospital & Research Centre Ltd", kind="draft",
                                   group="Contracts", ref=export.reference_for("LEG", "NDA"))
    d = docx.Document(io.BytesIO(data))
    masthead = d.tables[0].cell(0, 0).text
    assert "LEGAL · CONFIDENTIAL" in masthead and "Non-Disclosure Agreement" in masthead
    assert "Agreement no. LHRC/LEG/NDA/" in d.tables[0].cell(0, 0).tables[0].cell(0, 0).text  # the outline pill
    text = "\n".join(p.text for p in d.paragraphs)
    assert "1.\tConfidential Information means all information." in text
    risk = next(t for t in d.tables if t.rows[0].cells[0].text == "No.")
    assert risk.rows[1].cells[2].text == "High"
    assert "Have Legal review before execution" in d.sections[0].footer.paragraphs[0].text
    z = zipfile.ZipFile(io.BytesIO(data))
    assert any(n.endswith(".odttf") for n in z.namelist())
    assert b'w:name="DM Sans SemiBold"' in z.read("word/fontTable.xml")
    assert b"embedTrueTypeFonts" in z.read("word/settings.xml")


def test_embedded_font_deobfuscates_to_original():
    import re
    import zipfile
    z = zipfile.ZipFile(io.BytesIO(export.markdown_to_docx("Hello", "T")))
    table = z.read("word/fontTable.xml").decode()
    rels = z.read("word/_rels/fontTable.xml.rels").decode()
    m = re.search(r'w:name="DM Sans"><[^/]*/><[^/]*/><[^/]*/><w:embedRegular r:id="(\w+)" w:fontKey="\{([0-9A-F-]+)\}"', table)
    target = re.search(rf'Id="{m.group(1)}"[^>]*Target="([^"]+)"', rels).group(1)
    raw = bytearray(z.read("word/" + target))
    key = bytes.fromhex(m.group(2).replace("-", ""))[::-1]
    for i in range(32):
        raw[i] ^= key[i % 16]
    with open(export.os.path.join(export.FONT_DIR, "DMSans.ttf"), "rb") as f:
        assert bytes(raw) == f.read()


def test_docx_upload_reads_text_and_tables():
    src = docx.Document()
    src.add_paragraph("Clause 1. Term of three years.")
    t = src.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text = "Fee"
    t.rows[0].cells[1].text = "Rs 5,00,000"
    buf = io.BytesIO()
    src.save(buf)
    doc = files.read_upload("agreement.docx", buf.getvalue())
    assert doc["kind"] == "text"
    assert "Term of three years" in doc["data"] and "Fee | Rs 5,00,000" in doc["data"]
    blocks = files.to_content_blocks(doc)
    assert blocks[0]["type"] == "document" and blocks[0]["source"]["type"] == "text"


def test_rejects_old_word_and_unknown():
    import pytest
    with pytest.raises(files.UploadError, match="Save As"):
        files.read_upload("old.doc", b"xx")
    with pytest.raises(files.UploadError):
        files.read_upload("x.exe", b"xx")
