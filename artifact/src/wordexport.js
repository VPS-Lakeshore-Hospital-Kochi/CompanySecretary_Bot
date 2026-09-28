/* Word export in the VPS Lakeshore house style.
 *
 * Uses the brand's own component library (vendor/lakeshore_docx.js, the same file the
 * vps-*-docx skills use) on top of docx.js. The build wraps that file in
 * __lakeshoreFactory(require, module, exports, __dirname, process); here we give it a
 * tiny in-memory "fs" holding the logo and DM Sans fonts, fetched from the files
 * published beside the page.
 */
"use strict";

const LKWord = (() => {
  const ASSET_FILES = {
    "logo-lakeshore-colour.png": "brand/logo-lakeshore-colour.png",
    "logo-lakeshore-white.png": "brand/logo-lakeshore-white.png",
    "DMSans.ttf": "fonts/DMSans.ttf",
    "DMSansItalic.ttf": "fonts/DMSansItalic.ttf",
    "DMSansLight.ttf": "fonts/DMSansLight.ttf",
    "DMSansMedium.ttf": "fonts/DMSansMedium.ttf",
    "DMSansSemiBold.ttf": "fonts/DMSansSemiBold.ttf",
  };

  let libPromise = null;

  /** Build the library once. `docxLib` is the docx.js namespace; `fetchBytes(relPath)` returns a Uint8Array. */
  function load(docxLib, fetchBytes) {
    if (libPromise) return libPromise;
    libPromise = (async () => {
      const bytes = {};
      await Promise.all(Object.entries(ASSET_FILES).map(async ([name, rel]) => {
        try { bytes[name] = await fetchBytes(rel); } catch (_) { /* a missing font only loses embedding */ }
      }));
      const base = (p) => String(p).split("/").pop();
      const fs = {
        existsSync: (p) => base(p) in bytes,
        readFileSync: (p) => { const b = bytes[base(p)]; if (!b) throw new Error("missing " + p); return b; },
        writeFileSync: () => { throw new Error("not available in the browser"); },
      };
      const path = {
        join: (...a) => a.join("/").replace(/\/+/g, "/"),
        dirname: (p) => String(p).split("/").slice(0, -1).join("/") || "/",
      };
      const req = (name) => {
        if (name === "fs") return fs;
        if (name === "path") return path;
        if (name === "docx") return docxLib;
        throw new Error("Cannot load " + name);
      };
      req.resolve = () => "/lk/node_modules/docx/index.js";
      const module = { exports: {} };
      __lakeshoreFactory(req, module, module.exports, "/lk/scripts", { cwd: () => "/lk" });
      return module.exports;
    })();
    return libPromise;
  }

  const TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const plain = (t) => String(t).replace(/\*\*|`/g, "").trim();

  /** Markdown inline marks -> run specs understood by L.runs(). */
  function inline(text, base = {}) {
    const out = [];
    const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]\n]{2,80}\](?!\())/g;
    let last = 0, m;
    const push = (t, extra) => { if (t) out.push({ ...base, text: t, ...extra }); };
    while ((m = re.exec(text))) {
      push(text.slice(last, m.index));
      const p = m[0];
      if (p.startsWith("**")) push(p.slice(2, -2), { weight: "semibold", color: base.color || "001E5F" });
      else if (p.startsWith("`")) push(p.slice(1, -1), { weight: "medium" });
      else if (p.startsWith("[")) push(p, { weight: "semibold" });
      else push(p.slice(1, -1), { italic: true });
      last = m.index + p.length;
    }
    push(text.slice(last));
    return out.length ? out : [{ ...base, text: "" }];
  }

  function cells(line) {
    let l = line.trim();
    if (l.startsWith("|")) l = l.slice(1);
    if (l.endsWith("|")) l = l.slice(0, -1);
    return l.split("|").map((c) => c.trim());
  }

  /** Split a width into n columns that sum exactly to total. */
  function widths(n, total, firstNarrow) {
    if (firstNarrow && n > 2) {
      const first = 700, rest = Math.floor((total - first) / (n - 1));
      const w = [first, ...Array(n - 1).fill(rest)];
      w[n - 1] += total - w.reduce((a, b) => a + b, 0);
      return w;
    }
    const w = Array(n).fill(Math.floor(total / n));
    w[n - 1] += total - w.reduce((a, b) => a + b, 0);
    return w;
  }

  /**
   * Convert the assistant's Markdown into Lakeshore blocks.
   * meta: {title, kicker, pill, footer, company}
   */
  function toBlocks(L, markdown, meta) {
    let lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    let title = meta.title || "Document";
    const firstIdx = lines.findIndex((l) => l.trim());
    if (firstIdx >= 0) {
      const m = lines[firstIdx].trim().match(/^#\s+(.*)$/);
      if (m) { title = plain(m[1]); lines = lines.slice(firstIdx + 1); }
    }
    const blocks = [];
    blocks.push(...L.masthead({ kicker: meta.kicker, pill: meta.pill ? { text: meta.pill, style: "outline" } : undefined, title, rule: "navy" }));
    const d = new Date();
    const today = `${d.getDate()} ${d.toLocaleString("en-GB", { month: "long" })} ${d.getFullYear()}`;
    blocks.push(...L.metaGrid([[
      ...(meta.company ? [{ label: "Company", value: meta.company }] : []),
      { label: "Prepared by", value: "Company Secretariat & Legal" },
      { label: "Date", value: today },
      { label: "Status", value: meta.status || "Draft for review" },
    ]]));
    blocks.push(...L.spacer(1, 8));

    let afterVerdict = false;
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i], s = raw.trim();
      if (!s) { i++; continue; }
      if (s.startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim())) {
        const head = cells(s).map(plain);
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          const r = cells(lines[i]).map(plain);
          while (r.length < head.length) r.push("");
          rows.push(r.slice(0, head.length));
          i++;
        }
        const numbered = rows.length && rows.every((r) => /^\d{1,3}\.?$/.test(r[0] || ""));
        blocks.push(L.dataTable({ headers: head, rows, widths: widths(head.length, L.PAGE.content, numbered), accentFirstCol: numbered }));
        blocks.push(...L.spacer(1, 6));
        continue;
      }
      let m = s.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        afterVerdict = plain(m[2]).toLowerCase() === "verdict";
        if (!afterVerdict) blocks.push(m[1].length <= 2 ? L.h2(plain(m[2])) : L.h3(plain(m[2])));
        i++; continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) { blocks.push(L.divider()); i++; continue; }
      if (/^\s*[-*+]\s+/.test(raw)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          const depth = Math.floor(lines[i].match(/^\s*/)[0].length / 2);
          items.push(inline((depth ? "– " : "") + lines[i].replace(/^\s*[-*+]\s+/, "")));
          i++;
        }
        blocks.push(...L.bullets(items));
        continue;
      }
      if (/^\s*\d+(\.\d+)*[.)]\s+/.test(raw)) {
        const items = [];
        let start = null;
        while (i < lines.length && /^\s*(\d+(\.\d+)*|[a-z]|[ivx]+)[.)]\s+/.test(lines[i])) {
          const mm = lines[i].match(/^\s*(\d+(?:\.\d+)*|[a-z]|[ivx]+)[.)]\s+(.*)$/);
          if (start === null) start = parseInt(mm[1], 10) || 1;
          const t = mm[2];
          const tm = t.match(/^\*\*([^*]+)\*\*\s*(.*)$/);
          const sub = !/^\d/.test(mm[1]);
          if (sub && items.length) {
            // House style: sub-points run inline as (a), (b) inside their clause.
            items[items.length - 1].text.push({ text: ` (${mm[1]}) ` }, ...inline(t));
          } else {
            items.push(tm ? { title: plain(tm[1]), text: inline(tm[2]) } : { text: inline(t) });
          }
          i++;
        }
        blocks.push(L.clauses(items, { start }));
        blocks.push(...L.spacer(1, 4));
        continue;
      }
      if (s.startsWith(">")) {
        const buf = [];
        while (i < lines.length && lines[i].trim().startsWith(">")) buf.push(lines[i++].trim().replace(/^>\s?/, ""));
        blocks.push(L.panel([L.body(inline(buf.join(" ")))], { fill: "cream" }));
        blocks.push(...L.spacer(1, 6));
        continue;
      }
      const buf = [s];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#|\||[-*+]\s|\d+[.)]\s|>)/.test(lines[i].trim())) buf.push(lines[i++].trim());
      const text = buf.join(" ");
      const v = plain(text).match(/^(GREEN|AMBER|RED)\b/);
      if (v || afterVerdict) {
        const fill = v && v[1] === "RED" ? "grey" : "cream";
        blocks.push(L.panel([L.body(inline(text, v && v[1] === "RED" ? { color: "B5175A" } : {}))], { fill, label: "Verdict" }));
        blocks.push(...L.spacer(1, 6));
        afterVerdict = false;
        continue;
      }
      blocks.push(L.body(inline(text)));
    }
    return { blocks, title };
  }

  /**
   * Markdown -> .docx bytes. `pack(doc)` returns the zip (Blob or Buffer); `JSZip` is used to
   * upper-case the embedded-font keys, as the OOXML schema requires (docx.js writes them in
   * lower case, and Word/LibreOffice then ignore the embedded DM Sans).
   */
  async function build(L, markdown, meta, pack, JSZip) {
    const { blocks, title } = toBlocks(L, markdown, meta);
    const doc = L.buildDoc({ title, creator: meta.company || "VPS Lakeshore", sections: [{ children: blocks, footer: L.footerStandard(meta.footer) }] });
    const raw = await pack(doc);
    const zip = await JSZip.loadAsync(raw);
    const ft = zip.file("word/fontTable.xml");
    if (ft) {
      const xml = await ft.async("string");
      zip.file("word/fontTable.xml", xml.replace(/w:fontKey="\{([0-9a-fA-F-]+)\}"/g, (m, g) => `w:fontKey="{${g.toUpperCase()}}"`));
    }
    const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    return { data, title };
  }

  return { load, toBlocks, build };
})();
