/**
 * lakeshore_docx.js — VPS Lakeshore 2.0 brand component library for docx-js.
 *
 * Encodes the "In good hands" document grammar (Sept 2026 brand book + the
 * Legal & Clinical template set): DM Sans, navy 001E5F, magenta B5175A accents,
 * cream FFF8E1 panels, thin D9DDE8 rules, small-caps slate labels.
 *
 * Usage:  const L = require('./lakeshore_docx');  ... L.buildDoc({...})
 * Requires the global `docx` package (v9+):  export NODE_PATH=$(npm root -g)
 * Assets (../assets) must sit beside the scripts folder: logos + DM Sans TTFs.
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign, PageNumber,
  Footer, Header, LevelFormat, TabStopType, HeightRule, PageBreak, TableLayoutType, LineRuleType,
} = require('docx');

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
const C = {
  navy: '001E5F',     // brand navy — titles, rules, table headers, bands
  ink: '131944',      // body text
  magenta: 'B5175A',  // accent — kickers, pills, clause numbers, alerts
  cream: 'FFF8E1',    // warm panels, footer bands, quote boxes
  slate: '5C6480',    // labels, secondary text, footers
  bandLabel: 'B3BBCF',// small-caps labels on navy
  bandRule: '4D618F', // hairline on navy
  rule: 'D9DDE8',     // light rules / table row dividers
  panel: 'F3F4F8',    // grey panels, cards
  white: 'FFFFFF',
  magentaTint: 'F5E1EA',
};

const F = {
  regular: 'DM Sans',
  italic: 'DM Sans Italic',
  light: 'DM Sans Light',
  medium: 'DM Sans Medium',
  semibold: 'DM Sans SemiBold',
  fallback: 'Arial', // for glyphs DM Sans lacks (₹)
};

// A4, 1.8 cm side margins → 9866 DXA content width
const PAGE = {
  width: 11906, height: 16838,
  margin: { top: 1077, bottom: 1250, left: 1020, right: 1020, header: 500, footer: 560 },
  content: 9866,
  landscapeContent: 14838, // A4 landscape with the same 1.8 cm side margins
};

const ASSETS = [path.join(__dirname, '..', 'assets'), path.join(__dirname, 'assets'), path.join(process.cwd(), 'assets')]
  .find((d) => fs.existsSync(path.join(d, 'logo-lakeshore-colour.png'))) || path.join(__dirname, '..', 'assets');
const LOGO = {
  colour: path.join(ASSETS, 'logo-lakeshore-colour.png'), // 1004×306
  white: path.join(ASSETS, 'logo-lakeshore-white.png'),   // 690×215
};

const ORG = {
  legalName: 'Lakeshore Hospital & Research Centre Ltd',
  brand: 'VPS Lakeshore',
  tagline: 'Global Lifecare',
  cin: 'U85110KL1996PLC010235',
  address: 'XVI/612, Nettoor P.O., Maradu, Kochi 682 040',
  addressLines: ['Lakeshore Hospital & Research Centre Ltd', 'XVI/612, Nettoor P.O., Maradu, Kochi 682 040'],
  phone: '+91 484 270 1032',
  emergency: '+91 9961 640 000',
  web: 'lakeshorehospital.org',
};

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const cellNoBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const line = (color, size = 6) => ({ style: BorderStyle.SINGLE, size, color });
const pad = (t, b, l, r) => ({ top: t, bottom: b ?? t, left: l ?? 0, right: r ?? l ?? 0 });
const shade = (fill) => ({ fill, type: ShadingType.CLEAR, color: 'auto' });

function fontFor(weight, italic) {
  if (italic && (!weight || weight === 'regular')) return F.italic;
  return F[weight || 'regular'] || F.regular;
}

/**
 * Build TextRuns. Accepts a string, a run spec, or an array of either.
 * spec: { text, weight:'light'|'regular'|'medium'|'semibold', italic, color, size(pt),
 *         caps, tracking(DXA/…: character spacing in twentieths of a pt), underline, break }
 * Characters DM Sans lacks (₹) are automatically set in the fallback font; "\n" in text is a line break.
 */
function runs(input, base = {}) {
  const items = Array.isArray(input) ? input : [input];
  const out = [];
  for (const it of items) {
    const spec = typeof it === 'string' ? { text: it } : it;
    const o = { ...base, ...spec };
    const font = fontFor(o.weight, o.italic);
    const common = {
      color: o.color || base.color || C.ink,
      size: Math.round((o.size || base.size || 10) * 2),
      allCaps: !!o.caps,
      characterSpacing: o.tracking,
      underline: o.underline ? {} : undefined,
      italics: o.italic && font !== F.italic ? true : undefined,
    };
    if (o.break) out.push(new TextRun({ break: 1 }));
    if (o.text === undefined || o.text === null) continue;
    // "\n" inside text becomes a line break; ₹ is set in the fallback font (DM Sans lacks the glyph)
    const lines = String(o.text).split('\n');
    lines.forEach((ln, li) => {
      if (li > 0) out.push(new TextRun({ break: 1 }));
      for (const p of ln.split(/(₹)/)) {
        if (!p) continue;
        out.push(new TextRun({ ...common, text: p, font: p === '₹' ? F.fallback : font }));
      }
    });
  }
  return out;
}

function para(children, opts = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    alignment: opts.align,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 0, line: opts.line ?? 300, lineRule: LineRuleType.AUTO },
    indent: opts.indent,
    border: opts.border,
    shading: opts.shading,
    keepNext: opts.keepNext,
    keepLines: opts.keepLines,
    tabStops: opts.tabStops,
    numbering: opts.numbering,
    pageBreakBefore: opts.pageBreakBefore,
  });
}

function image(file, widthPx, ratio) {
  return new ImageRun({
    type: 'png',
    data: fs.readFileSync(file),
    transformation: { width: widthPx, height: Math.round(widthPx / ratio) },
  });
}
const logoColour = (widthPx = 163) => image(LOGO.colour, widthPx, 1004 / 306);
const logoWhite = (widthPx = 170) => image(LOGO.white, widthPx, 690 / 215);

