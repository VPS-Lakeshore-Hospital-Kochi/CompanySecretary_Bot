/* CS Assistant - claude.ai artifact version.
 *
 * Shared records (company details, filings done, licences, library index) live in the
 * artifact's `db`; library files in its `assets` store; Ask / Check / Write run on the
 * viewer's own Claude account through `sample`. Nothing here needs a server.
 */
"use strict";

/* =================================================================== basics */
const app = document.getElementById("app");
const dlg = document.getElementById("dlg");
const LIBS = {
  pdf: ["https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"],
  mammoth: ["https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js"],
  docx: ["https://cdn.jsdelivr.net/npm/docx@9.5.1/dist/index.iife.js",
         "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"],
};
const MAX_FILE = 20 * 1024 * 1024;
const TEXT_CAP_BYTES = 230000;      // one db document holds 256 KiB
const INLINE_DOC_BYTES = 36000;     // documents this small go straight into the question
const PROMPT_CAP = 62000;           // `sample` takes 64 KiB of text per call
const CHUNK_BYTES = 26000;          // a tool result may be 32 KB

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const bytes = (s) => new TextEncoder().encode(s).length;
const pad2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayIso = () => iso(new Date());
const parseIso = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmtDate = (s) => { if (!s) return ""; const d = parseIso(String(s).slice(0, 10)); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round((n || 0) / 1024)) + " KB");
const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function cutToBytes(text, max) {
  if (bytes(text) <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bytes(text.slice(0, mid)) <= max) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo);
}

const scriptCache = {};
function loadScript(url) {
  if (!scriptCache[url]) {
    scriptCache[url] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url; s.async = false;
      s.onload = resolve;
      s.onerror = () => { delete scriptCache[url]; reject(new Error("Could not load a component from the internet. Check the connection and try again.")); };
      document.head.appendChild(s);
    });
  }
  return scriptCache[url];
}
async function need(name) { for (const u of LIBS[name]) await loadScript(u); }

function fontSize(step) {
  const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--base")) || 19;
  const next = Math.min(28, Math.max(15, cur + step * 2));
  document.documentElement.style.setProperty("--base", next + "px");
  try { localStorage.setItem("cs-font", String(next)); } catch (_) { /* storage blocked */ }
}
try { const f = localStorage.getItem("cs-font"); if (f) document.documentElement.style.setProperty("--base", f + "px"); } catch (_) { /* ignore */ }

/* ================================================================== dialogs */
function openDialog(html, wide = false) {
  dlg.className = wide ? "wide" : "";
  dlg.innerHTML = html;
  if (!dlg.open) dlg.showModal();
  return dlg;
}
function closeDialog() { if (dlg.open) dlg.close(); }
function flash(msg) {
  openDialog(`<p style="font-size:1.05rem;margin-top:0">${esc(msg)}</p><div class="row"><button class="btn" id="dlg-ok">OK</button></div>`);
  $("#dlg-ok").onclick = closeDialog;
}
function askConfirm(msg, yes = "Yes", danger = false) {
  return new Promise((resolve) => {
    openDialog(`<p style="font-size:1.05rem;margin-top:0">${esc(msg)}</p>
      <div class="row"><button class="btn ${danger ? "danger" : ""}" id="cf-yes">${esc(yes)}</button><button class="btn light" id="cf-no">Cancel</button></div>`);
    $("#cf-yes").onclick = () => { closeDialog(); resolve(true); };
    $("#cf-no").onclick = () => { closeDialog(); resolve(false); };
    dlg.addEventListener("close", () => resolve(false), { once: true });
  });
}

/* ================================================================= markdown */
function inlineMd(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
function splitRow(line) {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}
function md(text) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  let out = "", i = 0;
  const isSep = (l) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l.trim());
  const LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  while (i < lines.length) {
    const line = lines[i], t = line.trim();
    if (!t) { i++; continue; }
    if (t.startsWith("```")) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++; out += `<pre><code>${esc(buf.join("\n"))}</code></pre>`; continue;
    }
    let m = t.match(/^(#{1,6})\s+(.*)$/);
    if (m) { const n = Math.min(m[1].length, 4); out += `<h${n}>${inlineMd(m[2])}</h${n}>`; i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { out += "<hr>"; i++; continue; }
    if (t.startsWith("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = splitRow(t); i += 2;
      let rows = "";
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = splitRow(lines[i++]);
        rows += "<tr>" + head.map((_, j) => `<td>${inlineMd(cells[j] ?? "")}</td>`).join("") + "</tr>";
      }
      out += `<div class="tablewrap"><table><thead><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
      continue;
    }
    if (LI.test(line)) {
      const items = [];
      while (i < lines.length && (LI.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i]) && !LI.test(lines[i])))) {
        const m2 = lines[i].match(LI);
        if (m2) items.push({ lvl: Math.min(3, Math.floor(m2[1].length / 2)), ordered: /\d/.test(m2[2]), num: parseInt(m2[2], 10), text: m2[3] });
        else items[items.length - 1].text += " " + lines[i].trim();
        i++;
      }
      const stack = [];
      let html = "";
      for (const it of items) {
        while (stack.length > it.lvl + 1) html += `</li></${stack.pop()}>`;
        if (stack.length === it.lvl + 1) html += "</li>";
        while (stack.length < it.lvl + 1) {
          const tag = it.ordered ? "ol" : "ul";
          html += it.ordered && it.num > 1 ? `<ol start="${it.num}">` : `<${tag}>`;
          stack.push(tag);
        }
        html += `<li>${inlineMd(it.text)}`;
      }
      while (stack.length) html += `</li></${stack.pop()}>`;
      out += html;
      continue;
    }
    if (t.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) buf.push(lines[i++].trim().replace(/^>\s?/, ""));
      out += `<blockquote>${inlineMd(buf.join(" "))}</blockquote>`; continue;
    }
    const buf = [t]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#|\||```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i].trim())) buf.push(lines[i++].trim());
    const para = buf.join(" ");
    const v = para.replace(/\*/g, "").match(/^(GREEN|AMBER|RED)\b/);
    out += v ? `<div class="verdict ${v[1].toLowerCase()}">${inlineMd(para)}</div>` : `<p>${inlineMd(para)}</p>`;
  }
  return out;
}

/* ============================================================ capabilities */
const cap = { db: null, assets: null, sample: null, user: null, downloads: null, limits: null, uid: null,
  canEdit: false, canWrite: null, canUpload: false, ready: false };
const S = { profile: null, agm: {}, filings: {}, licences: [], lib: [], reg: {}, loaded: { profile: false, lib: false, licences: false, reg: false } };
const names = {};

async function initCaps() {
  const c = window.claude;
  if (!c || typeof c.use !== "function") { cap.ready = true; rerender(); return; }
  const use = (n) => c.use(n).catch(() => null);
  const [db, assets, sample, user, downloads] = await Promise.all(["db", "assets", "sample", "user", "downloads"].map(use));
  Object.assign(cap, { db, assets, sample, user, downloads });
  if (user) {
    const me = await user.me();
    cap.uid = me.id;
    cap.canEdit = me.canEdit;
    cap.canWrite = await user.can("data.write");
    const up = await user.can("assets.write");
    cap.canUpload = !!assets && up !== false;
    if (me.id) names[me.id] = me.name || "you";
  } else {
    cap.canUpload = !!assets;
  }
  if (sample) cap.limits = await sample.limits().catch(() => null);
  cap.ready = true;
  if (db) subscribe();
  rerender();
}

function dbError(e) {
  const code = e && e.code;
  if (code === "invalid_argument") return "Your access to this page does not allow changes. Ask the owner to share it with you as a Contributor or Editor.";
  if (code === "quota_exceeded") return "The page's storage is full. An editor needs to remove old documents first.";
  if (code === "resource_exhausted") return "Too many changes at once. Wait a moment and try again.";
  return "The change could not be saved. Check the connection and try again.";
}
async function write(fn) {
  try { await fn(); return true; } catch (e) { flash(dbError(e)); return false; }
}

function subscribe() {
  const db = cap.db;
  const onErr = () => { /* terminal errors: keep the page usable with what we have */ };
  db.doc("settings/company").onSnapshot((d) => { S.profile = d.exists ? d.data() : null; S.loaded.profile = true; rerender("profile"); }, onErr);
  db.doc("calendar/agm").onSnapshot((d) => { S.agm = (d.exists && d.data().dates) || {}; rerender("calendar"); }, onErr);
  db.collection("filings").onSnapshot((q) => { S.filings = {}; q.docs.forEach((d) => { S.filings[d.id] = d.data(); }); rerender("calendar"); }, onErr);
  db.collection("licences").onSnapshot((q) => { S.licences = q.docs.map((d) => ({ id: d.id, ...d.data() })); S.loaded.licences = true; rerender("licences"); }, onErr);
  let regSeen = 0;
  for (const kind of ["committees", "transplant", "decisions", "requests"]) {
    let first = true;
    db.collection("reg_" + kind).onSnapshot((q) => {
      S.reg[kind] = q.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (first) { first = false; regSeen++; S.loaded.reg = regSeen === 4; }
      rerender("reg");
    }, onErr);
  }
  db.collection("lib").onSnapshot((q) => {
    S.lib = q.docs.map((d) => ({ id: d.id, ...d.data() }));
    S.loaded.lib = true;
    for (const d of S.lib) { const c = textCache.get(d.id); if (c && c.v !== d.current) textCache.delete(d.id); }
    rerender("lib");
  }, onErr);
}

async function resolveNames(ids) {
  const want = [...new Set(ids.filter((x) => x && !(x in names)))];
  if (!want.length || !cap.user) return;
  const ps = await cap.user.profiles(want);
  for (const id of want) names[id] = (ps[id] && ps[id].name) || "a colleague";
}
const nameOf = (id) => (id ? names[id] || "a colleague" : "");

function profile() {
  const p = { ...DATA.profileDefaults, ...(S.profile || {}) };
  p.flags = { ...DATA.profileDefaults.flags, ...((S.profile && S.profile.flags) || {}) };
  return p;
}

/* ================================================================ calendar */
const fyLabel = (y) => `${y}-${String(y + 1).slice(-2)}`;
const currentFy = (d) => (d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1);
function safeDate(y, m, d) { const last = new Date(y, m, 0).getDate(); return iso(new Date(y, m - 1, Math.min(d, last))); }
function periodOf(item, y) {
  return item.period_fmt.replace("{fy}", fyLabel(y)).replace("{pfy}", fyLabel(y - 1)).replace("{y}", String(y)).replace("{py}", String(y - 1));
}
function occurrences(fy, flags, agmIso) {
  const agm = agmIso || `${fy}-09-30`;
  const out = [];
  for (const it of DATA.items) {
    if (it.applies_if && !flags[it.applies_if]) continue;
    if (it.category === "tax_labour" && !flags.track_tax_labour) continue;
    const [kind, arg] = it.rule;
    if (kind === "dates") {
      for (const [m, d, label] of arg) {
        const y = m >= 4 ? fy : fy + 1;
        const period = label ? label.replace("{y}", String(fy)).replace("{y1}", String(fy + 1)) : periodOf(it, fy);
        out.push({ item: it, due: safeDate(y, m, d), period });
      }
    } else if (kind === "monthly") {
      for (let n = 0; n < 12; n++) {
        const pm = ((4 + n - 1) % 12) + 1;
        const py = pm >= 4 ? fy : fy + 1;
        const dm = (pm % 12) + 1;
        const dy = pm === 12 ? py + 1 : py;
        const day = it.id === "tds_deposit" && pm === 3 ? 30 : arg;
        out.push({ item: it, due: safeDate(dy, dm, day), period: `for ${MONTHS[pm - 1]} ${py}` });
      }
    } else if (kind === "agm_plus") {
      const d = parseIso(agm); d.setDate(d.getDate() + arg);
      out.push({ item: it, due: iso(d), period: periodOf(it, fy), agmBased: true });
    } else if (kind === "fy_start_plus") {
      const d = new Date(fy, 3, 1); d.setDate(d.getDate() + arg);
      out.push({ item: it, due: iso(d), period: periodOf(it, fy) });
    }
  }
  for (const o of out) o.key = `${o.item.id}@${o.due}`;
  out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.item.title.localeCompare(b.item.title)));
  return out;
}
function statusFor(due, today, done) {
  if (done) return ["done", "Done"];
  const days = daysBetween(today, due);
  if (days < 0) return ["overdue", `Overdue by ${-days} day${days === -1 ? "" : "s"}`];
  if (days === 0) return ["today", "Due today"];
  if (days <= 15) return ["soon", `Due in ${days} day${days === 1 ? "" : "s"}`];
  if (days <= 45) return ["upcoming", `Due in ${days} days`];
  return ["later", `Due in ${days} days`];
}
function calendarRows(fy) {
  const p = profile();
  const today = todayIso();
  const since = p.tracking_since || today;
  const row = (o) => {
    const done = S.filings[o.key];
    let [code, label] = statusFor(o.due, today, !!done);
    if (!done && o.due < since) { code = "untracked"; label = "Before tracking started"; }
    return { ...o, status: code, label, done };
  };
  const all = occurrences(fy, p.flags, S.agm[fy]).map(row);
  const around = [...occurrences(fy - 1, p.flags, S.agm[fy - 1]), ...occurrences(fy, p.flags, S.agm[fy]), ...occurrences(fy + 1, p.flags, S.agm[fy + 1])]
    .filter((o) => Math.abs(daysBetween(today, o.due)) <= 60).map(row);
  const seen = new Set();
  const coming = around.filter((r) => ["overdue", "today", "soon", "upcoming"].includes(r.status) && !seen.has(r.key) && seen.add(r.key));
  return { all, coming, since, today };
}

/* ================================================================== library */
const FOLDER = Object.fromEntries(DATA.folders.map((f) => [f.id, f]));
const textCache = new Map(); // doc id -> {v, text, status}
const liveDocs = () => S.lib.filter((d) => !d.deleted);
const currentVersion = (d) => (d.versions || []).find((v) => v.v === d.current) || (d.versions || [])[0] || {};

async function docText(id) {
  const d = S.lib.find((x) => x.id === id);
  const c = textCache.get(id);
  if (c && d && c.v === d.current) return c;
  if (!cap.db) return { text: "", status: "none" };
  const snap = await cap.db.doc("libtext/" + id).get();
  const t = snap.exists ? snap.data() : { text: "", status: "none" };
  const entry = { v: t.v, text: t.text || "", status: t.status || "none" };
  textCache.set(id, entry);
  return entry;
}
let allTextLoaded = false;
async function loadAllText() {
  if (allTextLoaded || !cap.db) return;
  const q = await cap.db.collection("libtext").get();
  q.docs.forEach((d) => { const t = d.data(); textCache.set(d.id, { v: t.v, text: t.text || "", status: t.status || "none" }); });
  allTextLoaded = true;
}

function words(q) { return (String(q).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\-\/.]*/gu) || []).filter((w) => w.length > 1 || /\d/.test(w)).slice(0, 12); }
function snippetFor(text, ws) {
  const low = text.toLowerCase();
  let at = -1;
  for (const w of ws) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return "";
  const start = Math.max(0, at - 90), end = Math.min(text.length, at + 160);
  let s = (start ? "… " : "") + text.slice(start, end).replace(/\s+/g, " ") + (end < text.length ? " …" : "");
  for (const w of ws) s = s.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"), "gi"), (m) => `«${m}»`);
  return s;
}
/** Search titles, notes, key words and (after loading) the text inside documents. */
async function searchLibrary(q, folder = "", { includeText = true, limit = 200 } = {}) {
  const ws = words(q);
  if (!ws.length) return [];
  if (includeText) await loadAllText();
  const score = (d, needAll) => {
    const v = currentVersion(d);
    const fields = [[d.title, 10], [d.description, 4], [d.tags, 4], [(FOLDER[d.folder] || {}).name, 2], [v.filename, 3]];
    const body = (textCache.get(d.id) || {}).text || "";
    let total = 0, hit = 0;
    for (const w of ws) {
      let s = 0;
      for (const [f, wt] of fields) if (f && String(f).toLowerCase().includes(w)) s += wt;
      if (body) { const n = body.toLowerCase().split(w).length - 1; s += Math.min(n, 8); }
      if (s) hit++;
      total += s;
    }
    if (needAll ? hit < ws.length : !hit) return 0;
    return total;
  };
  const pool = liveDocs().filter((d) => !folder || d.folder === folder);
  for (const needAll of [true, false]) {
    const res = pool.map((d) => ({ d, s: score(d, needAll) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit);
    if (res.length) {
      return res.map(({ d }) => ({ ...d, snippet: snippetFor((textCache.get(d.id) || {}).text || d.description || "", ws) }));
    }
  }
  return [];
}

/* ================================================================ files */
const EXT_TYPES = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  txt: "text/plain", md: "text/markdown", csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const NATIVE = new Set(["pdf", "png", "jpg", "jpeg", "webp", "txt", "md", "csv"]);
const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";

async function pdfDoc(buf) {
  await need("pdf");
  return window.pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
}
async function pdfText(buf) {
  const pdf = await pdfDoc(buf.slice(0));
  const parts = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const t = tc.items.map((x) => x.str + (x.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+\n/g, "\n").trim();
    if (t) parts.push(`[Page ${n}]\n${t}`);
  }
  const text = parts.join("\n\n");
  return { text, pages: pdf.numPages, scanned: text.length < 40 * pdf.numPages / 4 };
}
async function pdfPagesAsImages(buf, max) {
  const pdf = await pdfDoc(buf.slice(0));
  const out = [];
  for (let n = 1; n <= Math.min(pdf.numPages, max); n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1.6 });
    const c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    out.push(await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85)));
  }
  return out;
}
async function docxText(buf) {
  await need("mammoth");
  const r = await window.mammoth.extractRawText({ arrayBuffer: buf.slice(0) });
  return r.value.replace(/\n{3,}/g, "\n\n").trim();
}

/** Read a file for the assistant: text, or page pictures for scanned copies. */
async function readForAssistant(name, buf) {
  const ext = extOf(name);
  const maxImages = (cap.limits && cap.limits.images && cap.limits.images.maxCount) || 0;
  if (ext === "pdf") {
    const r = await pdfText(buf);
    if (!r.scanned) return { name, text: r.text, summary: `PDF, ${r.pages} page${r.pages > 1 ? "s" : ""}` };
    if (!maxImages) throw new Error(`'${name}' is a scanned copy with no readable text, and pictures cannot be sent from this view. Upload a text PDF or the Word file instead.`);
    const images = await pdfPagesAsImages(buf, maxImages);
    return { name, text: "", images, summary: `Scanned PDF - the first ${images.length} of ${r.pages} page${r.pages > 1 ? "s" : ""} will be read as pictures` };
  }
  if (ext === "docx") { const text = await docxText(buf); return { name, text, summary: `Word document, about ${text.split(/\s+/).length.toLocaleString("en-IN")} words` }; }
  if (["txt", "md", "csv"].includes(ext)) { const text = new TextDecoder().decode(buf); return { name, text, summary: "Text file" }; }
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
    if (!maxImages) throw new Error("Pictures cannot be sent to the assistant from this view.");
    return { name, text: "", images: [new Blob([buf], { type: EXT_TYPES[ext] })], summary: "Picture / scan" };
  }
  if (ext === "doc") throw new Error("Old-style Word files (.doc) cannot be read. In Word choose File > Save As > Word Document (.docx) or PDF, then add it again.");
  throw new Error(`'${name}' cannot be read by the assistant. Use a PDF, a Word (.docx) file, a picture or a text file.`);
}

function b64(buf) {
  const u = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

/** Stored file bytes for a version (unwrapping Word / Excel / PowerPoint files kept inside JSON). */
async function versionBytes(v) {
  const r = await fetch("/_blob/" + v.asset);
  if (!r.ok) throw new Error("The file could not be found. It may have been removed.");
  if (v.wrapped) { const j = await r.json(); return unb64(j.data); }
  return new Uint8Array(await r.arrayBuffer());
}
async function saveFile(filename, data) {
  if (!cap.downloads) return flash("Downloads are not available in this view.");
  try { await cap.downloads.save({ filename, data }); }
  catch (e) {
    if (e && e.code === "declined") return;
    flash(e && e.code === "rejected_extension" ? "This kind of file cannot be downloaded here." : "The file could not be downloaded. Please try again.");
  }
}

/* ============================================================ word export */
const KIND_KICKER = { vet: "LEGAL · DOCUMENT REVIEW", answer: "COMPANY SECRETARIAT · ADVICE NOTE", ask: "COMPANY SECRETARIAT · ADVICE NOTE", draft: "LEGAL · CONFIDENTIAL" };
const KIND_FOOTER = {
  vet: "Review note · Confidential · Check the points against the document before relying on it",
  answer: "Advice note · Check against the Act and the portal before acting",
  ask: "Advice note · Check against the Act and the portal before acting",
  draft: "Template for guidance · Have Legal review before execution",
};
const GROUP_KICKER = { "Board & Shareholders": "GOVERNANCE · COMPANY SECRETARIAT", Contracts: "LEGAL · CONFIDENTIAL",
  "Legal Letters & Disputes": "LEGAL · PRIVILEGED & CONFIDENTIAL", Policies: "POLICY · DRAFT FOR APPROVAL" };

async function wordFile(markdown, title, kind, docType) {
  await need("docx");
  const L = await LKWord.load(window.docx, async (rel) => new Uint8Array(await (await fetch(rel)).arrayBuffer()));
  const dt = DATA.draftTypes.find((d) => d.id === docType);
  let kicker = KIND_KICKER[kind] || KIND_KICKER.draft, pill = null;
  if (kind === "draft" && dt) {
    kicker = GROUP_KICKER[dt.group] || kicker;
    const [dept, code] = DATA.refCodes[docType] || ["LEG", "GEN"];
    pill = `${dt.group === "Contracts" ? "Agreement no." : "Ref."} LHRC/${dept}/${code}/${new Date().getFullYear()}/[NNN]`;
  }
  const { data } = await LKWord.build(L, markdown, {
    title, kicker, pill, footer: KIND_FOOTER[kind] || KIND_FOOTER.draft, company: profile().name,
    status: kind === "draft" ? "Draft for review" : "For internal use",
  }, (doc) => window.docx.Packer.toBlob(doc), window.JSZip);
  const safe = String(title).replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "_").slice(0, 80) || "document";
  return { data, filename: `${safe}_${todayIso()}.docx` };
}

/* =============================================================== assistant */
const toolsOk = () => !!(cap.limits && cap.limits.tools);

function profileBlock() {
  const p = profile();
  const d = new Date();
  const lines = [`Today's date is ${fmtDate(todayIso())} (${d.toLocaleDateString("en-GB", { weekday: "long" })}).`, "", "# Company profile (from Settings)"];
  const labels = { name: "Legal name", brand: "Known as", cin: "CIN", registered_office: "Registered office", company_type: "Type of company",
    parent: "Holding / parent", pan: "PAN", gstin: "GSTIN", fy_end: "Financial year end", cs_name: "Company Secretary", signatory: "Usual signatory", notes: "Other notes" };
  for (const [k, lab] of Object.entries(labels)) if (String(p[k] || "").trim()) lines.push(`- ${lab}: ${String(p[k]).trim()}`);
  for (const [k, lab] of Object.entries(DATA.flags)) if (k !== "track_tax_labour") lines.push(`- ${lab}: ${p.flags[k] ? "Yes" : "No"}`);
  return lines.join("\n");
}

function vetPrompt(form, docNames) {
  const v = DATA.vetTypes.find((x) => x.id === form.type) || DATA.vetTypes[DATA.vetTypes.length - 1];
  const parts = [`Please vet the attached document(s): ${docNames.join(", ") || "pasted text below"}.`, `Type of document: ${v.title}.`,
    `Our side: ${form.role || "Not stated - work it out"}.`, `Pay particular attention to: ${v.focus}`];
  if ((form.concerns || "").trim()) parts.push(`The CS is specifically worried about: ${form.concerns.trim()}`);
  parts.push("Follow the vetting structure in your instructions exactly.");
  return parts.join("\n");
}
function draftPrompt(form, docNames) {
  const d = DATA.draftTypes.find((x) => x.id === form.type) || DATA.draftTypes[DATA.draftTypes.length - 1];
  const lines = [`Please draft: ${d.title}.`, ""];
  for (const [key, label] of [...d.questions, ...DATA.commonQuestions]) {
    const val = String((form.answers || {})[key] || "").trim();
    lines.push(`- ${label}: ${val || "[not given - leave a blank]"}`);
  }
  if (d.guidance) lines.push("", `Guidance for this document: ${d.guidance}`);
  if (docNames.length) lines.push("", `Reference material attached: ${docNames.join(", ")}. Use it where relevant (e.g. follow the other side's draft or our earlier format).`);
  lines.push("", "Write the complete document in Markdown (use # headings, numbered clauses and tables), then the 'Notes for the CS' section.");
  return lines.join("\n");
}

function chunk(text, start) {
  start = Math.max(0, Number(start) || 0);
  const part = cutToBytes(text.slice(start), CHUNK_BYTES);
  const next = start + part.length;
  return { start, text: part, next_start: next < text.length ? next : null, total_chars: text.length };
}

/** Put together what one call to Claude sends: turns within the size cap, plus tools and images. */
function assemble(session) {
  const atts = session.attachments || [];
  const textAtts = atts.filter((a) => a.text);
  const images = atts.flatMap((a) => a.images || []).slice(0, (cap.limits && cap.limits.images && cap.limits.images.maxCount) || 0);
  const libTools = toolsOk() && liveDocs().length > 0;
  const rules = DATA.systemPrompt + "\n\n" + profileBlock();
  const build = (inline, history) => {
    let first = session.first;
    if (textAtts.length && inline) {
      first += "\n\n" + textAtts.map((a) => `<document name="${a.name}">\n${a.text}\n</document>`).join("\n\n");
    } else if (textAtts.length) {
      first += "\n\nThe attached documents are long, so they are not pasted here. Read all of each one with the read_attached tool before answering (ask for several parts at once if you can):\n" +
        textAtts.map((a, i) => `${i + 1}. ${a.name} - ${a.text.length.toLocaleString("en-IN")} characters`).join("\n");
    }
    if (images.length) first += `\n\n${images.length} picture${images.length > 1 ? "s" : ""} of scanned pages ${images.length > 1 ? "are" : "is"} attached; read ${images.length > 1 ? "them" : "it"} as part of the document.`;
    if (libTools) first += `\n\nThe company's document library holds ${liveDocs().length} document${liveDocs().length > 1 ? "s" : ""}; search it with search_library and read documents with read_library_document whenever our own records matter.`;
    return [{ role: "user", content: rules }, { role: "user", content: first }, ...history];
  };
  const size = (turns) => turns.reduce((n, t) => n + bytes(t.content), 0);
  let history = (session.history || []).slice();
  let inline = !toolsOk() || textAtts.reduce((n, a) => n + bytes(a.text), 0) <= INLINE_DOC_BYTES;
  let turns = build(inline, history);
  while (size(turns) > PROMPT_CAP && history.length > 2) { history = history.slice(2); turns = build(inline, history); }
  if (size(turns) > PROMPT_CAP && inline && toolsOk() && textAtts.length) { inline = false; turns = build(inline, history); }
  if (size(turns) > PROMPT_CAP) {
    // Last resort without tools: keep the start of each document.
    const room = Math.max(4000, PROMPT_CAP - size(build(false, history)) - 2000);
    const each = Math.floor(room / Math.max(1, textAtts.length));
    const saved = textAtts.map((a) => a.text);
    textAtts.forEach((a) => { a.text = cutToBytes(a.text, each) + "\n[The rest of this document was too long to include.]"; });
    turns = build(true, history);
    textAtts.forEach((a, i) => { a.text = saved[i]; });
    session.cutShort = true;
  }
  const tools = [];
  const sources = session.sources || (session.sources = {});
  if (!inline && textAtts.length) {
    tools.push({
      name: "read_attached",
      description: "Read one of the documents the user attached to this request, in parts. Returns {document, start, text, next_start, total_chars}; call again with start = next_start until next_start is null.",
      inputSchema: { type: "object", properties: { document: { type: "integer", description: "The document's number in the list (1 = first)." },
        start: { type: "integer", description: "Character position to start from; 0 for the beginning." } }, required: ["document"] },
      execute: async (input) => {
        const a = textAtts[(Number(input.document) || 1) - 1];
        if (!a) throw new Error("There is no document with that number.");
        session.onStatus && session.onStatus(`Reading ${a.name}...`);
        return { document: a.name, ...chunk(a.text, input.start) };
      },
    });
  }
  if (libTools) {
    tools.push({
      name: "search_library",
      description: "Search the company's own document library (MOA/AOA, Board and general meeting papers and minutes, registers, filed MCA forms, policies, executed contracts, licences, FEMA filings, litigation papers, templates, opinions). Returns up to 8 matches with a short extract.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "Key words, e.g. 'quorum board meeting articles'" },
        folder: { type: "string", enum: DATA.folders.map((f) => f.id), description: "Optional folder to search in." } }, required: ["query"] },
      execute: async (input) => {
        const q = String(input.query || "").trim();
        if (!q) throw new Error("Give some key words to search for.");
        session.onStatus && session.onStatus(`Searching the library for "${q.slice(0, 60)}"...`);
        const hits = await searchLibrary(q, FOLDER[input.folder] ? input.folder : "", { limit: 8 });
        if (!hits.length) return { results: [], note: "No matching documents." };
        return { results: hits.map((d) => ({ doc_id: d.id, title: d.title, folder: (FOLDER[d.folder] || {}).name, date: d.date || null,
          version: d.current, extract: (d.snippet || "").replace(/[«»]/g, "") })) };
      },
    });
    tools.push({
      name: "read_library_document",
      description: "Read the text of one library document (its current version) in parts. Returns {title, folder, date, version, start, text, next_start, total_chars}; call again with start = next_start to continue.",
      inputSchema: { type: "object", properties: { doc_id: { type: "string", description: "The doc_id from search_library." },
        start: { type: "integer", description: "Character position to start from; 0 for the beginning." } }, required: ["doc_id"] },
      execute: async (input) => {
        const d = liveDocs().find((x) => x.id === String(input.doc_id));
        if (!d) throw new Error("No such document in the library.");
        session.onStatus && session.onStatus(`Reading "${d.title.slice(0, 60)}" from the library...`);
        const t = await docText(d.id);
        sources["doc-" + d.id] = d.title;
        const out = { title: d.title, folder: (FOLDER[d.folder] || {}).name, date: d.date || null, version: d.current, ...chunk(t.text, input.start) };
        if (!t.text) out.note = "This document has no readable text (a scanned copy, picture or spreadsheet). Tell the user to open it in the library and use 'Ask about this document'.";
        return out;
      },
    });
  }
  return { turns, tools, images };
}