function cell(children, o = {}) {
  return new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: o.width ? { size: o.width, type: WidthType.DXA } : undefined,
    borders: o.borders || cellNoBorders,
    shading: o.fill ? shade(o.fill) : undefined,
    margins: o.margins || pad(0, 0, 0, 0),
    verticalAlign: o.valign || VerticalAlign.TOP,
    columnSpan: o.span,
  });
}

function table(rows, widths, o = {}) {
  return new Table({
    rows,
    width: { size: o.width || widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders: o.borders || noBorders,
    indent: o.indent !== undefined ? { size: o.indent, type: WidthType.DXA } : undefined,
    layout: TableLayoutType.FIXED,
  });
}

function splitWidths(n, total = PAGE.content, gap = 0) {
  const w = Math.floor((total - gap * (n - 1)) / n);
  const out = [];
  for (let i = 0; i < n; i++) { out.push(w); if (i < n - 1 && gap) out.push(gap); }
  return out;
}

// ---------------------------------------------------------------------------
// Text components
// ---------------------------------------------------------------------------
const spacer = (n = 1, pts = 6) => Array.from({ length: n }, () => para([new TextRun({ text: '', size: pts * 2 })], { line: 240 }));

/** Small-caps tracked label, slate. */
const label = (text, o = {}) => para(runs({ text, size: 7.5, weight: 'medium', caps: true, tracking: 30, color: o.color || C.slate }), { after: o.after ?? 40, line: 240, keepNext: true });

/** Kicker — magenta small caps, e.g. "LEGAL · CONFIDENTIAL", "FORM CL-07 · REV 3". */
const kicker = (text, o = {}) => para(runs({ text, size: 7.5, weight: 'semibold', caps: true, tracking: 30, color: o.color || C.magenta }), { after: o.after ?? 60, line: 240 });

/** Document title — navy, DM Sans regular, 20pt (forms/clinical use 17pt). */
const title = (text, o = {}) => para(runs({ text, size: o.size || 20, weight: o.weight || 'regular', color: o.color || C.navy }), { after: o.after ?? 120, line: 260 });

/** Body heading (navy semibold 11.5pt). */
const h2 = (text, o = {}) => para(runs({ text, size: 11.5, weight: 'semibold', color: C.navy }), { before: o.before ?? 200, after: o.after ?? 80, line: 260, keepNext: true });
const h3 = (text, o = {}) => para(runs({ text, size: 10.5, weight: 'medium', color: C.navy }), { before: o.before ?? 140, after: o.after ?? 60, line: 260, keepNext: true });

/** Body paragraph, 10pt ink, 1.35 line. Pass a string or run specs for inline emphasis. */
const body = (input, o = {}) => para(runs(input, { size: o.size || 10 }), { after: o.after ?? 120, line: o.line ?? 300, align: o.align, keepNext: o.keepNext, keepLines: o.keepLines });
/** Larger opening paragraph (11.5pt) for circulars, releases, letters. */
const lead = (input, o = {}) => para(runs(input, { size: 11.5 }), { after: o.after ?? 160, line: 340 });
/** Secondary text — slate 9.5pt. */
const muted = (input, o = {}) => para(runs(input, { size: o.size || 9.5, color: C.slate }), { after: o.after ?? 100, line: 280, align: o.align });
/** Subtitle / standfirst — slate 12pt light (press releases, reports). */
const standfirst = (input, o = {}) => para(runs(input, { size: 12, weight: 'light', color: C.slate }), { after: o.after ?? 200, line: 320 });
/** Brand statement in editorial voice — navy light, large. */
const statement = (input, o = {}) => para(runs(input, { size: o.size || 20, weight: 'light', color: o.color || C.navy }), { after: o.after ?? 160, line: 280 });

/** Bulleted list (navy dot). */
const bullets = (items, o = {}) => items.map((it) => para(runs(it, { size: o.size || 10 }), { numbering: { reference: 'lk-bullets', level: 0 }, after: o.after ?? 60, line: 300 }));
/** Numbered list. */
const numbered = (items, o = {}) => items.map((it) => para(runs(it, { size: o.size || 10 }), { numbering: { reference: 'lk-numbers', level: 0 }, after: o.after ?? 60, line: 300 }));

/** Thin grey rule. */
const divider = (o = {}) => para([new TextRun({ text: '', size: 2 })], { border: { bottom: line(o.color || C.rule, 6) }, before: o.before ?? 120, after: o.after ?? 160, line: 120 });
/** Navy rule (used under title blocks). */
const navyRule = (o = {}) => divider({ color: C.navy, before: o.before ?? 60, after: o.after ?? 200 });

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

// ---------------------------------------------------------------------------
// Pills (chips)
// ---------------------------------------------------------------------------
/**
 * Pill chip. style 'filled' (magenta, white text) or 'outline' (navy border, navy text).
 * Returns a Table (one cell); place it as a block. Width is estimated from text length.
 */
function pill(text, style = 'filled', o = {}) {
  const est = Math.max(1100, Math.round(String(text).length * 92 + 520));
  const filled = style === 'filled';
  const c = cell(
    para(runs({ text, size: 8.5, weight: 'semibold', color: filled ? C.white : C.navy }), { line: 220, align: AlignmentType.CENTER }),
    {
      width: est,
      fill: filled ? (o.fill || C.magenta) : undefined,
      borders: filled ? cellNoBorders : { top: line(C.navy, 8), bottom: line(C.navy, 8), left: line(C.navy, 8), right: line(C.navy, 8) },
      margins: pad(70, 70, 160, 160),
      valign: VerticalAlign.CENTER,
    },
  );
  return table([new TableRow({ children: [c] })], [est], { indent: o.indent });
}

// ---------------------------------------------------------------------------
// Header blocks (page-1 mastheads)
// ---------------------------------------------------------------------------
/**
 * Standard masthead: kicker / pill / title on the left, colour logo top-right.
 * o.kicker, o.pill {text, style}, o.title, o.titleSize, o.rule ('navy'|'none'), o.logoWidth
 * Returns an array of blocks.
 */
function masthead(o = {}) {
  const left = [];
  if (o.kicker) left.push(kicker(o.kicker, { after: o.pill ? 80 : 60 }));
  if (o.pill) left.push(pill(o.pill.text, o.pill.style || 'outline'), ...spacer(1, 4));
  if (o.title) left.push(title(o.title, { size: o.titleSize || (o.kicker && !o.pill ? 17 : 20), after: 0 }));
  const logoW = o.logoWidth || 163;
  const rightW = 2700;
  const rows = [new TableRow({ children: [
    cell(left, { width: PAGE.content - rightW, valign: VerticalAlign.BOTTOM }),
    cell(para([logoColour(logoW)], { align: AlignmentType.RIGHT, line: 240 }), { width: rightW, valign: VerticalAlign.TOP }),
  ] })];
  const out = [table(rows, [PAGE.content - rightW, rightW])];
  if (o.rule === 'navy') out.push(navyRule({ before: 100, after: 220 }));
  else out.push(...spacer(1, 10));
  return out;
}

/**
 * Letterhead: colour logo left (large), organisation address right in slate, navy rule.
 * o.addressLines (array), o.email, o.logoWidth
 */
function letterhead(o = {}) {
  const lines = o.addressLines || ORG.addressLines;
  const right = lines.map((t) => para(runs({ text: t, size: 9.5, color: C.slate }), { align: AlignmentType.RIGHT, line: 250 }));
  if (o.email) right.push(para(runs({ text: o.email, size: 9.5, color: C.slate }), { align: AlignmentType.RIGHT, line: 250 }));
  const rows = [new TableRow({ children: [
    cell(para([logoColour(o.logoWidth || 212)], { line: 240 }), { width: 4400, valign: VerticalAlign.TOP }),
    cell(right, { width: PAGE.content - 4400, valign: VerticalAlign.TOP }),
  ] })];
  return [table(rows, [4400, PAGE.content - 4400]), navyRule({ before: 160, after: 260 })];
}

/** Ref left, date right (letters). */
function refLine(ref, date) {
  return para([
    ...runs({ text: ref, size: 10, color: C.slate }),
    new TextRun({ text: '\t' }),
    ...runs({ text: date, size: 10, color: C.slate }),
  ], { tabStops: [{ type: TabStopType.RIGHT, position: PAGE.content }], after: 200, line: 260 });
}

/** Addressee line with optional pill in front: pill + "Dr. Name, MBBS…". Always returns an array — spread it. */
function addressee(o = {}) {
  if (!o.pill) return [para(runs({ text: o.text, size: 10.5 }), { after: 200, line: 260 })];
  const pw = Math.max(1100, Math.round(String(o.pill).length * 92 + 520));
  const rows = [new TableRow({ children: [
    cell(pill(o.pill, 'filled'), { width: pw + 200, valign: VerticalAlign.CENTER }),
    cell(para(runs({ text: o.text, size: 10.5 }), { line: 240 }), { width: PAGE.content - pw - 200, valign: VerticalAlign.CENTER }),
  ] })];
  return [table(rows, [pw + 200, PAGE.content - pw - 200]), ...spacer(1, 6)];
}

const subject = (text) => para(runs({ text: `Subject: ${text}`, size: 10.5, weight: 'semibold', color: C.navy }), { after: 200, line: 260 });

/**
 * Full-bleed navy band header (agreements, circulars, notices) — returns a Header for the FIRST page.
 * Use it as `firstHeader` on the section (buildDoc then zeroes the header distance so the band
 * touches the top edge, and the body starts below it).
 * o.pill {text} | string, o.title (cream, light 26pt; \n forces a break), o.meta [{label, value}] (≤4),
 * o.titleSize, o.logoWidth
 */
function bandHeader(o = {}) {
  const inner = PAGE.content;
  const pillText = o.pill ? (o.pill.text || o.pill) : null;
  const topRow = table([new TableRow({ children: [
    cell(pillText ? [pill(pillText, 'filled')] : [para([new TextRun({ text: '', size: 2 })], { line: 240 })], { width: inner - 2700, valign: VerticalAlign.TOP }),
    cell(para([logoWhite(o.logoWidth || 170)], { align: AlignmentType.RIGHT, line: 240 }), { width: 2700, valign: VerticalAlign.TOP }),
  ] })], [inner - 2700, 2700]);
  const content = [topRow];
  const titleLines = String(o.title || '').split('\n');
  const titleRuns = [];
  titleLines.forEach((t, i) => titleRuns.push(...runs({ text: t, size: o.titleSize || 26, weight: 'light', color: C.cream, break: i > 0 })));
  content.push(para(titleRuns, { line: 260, before: 260, after: o.meta ? 300 : 120 }));
  if (o.meta && o.meta.length) {
    content.push(para([new TextRun({ text: '', size: 2 })], { border: { bottom: line(C.bandRule, 4) }, after: 160, line: 120 }));
    const widths = splitWidths(o.meta.length, inner);
    content.push(table([new TableRow({ children: o.meta.map((m, i) => cell([
      para(runs({ text: m.label, size: 7.5, weight: 'medium', caps: true, tracking: 30, color: C.bandLabel }), { after: 40, line: 240 }),
      para(runs({ text: m.value, size: 10, color: C.white }), { line: 260 }),
    ], { width: widths[i], margins: pad(0, 0, 0, 200) })) })], widths));
  }
  const bandCell = cell(content, { width: PAGE.width, fill: C.navy, margins: pad(700, 560, PAGE.margin.left, PAGE.margin.right) });
  const band = table([new TableRow({ children: [bandCell] })], [PAGE.width], { indent: -PAGE.margin.left });
  const hdr = new Header({ children: [band, ...spacer(1, 12)] });
  hdr.__lakeshoreBand = true;
  return hdr;
}

// ---------------------------------------------------------------------------
// Data / form components
// ---------------------------------------------------------------------------
/**
 * Numbered clauses (legal). items: [{title, text}] — number magenta, title navy semibold inline.
 * o.start (default 1), o.numWidth
 */
function clauses(items, o = {}) {
  const nw = o.numWidth || 700;
  const rows = items.map((it, i) => new TableRow({ children: [
    cell(para(runs({ text: `${(o.start || 1) + i}.`, size: 10, weight: 'semibold', color: C.magenta }), { line: 300 }), { width: nw, margins: pad(0, 140, 0, 0) }),
    cell(para([
      ...(it.title ? runs({ text: `${it.title} `, size: 10, weight: 'semibold', color: C.navy }) : []),
      ...runs(it.text, { size: 10 }),
    ], { line: 300 }), { width: PAGE.content - nw, margins: pad(0, 140, 0, 0) }),
  ] }));
  return table(rows, [nw, PAGE.content - nw]);
}

/**
 * Form fields with write-in rules. rows: [[{label, value?, span?}, ...], ...]; each row's cells split evenly
 * (or by span weights). A navy rule sits under each field.
 */
function fieldGrid(rows, o = {}) {
  const gap = 260;
  const out = rows.map((cells) => {
    const spans = cells.map((c) => c.span || 1);
    const total = spans.reduce((a, b) => a + b, 0);
    const avail = PAGE.content - gap * (cells.length - 1);
    const widths = [];
    const children = [];
    cells.forEach((c, i) => {
      const w = Math.floor((avail * spans[i]) / total);
      widths.push(w);
      children.push(cell([
        label(c.label, { after: 60 }),
        para(runs({ text: c.value || ' ', size: 10 }), { line: 260, border: { bottom: line(C.navy, 6) }, after: 0 }),
      ], { width: w, margins: pad(0, 200, 0, 0) }));
      if (i < cells.length - 1) { widths.push(gap); children.push(cell(para([new TextRun('')]), { width: gap })); }
    });
    return table([new TableRow({ children })], widths);
  });
  return out;
}

/** Label/value pairs in columns, no rules (discharge summary meta). rows: [[{label,value}...]] */
function metaGrid(rows, o = {}) {
  return rows.map((cells) => {
    const widths = cells.map((c) => c.width || Math.floor(PAGE.content / cells.length));
    return table([new TableRow({ children: cells.map((c, i) => cell([
      label(c.label, { after: 30 }),
      para(runs(c.value, { size: 10 }), { line: 260 }),
    ], { width: widths[i], margins: pad(0, 140, 0, i < cells.length - 1 ? 200 : 0) })) })], widths);
  });
}

/** Key terms — label (slate) | value, with light rules between rows (offer letters, term sheets). */
function keyTerms(items, o = {}) {
  const lw = o.labelWidth || 2300;
  const rows = items.map((it, i) => new TableRow({ children: [
    cell(para(runs({ text: it.label, size: 10, weight: 'medium', color: C.slate }), { line: 280 }), {
      width: lw, margins: pad(120, 120, 0, 120),
      borders: { top: i === 0 ? line(C.navy, 6) : line(C.rule, 4), bottom: line(C.rule, 4), left: NONE, right: NONE },
    }),
    cell(para(runs(it.value, { size: 10 }), { line: 280 }), {
      width: PAGE.content - lw, margins: pad(120, 120, 0, 0),
      borders: { top: i === 0 ? line(C.navy, 6) : line(C.rule, 4), bottom: line(C.rule, 4), left: NONE, right: NONE },
    }),
  ] }));
  return table(rows, [lw, PAGE.content - lw]);
}

/**
 * Data table — navy header, white rows with light rules.
 * o.headers [..], o.rows [[..]], o.widths (sum = content), o.align (['left','right',...]),
 * o.accentFirstCol (magenta semibold numbers), o.navySecondCol (navy semibold), o.totalRows [idx], o.size
 */
function dataTable(o) {
  const n = o.headers.length;
  const widths = o.widths || splitWidths(n);
  const sz = o.size || 9.5;
  const alignOf = (i) => (o.align && o.align[i] === 'right' ? AlignmentType.RIGHT : o.align && o.align[i] === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT);
  const head = new TableRow({ tableHeader: true, children: o.headers.map((h, i) => cell(
    para(runs({ text: h, size: sz, weight: 'semibold', color: C.white }), { align: alignOf(i), line: 260 }),
    { width: widths[i], fill: C.navy, margins: pad(150, 150, 160, 160), valign: VerticalAlign.CENTER },
  )) });
  const rows = o.rows.map((r, ri) => new TableRow({ children: r.map((v, i) => {
    const isTotal = o.totalRows && o.totalRows.includes(ri);
    let spec = { size: sz };
    if (isTotal) spec = { ...spec, weight: 'semibold', color: C.navy };
    else if (i === 0 && o.accentFirstCol) spec = { ...spec, weight: 'semibold', color: C.magenta };
    else if (i === 1 && o.navySecondCol) spec = { ...spec, weight: 'semibold', color: C.navy };
    else if (i === 0 && o.firstColSemibold) spec = { ...spec, weight: 'medium', color: C.ink };
    return cell(para(runs(v, spec), { align: alignOf(i), line: 280 }), {
      width: widths[i], fill: isTotal ? C.panel : undefined,
      margins: pad(120, 120, 160, 160), valign: VerticalAlign.CENTER,
      borders: { top: NONE, bottom: line(C.rule, 6), left: NONE, right: NONE },
    });
  }) }));
  return table([head, ...rows], widths);
}

/** Checklist — outlined checkbox + text. */
function checklist(items, o = {}) {
  const bw = 380;
  const rows = items.map((it) => new TableRow({ children: [
    cell(para([new TextRun('')]), { width: bw, margins: pad(0, 0, 0, 0), valign: VerticalAlign.TOP, borders: cellNoBorders,
      // inner box drawn as a nested 1-cell bordered table for crisp square corners
    }),
    cell(para(runs(it, { size: 10 }), { line: 300 }), { width: PAGE.content - bw - 200, margins: pad(0, 0, 200, 0) }),
  ] }));
  // replace first cells with box tables
  const boxed = items.map((it) => new TableRow({ children: [
    cell(table([new TableRow({ children: [cell(para([new TextRun({ text: '', size: 12 })], { line: 200 }), {
      width: 300, borders: { top: line(C.navy, 8), bottom: line(C.navy, 8), left: line(C.navy, 8), right: line(C.navy, 8) }, margins: pad(40, 40, 0, 0),
    })] })], [300]), { width: bw, margins: pad(30, 0, 0, 0) }),
    cell(para(runs(it, { size: 10 }), { line: 300 }), { width: PAGE.content - bw, margins: pad(0, 130, 0, 0) }),
  ] }));
  return table(boxed, [bw, PAGE.content - bw]);
}

/** Inline checkbox options in rows (e.g. incident types). items: strings; o.perRow (default 4) */
function checkboxRow(items, o = {}) {
  const per = o.perRow || 4;
  const chunks = [];
  for (let i = 0; i < items.length; i += per) chunks.push(items.slice(i, i + per));
  const widths = splitWidths(per);
  return chunks.map((ch) => table([new TableRow({ children: widths.map((w, i) => {
    const it = ch[i];
    if (!it) return cell(para([new TextRun('')]), { width: w });
    const inner = table([new TableRow({ children: [
      cell(table([new TableRow({ children: [cell(para([new TextRun({ text: '', size: 12 })], { line: 200 }), { width: 300, borders: { top: line(C.navy, 8), bottom: line(C.navy, 8), left: line(C.navy, 8), right: line(C.navy, 8) } })] })], [300]), { width: 380, margins: pad(30, 0, 0, 0) }),
      cell(para(runs(it, { size: 10 }), { line: 280 }), { width: w - 380 }),
    ] })], [380, w - 380]);
    return cell(inner, { width: w, margins: pad(0, 100, 0, 0) });
  }) })], widths));
}

/** Outlined option boxes in a row (severity scale). items: [{text, accent?}] */
function optionRow(items) {
  const gap = 200;
  const n = items.length;
  const widths = [];
  const children = [];
  const w = Math.floor((PAGE.content - gap * (n - 1)) / n);
  items.forEach((it, i) => {
    const col = it.accent ? C.magenta : C.rule;
    children.push(cell(para([
      new TextRun({ text: '○  ', font: F.fallback, size: 20, color: it.accent ? C.magenta : C.navy }),
      ...runs({ text: it.text, size: 10, weight: it.accent ? 'semibold' : 'regular', color: it.accent ? C.magenta : C.ink }),
    ], { line: 260 }), {
      width: w, margins: pad(140, 140, 200, 120),
      borders: { top: line(col, it.accent ? 10 : 6), bottom: line(col, it.accent ? 10 : 6), left: line(col, it.accent ? 10 : 6), right: line(col, it.accent ? 10 : 6) },
      valign: VerticalAlign.CENTER,
    }));
    widths.push(w);
    if (i < n - 1) { children.push(cell(para([new TextRun('')]), { width: gap })); widths.push(gap); }
  });
  return table([new TableRow({ children })], widths);
}

/** Labelled empty write-in box. o.label, o.heightPt (default 120) */
function textArea(o = {}) {
  const out = [];
  if (o.label) out.push(label(o.label, { after: 80 }));
  out.push(new Table({
    rows: [new TableRow({ height: { value: Math.round((o.heightPt || 120) * 20), rule: HeightRule.ATLEAST }, children: [
      cell(para([new TextRun('')]), { width: PAGE.content, borders: { top: line(C.rule, 8), bottom: line(C.rule, 8), left: line(C.rule, 8), right: line(C.rule, 8) }, margins: pad(120, 120, 160, 160) }),
    ] })],
    width: { size: PAGE.content, type: WidthType.DXA }, columnWidths: [PAGE.content], borders: noBorders, layout: TableLayoutType.FIXED,
  }));
  out.push(...spacer(1, 8));
  return out;
}

/**
 * Shaded panel. children: paragraphs/tables (or strings → body). o.fill 'grey'|'cream'|'navy', o.label (small caps)
 */
function panel(children, o = {}) {
  const fill = o.fill === 'cream' ? C.cream : o.fill === 'navy' ? C.navy : C.panel;
  const kids = (Array.isArray(children) ? children : [children]).map((k) => (typeof k === 'string' ? body(k, { after: 60 }) : k));
  const content = [];
  if (o.label) content.push(label(o.label, { after: 100, color: o.fill === 'navy' ? C.bandLabel : o.labelColor || C.slate }));
  content.push(...kids);
  return table([new TableRow({ children: [cell(content, { width: PAGE.content, fill, margins: pad(260, 220, 300, 300) })] })], [PAGE.content]);
}

/** Navy alert band: text left, big value right (emergency numbers, deadlines). */
function alertBand(text, value, o = {}) {
  const vw = o.valueWidth || 3200;
  return table([new TableRow({ children: [
    cell(para(runs(text, { size: 10, color: C.white }), { line: 280 }), { width: PAGE.content - vw, fill: C.navy, margins: pad(260, 260, 300, 200), valign: VerticalAlign.CENTER }),
    cell(para(runs({ text: value, size: 15, weight: 'semibold', color: C.white }), { align: AlignmentType.RIGHT, line: 280 }), { width: vw, fill: C.navy, margins: pad(260, 260, 100, 300), valign: VerticalAlign.CENTER }),
  ] })], [PAGE.content - vw, vw]);
}

/** Side-by-side grey cards with magenta labels. items: [{label, bullets:[..] | paras:[..]}] */
function cards(items, o = {}) {
  const gap = 300;
  const n = items.length;
  const w = Math.floor((PAGE.content - gap * (n - 1)) / n);
  const widths = []; const children = [];
  items.forEach((it, i) => {
    const content = [label(it.label, { color: C.magenta, after: 120 })];
    if (it.bullets) content.push(...bullets(it.bullets, { after: 40 }));
    if (it.paras) content.push(...it.paras.map((p) => (typeof p === 'string' ? body(p, { after: 60 }) : p)));
    children.push(cell(content, { width: w, fill: it.fill === 'cream' ? C.cream : C.panel, margins: pad(280, 240, 300, 280) }));
    widths.push(w);
    if (i < n - 1) { children.push(cell(para([new TextRun('')]), { width: gap })); widths.push(gap); }
  });
  return table([new TableRow({ children, cantSplit: true })], widths);
}

/** Cream quote box (press releases, reports). */
function quote(text, attribution) {
  const content = [para(runs({ text: `“${text}”`, size: 12, color: C.navy }), { line: 300, after: attribution ? 120 : 0 })];
  if (attribution) content.push(para(runs({ text: attribution, size: 9.5, color: C.slate }), { line: 240 }));
  return table([new TableRow({ children: [cell(content, { width: PAGE.content, fill: C.cream, margins: pad(300, 280, 300, 300) })] })], [PAGE.content]);
}

/** KPI strip — big navy numbers with slate labels, separated by rules. items: [{value,label}] */
function kpiStrip(items, o = {}) {
  const widths = splitWidths(items.length);
  return table([new TableRow({ children: items.map((it, i) => cell([
    para(runs({ text: it.value, size: o.valueSize || 20, weight: 'light', color: C.navy }), { line: 260, after: 40 }),
    para(runs({ text: it.label, size: 8.5, color: C.slate }), { line: 240 }),
  ], { width: widths[i], margins: pad(160, 160, i === 0 ? 0 : 220, 160), borders: { top: line(C.navy, 6), bottom: line(C.rule, 6), left: i === 0 ? NONE : line(C.rule, 6), right: NONE } })) })], widths);
}

/** Two-column editorial spread: big statement left, detail right (reports, strategy notes). */
function spread(statementText, rightBlocks, o = {}) {
  const lw = o.leftWidth || 3700;
  const gap = 400;
  const right = (Array.isArray(rightBlocks) ? rightBlocks : [rightBlocks]).map((b) => (typeof b === 'string' ? body(b) : b));
  return table([new TableRow({ children: [
    cell(statement(statementText, { size: o.size || 18 }), { width: lw }),
    cell(para([new TextRun('')]), { width: gap }),
    cell(right, { width: PAGE.content - lw - gap }),
  ] })], [lw, gap, PAGE.content - lw - gap]);
}

// ---------------------------------------------------------------------------
// Signature blocks
// ---------------------------------------------------------------------------
/**
 * Two (or more) signature columns with navy top rule.
 * parties: [{for: 'FOR LAKESHORE HOSPITAL & RESEARCH CENTRE LTD', lines: ['Name: ____', ...]}]
 */
function signatures(parties, o = {}) {
  const gap = 400;
  const n = parties.length;
  const w = Math.floor((PAGE.content - gap * (n - 1)) / n);
  const widths = []; const children = [];
  parties.forEach((p, i) => {
    const content = [
      para([new TextRun({ text: '', size: 2 })], { border: { top: line(C.navy, 8) }, after: 160, line: 120 }),
      para(runs({ text: p.for, size: 8, weight: 'medium', caps: true, tracking: 30, color: C.slate }), { after: o.gapAfterLabel ?? 320, line: 260 }),
      ...(p.lines || (n >= 3 ? ['Name: ______________', 'Designation: ________', 'Date: ______________'] : ['Name: ____________________', 'Designation: ______________', 'Date: ____________________'])).map((l) => para(runs({ text: l, size: 10 }), { line: 280, after: 40 })),
    ];
    children.push(cell(content, { width: w })); widths.push(w);
    if (i < n - 1) { children.push(cell(para([new TextRun('')]), { width: gap })); widths.push(gap); }
  });
  return table([new TableRow({ children, cantSplit: true })], widths);
}

/** Letter sign-off columns: [{name, title}] — name navy semibold, title ink. */
function signoff(people, o = {}) {
  const widths = splitWidths(people.length);
  return table([new TableRow({ children: people.map((p, i) => cell([
    para(runs({ text: p.name, size: 10.5, weight: 'semibold', color: C.navy }), { line: 260, after: 20 }),
    para(runs({ text: p.title, size: 10 }), { line: 260 }),
    ...(p.extra ? [para(runs({ text: p.extra, size: 9.5, color: C.slate }), { line: 260 })] : []),
  ], { width: widths[i] })), cantSplit: true })], widths);
}

/** Grey acceptance / countersign line under a rule. */
const acceptanceLine = (text) => para(runs({ text, size: 9.5, color: C.slate }), { border: { top: line(C.rule, 6) }, before: 200, after: 0, line: 300 });

/** Signature panel in a grey box, three columns (consent forms). cols: [{label, lines:[..]}] */
function signaturePanel(cols) {
  const widths = splitWidths(cols.length);
  const row = new TableRow({ children: cols.map((c, i) => cell([
    label(c.label, { after: 200 }),
    ...c.lines.map((l) => para(runs({ text: l, size: 9.5 }), { line: 280, after: 20 })),
  ], { width: widths[i], fill: C.panel, margins: pad(240, 240, i === 0 ? 260 : 120, 120) })), cantSplit: true });
  return table([row], widths);
}

// ---------------------------------------------------------------------------
// Footers & headers (section-level)
// ---------------------------------------------------------------------------
/** Standard footer: grey rule, slate note left, "n / N" right. */
function footerStandard(leftText, o = {}) {
  return new Footer({ children: [
    para([
      ...runs({ text: leftText || '', size: 8.5, color: C.slate }),
      new TextRun({ text: '\t' }),
      new TextRun({ children: [PageNumber.CURRENT], font: F.regular, size: 17, color: C.slate }),
      new TextRun({ text: ' / ', font: F.regular, size: 17, color: C.slate }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: F.regular, size: 17, color: C.slate }),
    ], { tabStops: [{ type: TabStopType.RIGHT, position: o.width || PAGE.content }], border: { top: line(C.rule, 6) }, before: 0, after: 0, line: 300 }),
  ] });
}