const SAMPLE_ERRORS = {
  not_granted: "The assistant is not switched on for you on this page. Reload the page and allow it when claude.ai asks.",
  sampling_disabled: "The assistant is not available for your claude.ai account.",
  not_declared: "The assistant is not available on this version of the page.",
  capability_disabled: "The assistant is not available in this view.",
  capability_removed: "The assistant is not available in this view.",
  rate_limited: "You have asked a lot in a short time, or reached your usage limit. Wait a little and press the button again.",
  session_expired: "Your claude.ai session has ended. Sign in again, then try once more.",
  prompt_too_large: "This is too long to send in one go. Attach fewer or shorter documents (for example the agreement without its annexures).",
  refused: "The assistant declined this request. Rephrase it, or remove any unusual content, and try again.",
  empty_completion: "No answer came back. Try asking in a simpler way.",
  image_rejected: "One of the pictures could not be used. Try a clearer or smaller file.",
  images_unavailable: "Pictures of scanned pages cannot be sent from this view. Use a text PDF or the Word file.",
  tools_unavailable: "This view cannot read long documents in parts. Attach a shorter document.",
};
const sampleError = (e) => SAMPLE_ERRORS[e && e.code] || "The answer was interrupted. Please press the button again.";

function userBubble(text) { return h(`<div class="turn user"><div class="who">You</div><div class="bubble">${esc(text)}</div></div>`); }

/** One answer from the assistant, streamed into `area`. Resolves with the text ("" on failure). */
async function runTurn(session, area) {
  const view = h(`<div class="turn"><div class="who">Assistant</div><div class="answer">
      <div class="thinking"><span class="spinner"></span><span class="st">Thinking. Long documents can take a minute or two.</span>
        <button class="btn light stop" type="button">Stop</button></div>
      <div class="md"></div><div class="notes"></div><div class="sources" hidden></div><div class="row actions" hidden></div></div></div>`);
  area.appendChild(view);
  view.scrollIntoView({ behavior: "smooth", block: "start" });
  const out = $(".md", view), think = $(".thinking", view), st = $(".st", view);
  const note = (cls, msg) => $(".notes", view).appendChild(h(`<div class="banner ${cls}">${esc(msg)}</div>`));
  if (!cap.sample) {
    think.hidden = true;
    note("warn", cap.ready ? "The assistant works when this page is opened on claude.ai. The library, calendar, events and licences work here." : "Still connecting to claude.ai. Try again in a moment.");
    return "";
  }
  const ctl = new AbortController();
  $(".stop", view).onclick = () => ctl.abort();
  session.onStatus = (t) => { st.textContent = t; };
  const { turns, tools, images } = assemble(session);
  let text = "", queued = false;
  const paint = () => { queued = false; out.innerHTML = md(text); };
  const opts = { signal: ctl.signal, modelTier: session.mode === "ask" ? "default" : "complex",
    onText: (u) => { text = u.text; st.textContent = "Writing..."; if (!queued) { queued = true; requestAnimationFrame(paint); } } };
  if (tools.length) opts.tools = tools; else opts.cache = false;
  if (images.length) opts.images = images;
  try {
    const r = await cap.sample(turns, opts);
    text = r.text;
    if (r.truncated) note("warn", "The answer was cut short because it was very long. Ask for 'the rest' below.");
    if (session.cutShort) note("warn", "The documents were too long to send in full, so only their beginning was read.");
  } catch (e) {
    text = (e && e.code !== "refused" && e.text) || "";
    if (!e || e.code !== "cancelled") note("error", sampleError(e));
  }
  think.hidden = true;
  paint();
  const src = Object.entries(session.sources || {});
  if (src.length) {
    const s = $(".sources", view); s.hidden = false;
    s.innerHTML = "<strong>Library documents used:</strong> " + src.map(([k, t]) => `<button type="button" data-open="${esc(k)}">${esc(t)}</button>`).join(" · ");
    $$("[data-open]", s).forEach((b) => { b.onclick = () => go(b.dataset.open); });
    session.sources = {};
  }
  if (text) {
    session.history.push({ role: "assistant", content: text });
    addActions($(".actions", view), session, () => text, (t) => { text = t; paint(); session.history[session.history.length - 1].content = t; });
  }
  return text;
}

function addActions(row, session, getText, onEdit) {
  row.hidden = false;
  const kind = session.mode === "ask" ? "answer" : session.mode;
  const b = (label, fn, cls = "light") => { const x = h(`<button type="button" class="btn ${cls}">${label}</button>`); x.onclick = fn; row.appendChild(x); return x; };
  b("Download as Word", async (ev) => {
    ev.target.disabled = true;
    try { const f = await wordFile(getText(), session.title, kind, session.docType); await saveFile(f.filename, f.data); }
    catch (e) { flash(e.message || "The Word file could not be made."); }
    ev.target.disabled = false;
  });
  b("Copy", async () => {
    try { await navigator.clipboard.writeText(getText()); flash("Copied. You can paste it into Word or an e-mail."); }
    catch (_) {
      openDialog(`<h2 style="margin-top:0">Copy the text</h2><p class="meta">Select all (Ctrl+A), then copy (Ctrl+C).</p><textarea id="copy-box" class="editbox" readonly></textarea><div class="row"><button class="btn" id="copy-close">Close</button></div>`, true);
      $("#copy-box").value = getText(); $("#copy-box").select(); $("#copy-close").onclick = closeDialog;
    }
  });
  if (cap.canUpload) b("Save to library", () => saveToLibraryDialog(getText(), session.title, kind, session.docType));
  if (onEdit) b("Edit the text", () => {
    openDialog(`<h2 style="margin-top:0">Edit the text</h2><p class="meta">Change anything, then press Save changes. Lines starting with # are headings.</p>
      <textarea id="edit-box" class="editbox"></textarea><div class="row"><button class="btn" id="edit-save">Save changes</button><button class="btn light" id="edit-cancel">Cancel</button></div>`, true);
    $("#edit-box").value = getText();
    $("#edit-save").onclick = () => { onEdit($("#edit-box").value); closeDialog(); };
    $("#edit-cancel").onclick = closeDialog;
  });
}

function followUpBox(session, area, placeholder) {
  const box = h(`<div class="panel step"><div class="q">Ask a follow-up question, or ask for changes</div>
    <textarea id="fu-${session.mode}" placeholder="${esc(placeholder)}"></textarea>
    <div class="row"><button type="button" class="btn big">Send</button></div></div>`);
  const ta = $("textarea", box), btn = $("button", box);
  btn.onclick = async () => {
    const q = ta.value.trim();
    if (!q) return ta.focus();
    btn.disabled = true; ta.value = "";
    session.history.push({ role: "user", content: q });
    area.appendChild(userBubble(q));
    const t = await runTurn(session, area);
    if (!t) session.history.pop();
    btn.disabled = false;
    area.after(box);
  };
  return box;
}

/* ================================================================ uploader */
function makeUploader(box) {
  const docs = [];
  box.innerHTML = `
    <div class="drop"><p style="margin:0 0 0.6rem"><strong>Drag the file here</strong>, or</p>
      <div class="row" style="justify-content:center;margin:0">
        <label class="btn">Choose file from computer<input type="file" multiple hidden accept=".pdf,.docx,.doc,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"></label>
        <button type="button" class="btn light pick">Pick from the document library</button></div>
      <p class="meta" style="margin:0.6rem 0 0">PDF, Word (.docx), scanned picture (JPG / PNG) or text. Up to 20 MB each.</p></div>
    <ul class="files"></ul>
    <details><summary style="cursor:pointer;margin-top:0.6rem;font-weight:500">Or paste the text instead</summary>
      <textarea class="paste" placeholder="Paste the text of the document here"></textarea></details>
    <div class="uperr"></div>`;
  const input = $("input[type=file]", box), list = $(".files", box), err = $(".uperr", box), zone = $(".drop", box);
  const draw = () => {
    list.innerHTML = "";
    docs.forEach((d, n) => {
      const li = h(`<li><span>&#10003; <strong>${esc(d.name)}</strong> · ${esc(d.summary)}</span><button type="button">Remove</button></li>`);
      $("button", li).onclick = () => { docs.splice(n, 1); draw(); };
      list.appendChild(li);
    });
  };
  const add = async (fileList) => {
    err.innerHTML = "";
    const strong = $("strong", zone);
    strong.textContent = "Reading the file...";
    for (const f of [...fileList]) {
      try {
        if (f.size > MAX_FILE) throw new Error(`'${f.name}' is larger than 20 MB.`);
        docs.push(await readForAssistant(f.name, await f.arrayBuffer()));
      } catch (e) { err.appendChild(h(`<div class="banner error">${esc(e.message || "The file could not be read.")}</div>`)); }
    }
    strong.textContent = "Drag the file here";
    draw();
  };
  input.onchange = () => { if (input.files.length) add(input.files); input.value = ""; };
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add("over"); };
  zone.ondragleave = () => zone.classList.remove("over");
  zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove("over"); if (e.dataTransfer.files.length) add(e.dataTransfer.files); };
  $(".pick", box).onclick = () => pickFromLibrary((d) => { docs.push(d); draw(); });
  return {
    take() {
      const pasted = $(".paste", box).value.trim();
      if (pasted) { docs.push({ name: "Pasted text", text: pasted, summary: "Pasted text" }); $(".paste", box).value = ""; draw(); }
      return docs.slice();
    },
    add(d) { docs.push(d); draw(); },
    count() { return docs.length + ($(".paste", box).value.trim() ? 1 : 0); },
  };
}

/** A library document, prepared for the assistant (text, or page pictures for a scanned PDF). */
async function libraryAttachment(d) {
  const t = await docText(d.id);
  if (t.text) return { name: d.title, text: t.text, summary: `From the library${t.status === "partial" ? " (first part only)" : ""}` };
  const v = currentVersion(d);
  if (extOf(v.filename) === "pdf" || ["png", "jpg", "jpeg", "webp"].includes(extOf(v.filename))) {
    const r = await readForAssistant(v.filename, (await versionBytes(v)).buffer);
    return { ...r, name: d.title };
  }
  throw new Error(`"${d.title}" has no text the assistant can read. Download it and save it as PDF first.`);
}

function pickFromLibrary(onPick) {
  openDialog(`<h2 style="margin-top:0">Pick from the document library</h2>
    <div class="inline"><div class="grow"><input type="search" id="pk-q" placeholder="A word from the title or inside, e.g. articles, NDA, 142nd"></div>
      <button type="button" class="btn" id="pk-go">Search</button></div>
    <div id="pk-list" class="cards" style="margin-top:0.8rem;max-height:55vh;overflow:auto"></div>
    <div class="row"><button type="button" class="btn light" id="pk-close">Close</button></div>`, true);
  const list = $("#pk-list");
  const show = (docs) => {
    list.innerHTML = docs.length ? "" : `<div class="banner info">Nothing found. Try another word.</div>`;
    docs.slice(0, 40).forEach((d) => {
      const row = h(`<div class="card later"><div><div class="title">${esc(d.title)}</div>
        <div class="meta">${esc((FOLDER[d.folder] || {}).name || "")}${d.date ? " · " + fmtDate(d.date) : ""} · ${esc(currentVersion(d).filename || "")}</div></div>
        <div class="actions"><button type="button" class="btn">Use this</button></div></div>`);
      $("button", row).onclick = async (ev) => {
        ev.target.disabled = true; ev.target.textContent = "Reading...";
        try { onPick(await libraryAttachment(d)); closeDialog(); }
        catch (e) { ev.target.disabled = false; ev.target.textContent = "Use this"; list.prepend(h(`<div class="banner error">${esc(e.message)}</div>`)); }
      };
      list.appendChild(row);
    });
  };
  const run = async () => {
    const q = $("#pk-q").value.trim();
    list.innerHTML = `<p class="meta">Searching...</p>`;
    show(q ? await searchLibrary(q) : liveDocs().slice().sort((a, b) => (b.updated || "").localeCompare(a.updated || "")));
  };
  $("#pk-go").onclick = run;
  $("#pk-q").onkeydown = (e) => { if (e.key === "Enter") run(); };
  $("#pk-close").onclick = closeDialog;
  run();
}

/* ========================================================= library writes */
function folderOptions(sel) { return DATA.folders.map((f) => `<option value="${f.id}" ${f.id === sel ? "selected" : ""}>${esc(f.name)}</option>`).join(""); }

/** Store a file in the assets store; Office files travel inside a small JSON wrapper. */
async function storeFile(name, buf) {
  const ext = extOf(name);
  if (!EXT_TYPES[ext]) throw new Error(`'${name}' is not a file type the library keeps. Use PDF, Word, Excel, PowerPoint, pictures or text files.`);
  let blob, type = EXT_TYPES[ext], wrapped = false;
  if (NATIVE.has(ext)) blob = new Blob([buf], { type });
  else { blob = new Blob([JSON.stringify({ lkWrapped: 1, filename: name, mime: type, data: b64(buf) })], { type: "application/json" }); type = "application/json"; wrapped = true; }
  if (blob.size > MAX_FILE) throw new Error(`'${name}' is too large for the library (limit about ${wrapped ? "14" : "20"} MB).`);
  const up = await cap.assets.upload(blob, { type });
  return { asset: up.id, wrapped, size: buf.byteLength };
}
async function libraryText(name, buf) {
  const ext = extOf(name);
  try {
    if (ext === "pdf") { const r = await pdfText(buf); return { text: r.text, status: r.scanned ? "scanned" : "ok" }; }
    if (ext === "docx") return { text: await docxText(buf), status: "ok" };
    if (["txt", "md", "csv"].includes(ext)) return { text: new TextDecoder().decode(buf), status: "ok" };
    if (["png", "jpg", "jpeg", "webp"].includes(ext)) return { text: "", status: "picture" };
  } catch (_) { /* unreadable: still store the file */ }
  return { text: "", status: "none" };
}
function assetError(e) {
  const c = e && e.code;
  if (c === "too_large") return "The file is too large for the library.";
  if (c === "quota_or_state") return "The library's storage is full. An editor needs to remove old documents first.";
  if (c === "not_granted" || c === "capability_disabled") return "Only people with Edit access can add files.";
  if (c === "rate_limited") return "Too many uploads at once. Wait a moment and try again.";
  return (e && e.message) || "The file could not be stored.";
}
async function addToLibrary(name, buf, meta, textOverride) {
  const stored = await storeFile(name, buf);
  const t = textOverride != null ? { text: textOverride, status: "ok" } : await libraryText(name, buf);
  const text = cutToBytes(t.text || "", TEXT_CAP_BYTES);
  const status = text.length < (t.text || "").length ? "partial" : t.status;
  const now = new Date().toISOString();
  const id = newId();
  const version = { v: 1, asset: stored.asset, wrapped: stored.wrapped, filename: name, size: stored.size, uploaded: now, by: cap.uid, note: meta.note || "First version", text: status };
  await cap.db.doc("libtext/" + id).set({ v: 1, text, status });
  await cap.db.doc("lib/" + id).set({ title: (meta.title || name.replace(/\.[^.]+$/, "").replace(/_/g, " ")).slice(0, 200), folder: meta.folder || "other",
    date: meta.date || null, description: meta.description || "", tags: meta.tags || "", deleted: false, current: 1, versions: [version],
    created: now, createdBy: cap.uid, updated: now, updatedBy: cap.uid });
  textCache.set(id, { v: 1, text, status });
  return id;
}
async function addVersion(d, name, buf, note) {
  const stored = await storeFile(name, buf);
  const t = await libraryText(name, buf);
  const text = cutToBytes(t.text || "", TEXT_CAP_BYTES);
  const status = text.length < (t.text || "").length ? "partial" : t.status;
  const n = (d.current || 1) + 1, now = new Date().toISOString();
  const versions = [...(d.versions || []), { v: n, asset: stored.asset, wrapped: stored.wrapped, filename: name, size: stored.size, uploaded: now, by: cap.uid, note, text: status }];
  await cap.db.doc("libtext/" + d.id).set({ v: n, text, status });
  await cap.db.doc("lib/" + d.id).update({ versions, current: n, updated: now, updatedBy: cap.uid });
  textCache.set(d.id, { v: n, text, status });
}

function uploadDialog(folder) {
  openDialog(`<h2 style="margin-top:0">Add documents to the library</h2>
    <label class="field" for="up-folder">Which folder?</label><select id="up-folder">${folderOptions(folder || "board")}</select>
    <p class="meta" id="up-hint"></p>
    <label class="field" for="up-files">Choose the file or files</label><input type="file" id="up-files" multiple accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp">
    <label class="field" for="up-title">Title (optional; the file name is used if left empty)</label><input type="text" id="up-title" placeholder="e.g. Minutes of the 142nd Board Meeting">
    <label class="field" for="up-date">Date of the document (optional)</label><input type="date" id="up-date" style="max-width:260px">
    <label class="field" for="up-desc">Short note (optional)</label><input type="text" id="up-desc" placeholder="e.g. Signed copy, approved at the 31st AGM">
    <label class="field" for="up-tags">Key words (optional)</label><input type="text" id="up-tags" placeholder="e.g. quorum, borrowing, Sec 180">
    <div id="up-msg"></div>
    <div class="row"><button type="button" class="btn" id="up-save">Add to library</button><button type="button" class="btn light" id="up-cancel">Cancel</button></div>`);
  const hint = () => { $("#up-hint").textContent = "Usually kept here: " + FOLDER[$("#up-folder").value].hint; };
  $("#up-folder").onchange = hint; hint();
  $("#up-cancel").onclick = closeDialog;
  $("#up-save").onclick = async () => {
    const files = [...$("#up-files").files];
    const msg = $("#up-msg");
    if (!files.length) { msg.innerHTML = `<div class="banner warn">Please choose at least one file.</div>`; return; }
    const btn = $("#up-save"); btn.disabled = true;
    const meta = { folder: $("#up-folder").value, date: $("#up-date").value || null, description: $("#up-desc").value.trim(), tags: $("#up-tags").value.trim() };
    let ok = 0; const errs = [];
    for (const f of files) {
      btn.textContent = `Adding ${ok + errs.length + 1} of ${files.length}...`;
      try { await addToLibrary(f.name, await f.arrayBuffer(), { ...meta, title: files.length === 1 ? $("#up-title").value.trim() : "" }); ok++; }
      catch (e) { errs.push(`${f.name}: ${e.code ? (e.code in { invalid_argument: 1, quota_exceeded: 1 } ? dbError(e) : assetError(e)) : e.message}`); }
    }
    if (errs.length) { msg.innerHTML = `<div class="banner error">${errs.map(esc).join("<br>")}</div>`; btn.disabled = false; btn.textContent = "Add to library"; if (!ok) return; }
    else closeDialog();
    if (ok) flash(`${ok} document${ok > 1 ? "s" : ""} added to the library.`);
  };
}

function saveToLibraryDialog(markdown, title, kind, docType) {
  const contract = kind === "draft" && /^(nda|consultant|service|equipment|lease|mou|cta|dpa|empanel)/.test(docType || "");
  openDialog(`<h2 style="margin-top:0">Save to the document library</h2>
    <p class="meta">It is saved as a Word file in the Lakeshore format and can be searched and used later.</p>
    <label class="field" for="sv-title">Title</label><input type="text" id="sv-title" value="${esc(title)}">
    <label class="field" for="sv-folder">Folder</label><select id="sv-folder">${folderOptions(contract ? "contracts" : "assistant")}</select>
    <label class="field" for="sv-desc">Short note (optional)</label><input type="text" id="sv-desc" placeholder="e.g. Draft sent to the vendor on 3 October">
    <div id="sv-msg"></div>
    <div class="row"><button type="button" class="btn" id="sv-save">Save</button><button type="button" class="btn light" id="sv-cancel">Cancel</button></div>`);
  $("#sv-cancel").onclick = closeDialog;
  $("#sv-save").onclick = async () => {
    const btn = $("#sv-save"); btn.disabled = true; btn.textContent = "Saving...";
    try {
      const t = $("#sv-title").value.trim() || title;
      const f = await wordFile(markdown, t, kind, docType);
      await addToLibrary(f.filename, f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength), { folder: $("#sv-folder").value, title: t, description: $("#sv-desc").value.trim(),
        tags: kind, date: todayIso(), note: "Saved from the CS Assistant" }, markdown);
      closeDialog(); flash("Saved to the document library.");
    } catch (e) { $("#sv-msg").innerHTML = `<div class="banner error">${esc(e.code ? assetError(e) : e.message)}</div>`; btn.disabled = false; btn.textContent = "Save"; }
  };
}

/* ================================================================= screens */
const screens = {};
let current = { name: "home", param: "" };
const back = (to = "home", label = "Back to Home") => `<button type="button" class="btn light back" data-go="${to}">&larr; ${esc(label)}</button>`;
const readOnlyNote = () => (cap.db && cap.canWrite === false ? `<div class="banner info">You can read this page but not change it. Ask the owner to share it with you as a Contributor or Editor.</div>` : "");

function choiceList(name, options, selected) {
  return `<div class="choices">${options.map((o) => `<label class="choice ${o.id === selected ? "sel" : ""}"><input type="radio" name="${name}" value="${esc(o.id)}" ${o.id === selected ? "checked" : ""}><span>${esc(o.title)}</span></label>`).join("")}</div>`;
}
function wireChoices(root) {
  $$(".choice input", root).forEach((inp) => inp.addEventListener("change", () => {
    $$(`input[name="${inp.name}"]`, root).forEach((o) => o.closest(".choice").classList.toggle("sel", o.checked));
  }));
}

screens.home = () => {
  const hour = new Date().getHours();
  const { coming } = calendarRows(currentFy(new Date()));
  const over = coming.filter((r) => r.status === "overdue").length;
  const soon = coming.filter((r) => r.status === "soon" || r.status === "today").length;
  const n = liveDocs().length;
  app.innerHTML = `
    <div class="kicker">VPS Lakeshore · Company Secretariat</div>
    <h1>Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}. What would you like to do?</h1>
    ${cap.ready && !cap.sample ? `<div class="banner warn">The assistant works when this page is opened on claude.ai. The library, calendar, events and licences work here too.</div>` : ""}
    ${over || soon ? `<div class="banner ${over ? "error" : "warn"}"><strong>${over ? `${over} filing${over > 1 ? "s" : ""} overdue` : ""}${over && soon ? " and " : ""}${soon ? `${soon} due in the next 15 days` : ""}.</strong> <button type="button" class="linklike" data-go="calendar">See them</button></div>` : ""}
    <div class="panel cream">
      <div class="lbl">Document library</div>
      <div class="inline" style="margin-top:0.5rem"><div class="grow"><input type="search" id="home-q" placeholder="Find a document, e.g. Articles of Association, 142nd Board minutes, fire NOC"></div>
        <button type="button" class="btn big" id="home-go">Search</button><button type="button" class="btn light big" data-go="library">Open the library</button></div>
      <p class="meta" style="margin:0.6rem 0 0">${S.loaded.lib ? (n ? `${n} document${n > 1 ? "s" : ""} in the library.` : "The library is empty. Open it to add the company's key documents.") : "Loading the library..."}</p>
    </div>
    <div class="tiles">
      <button type="button" class="tile" data-go="ask"><span class="t">Ask a question</span><span class="d">Company law, FEMA, hospital licences, contracts and notices in plain English, with sections quoted. It also looks in our own documents.</span></button>
      <button type="button" class="tile" data-go="vet"><span class="t">Check a document</span><span class="d">An NDA, agreement, legal notice or Board paper. Get a clear verdict, the risks and the changes to ask for.</span></button>
      <button type="button" class="tile" data-go="draft"><span class="t">Write a document</span><span class="d">Board notice, minutes, resolutions, NDA, doctor agreement, reply to a legal notice and more, ready in Word.</span></button>
      <button type="button" class="tile" data-go="calendar"><span class="t">Filing calendar</span><span class="d">What is due and overdue: MCA forms, AGM, FEMA, PCPNDT, BMW. Tick them off when filed.</span></button>
      <button type="button" class="tile" data-go="events"><span class="t">Something happened?</span><span class="d">New director, loan, share allotment, legal notice, data leak: the checklist of what to do.</span></button>
      <button type="button" class="tile" data-go="licences"><span class="t">Licences &amp; renewals</span><span class="d">Expiry dates of hospital licences (AERB, PCPNDT, fire, pollution, drugs) and what needs renewing.</span></button>
      <button type="button" class="tile" data-go="share"><span class="t">Can we share this?</span><span class="d">A shareholder, the police, a court, an insurer or a patient's family wants our records. What the law allows, the requests register, and how long to keep records.</span></button>
      <button type="button" class="tile" data-go="committees"><span class="t">Committees &amp; decisions</span><span class="d">Board and hospital committees, Transplant Authorisation Committee files, and Board decisions to follow up for the Action Taken Report.</span></button>
    </div>
    <div class="tiles small" style="margin-top:1rem">
      <button type="button" class="tile" data-go="guides"><span class="t">Guides &amp; official links</span><span class="d">What the CS office looks after, and the MCA, RBI and regulator portals.</span></button>
      <button type="button" class="tile" data-go="settings"><span class="t">Company details</span><span class="d">Name, CIN and which rules apply to us. Who can use this page.</span></button>
    </div>`;
  const q = $("#home-q");
  const search = () => { pending.libQuery = q.value.trim(); go("library"); };
  $("#home-go").onclick = search;
  q.onkeydown = (e) => { if (e.key === "Enter") search(); };
};
screens.home.live = ["calendar", "lib", "profile"];

const pending = {};
let askSession = null;