/** Two-text footer without page numbers (press release "— Ends —"). */
function footerPlain(leftText, rightText, o = {}) {
  return new Footer({ children: [
    para([...runs({ text: leftText || '', size: 8.5, color: C.slate }), new TextRun({ text: '\t' }), ...runs({ text: rightText || '', size: 8.5, color: C.slate })],
      { tabStops: [{ type: TabStopType.RIGHT, position: o.width || PAGE.content }], border: { top: line(C.rule, 6) }, before: 0, after: 0, line: 300 }),
  ] });
}

/** Full-bleed cream footer band (letters, circulars). left: run specs; right: text */
function footerBand(left, right, o = {}) {
  const fill = o.fill === 'navy' ? C.navy : C.cream;
  const tc = o.fill === 'navy' ? C.white : C.ink;
  const rc = o.fill === 'navy' ? C.bandLabel : C.slate;
  const row = new TableRow({ children: [
    cell(para(runs(left, { size: 9, color: tc }), { line: 260 }), { width: Math.floor(PAGE.width / 2), fill, margins: pad(300, 300, PAGE.margin.left, 0), valign: VerticalAlign.CENTER }),
    cell(para(runs({ text: right || '', size: 9, color: rc }), { align: AlignmentType.RIGHT, line: 260 }), { width: PAGE.width - Math.floor(PAGE.width / 2), fill, margins: pad(300, 300, 0, PAGE.margin.right), valign: VerticalAlign.CENTER }),
  ] });
  const f = new Footer({ children: [table([row], [Math.floor(PAGE.width / 2), PAGE.width - Math.floor(PAGE.width / 2)], { indent: -PAGE.margin.left })] });
  f.__lakeshoreBand = true;
  return f;
}

/** Small running header for continuation pages (optional): slate text left, doc ref right. Pass {width: L.PAGE.landscapeContent} in landscape sections. */
function runningHeader(left, right, o = {}) {
  return new Header({ children: [para([...runs({ text: left || '', size: 8, color: C.slate }), new TextRun({ text: '\t' }), ...runs({ text: right || '', size: 8, color: C.slate })],
    { tabStops: [{ type: TabStopType.RIGHT, position: o.width || PAGE.content }], after: 0, line: 240 })] });
}

// ---------------------------------------------------------------------------
// Cover (reports / strategy notes) & certificate frame
// ---------------------------------------------------------------------------
/**
 * Full-page navy cover. Put it in its OWN section with `fullBleed: true` (zero margins), e.g.
 *   { children: L.cover({...}), fullBleed: true }
 * o.kicker (small caps), o.title (cream light 34pt, \n for breaks), o.subtitle (white 13pt light),
 * o.meta [{label,value}], o.confidential (string | false)
 */
function cover(o = {}) {
  const inner = PAGE.content;
  const top = [para([logoWhite(230)], { line: 240, after: 0 })];
  const mid = [];
  if (o.kicker) mid.push(para(runs({ text: o.kicker, size: 8.5, weight: 'medium', caps: true, tracking: 40, color: C.bandLabel }), { after: 300, line: 240 }));
  const tl = String(o.title || '').split('\n'); const tr = [];
  tl.forEach((t, i) => tr.push(...runs({ text: t, size: o.titleSize || 34, weight: 'light', color: C.cream, break: i > 0 })));
  mid.push(para(tr, { line: 250, after: 260 }));
  if (o.subtitle) mid.push(para(runs({ text: o.subtitle, size: 13, weight: 'light', color: C.white }), { line: 320, after: 0 }));
  const bottom = [];
  if (o.meta && o.meta.length) {
    bottom.push(para([new TextRun({ text: '', size: 2 })], { border: { bottom: line(C.bandRule, 4) }, after: 160, line: 120 }));
    const widths = splitWidths(o.meta.length, inner);
    bottom.push(table([new TableRow({ children: o.meta.map((m, i) => cell([
      para(runs({ text: m.label, size: 7.5, weight: 'medium', caps: true, tracking: 30, color: C.bandLabel }), { after: 40, line: 240 }),
      para(runs({ text: m.value, size: 10, color: C.white }), { line: 260 }),
    ], { width: widths[i], margins: pad(0, 0, 0, 200) })) })], widths));
  }
  if (o.confidential !== false) bottom.push(para(runs({ text: o.confidential || 'Strictly confidential · Prepared for internal circulation', size: 8.5, color: C.bandLabel }), { before: 300, line: 240 }));
  const h = PAGE.height - 120; // leave a hair so the table never spills to a second page
  const side = pad(0, 0, PAGE.margin.left + 400, PAGE.margin.right + 400);
  const rows = [
    new TableRow({ height: { value: Math.round(h * 0.18), rule: HeightRule.EXACT }, children: [cell(top, { width: PAGE.width, fill: C.navy, margins: { ...side, top: 1300 }, valign: VerticalAlign.TOP })] }),
    new TableRow({ height: { value: Math.round(h * 0.52), rule: HeightRule.EXACT }, children: [cell(mid, { width: PAGE.width, fill: C.navy, margins: side, valign: VerticalAlign.CENTER })] }),
    new TableRow({ height: { value: Math.round(h * 0.30), rule: HeightRule.EXACT }, children: [cell(bottom, { width: PAGE.width, fill: C.navy, margins: { ...side, bottom: 1200 }, valign: VerticalAlign.BOTTOM })] }),
  ];
  return [new Table({ rows, width: { size: PAGE.width, type: WidthType.DXA }, columnWidths: [PAGE.width], borders: noBorders, layout: TableLayoutType.FIXED })];
}