screens.ask = () => {
  const examples = [
    "What are the steps and forms for appointing a new independent director?",
    "Which Board resolutions must be filed in MGT-14, and by when?",
    "Our foreign parent is transferring shares to another group company. What FEMA filings are needed?",
    "Can a consultant doctor agreement include a non-compete after the term ends?",
    "What is the stamp duty on an NDA and on a 3-year lease in Kerala?",
    "What should we do within the first 30 days after receiving a consumer complaint for medical negligence?",
    "What does our Articles of Association say about the quorum for Board meetings?",
  ];
  app.innerHTML = `${back()}
    <h1>Ask a question</h1>
    <p class="lead">Type it as you would ask a colleague. The answer quotes the section and form numbers, and looks in our library when our own documents matter.</p>
    <div class="panel step" id="ask-box">
      <div class="q">Your question</div>
      <textarea id="ask-q" placeholder="For example: What is the last date for filing AOC-4 if our AGM is on 26 September?"></textarea>
      <details style="margin-top:0.6rem"><summary style="cursor:pointer;font-weight:500">Attach a document to the question (optional)</summary><div id="ask-up" style="margin-top:0.6rem"></div></details>
      <div class="row"><button type="button" class="btn big" id="ask-go">Ask</button><button type="button" class="btn light" id="ask-new">Start a new question</button></div>
      <div class="group-title">Or pick an example</div>
      <div class="chips">${examples.map((e) => `<button type="button" class="chip ex">${esc(e)}</button>`).join("")}</div>
    </div>
    <div id="convo"></div>`;
  const q = $("#ask-q"), area = $("#convo"), btn = $("#ask-go");
  const up = makeUploader($("#ask-up"));
  $$(".ex").forEach((b) => { b.onclick = () => { q.value = b.textContent; q.focus(); }; });
  if (pending.question) { q.value = pending.question; delete pending.question; askSession = null; }
  if (pending.attach) { up.add(pending.attach); $("#ask-box details").open = true; delete pending.attach; askSession = null; }
  if (askSession) {
    askSession.shown.forEach((t) => {
      if (t.role === "user") area.appendChild(userBubble(t.content));
      else {
        const v = h(`<div class="turn"><div class="who">Assistant</div><div class="answer"><div class="md">${md(t.content)}</div><div class="row actions"></div></div></div>`);
        addActions($(".actions", v), askSession, () => t.content);
        area.appendChild(v);
      }
    });
  }
  $("#ask-new").onclick = () => { askSession = null; area.innerHTML = ""; q.value = ""; q.focus(); };
  btn.onclick = async () => {
    const text = q.value.trim();
    if (!text) return q.focus();
    btn.disabled = true;
    const atts = up.take();
    if (!askSession || atts.length) {
      askSession = { mode: "ask", title: text.slice(0, 80), attachments: atts, first: text, history: [], shown: [] };
    } else {
      askSession.history.push({ role: "user", content: text });
    }
    askSession.shown.push({ role: "user", content: text + (atts.length ? `\n(with ${atts.map((a) => a.name).join(", ")})` : "") });
    area.appendChild(userBubble(askSession.shown[askSession.shown.length - 1].content));
    q.value = "";
    const answer = await runTurn(askSession, area);
    if (answer) askSession.shown.push({ role: "assistant", content: answer });
    else if (askSession.history.length) askSession.history.pop();
    btn.disabled = false;
    q.placeholder = "Ask a follow-up (the assistant remembers this conversation), or press 'Start a new question'.";
  };
};

screens.vet = () => {
  const vt = DATA.vetTypes.map((v) => ({ id: v.id, title: v.title }));
  const vetChosen = pending.vetType || "nda"; delete pending.vetType;
  app.innerHTML = `${back()}
    <h1>Check a document</h1>
    <p class="lead">Three steps. The assistant reads the whole document and tells you whether it is safe to sign.</p>
    <div class="panel step"><div class="step-no">Step 1</div><div class="q">What kind of document is it?</div>${choiceList("vtype", vt, vetChosen)}</div>
    <div class="panel step"><div class="step-no">Step 2</div><div class="q">Add the document</div><div id="vet-up"></div></div>
    <div class="panel step"><div class="step-no">Step 3</div><div class="q">A little background (optional)</div>
      <label class="field" for="vet-role">Which side are we on?</label>
      <select id="vet-role">${DATA.roles.map((r) => `<option>${esc(r)}</option>`).join("")}</select>
      <label class="field" for="vet-concerns">Anything you are particularly worried about?</label>
      <textarea id="vet-concerns" placeholder="For example: they want us to share patient data; the liability clause looks one-sided."></textarea></div>
    <div class="row"><button type="button" class="btn big" id="vet-go">Check this document</button></div>
    <div id="convo"></div>`;
  wireChoices(app);
  const up = makeUploader($("#vet-up"));
  if (pending.attach) { up.add(pending.attach); delete pending.attach; }
  const area = $("#convo"), btn = $("#vet-go");
  btn.onclick = async () => {
    if (!up.count()) return flash("Please add the document in Step 2 first: choose a file, pick one from the library, or paste the text.");
    btn.disabled = true;
    const atts = up.take();
    const type = $("input[name=vtype]:checked").value;
    const typeTitle = vt.find((v) => v.id === type).title;
    const docNames = atts.map((a) => a.name);
    const session = { mode: "vet", title: `Review - ${typeTitle} - ${docNames[0] || ""}`, docType: type, attachments: atts, history: [],
      first: vetPrompt({ type, role: $("#vet-role").value, concerns: $("#vet-concerns").value }, docNames) };
    area.innerHTML = "";
    area.appendChild(userBubble(`Please check ${docNames.join(", ")} (${typeTitle}).`));
    await runTurn(session, area);
    area.after(followUpBox(session, area, "For example: redraft clause 9 in our favour. / Is the arbitration clause acceptable?"));
    btn.disabled = false; btn.textContent = "Check again";
  };
};

screens.draft = () => {
  const groups = {};
  DATA.draftTypes.forEach((d) => (groups[d.group] = groups[d.group] || []).push(d));
  const chosen = pending.draftType || "nda"; delete pending.draftType;
  let prefill = pending.draftAnswers || null; delete pending.draftAnswers;
  app.innerHTML = `${back()}
    <h1>Write a document</h1>
    <p class="lead">Pick the document, answer a few questions, and the assistant writes a complete first draft you can download in Word.</p>
    <div class="panel step"><div class="step-no">Step 1</div><div class="q">Which document do you need?</div>
      ${Object.entries(groups).map(([g, list]) => `<div class="group-title">${esc(g)}</div>${choiceList("dtype", list, chosen)}`).join("")}</div>
    <div class="panel step"><div class="step-no">Step 2</div><div class="q">Tell the assistant the details</div>
      <p class="meta" style="margin:0">Fill in what you know. Anything left empty shows as a blank [LIKE THIS] in the draft.</p><div id="qs"></div></div>
    <div class="panel step"><div class="step-no">Step 3 (optional)</div><div class="q">Add a reference document</div>
      <p class="meta" style="margin-top:0">The other side's draft, last year's version, our own template from the library, or your rough notes.</p><div id="draft-up"></div></div>
    <div class="row"><button type="button" class="btn big" id="draft-go">Write the document</button></div>
    <div id="convo"></div>`;
  wireChoices(app);
  const qs = $("#qs");
  const drawQs = () => {
    const d = DATA.draftTypes.find((x) => x.id === $("input[name=dtype]:checked").value);
    qs.innerHTML = [...d.questions, ...DATA.commonQuestions].map(([k, label, kind]) => `<label class="field" for="f-${k}">${esc(label)}</label>` +
      (kind === "textarea" ? `<textarea id="f-${k}" data-k="${k}"></textarea>` : `<input type="text" id="f-${k}" data-k="${k}">`)).join("");
    if (prefill) { $$("[data-k]", qs).forEach((el) => { if (prefill[el.dataset.k]) el.value = prefill[el.dataset.k]; }); prefill = null; }
  };
  $$("input[name=dtype]").forEach((i) => i.addEventListener("change", drawQs));
  drawQs();
  const up = makeUploader($("#draft-up"));
  if (pending.attach) { up.add(pending.attach); delete pending.attach; }
  const area = $("#convo"), btn = $("#draft-go");
  btn.onclick = async () => {
    btn.disabled = true;
    const atts = up.take();
    const id = $("input[name=dtype]:checked").value;
    const d = DATA.draftTypes.find((x) => x.id === id);
    const answers = {};
    $$("[data-k]", qs).forEach((el) => { answers[el.dataset.k] = el.value; });
    const session = { mode: "draft", title: d.title, docType: id, attachments: atts, history: [], first: draftPrompt({ type: id, answers }, atts.map((a) => a.name)) };
    area.innerHTML = "";
    area.appendChild(userBubble(`Please write: ${d.title}`));
    await runTurn(session, area);
    area.after(followUpBox(session, area, "For example: make the term 3 years and add a non-solicitation clause. / Make it shorter."));
    btn.disabled = false; btn.textContent = "Write it again";
  };
};

/* --------------------------------------------------------------- calendar */
let calFilter = "all", calFy = null;
screens.calendar = async () => {
  if (calFy == null) calFy = currentFy(new Date());
  const { all, coming, since, today } = calendarRows(calFy);
  await resolveNames(all.concat(coming).map((r) => r.done && r.done.by));
  const card = (r) => `
    <div class="card ${r.status}">
      <div><div class="title">${esc(r.item.title)}</div>
        <div class="meta">${esc(r.period)}${r.item.form ? " · " + esc(r.item.form) : ""} · Handled by ${esc(r.item.who)}</div></div>
      <div class="right">${fmtDate(r.due)}<br><span class="status ${r.status}">${esc(r.label)}</span></div>
      <details><summary>What is this?</summary>
        <p>${esc(r.item.what)}</p><p><strong>Law:</strong> ${esc(r.item.law)}</p>
        ${r.item.penalty ? `<p><strong>If late:</strong> ${esc(r.item.penalty)}</p>` : ""}
        ${r.item.tip ? `<p><strong>Tip:</strong> ${esc(r.item.tip)}</p>` : ""}
        ${r.item.verify ? `<div class="banner warn"><strong>Please check:</strong> ${esc(r.item.verify)}</div>` : ""}
        ${r.agmBased ? `<p class="meta">Worked out from the AGM date set below.</p>` : ""}</details>
      ${r.done ? `<div class="meta" style="grid-column:1/-1">Done on ${fmtDate(r.done.done_on)}${r.done.by ? " by " + esc(nameOf(r.done.by)) : ""}${r.done.srn ? " · SRN / Ref: " + esc(r.done.srn) : ""}${r.done.notes ? " · " + esc(r.done.notes) : ""}</div>` : ""}
      <div class="actions">
        ${r.done ? `<button type="button" class="btn light" data-undo="${esc(r.key)}">Mark as not done</button>` : `<button type="button" class="btn" data-done="${esc(r.key)}">Mark as done</button>`}
        <button type="button" class="btn light" data-ask="${esc(r.key)}">Ask the assistant about this</button></div>
    </div>`;
  const shown = all.filter((r) => calFilter === "all" || r.item.category === calFilter);
  const byMonth = {};
  shown.forEach((r) => (byMonth[r.due.slice(0, 7)] = byMonth[r.due.slice(0, 7)] || []).push(r));
  app.innerHTML = `${back()}
    <h1>Filing calendar</h1>
    <p class="lead">Today is ${fmtDate(today)}. Dates before ${fmtDate(since)}, when tracking started, are shown in grey.</p>
    ${readOnlyNote()}
    <h2>Needs attention now</h2>
    <div class="cards">${coming.length ? coming.map(card).join("") : `<div class="banner info">Nothing is overdue or due in the next 45 days.</div>`}</div>
    <h2>Whole year: FY ${fyLabel(calFy)}</h2>
    <div class="panel"><div class="inline">
      <div class="grow"><label class="field" for="agm-date" style="margin-top:0">AGM date for this year</label><input type="date" id="agm-date" value="${esc(S.agm[calFy] || `${calFy}-09-30`)}"></div>
      <button type="button" class="btn light" id="agm-save">Save AGM date</button>
      <button type="button" class="btn light" id="fy-prev">&larr; Previous year</button><button type="button" class="btn light" id="fy-next">Next year &rarr;</button></div>
      ${S.agm[calFy] ? "" : `<p class="meta" style="margin-bottom:0">AGM date not set, so 30 September is assumed. AOC-4, MGT-7, ADT-1 and CSR-2 dates follow from it.</p>`}</div>
    <div class="chips"><button type="button" class="chip ${calFilter === "all" ? "on" : ""}" data-f="all">Everything</button>
      ${Object.entries(DATA.categories).map(([k, v]) => `<button type="button" class="chip ${calFilter === k ? "on" : ""}" data-f="${k}">${esc(v)}</button>`).join("")}</div>
    ${Object.entries(byMonth).map(([m, list]) => `<div class="month">${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</div><div class="cards">${list.map(card).join("")}</div>`).join("")}
    <p class="meta" style="margin-top:1.5rem">Filings that follow an event (DIR-12, MGT-14, CHG-1, PAS-3) are under <button type="button" class="linklike" data-go="events" style="background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;color:inherit">Something happened?</button>. Which items appear depends on the switches in Company details.</p>`;
  const find = (k) => all.concat(coming).find((r) => r.key === k);
  $$("[data-f]").forEach((b) => { b.onclick = () => { calFilter = b.dataset.f; screens.calendar(); }; });
  $("#fy-prev").onclick = () => { calFy--; screens.calendar(); };
  $("#fy-next").onclick = () => { calFy++; screens.calendar(); };
  $("#agm-save").onclick = () => write(() => cap.db.doc("calendar/agm").set({ dates: { ...S.agm, [calFy]: $("#agm-date").value || `${calFy}-09-30` } }));
  $$("[data-undo]").forEach((b) => { b.onclick = () => write(() => cap.db.doc("filings/" + b.dataset.undo).delete()); });
  $$("[data-ask]").forEach((b) => { b.onclick = () => {
    const r = find(b.dataset.ask);
    pending.question = `Please explain "${r.item.title}" (${r.item.form || r.item.law}) due on ${fmtDate(r.due)} for ${r.period}: what exactly must be filed, the documents and approvals I need, the step-by-step process, fees and the penalty for delay.`;
    go("ask");
  }; });
  $$("[data-done]").forEach((b) => { b.onclick = () => {
    const r = find(b.dataset.done);
    openDialog(`<h2 style="margin-top:0">Mark as done</h2><p><strong>${esc(r.item.title)}</strong><br>${esc(r.period)} · due ${fmtDate(r.due)}</p>
      <label class="field" for="m-date">Date filed or done</label><input type="date" id="m-date" value="${todayIso()}">
      <label class="field" for="m-srn">SRN / challan / reference number (optional)</label><input type="text" id="m-srn">
      <label class="field" for="m-notes">Notes (optional)</label><input type="text" id="m-notes">
      <div class="row"><button type="button" class="btn" id="m-save">Save</button><button type="button" class="btn light" id="m-cancel">Cancel</button></div>`);
    $("#m-cancel").onclick = closeDialog;
    $("#m-save").onclick = async () => {
      const ok = await write(() => cap.db.doc("filings/" + r.key).set({ item: r.item.id, due: r.due, done_on: $("#m-date").value || todayIso(),
        srn: $("#m-srn").value.trim(), notes: $("#m-notes").value.trim(), by: cap.uid, at: new Date().toISOString() }));
      if (ok) closeDialog();
    };
  }; });
};
screens.calendar.live = ["calendar", "profile"];

/* ----------------------------------------------------------------- events */
screens.events = () => {
  app.innerHTML = `${back()}
    <h1>Something happened?</h1>
    <p class="lead">Choose what happened to see the approvals, forms and deadlines.</p>
    <div class="tiles small">${DATA.events.map((e) => `<button type="button" class="tile" data-go="event-${e.id}"><span class="t">${esc(e.title)}</span></button>`).join("")}</div>
    <div class="banner info" style="margin-top:1rem">Not in the list? <button type="button" class="linklike" data-go="ask">Ask the assistant</button> and describe what happened.</div>`;
};
screens.event = (id) => {
  const e = DATA.events.find((x) => x.id === id);
  if (!e) return screens.events();
  app.innerHTML = `${back("events", "Back to the list")}
    <h1>${esc(e.title)}</h1>
    <p class="lead">Tick each step as you finish it. Law: ${esc(e.law)}</p>
    ${e.verify ? `<div class="banner warn">${esc(e.verify)}</div>` : ""}
    <div class="panel"><ul class="checklist">${e.steps.map((s, n) => `<li><input type="checkbox" id="ev-${n}"><label for="ev-${n}">${esc(s)}</label></li>`).join("")}</ul></div>
    <div class="row"><button type="button" class="btn" id="ev-ask">Ask the assistant for a detailed plan</button><button type="button" class="btn light" id="ev-draft">Write the documents needed</button></div>
    <p class="meta">These are the usual steps. Check the latest rules for your exact facts; the assistant can help.</p>`;
  $$(".checklist input").forEach((c) => { c.onchange = () => c.closest("li").classList.toggle("ticked", c.checked); });
  $("#ev-ask").onclick = () => { pending.question = `Something has happened: ${e.title}. Please give me a complete, dated action plan for our company - every approval, form, deadline, fee and register entry - and list the documents I will need to prepare.`; go("ask"); };
  $("#ev-draft").onclick = () => { pending.draftType = { legal_notice: "reply_legal_notice", consumer_case: "consumer_reply", govt_notice: "roc_reply", board_meeting_held: "minutes", records_request: "records_reply", transplant_case: "tac_minutes" }[e.id] || "board_resolution"; go("draft"); };
};

/* --------------------------------------------------------------- licences */
function licenceStatus(l) {
  if (!l.expiry) return ["unknown", "Enter expiry date"];
  const days = daysBetween(todayIso(), l.expiry);
  if (days < 0) return ["overdue", `Expired ${-days} days ago`];
  if (days <= 30) return ["soon", `Expires in ${days} days - renew now`];
  if (days <= 90) return ["upcoming", `Expires in ${days} days - start renewal`];
  return ["later", "Valid"];
}
screens.licences = () => {
  const rank = { overdue: 0, soon: 1, upcoming: 2, unknown: 4, later: 3 };
  const list = S.licences.map((l) => ({ ...l, st: licenceStatus(l) })).sort((a, b) => rank[a.st[0]] - rank[b.st[0]] || String(a.expiry || "9999").localeCompare(String(b.expiry || "9999")) || a.name.localeCompare(b.name));
  const attention = list.filter((l) => ["overdue", "soon", "upcoming"].includes(l.st[0])).length;
  app.innerHTML = `${back()}
    <h1>Licences &amp; renewals</h1>
    <p class="lead">Enter each licence's expiry date once. You are warned 90 days before, and again at 30 days.</p>
    ${readOnlyNote()}
    ${attention ? `<div class="banner warn"><strong>${attention} licence${attention > 1 ? "s need" : " needs"} attention.</strong></div>` : ""}
    <div class="row"><button type="button" class="btn" id="lic-add">+ Add a licence</button></div>
    <div class="cards">${S.loaded.licences ? (list.map((l) => `
      <div class="card ${l.st[0]}"><div><div class="title">${esc(l.name)}</div>
        <div class="meta">${esc(l.authority || "")}${l.number ? " · No. " + esc(l.number) : ""}${l.owner ? " · Looked after by " + esc(l.owner) : ""}</div>
        ${l.notes ? `<div class="meta">${esc(l.notes)}</div>` : ""}</div>
        <div class="right">${l.expiry ? fmtDate(l.expiry) : ""}<br><span class="status ${l.st[0]}">${esc(l.st[1])}</span></div>
        <div class="actions"><button type="button" class="btn light" data-edit="${esc(l.id)}">Edit / enter expiry</button></div></div>`).join("") ||
      `<div class="banner info">No licences listed yet. Press "+ Add a licence".</div>`) : `<p class="meta">Loading...</p>`}</div>`;
  const edit = (l) => {
    openDialog(`<h2 style="margin-top:0">${l.id ? "Edit licence" : "Add a licence"}</h2>
      <label class="field" for="l-name">Name of licence</label><input type="text" id="l-name" value="${esc(l.name || "")}">
      <label class="field" for="l-auth">Issued by</label><input type="text" id="l-auth" value="${esc(l.authority || "")}">
      <label class="field" for="l-num">Licence / registration number</label><input type="text" id="l-num" value="${esc(l.number || "")}">
      <label class="field" for="l-exp">Valid until (expiry date)</label><input type="date" id="l-exp" value="${esc(l.expiry || "")}">
      <label class="field" for="l-own">Who looks after it</label><input type="text" id="l-own" value="${esc(l.owner || "")}">
      <label class="field" for="l-notes">Notes</label><input type="text" id="l-notes" value="${esc(l.notes || "")}">
      <div class="row"><button type="button" class="btn" id="l-save">Save</button><button type="button" class="btn light" id="l-cancel">Cancel</button>
      ${l.id ? `<button type="button" class="btn danger" id="l-del">Delete</button>` : ""}</div>`);
    $("#l-cancel").onclick = closeDialog;
    $("#l-save").onclick = async () => {
      const name = $("#l-name").value.trim();
      if (!name) return $("#l-name").focus();
      const body = { name, authority: $("#l-auth").value.trim(), number: $("#l-num").value.trim(), expiry: $("#l-exp").value || null,
        owner: $("#l-own").value.trim(), notes: $("#l-notes").value.trim(), by: cap.uid, at: new Date().toISOString() };
      if (await write(() => cap.db.doc("licences/" + (l.id || newId())).set(body))) closeDialog();
    };
    if (l.id) $("#l-del").onclick = async () => {
      if (await askConfirm(`Delete "${l.name}" from the list?`, "Delete", true)) write(() => cap.db.doc("licences/" + l.id).delete());
    };
  };
  $("#lic-add").onclick = () => edit({});
  $$("[data-edit]").forEach((b) => { b.onclick = () => edit(S.licences.find((l) => l.id === b.dataset.edit)); });
};
screens.licences.live = ["licences"];

/* ------------------------------------------------- registers (shared logic in static/registers.js) */
const REG_KINDS = ["committees", "transplant", "decisions", "requests"];
const regCtx = () => ({ spec: DATA.registers, checklist: DATA.transplantChecklist });
const regRows = (kind) => S.reg[kind] || [];

function regCard(kind, r, st) {
  return `<div class="card ${st[0]}"><div><div class="title">${esc(regTitle(kind, r))}</div>
      <div class="meta">${regMeta(kind, r, regCtx())}</div>
      ${kind === "decisions" && r.decision ? `<div class="meta">${esc(r.decision)}</div>` : ""}
      ${kind === "requests" && r.what ? `<div class="meta">${esc(r.what)}</div>` : ""}</div>
    <div class="right"><span class="status ${st[0]}">${esc(st[1])}</span></div>
    <div class="actions"><button type="button" class="btn light" data-redit="${esc(r.id)}">Open / update</button></div></div>`;
}

function regEdit(kind, r, preset = {}, after = null) {
  const ctx = regCtx(), spec = ctx.spec[kind];
  const row = r.id ? r : { ...preset };
  openDialog(`<h2 style="margin-top:0">${r.id ? "Update" : "Add a"} ${esc(spec.singular)}</h2>
    ${kind === "transplant" ? `<div class="banner warn">${esc(DATA.transplantVerify)}</div>` : ""}
    ${regFormHtml(kind, row, ctx)}
    <div class="row"><button type="button" class="btn" id="r-save">Save</button><button type="button" class="btn light" id="r-cancel">Cancel</button>
    ${r.id ? `<button type="button" class="btn danger" id="r-del">Delete</button>` : ""}</div>`, true);
  regWireForm(kind, dlg, ctx);
  $("#r-cancel").onclick = closeDialog;
  $("#r-save").onclick = async () => {
    const { data, missing } = regReadForm(kind, dlg, ctx);
    if (missing) return flash(`Please fill in: ${missing}.`);
    if (await write(() => cap.db.doc(`reg_${kind}/` + (r.id || newId())).set({ ...data, by: cap.uid, at: new Date().toISOString() }))) {
      closeDialog();
      if (after) after(); else render();
    }
  };
  if (r.id) $("#r-del").onclick = async () => {
    if (await askConfirm(`Delete this ${spec.singular}?`, "Delete", true)) { if (await write(() => cap.db.doc(`reg_${kind}/` + r.id).delete())) render(); }
  };
}
function wireRegCards(kind) {
  $$("[data-redit]").forEach((b) => { b.onclick = () => regEdit(kind, regRows(kind).find((x) => x.id === b.dataset.redit)); });
}
const chipTabs = (tabs, on) => `<div class="chips">${tabs.map(([k, l]) => `<button type="button" class="chip ${k === on ? "on" : ""}" data-tab="${k}">${esc(l)}</button>`).join("")}</div>`;

/* -------------------------------------------------------------- can we share this? */
let shareTab = "decide";
const shareSel = { record: "", requester: "" };
screens.share = () => {
  const R = DATA.records;
  const head = `${back()}<h1>Records: share or keep?</h1>
    <p class="lead">Someone wants our records. Can we give them, and on what terms? How long must we keep them?</p>
    ${chipTabs([["decide", "Can we share this?"], ["requests", "Requests register"], ["retention", "How long to keep records"]], shareTab)}`;
  const wireTabs = () => $$("[data-tab]").forEach((b) => { b.onclick = () => { shareTab = b.dataset.tab; render(); }; });

  if (shareTab === "retention") {
    app.innerHTML = head + `
      <div class="panel md"><table><thead><tr><th>Record</th><th>Keep for</th><th>Law</th></tr></thead><tbody>
      ${R.retention.map((x) => `<tr><td>${esc(x.record)}${x.note ? `<div class="meta">${esc(x.note)}</div>` : ""}${x.verify ? `<div class="meta"><strong>Please check:</strong> ${esc(x.verify)}</div>` : ""}</td>
        <td>${esc(x.keep)}</td><td>${esc(x.law)}</td></tr>`).join("")}</tbody></table></div>
      <h2>Before anything is destroyed</h2><div class="panel"><ol>${R.destructionSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>
      <div class="row"><button type="button" class="btn" id="ret-draft">Write our records retention policy</button></div>`;
    wireTabs();
    $("#ret-draft").onclick = () => { pending.draftType = "retention_policy"; go("draft"); };
    return;
  }

  if (shareTab === "requests") {
    const list = regSort("requests", regRows("requests"), regCtx());
    const open = list.filter((x) => x.st[0] !== "done").length;
    app.innerHTML = head + `${readOnlyNote()}
      ${open ? `<div class="banner warn"><strong>${open} request${open > 1 ? "s" : ""} still pending.</strong></div>` : ""}
      <div class="row"><button type="button" class="btn" id="rq-add">+ Log a request</button></div>
      <div class="cards">${S.loaded.reg ? (list.map((x) => regCard("requests", x.r, x.st)).join("") || `<div class="banner info">No requests logged yet.</div>`) : `<p class="meta">Loading...</p>`}</div>`;
    wireTabs();
    $("#rq-add").onclick = () => regEdit("requests", {}, { received_on: todayIso(), outcome: "Pending" });
    wireRegCards("requests");
    return;
  }

  const groups = {};
  R.types.forEach((t) => (groups[t.group] = groups[t.group] || []).push(t));
  app.innerHTML = head + `
    <div class="panel step"><div class="step-no">Step 1</div><div class="q">What record do they want?</div>
      ${Object.entries(groups).map(([g, list]) => `<div class="group-title">${esc(g)}</div>${choiceList("srec", list.map((t) => ({ id: t.id, title: t.title })), shareSel.record)}`).join("")}</div>
    <div class="panel step"><div class="step-no">Step 2</div><div class="q">Who is asking?</div>
      ${choiceList("sreq", R.requesters.map(([id, title]) => ({ id, title })), shareSel.requester)}</div>
    <div id="share-out"></div>`;
  wireTabs(); wireChoices(app);
  const out = $("#share-out");
  const draw = () => {
    const recId = ($("input[name=srec]:checked") || {}).value;
    const reqId = ($("input[name=sreq]:checked") || {}).value;
    Object.assign(shareSel, { record: recId || "", requester: reqId || "" });
    if (!recId || !reqId) { out.innerHTML = `<div class="banner info">Choose the record and the requester to see the answer.</div>`; return; }
    const rec = R.types.find((t) => t.id === recId), reqTitle = R.requesters.find((q) => q[0] === reqId)[1];
    const d = R.matrix[recId][reqId];
    out.innerHTML = `<div class="panel"><div class="lbl">The answer</div><h2 style="margin-top:0.3rem">${esc(reqTitle)} wants ${esc(rec.title.toLowerCase())}</h2>
      ${shareAnswerHtml(rec, reqTitle, d, R.generalSteps)}
      <label class="field" for="sh-detail">Anything particular about this request? (optional, used by the buttons below)</label>
      <textarea id="sh-detail" placeholder="e.g. Sub-Inspector, Maradu PS, crime no. 123/2026, wants the case sheet of an MLC patient by Friday"></textarea>
      <div class="row"><button type="button" class="btn" id="sh-log">Log this request</button><button type="button" class="btn light" id="sh-ask">Ask the assistant to confirm</button>
        <button type="button" class="btn light" id="sh-draft">Write the reply</button></div>
      <p class="meta">A first answer from the general rules. Facts can change it: take Legal's view before releasing anything sensitive.</p></div>`;
    const detail = () => $("#sh-detail").value.trim();
    $("#sh-log").onclick = () => regEdit("requests", {}, { received_on: todayIso(), requester: reqId, record: recId, what: detail(), outcome: d.verdict === "no" ? "Refused" : "Pending" },
      () => { shareTab = "requests"; render(); });
    $("#sh-ask").onclick = () => { pending.question = shareQuestion(rec, reqTitle, d, detail()); go("ask"); };
    $("#sh-draft").onclick = () => {
      pending.draftType = "records_reply";
      pending.draftAnswers = { requester: reqTitle + (detail() ? " - " + detail() : ""), asked: rec.title, decision: `${d.label}. ${d.summary} ${d.conditions.join(" ")}` };
      go("draft");
    };
  };
  $$("input[name=srec], input[name=sreq]").forEach((i) => i.addEventListener("change", draw));
  draw();
};
screens.share.live = ["reg"];

/* --------------------------------------------------------- committees & decisions */
let comTab = "committees";
screens.committees = () => {
  const ctx = regCtx(), rows = regRows(comTab), list = regSort(comTab, rows, ctx);
  const attention = list.filter((x) => ["overdue", "today", "soon"].includes(x.st[0])).length;
  const intro = {
    committees: "Board committees and the hospital's statutory committees. Enter the last meeting date to see when the next one is due, and the date each must be reconstituted or re-registered.",
    transplant: "Living-donor files for the Transplant Authorisation Committee. Choose who the donor is to get the document list, and tick each item as it is verified. Use the case number, not patient names.",
    decisions: "Decisions of the Board and its committees, who must act and by when. This list becomes the Action Taken Report (matters arising) for the next Board meeting.",
  }[comTab];
  const extra = {
    committees: `<button type="button" class="btn light" id="c-minutes">Write minutes from rough notes</button><button type="button" class="btn light" id="c-tor">Write a committee's terms of reference</button>`,
    transplant: `<button type="button" class="btn light" id="t-vet">Ask the assistant to check a file</button><button type="button" class="btn light" id="t-minutes">Write committee minutes and decision</button>`,
    decisions: `<button type="button" class="btn light" id="d-atr">Write the Action Taken Report</button>`,
  }[comTab];
  const empty = comTab === "committees"
    ? `<div class="banner info">No committees listed yet. <button type="button" class="linklike" id="c-seed">Add the usual committees</button> (Audit, NRC, CSR, Transplant Authorisation, Ethics, POSH and the NABH committees), then edit them.</div>`
    : `<div class="banner info">Nothing here yet.</div>`;
  app.innerHTML = `${back()}<h1>Committees &amp; decisions</h1>
    ${chipTabs([["committees", "Committees"], ["transplant", "Transplant files"], ["decisions", "Board decisions to follow up"]], comTab)}
    <p class="lead">${esc(intro)}</p>${readOnlyNote()}
    ${comTab === "transplant" ? `<div class="banner warn">${esc(DATA.transplantVerify)}</div>` : ""}
    ${attention ? `<div class="banner warn"><strong>${attention} need${attention > 1 ? "" : "s"} attention now.</strong></div>` : ""}
    <div class="row"><button type="button" class="btn" id="c-add">+ Add a ${esc(ctx.spec[comTab].singular)}</button>${extra}</div>
    <div class="cards">${S.loaded.reg ? (list.map((x) => regCard(comTab, x.r, x.st)).join("") || empty) : `<p class="meta">Loading...</p>`}</div>`;
  $$("[data-tab]").forEach((b) => { b.onclick = () => { comTab = b.dataset.tab; render(); }; });
  const presets = { decisions: { status: "Open" }, transplant: { received_on: todayIso(), decision: "Pending", organ: "Kidney" } }[comTab] || {};
  $("#c-add").onclick = () => regEdit(comTab, {}, presets);
  wireRegCards(comTab);
  const on = (id, fn) => { const el = $("#" + id); if (el) el.onclick = fn; };
  on("c-seed", async () => {
    const fields = DATA.registers.committees.fields.map((f) => f.key);
    await write(async () => {
      for (const p of DATA.committeePresets) {
        const row = Object.fromEntries(fields.map((k) => [k, p[k] ?? (k === "every_days" ? null : "")]));
        await cap.db.doc("reg_committees/" + newId()).set({ ...row, by: cap.uid, at: new Date().toISOString() });
      }
    });
  });
  on("c-minutes", () => { pending.draftType = "minutes"; go("draft"); });
  on("c-tor", () => { pending.draftType = "committee_constitution"; go("draft"); });
  on("t-vet", () => { pending.vetType = "transplant_file"; go("vet"); });
  on("t-minutes", () => { pending.draftType = "tac_minutes"; go("draft"); });
  on("d-atr", () => {
    const open = rows.filter((r) => r.status !== "Dropped");
    if (!open.length) return flash("Add the decisions first, then press this button.");
    pending.draftType = "action_taken_report";
    pending.draftAnswers = { items: atrText(open) };
    go("draft");
  });
};
screens.committees.live = ["reg"];

/* ---------------------------------------------------------------- library */
function docCard(d) {
  const v = currentVersion(d);
  const meta = [(FOLDER[d.folder] || {}).name, d.date ? fmtDate(d.date) : "", v.filename ? `${v.filename} (${fmtSize(v.size)})` : "",
    d.current > 1 ? `version ${d.current}` : "", d.createdBy ? `added by ${nameOf(d.createdBy)}` : ""].filter(Boolean);
  return `<div class="card ${d.deleted ? "untracked" : "later"}">
    <div><button type="button" class="title" data-go="doc-${d.id}">${esc(d.title)}</button>
      <div class="meta">${meta.map(esc).join(" · ")}</div>
      ${d.snippet ? `<div class="snippet">${esc(d.snippet).replace(/«/g, "<mark>").replace(/»/g, "</mark>")}</div>` : ""}
      ${["scanned", "picture", "none"].includes(v.text) ? `<div class="meta">No searchable text inside (scanned copy, picture or spreadsheet). A clear title and note help people find it.</div>` : ""}</div>
    <div class="actions">${d.deleted ? (cap.canUpload ? `<button type="button" class="btn" data-restore="${d.id}">Restore</button>` : "")
      : `<button type="button" class="btn" data-go="doc-${d.id}">Open</button><button type="button" class="btn light" data-dl="${d.id}">Download</button>`}</div></div>`;
}
function wireDocCards(root) {
  $$("[data-dl]", root).forEach((b) => { b.onclick = () => downloadDoc(S.lib.find((d) => d.id === b.dataset.dl)); });
  $$("[data-restore]", root).forEach((b) => { b.onclick = () => write(() => cap.db.doc("lib/" + b.dataset.restore).update({ deleted: false, updated: new Date().toISOString(), updatedBy: cap.uid })); });
}
async function downloadDoc(d, v = currentVersion(d)) {
  try { await saveFile(v.filename, await versionBytes(v)); } catch (e) { flash(e.message); }
}

async function libraryView(folder, removed) {
  const q = pending.libQuery ?? ""; delete pending.libQuery;
  const f = FOLDER[folder];
  const docs = removed ? S.lib.filter((d) => d.deleted) : q ? null : liveDocs().filter((d) => !folder || d.folder === folder);
  app.innerHTML = `${folder || removed || q ? back("library", "All folders") : back()}
    <div class="kicker">Document library</div>
    <h1>${removed ? "Removed documents" : f ? esc(f.name) : "The CS office's documents"}</h1>
    <p class="lead">${removed ? "Documents that were removed. Restore any removed by mistake." : f ? "Usually kept here: " + esc(f.hint) : "Search, open, and use any document to ask a question, check it or draft from it."}</p>
    <div class="panel"><div class="inline">
      <div class="grow"><input type="search" id="lib-q" value="${esc(q)}" placeholder="Search by any word in the title or inside the document"></div>
      <button type="button" class="btn big" id="lib-go">Search</button>
      ${cap.canUpload ? `<button type="button" class="btn big light" id="lib-add">+ Add documents</button>` : ""}</div>
      ${cap.ready && !cap.canUpload ? `<p class="meta" style="margin-bottom:0">Only people with Edit access to this page can add files.</p>` : ""}</div>
    <div id="lib-body">${S.loaded.lib || !cap.db ? "" : `<p class="meta">Loading...</p>`}</div>`;
  const body = $("#lib-body");
  const doSearch = () => { pending.libQuery = $("#lib-q").value.trim(); libraryView(folder, false); };
  $("#lib-go").onclick = doSearch;
  $("#lib-q").onkeydown = (e) => { if (e.key === "Enter") doSearch(); };
  if ($("#lib-add")) $("#lib-add").onclick = () => uploadDialog(folder);
  if (!S.loaded.lib && cap.db) return;
  let list = docs;
  if (q) { body.innerHTML = `<p class="meta">Searching inside the documents...</p>`; list = await searchLibrary(q, folder); }
  await resolveNames((list || liveDocs()).map((d) => d.createdBy));
  if (q || folder || removed) {
    if (!q) list = list.slice().sort((a, b) => String(b.date || b.created).localeCompare(String(a.date || a.created)));
    body.innerHTML = `<h2>${q ? `${list.length} result${list.length === 1 ? "" : "s"} for "${esc(q)}"` : `${list.length} document${list.length === 1 ? "" : "s"}`}</h2>
      <div class="cards">${list.map(docCard).join("") || `<div class="banner info">${q ? "Nothing found. Try a different or shorter word." : "No documents here yet."}</div>`}</div>`;
    wireDocCards(body);
    return;
  }
  const counts = {};
  liveDocs().forEach((d) => { counts[d.folder] = (counts[d.folder] || 0) + 1; });
  const recent = liveDocs().slice().sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || ""))).slice(0, 8);
  body.innerHTML = `<h2>Folders</h2>
    <div class="tiles small">${DATA.folders.map((x) => `<button type="button" class="tile" data-go="folder-${x.id}"><span class="count">${counts[x.id] || 0} document${(counts[x.id] || 0) === 1 ? "" : "s"}</span><span class="t">${esc(x.name)}</span><span class="d">${esc(x.hint)}</span></button>`).join("")}</div>
    <h2>Recently added or changed</h2>
    <div class="cards">${recent.map(docCard).join("") || `<div class="banner info">The library is empty. Start with the key documents: Certificate of Incorporation, MOA and AOA, the latest signed Board and AGM minutes, the statutory registers and the main policies.</div>`}</div>
    ${cap.canUpload && S.lib.some((d) => d.deleted) ? `<p class="meta" style="margin-top:1.4rem"><button type="button" class="linklike" data-go="removed" style="background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;color:inherit">Show removed documents</button></p>` : ""}`;
  wireDocCards(body);
}
screens.library = () => libraryView("", false);
screens.library.live = ["lib"];
screens.folder = (id) => libraryView(id, false);
screens.folder.live = ["lib"];
screens.removed = () => libraryView("", true);
screens.removed.live = ["lib"];