/** Section-page for reports: kicker + rule at top, big navy statement, optional body. */
function sectionOpener(o = {}) {
  const out = [];
  out.push(para(runs({ text: o.kicker, size: 8, weight: 'medium', caps: true, tracking: 40, color: C.navy }), { after: 100, line: 240, pageBreakBefore: o.pageBreak !== false }));
  out.push(para([new TextRun({ text: '', size: 2 })], { border: { bottom: line(C.navy, 6) }, after: 700, line: 120 }));
  if (o.title) out.push(statement(o.title, { size: o.size || 26, after: 300 }));
  if (o.intro) out.push(...(Array.isArray(o.intro) ? o.intro : [o.intro]).map((t) => (typeof t === 'string' ? para(runs({ text: t, size: 12, weight: 'light', color: C.slate }), { line: 320, after: 160 }) : t)));
  return out;
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------
function embeddedFonts() {
  const dir = path.join(ASSETS, 'fonts');
  const list = [
    ['DM Sans', 'DMSans.ttf'], ['DM Sans Italic', 'DMSansItalic.ttf'], ['DM Sans Light', 'DMSansLight.ttf'],
    ['DM Sans Medium', 'DMSansMedium.ttf'], ['DM Sans SemiBold', 'DMSansSemiBold.ttf'],
  ];
  return list.filter(([, f]) => fs.existsSync(path.join(dir, f))).map(([name, f]) => ({ name, data: fs.readFileSync(path.join(dir, f)) }));
}

/**
 * Build the Document.
 * o.sections: [{ children:[...], footer: Footer|undefined, header: Header|undefined, firstFooter, orientation, pageBorder:boolean, margin:{...} }]
 * o.embedFonts (default true), o.title, o.creator
 */
function buildDoc(o) {
  const sections = o.sections.map((s) => {
    const landscape = s.orientation === 'landscape';
    const m = { ...PAGE.margin, ...(s.margin || {}) };
    if (s.firstHeader && s.firstHeader.__lakeshoreBand) { m.header = 0; m.top = Math.max(m.top, 1077); }
    if (s.fullBleed) { m.top = 0; m.bottom = 0; m.left = 0; m.right = 0; m.header = 0; m.footer = 0; }
    const props = {
      page: {
        size: landscape ? { width: PAGE.height, height: PAGE.width } : { width: PAGE.width, height: PAGE.height },
        margin: m,
        borders: s.pageBorder ? {
          pageBorderTop: { style: BorderStyle.SINGLE, size: 8, color: C.navy, space: 24 },
          pageBorderBottom: { style: BorderStyle.SINGLE, size: 8, color: C.navy, space: 24 },
          pageBorderLeft: { style: BorderStyle.SINGLE, size: 8, color: C.navy, space: 24 },
          pageBorderRight: { style: BorderStyle.SINGLE, size: 8, color: C.navy, space: 24 },
        } : undefined,
      },
      titlePage: (s.firstFooter || s.firstHeader) ? true : undefined, // never emit titlePg=false (LibreOffice misreads it)
    };
    // Always set explicit headers/footers so a section never inherits ("links to") the previous one.
    const empty = () => new Header({ children: [para([new TextRun({ text: '', size: 2 })], { line: 240 })] });
    const emptyF = () => new Footer({ children: [para([new TextRun({ text: '', size: 2 })], { line: 240 })] });
    if (s.fullBleed) return { properties: props, children: s.children }; // cover pages: no chrome at all
    const headers = { default: s.header || empty() };
    const footers = { default: s.footer || emptyF() };
    if (props.titlePage) {
      headers.first = s.firstHeader || s.header || empty();
      footers.first = s.firstFooter || s.footer || emptyF();
    }
    if ((s.footer && s.footer.__lakeshoreBand) || (s.firstFooter && s.firstFooter.__lakeshoreBand)) m.footer = 0;
    return { properties: props, headers, footers, children: s.children };
  });

  return new Document({
    creator: o.creator || 'VPS Lakeshore',
    title: o.title || '',
    fonts: o.embedFonts === false ? undefined : embeddedFonts(),
    styles: {
      default: { document: { run: { font: F.regular, size: 20, color: C.ink } } },
      paragraphStyles: [
        { id: 'Normal', name: 'Normal', run: { font: F.regular, size: 20, color: C.ink }, paragraph: { spacing: { line: 300, lineRule: LineRuleType.AUTO, after: 120 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: F.regular, size: 40, color: C.navy }, paragraph: { spacing: { before: 0, after: 120 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: F.semibold, size: 23, color: C.navy }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: F.medium, size: 21, color: C.navy }, paragraph: { spacing: { before: 140, after: 60 }, keepNext: true } },
      ],
    },
    numbering: {
      config: [
        { reference: 'lk-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { run: { font: F.regular, color: C.navy }, paragraph: { indent: { left: 440, hanging: 260 } } } }] },
        { reference: 'lk-numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { run: { font: F.semibold, color: C.magenta }, paragraph: { indent: { left: 520, hanging: 520 } } } }] },
      ],
    },
    sections,
  });
}

/** Write the Document to disk (normalises embedded-font GUIDs to the upper-case form the OOXML schema expects). */
async function save(doc, outPath) {
  let buf = await Packer.toBuffer(doc);
  try {
    const JSZip = require(path.join(path.dirname(require.resolve('docx')), '..', 'node_modules', 'jszip'));
    const zip = await JSZip.loadAsync(buf);
    const ft = zip.file('word/fontTable.xml');
    if (ft) {
      let xml = await ft.async('string');
      xml = xml.replace(/w:fontKey="\{([0-9a-fA-F-]+)\}"/g, (m, g) => `w:fontKey="{${g.toUpperCase()}}"`);
      zip.file('word/fontTable.xml', xml);
      buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    }
  } catch (e) { /* jszip unavailable — keep original buffer */ }
  fs.writeFileSync(outPath, buf);
  return outPath;
}

module.exports = {
  C, F, PAGE, LOGO, ORG,
  // primitives
  runs, para, cell, table, image, logoColour, logoWhite, splitWidths, pageBreak, spacer,
  // text
  label, kicker, title, h2, h3, body, lead, muted, standfirst, statement, bullets, numbered, divider, navyRule,
  // header blocks
  pill, masthead, letterhead, refLine, addressee, subject, bandHeader, cover, sectionOpener,
  // data / form
  clauses, fieldGrid, metaGrid, keyTerms, dataTable, checklist, checkboxRow, optionRow, textArea, panel, alertBand, cards, quote, kpiStrip, spread,
  // signatures
  signatures, signoff, acceptanceLine, signaturePanel,
  // section chrome
  footerStandard, footerPlain, footerBand, runningHeader,
  // assembly
  buildDoc, save,
  docx: require('docx'),
};