screens.doc = async (id) => {
  const d = S.lib.find((x) => x.id === id);
  if (!d) { app.innerHTML = `${back("library", "Library")}<div class="banner info">${S.loaded.lib ? "This document is not in the library." : "Loading..."}</div>`; return; }
  const v = currentVersion(d);
  const ext = extOf(v.filename);
  await resolveNames([d.createdBy, ...(d.versions || []).map((x) => x.by)]);
  app.innerHTML = `${back("folder-" + d.folder, (FOLDER[d.folder] || {}).name || "Library")}
    <div class="kicker">${esc((FOLDER[d.folder] || {}).name || "")}${d.deleted ? " · Removed" : ""}</div>
    <h1>${esc(d.title)}</h1>
    <div class="metagrid">
      <div><div class="lbl">Date</div>${d.date ? fmtDate(d.date) : "-"}</div>
      <div><div class="lbl">File</div>${esc(v.filename || "")} (${fmtSize(v.size)})</div>
      <div><div class="lbl">Version</div>${d.current} · ${fmtDate((v.uploaded || "").slice(0, 10))}</div>
      <div><div class="lbl">Added by</div>${esc(nameOf(d.createdBy) || "-")}</div></div>
    ${d.description ? `<p>${esc(d.description)}</p>` : ""}${d.tags ? `<p class="meta">Key words: ${esc(d.tags)}</p>` : ""}
    <div class="row"><button type="button" class="btn" id="d-dl">Download</button>
      <button type="button" class="btn light" data-use="ask">Ask about this document</button>
      <button type="button" class="btn light" data-use="vet">Check this document</button>
      <button type="button" class="btn light" data-use="draft">Use it to write a new document</button></div>
    ${cap.canUpload || cap.canWrite !== false ? `<div class="row">
      ${cap.canUpload ? `<button type="button" class="btn light" id="d-ver">Upload a new version</button>` : ""}
      <button type="button" class="btn light" id="d-edit">Edit details</button>
      ${d.deleted ? (cap.canUpload ? `<button type="button" class="btn" id="d-restore">Restore</button>` : "") : `<button type="button" class="btn danger" id="d-del">Remove</button>`}
      ${d.deleted && cap.canUpload ? `<button type="button" class="btn danger" id="d-purge">Delete for good</button>` : ""}</div>` : ""}
    <h2>Preview</h2><div class="preview" id="pv"><p class="meta">Loading the preview...</p></div>
    <h2>Versions</h2>
    <div class="tablewrap"><table class="plain"><thead><tr><th>No.</th><th>File</th><th>Uploaded</th><th>By</th><th>Note</th><th></th></tr></thead><tbody>
      ${(d.versions || []).slice().reverse().map((x) => `<tr><td>${x.v}</td><td>${esc(x.filename)}</td><td>${fmtDate((x.uploaded || "").slice(0, 10))}</td><td>${esc(nameOf(x.by))}</td>
        <td>${esc(x.note || "")}</td><td><button type="button" class="btn light" data-ver="${x.v}" style="min-height:2rem;padding:0.2rem 0.8rem">Download</button></td></tr>`).join("")}</tbody></table></div>`;
  $("#d-dl").onclick = () => downloadDoc(d);
  $$("[data-ver]").forEach((b) => { b.onclick = () => downloadDoc(d, d.versions.find((x) => x.v === Number(b.dataset.ver))); });
  $$("[data-use]").forEach((b) => { b.onclick = async () => {
    b.disabled = true; const label = b.textContent; b.textContent = "Reading...";
    try {
      pending.attach = await libraryAttachment(d);
      if (b.dataset.use === "ask") pending.question = `About the attached document "${d.title}": `;
      go(b.dataset.use);
    } catch (e) { flash(e.message); b.disabled = false; b.textContent = label; }
  }; });
  if ($("#d-ver")) $("#d-ver").onclick = () => {
    openDialog(`<h2 style="margin-top:0">Upload a new version</h2>
      <p class="meta">The current file stays as version ${d.current}. The new file becomes version ${d.current + 1}.</p>
      <label class="field" for="v-file">New file</label><input type="file" id="v-file" accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp">
      <label class="field" for="v-note">What changed? (optional)</label><input type="text" id="v-note" placeholder="e.g. Signed copy / amended at the 143rd Board meeting">
      <div id="v-msg"></div><div class="row"><button type="button" class="btn" id="v-save">Upload</button><button type="button" class="btn light" id="v-cancel">Cancel</button></div>`);
    $("#v-cancel").onclick = closeDialog;
    $("#v-save").onclick = async () => {
      const file = $("#v-file").files[0];
      if (!file) return;
      $("#v-save").disabled = true; $("#v-save").textContent = "Uploading...";
      try { await addVersion(d, file.name, await file.arrayBuffer(), $("#v-note").value.trim()); closeDialog(); }
      catch (e) { $("#v-msg").innerHTML = `<div class="banner error">${esc(e.code ? assetError(e) : e.message)}</div>`; $("#v-save").disabled = false; $("#v-save").textContent = "Upload"; }
    };
  };
  if ($("#d-edit")) $("#d-edit").onclick = () => {
    openDialog(`<h2 style="margin-top:0">Edit details</h2>
      <label class="field" for="e-title">Title</label><input type="text" id="e-title" value="${esc(d.title)}">
      <label class="field" for="e-folder">Folder</label><select id="e-folder">${folderOptions(d.folder)}</select>
      <label class="field" for="e-date">Date of the document</label><input type="date" id="e-date" value="${esc(d.date || "")}" style="max-width:260px">
      <label class="field" for="e-desc">Short note</label><input type="text" id="e-desc" value="${esc(d.description || "")}">
      <label class="field" for="e-tags">Key words</label><input type="text" id="e-tags" value="${esc(d.tags || "")}">
      <div class="row"><button type="button" class="btn" id="e-save">Save</button><button type="button" class="btn light" id="e-cancel">Cancel</button></div>`);
    $("#e-cancel").onclick = closeDialog;
    $("#e-save").onclick = async () => {
      const title = $("#e-title").value.trim();
      if (!title) return $("#e-title").focus();
      if (await write(() => cap.db.doc("lib/" + d.id).update({ title, folder: $("#e-folder").value, date: $("#e-date").value || null,
        description: $("#e-desc").value.trim(), tags: $("#e-tags").value.trim(), updated: new Date().toISOString(), updatedBy: cap.uid }))) closeDialog();
    };
  };
  if ($("#d-del")) $("#d-del").onclick = async () => {
    if (await askConfirm(`Remove "${d.title}" from the library? An editor can restore it later.`, "Remove", true))
      write(() => cap.db.doc("lib/" + d.id).update({ deleted: true, updated: new Date().toISOString(), updatedBy: cap.uid }));
  };
  if ($("#d-restore")) $("#d-restore").onclick = () => write(() => cap.db.doc("lib/" + d.id).update({ deleted: false, updated: new Date().toISOString(), updatedBy: cap.uid }));
  if ($("#d-purge")) $("#d-purge").onclick = async () => {
    if (!(await askConfirm(`Delete "${d.title}" and every version of its file for good? This cannot be undone.`, "Delete for good", true))) return;
    try {
      for (const x of d.versions || []) await cap.assets.delete(x.asset);
      await cap.db.doc("libtext/" + d.id).delete();
      await cap.db.doc("lib/" + d.id).delete();
      go("removed");
    } catch (e) { flash(e.code ? assetError(e) : dbError(e)); }
  };
  // Preview
  const pv = $("#pv");
  try {
    if (ext === "pdf") {
      const pdf = await pdfDoc((await versionBytes(v)).buffer);
      pv.innerHTML = "";
      const show = async (from, to) => {
        for (let n = from; n <= Math.min(pdf.numPages, to); n++) {
          const page = await pdf.getPage(n);
          const vp = page.getViewport({ scale: 1.4 });
          const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
          pv.appendChild(c);
          await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        }
        if (to < pdf.numPages) {
          const more = h(`<button type="button" class="btn light">Show the next pages (${to + 1} to ${Math.min(pdf.numPages, to + 5)} of ${pdf.numPages})</button>`);
          more.onclick = () => { more.remove(); show(to + 1, to + 5); };
          pv.appendChild(more);
        }
      };
      await show(1, 3);
    } else if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
      pv.innerHTML = `<img src="/_blob/${esc(v.asset)}" alt="${esc(d.title)}">`;
    } else {
      const t = await docText(d.id);
      pv.innerHTML = t.text ? `<div class="textpreview">${esc(t.text)}</div>` : `<div class="banner info">No preview for this kind of file. Press Download to open it.</div>`;
    }
  } catch (e) { pv.innerHTML = `<div class="banner info">The preview could not be shown. Press Download to open the file.</div>`; }
};
screens.doc.live = ["lib"];

/* ----------------------------------------------------------------- guides */
screens.guides = () => {
  app.innerHTML = `${back()}
    <h1>Guides &amp; official links</h1>
    <p class="lead">The official portals the CS office uses, and a guide to everything the office looks after.</p>
    <h2>Official websites</h2>
    <div class="tiles small">${DATA.links.map(([g, links]) => `<div class="tile" style="cursor:default"><span class="count">${esc(g)}</span>
      <ul class="links">${links.map(([t, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join("")}</ul></div>`).join("")}</div>
    <p class="meta">These open the official site in a new tab. If a page has moved, use the search box on that site.</p>
    <h2>What the CS office looks after</h2>
    <div class="answer"><div class="md">${md(DATA.guide.replace(/^# .*\n/, ""))}</div></div>`;
};

/* --------------------------------------------------------------- settings */
screens.settings = async () => {
  const p = profile();
  const admin = cap.canEdit;
  const fields = [["name", "Legal name of the company"], ["brand", "Known as (brand)"], ["cin", "CIN"], ["registered_office", "Registered office address"],
    ["company_type", "Type of company"], ["parent", "Holding / parent company"], ["pan", "PAN"], ["gstin", "GSTIN"],
    ["cs_name", "Company Secretary's name"], ["signatory", "Usual authorised signatory"], ["notes", "Other notes for the assistant"]];
  app.innerHTML = `${back()}
    <h1>Company details</h1>
    <p class="lead">Used in drafts, and to decide which filings appear in the calendar.${admin ? "" : " Only an editor can change them."}</p>
    ${S.loaded.profile && !S.profile ? `<div class="banner warn">These are the starting values and have not been saved yet.${admin ? " Check them and press Save." : ""}</div>` : ""}
    <div class="panel">${fields.map(([k, l]) => `<label class="field" for="p-${k}">${l}</label>` +
      (k === "notes" || k === "registered_office" ? `<textarea id="p-${k}">${esc(p[k] || "")}</textarea>` : `<input type="text" id="p-${k}" value="${esc(p[k] || "")}">`)).join("")}</div>
    <div class="panel"><div class="q" style="font-size:1.1rem;color:var(--heading)">Which of these apply to the company?</div>
      <div class="choices">${Object.entries(DATA.flags).map(([k, l]) => `<label class="choice"><input type="checkbox" id="fl-${k}" ${p.flags[k] ? "checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div>
      <label class="field" for="p-since">Start tracking filings from</label>
      <input type="date" id="p-since" value="${esc(p.tracking_since || todayIso())}" style="max-width:260px">
      <p class="meta">Due dates before this date are not shown as overdue.</p></div>
    ${admin ? `<div class="row"><button type="button" class="btn big" id="p-save">Save company details</button></div>` : ""}
    <h2>Who can use this page</h2>
    <div class="panel">
      <p style="margin-top:0">Access is managed with the <strong>Share</strong> button on claude.ai. Share it with the CS and Legal team inside the organisation:</p>
      <ul><li><strong>Editor</strong>: everything, including adding files to the library and changing company details. Give this to the CS and the Legal team.</li>
        <li><strong>Contributor</strong>: ask, check and write; mark filings done; update licences; edit library details.</li>
        <li><strong>Viewer</strong>: read the library, calendar and registers.</li></ul>
      <p class="meta" style="margin-bottom:0">The assistant runs on each person's own claude.ai account. The library cannot be shared outside the organisation.</p>
      <div id="usage"></div></div>`;
  if (!admin) $$("input, textarea", app).forEach((el) => { el.disabled = true; });
  if (admin) $("#p-save").onclick = async () => {
    const body = { flags: {}, tracking_since: $("#p-since").value || todayIso() };
    fields.forEach(([k]) => { body[k] = $("#p-" + k).value.trim(); });
    Object.keys(DATA.flags).forEach((k) => { body.flags[k] = $("#fl-" + k).checked; });
    body.fy_end = p.fy_end || "31 March";
    if (await write(() => cap.db.doc("settings/company").set(body))) flash("Saved.");
  };
  if (cap.assets) {
    try {
      const u = (await cap.assets.list()).usage;
      $("#usage").innerHTML = `<p class="meta" style="margin:0.8rem 0 0">Library storage: ${u.files} file${u.files === 1 ? "" : "s"}, ${fmtSize(u.bytes)} of ${fmtSize(u.maxBytes)} used.</p>`;
    } catch (_) { /* meter is optional */ }
  }
};

screens.help = () => {
  app.innerHTML = `${back()}<h1>How to use the CS Assistant</h1>
    <div class="answer"><div class="md">${md(`### Moving around
Press **Home** at the top at any time. **A+** and **A−** make the writing bigger or smaller.

### Asking a question
Home → **Ask a question**. Type as you would to a colleague and press **Ask**. Keep asking follow-ups; press **Start a new question** for a new topic. When our own documents matter, the assistant searches the library and names the documents it used.

### Checking a document
Home → **Check a document**. Choose the type, add the file (PDF, Word or a scanned picture) or pick it from the library, and press **Check this document**. You get a GREEN / AMBER / RED verdict, a table of problems and ready wording. Then ask for changes, such as "redraft clause 7 in our favour".

### Writing a document
Home → **Write a document**. Choose it, fill in what you know, and press **Write the document**. **Download as Word** gives a file in the Lakeshore format.

### The document library
Folders for Board papers, registers, policies, contracts, licences and more. Search by any word, open a document to preview it, download it, upload a newer version (older versions are kept), or use it for a question, a check or a draft. Editors add files; after any answer or draft, **Save to library** keeps it as a Word file.

### Filing calendar and licences
The calendar shows what is due for our financial year. When a filing is done press **Mark as done** and note the SRN; everyone sees it. Set the AGM date so AOC-4 and MGT-7 dates are right. Enter each licence's expiry date once to be warned 90 and 30 days ahead.

### Can we share this?
When someone asks for our records, choose the record and who is asking. You get a first answer (yes, yes with conditions, get approval first, or no), the law and what to check. **Log this request** keeps it in the Requests register; **Write the reply** drafts the letter. **How long to keep records** gives the retention periods.

### Committees & decisions
Keep each committee's members and last meeting date to see when the next meeting or reconstitution is due. Track Transplant Authorisation Committee files with the document checklist for each kind of donor (use case numbers, not patient names). Enter Board decisions with an owner and due date; **Write the Action Taken Report** turns them into the "matters arising" paper.

### Things to know
- The assistant cannot look things up on the internet here. It says when a point should be checked on the official portal.
- It reads text. For a scanned PDF it reads pictures of the first few pages.
- Documents you attach are sent to Claude to be read, on your own claude.ai account. Remove patient names and personal details you do not need.
- It is a well-read helper, not a replacement for the CS's judgement or an advocate's opinion.`)}</div></div>`;
};

/* ================================================================== router */
const ROUTES = ["home", "ask", "vet", "draft", "calendar", "events", "licences", "share", "committees", "library", "removed", "guides", "settings", "help"];
function parse(hash) {
  const t = String(hash || "").replace(/^#/, "");
  const m = t.match(/^(event|folder|doc)-(.+)$/);
  if (m) return { name: m[1], param: m[2] };
  return { name: ROUTES.includes(t) ? t : "home", param: "" };
}
function go(target) {
  const r = parse(target);
  current = r;
  const tok = r.param ? `${r.name}-${r.param}` : r.name;
  try { if (location.hash !== "#" + tok) history.pushState(null, "", "#" + tok); } catch (_) { /* some frames refuse history */ }
  closeDialog();
  render();
  window.scrollTo(0, 0);
}
function render() { (screens[current.name] || screens.home)(current.param); }
/** Re-draw the current screen when data it shows has changed (never screens with forms in progress). */
function rerender(what) {
  const s = screens[current.name];
  if (!what || (s && s.live && s.live.includes(what))) { if (!dlg.open) render(); }
}
window.addEventListener("popstate", () => { current = parse(location.hash); render(); });
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (b) { e.preventDefault(); go(b.dataset.go); }
});
$("#font-up").onclick = () => fontSize(1);
$("#font-down").onclick = () => fontSize(-1);

current = parse(location.hash);
render();
initCaps();
