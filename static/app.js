/* CS Assistant - front end. Plain JavaScript, no external libraries, so it runs on any office PC. */
"use strict";

let META = null;
const app = document.getElementById("app");
const pending = {};           // values handed between screens (e.g. a question to pre-fill)
let askSession = null;        // keep the Ask conversation when moving between screens
let ME = null;                // the signed-in user

/* ------------------------------------------------------------------ helpers */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}
function todayIso() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) {
    let msg = `Something went wrong (${r.status}).`, j = null;
    try { j = await r.json(); if (j.error) msg = j.error; } catch (_) { /* not JSON */ }
    if (r.status === 401 && j && j.login) { showSignIn(); }
    if (r.status === 403) msg = "Only an administrator can do this.";
    throw new Error(msg);
  }
  return r.json();
}
async function postForm(path, fd) {
  const r = await fetch(path, { method: "POST", body: fd });
  let j = {};
  try { j = await r.json(); } catch (_) { /* not JSON */ }
  if (r.status === 401 && j.login) showSignIn();
  if (!r.ok) throw new Error(j.error || (r.status === 413 ? "The files are too large in total." : `Upload failed (${r.status}).`));
  return j;
}
function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
function fontSize(step) {
  const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--base")) || 20;
  const next = Math.min(30, Math.max(15, cur + step * 2));
  document.documentElement.style.setProperty("--base", next + "px");
  try { localStorage.setItem("cs-font", next); } catch (_) { /* storage blocked */ }
}
(function restoreFont() {
  try { const v = localStorage.getItem("cs-font"); if (v) document.documentElement.style.setProperty("--base", v + "px"); } catch (_) { /* ignore */ }
})();
function backButton() { return `<button class="btn light back no-print" onclick="go('home')">&larr; Back to Home</button>`; }
function flash(msg) {
  const d = document.getElementById("dlg");
  d.innerHTML = `<p style="font-size:1.05rem">${esc(msg)}</p><div class="btn-row"><button class="btn" onclick="this.closest('dialog').close()">OK</button></div>`;
  d.showModal();
}

/* ------------------------------------------------------------ markdown view */
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
  return l.split("|").map(c => c.trim());
}
function md(text) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  let out = "", i = 0;
  const isSep = l => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l.trim());
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
      out += `<table><thead><tr>${head.map(c => `<th>${inlineMd(c)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      // Lists, with nesting by indentation (2 spaces per level).
      const LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
      const items = [];
      while (i < lines.length && (LI.test(lines[i]) || (items.length && /^\s{2,}\S/.test(lines[i]) && !LI.test(lines[i])))) {
        const m2 = lines[i].match(LI);
        if (m2) items.push({ lvl: Math.min(3, Math.floor(m2[1].length / 2)), ordered: /\d/.test(m2[2]), num: parseInt(m2[2]), text: m2[3] });
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

/* ---------------------------------------------------------------- uploader */
function makeUploader(box, opts = {}) {
  const docs = [];
  box.innerHTML = `
    <div class="dropzone">
      <p style="margin:0 0 0.6rem"><strong>Drag the file here</strong>, or</p>
      <label class="btn">Choose file from computer<input type="file" multiple hidden
        accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp"></label>
      <button type="button" class="btn light pick-lib">Pick from the document library</button>
      <p class="meta" style="margin:0.6rem 0 0;color:var(--slate);font-size:0.9rem">PDF, Word (.docx), scanned picture (JPG / PNG) or text. Up to 25 MB each.</p>
    </div>
    <ul class="filelist"></ul>
    <details ${opts.pasteOpen ? "open" : ""}><summary style="cursor:pointer;color:var(--navy);font-weight:600;margin-top:0.5rem">Or paste the text instead</summary>
      <textarea class="paste" placeholder="Paste the text of the document here"></textarea></details>
    <div class="uperr"></div>`;
  const input = box.querySelector("input[type=file]"), list = box.querySelector(".filelist"), err = box.querySelector(".uperr");
  const zone = box.querySelector(".dropzone");
  function draw() {
    list.innerHTML = "";
    docs.forEach((d, n) => {
      const li = h(`<li><span>&#10003; <strong>${esc(d.name)}</strong> &middot; ${esc(d.summary)}</span><button>Remove</button></li>`);
      li.querySelector("button").onclick = () => { docs.splice(n, 1); draw(); };
      list.appendChild(li);
    });
  }
  async function send(fileList) {
    err.innerHTML = "";
    const fd = new FormData();
    [...fileList].forEach(f => fd.append("files", f));
    zone.querySelector("strong").textContent = "Reading the file...";
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      if (!r.ok) throw new Error(r.status === 413 ? "The files are too large in total." : "Upload failed.");
      const j = await r.json();
      docs.push(...j.files);
      if (j.errors.length) err.innerHTML = `<div class="banner error">${j.errors.map(esc).join("<br>")}</div>`;
    } catch (e) { err.innerHTML = `<div class="banner error">${esc(e.message)}</div>`; }
    zone.querySelector("strong").textContent = "Drag the file here";
    draw();
  }
  input.onchange = () => { if (input.files.length) send(input.files); input.value = ""; };
  box.querySelector(".pick-lib").onclick = () => pickFromLibrary(d => { docs.push(d); draw(); });
  zone.ondragover = e => { e.preventDefault(); zone.classList.add("over"); };
  zone.ondragleave = () => zone.classList.remove("over");
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove("over"); if (e.dataTransfer.files.length) send(e.dataTransfer.files); };
  return {
    async ids() {
      const pasted = box.querySelector(".paste").value.trim();
      if (pasted) {
        const fd = new FormData(); fd.append("pasted", pasted);
        const j = await (await fetch("/api/upload", { method: "POST", body: fd })).json();
        docs.push(...j.files); box.querySelector(".paste").value = ""; draw();
      }
      return docs.map(d => d.id);
    },
    names() { return docs.map(d => d.name); },
    add(d) { docs.push(d); draw(); },
    count() { return docs.length + (box.querySelector(".paste").value.trim() ? 1 : 0); },
  };
}

/* Search the library in a dialog and hand the chosen document to Ask / Check / Write. */
function pickFromLibrary(onPick) {
  const d = document.getElementById("dlg");
  d.style.maxWidth = "860px";
  d.innerHTML = `<h2 style="margin-top:0">Pick from the document library</h2>
    <div class="inline searchrow"><div><input type="text" id="pk-q" placeholder="Type a word, e.g. articles, NDA, 142nd minutes"></div>
    <div><button class="btn" id="pk-go">Search</button></div></div>
    <div id="pk-list" class="cards" style="margin-top:0.8rem;max-height:55vh;overflow:auto"></div>
    <div class="btn-row"><button class="btn light" id="pk-close">Close</button></div>`;
  const list = d.querySelector("#pk-list");
  const run = async () => {
    list.innerHTML = `<p class="meta">Searching...</p>`;
    const r = await api("/api/library?q=" + encodeURIComponent(d.querySelector("#pk-q").value));
    list.innerHTML = r.docs.length ? "" : `<div class="banner info">Nothing found. Try another word.</div>`;
    r.docs.slice(0, 40).forEach(doc => {
      const row = h(`<div class="card later"><div><div class="title">${esc(doc.title)}</div>
        <div class="meta">${esc(doc.category_name)}${doc.doc_date ? " &middot; " + fmtDate(doc.doc_date) : ""} &middot; ${esc(doc.filename || "")}</div></div>
        <div class="actions"><button class="btn">Use this</button></div></div>`);
      row.querySelector("button").onclick = async () => {
        try { onPick(await api(`/api/library/${doc.id}/attach`, { method: "POST" })); d.close(); d.style.maxWidth = ""; }
        catch (e) { flash(e.message); }
      };
      list.appendChild(row);
    });
  };
  d.querySelector("#pk-go").onclick = run;
  d.querySelector("#pk-q").onkeydown = e => { if (e.key === "Enter") run(); };
  d.querySelector("#pk-close").onclick = () => { d.close(); d.style.maxWidth = ""; };
  d.showModal();
  run();
}

function folderOptions(selected) {
  return META.library_folders.map(f => `<option value="${f.id}" ${f.id === selected ? "selected" : ""}>${esc(f.name)}</option>`).join("");
}

/* ------------------------------------------------------ conversation engine */
async function readStream(resp, onEvent) {
  const reader = resp.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find(l => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

function userTurnView(text) {
  return h(`<div class="turn user"><div class="who">You</div><div class="bubble">${esc(text)}</div></div>`);
}

/* Runs one assistant turn inside `area` and resolves with the answer text. */
async function runTurn(session, area) {
  const turn = h(`<div class="turn"><div class="who">Assistant</div><div class="result">
      <div class="status"><span class="spinner"></span><span class="st">Starting...</span></div>
      <div class="md"></div><div class="notices"></div><div class="sources" hidden></div>
      <div class="btn-row actions" hidden></div></div></div>`);
  area.appendChild(turn);
  turn.scrollIntoView({ behavior: "smooth", block: "start" });
  const mdBox = turn.querySelector(".md"), status = turn.querySelector(".status"), st = turn.querySelector(".st");
  let text = "", queued = false, failed = false;
  const paint = () => { queued = false; mdBox.innerHTML = md(text); };
  try {
    const resp = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: session.mode, turns: session.turns, doc_ids: session.docIds, form: session.form }),
    });
    if (!resp.ok) throw new Error("The server could not handle the request.");
    await readStream(resp, ev => {
      if (ev.type === "status") { st.textContent = ev.text; status.hidden = false; }
      else if (ev.type === "text") {
        text += ev.text; st.textContent = "Writing...";
        if (!queued) { queued = true; requestAnimationFrame(paint); }
      } else if (ev.type === "notice") turn.querySelector(".notices").appendChild(h(`<div class="banner warn">${esc(ev.text)}</div>`));
      else if (ev.type === "error") { failed = true; turn.querySelector(".notices").appendChild(h(`<div class="banner error">${esc(ev.text)}</div>`)); }
      else if (ev.type === "sources") {
        const s = turn.querySelector(".sources"); s.hidden = false;
        s.innerHTML = "<strong>Sources checked:</strong> " + ev.items.filter(x => /^(#doc\/\d+$|https?:\/\/)/.test(x.url)).map(x => x.url.startsWith("#")
          ? `<a href="${esc(x.url)}">${esc(x.title)}</a>`
          : `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(" &middot; ");
      }
    });
  } catch (e) {
    failed = true;
    turn.querySelector(".notices").appendChild(h(`<div class="banner error">${esc(e.message)} Please check the connection and try again.</div>`));
  }
  status.hidden = true;
  paint();
  if (text) {
    session.turns.push({ role: "assistant", text });
    addActions(turn.querySelector(".actions"), () => text, session.title, session.mode,
      t => { text = t; paint(); session.turns[session.turns.length - 1].text = t; }, session.form && session.form.type);
  } else if (!failed) {
    turn.querySelector(".notices").appendChild(h(`<div class="banner warn">No answer came back. Please try again.</div>`));
  }
  return text;
}

function addActions(row, getText, title, kind, onEdit, docType) {
  row.hidden = false;
  const b = (label, fn, cls = "light") => { const x = h(`<button class="btn ${cls}">${label}</button>`); x.onclick = fn; row.appendChild(x); return x; };
  b("Download as Word", () => downloadWord(getText(), title, kind, docType));
  b("Print", () => printMd(getText(), title));
  b("Copy", async () => {
    try { await navigator.clipboard.writeText(getText()); }
    catch (_) { const ta = h("<textarea></textarea>"); ta.value = getText(); document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
    flash("Copied. You can now paste it into Word or an e-mail.");
  });
  b("Save to library", () => {
    const d = document.getElementById("dlg");
    const defaultFolder = kind === "draft" && docType && /^(nda|consultant|service|equipment|lease|mou|cta|dpa|empanel)/.test(docType) ? "contracts" : "assistant";
    d.innerHTML = `<h2 style="margin-top:0">Save to the document library</h2>
      <p class="meta">It is saved as a Word file in the Lakeshore format, and can be searched and used later.</p>
      <label class="field">Title</label><input type="text" id="sv-title" value="${esc(title)}">
      <label class="field">Folder</label><select id="sv-folder">${folderOptions(defaultFolder)}</select>
      <label class="field">Short note (optional)</label><input type="text" id="sv-desc" placeholder="e.g. Draft sent to vendor on 3 October">
      <div class="btn-row"><button class="btn" id="sv-save">Save</button><button class="btn light" id="sv-cancel">Cancel</button></div>`;
    d.showModal();
    d.querySelector("#sv-cancel").onclick = () => d.close();
    d.querySelector("#sv-save").onclick = async () => {
      try {
        await api("/api/library/from-assistant", { method: "POST", body: JSON.stringify({
          markdown: getText(), title: d.querySelector("#sv-title").value || title, kind: kind === "ask" ? "answer" : kind,
          doc_type: docType, folder: d.querySelector("#sv-folder").value, description: d.querySelector("#sv-desc").value }) });
        d.close();
        flash("Saved to the document library.");
      } catch (e) { flash(e.message); }
    };
  });
  if (onEdit) b("Edit the text", () => {
    const d = document.getElementById("dlg");
    d.style.maxWidth = "1000px";
    d.innerHTML = `<h2 style="margin-top:0">Edit the text</h2><p style="color:var(--slate);font-size:0.9rem">Change anything you like, then press Save changes. Lines starting with # are headings.</p>
      <textarea class="editbox"></textarea><div class="btn-row"><button class="btn">Save changes</button><button class="btn light">Cancel</button></div>`;
    d.querySelector("textarea").value = getText();
    const [save, cancel] = d.querySelectorAll(".btn-row button");
    save.onclick = () => { onEdit(d.querySelector("textarea").value); d.close(); d.style.maxWidth = ""; };
    cancel.onclick = () => { d.close(); d.style.maxWidth = ""; };
    d.showModal();
  });
}

async function downloadWord(markdown, title, kind, docType) {
  const r = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, title, kind: kind === "ask" ? "answer" : kind, doc_type: docType }) });
  if (!r.ok) return flash("Could not create the Word file.");
  const blob = await r.blob();
  const cd = r.headers.get("Content-Disposition") || "";
  const name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || "document.docx";
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

function printMd(markdown, title) {
  const w = window.open("", "_blank");
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><link rel="stylesheet" href="/static/style.css">
    <style>body{background:#fff;padding:1.5rem} html{font-size:15px}</style></head>
    <body><div class="md">${md(markdown)}</div>
    <p style="color:#666;font-size:0.8rem;margin-top:2rem">Prepared with the CS Assistant on ${new Date().toLocaleDateString("en-IN")}. Draft - review before use.</p></body></html>`);
  w.document.close();
  w.onload = () => w.print();
}

function followUpBox(session, area, placeholder) {
  const box = h(`<div class="step followup no-print"><div class="q">Ask a follow-up question, or ask for changes</div>
    <textarea placeholder="${esc(placeholder)}"></textarea>
    <div class="btn-row"><button class="btn big">Send</button></div></div>`);
  const ta = box.querySelector("textarea"), btn = box.querySelector("button");
  btn.onclick = async () => {
    const q = ta.value.trim();
    if (!q) return ta.focus();
    btn.disabled = true; ta.value = "";
    session.turns.push({ role: "user", text: q });
    area.appendChild(userTurnView(q));
    await runTurn(session, area);
    btn.disabled = false;
    area.after(box);
  };
  return box;
}

/* ------------------------------------------------------------------ screens */
const screens = {};

screens.home = () => {
  app.innerHTML = `
    <h1>Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}${ME ? ", " + esc(ME.full_name.split(" ")[0]) : ""}. What would you like to do?</h1>
    <p class="lead">Choose one of the boxes below, or search our documents.</p>
    ${META.ai_ready ? "" : `<div class="banner warn"><strong>The AI part is not switched on yet.</strong> The library, Filing calendar, 'Something happened?' and Licences work now. To ask questions, check and write documents, ask IT to add the access key (see README).</div>`}
    <div id="due-banner"></div>
    <div class="step libsearch">
      <div class="label">Document library</div>
      <div class="q">Find a document</div>
      <div class="inline searchrow"><div><input type="text" id="home-q" placeholder="e.g. Articles of Association, 142nd Board minutes, fire NOC, vendor NDA"></div>
        <div><button class="btn big" id="home-go">Search</button></div>
        <div><button class="btn light big" onclick="go('library')">Open the library</button></div></div>
      <p class="meta" id="home-libcount"></p>
    </div>
    <div class="tiles">
      <button class="tile" onclick="go('ask')"><span class="num">01</span><span class="t">Ask a question</span>
        <div class="d">Company law, FEMA, hospital licences, contracts, notices - in plain English, with sections quoted. Can look in our own documents too.</div></button>
      <button class="tile" onclick="go('vet')"><span class="num">02</span><span class="t">Check a document</span>
        <div class="d">Upload an NDA, agreement, legal notice or Board paper. Get a clear verdict, the risks and the changes to ask for.</div></button>
      <button class="tile" onclick="go('draft')"><span class="num">03</span><span class="t">Write a document</span>
        <div class="d">Board notice, minutes, resolutions, NDA, doctor agreement, reply to legal notice and more - ready in Word.</div></button>
      <button class="tile" onclick="go('calendar')"><span class="num">04</span><span class="t">Filing calendar</span>
        <div class="d">What is due and overdue: MCA forms, AGM, FEMA, PCPNDT, BMW, tax. Tick them off when filed.</div></button>
      <button class="tile" onclick="go('events')"><span class="num">05</span><span class="t">Something happened?</span>
        <div class="d">New director, loan taken, shares issued, legal notice received, data leak... get the checklist of what to do.</div></button>
      <button class="tile" onclick="go('licences')"><span class="num">06</span><span class="t">Licences &amp; renewals</span>
        <div class="d">Keep expiry dates of hospital licences (AERB, PCPNDT, fire, pollution, drugs...) and see what needs renewing.</div></button>
    </div>
    <div class="tiles" style="margin-top:1rem">
      <button class="tile small" onclick="go('library')"><span class="t">Document library</span><div class="d">Minutes, registers, policies, contracts, licences, templates - in folders.</div></button>
      <button class="tile small" onclick="go('guides')"><span class="t">Guides &amp; official links</span><div class="d">What the CS office looks after, and the MCA, RBI and regulator portals.</div></button>
      <button class="tile small" onclick="go('settings')"><span class="t">Settings</span><div class="d">Company details, my password${ME && ME.role === "admin" ? ", users, activity and backup" : ""}.</div></button>
    </div>`;
  const hq = document.getElementById("home-q");
  const search = () => { pending.libQuery = hq.value.trim(); go("library"); };
  document.getElementById("home-go").onclick = search;
  hq.onkeydown = e => { if (e.key === "Enter") search(); };
  api("/api/library?folder=none").then(r => {
    document.getElementById("home-libcount").textContent = r.total
      ? `${r.total} document${r.total > 1 ? "s" : ""} in the library.`
      : "The library is empty. Open it to add the company's key documents.";
  }).catch(() => {});
  api("/api/calendar").then(c => {
    const over = c.coming.filter(x => x.status === "overdue").length;
    const soon = c.coming.filter(x => x.status === "soon" || x.status === "today").length;
    if (over || soon) {
      document.getElementById("due-banner").innerHTML = `<div class="banner ${over ? "error" : "warn"}" style="cursor:pointer" onclick="go('calendar')">
        <strong>${over ? `${over} filing${over > 1 ? "s" : ""} overdue` : ""}${over && soon ? " and " : ""}${soon ? `${soon} due in the next 15 days` : ""}.</strong> Click here to see them.</div>`;
    }
  }).catch(() => {});
};

screens.ask = () => {
  const examples = [
    "What are the steps and forms for appointing a new independent director?",
    "Which Board resolutions must be filed in MGT-14, and by when?",
    "Our foreign parent is transferring shares to another group company. What FEMA filings are needed?",
    "Can a consultant doctor agreement include a non-compete after the term ends?",
    "What is the stamp duty on an NDA and on a 3-year lease in Kerala?",
    "What should we do within the first 30 days after receiving a consumer complaint for medical negligence?",
    "Explain the DPDP Act obligations for patient data in simple terms.",
    "Is Board approval needed for a contract with a company where our director is a director?",
    "What does our Articles of Association say about the quorum for Board meetings?",
  ];
  app.innerHTML = `${backButton()}
    <h1>Ask a question</h1>
    <p class="lead">Type your question as you would ask a colleague. The assistant answers with the section and form numbers.</p>
    <div class="step no-print" id="ask-box">
      <div class="q">Your question</div>
      <textarea id="q" placeholder="For example: What is the last date for filing AOC-4 if our AGM is on 26 September?"></textarea>
      <details style="margin-top:0.5rem"><summary style="cursor:pointer;color:var(--navy);font-weight:600">Attach a document to the question (optional)</summary><div id="ask-up" style="margin-top:0.6rem"></div></details>
      <div class="btn-row"><button class="btn big" id="ask-btn">Ask</button>
        <button class="btn light" id="new-btn">Start a new question</button></div>
      <div class="group-title">Or click an example:</div>
      <div class="examples">${examples.map(e => `<button>${esc(e)}</button>`).join("")}</div>
    </div>
    <div id="convo"></div>`;
  const q = document.getElementById("q"), area = document.getElementById("convo"), btn = document.getElementById("ask-btn");
  const up = makeUploader(document.getElementById("ask-up"));
  app.querySelectorAll(".examples button").forEach(b => b.onclick = () => { q.value = b.textContent; q.focus(); });
  if (pending.question) { q.value = pending.question; delete pending.question; askSession = null; }
  if (pending.attach) { up.add(pending.attach); app.querySelector("#ask-box details").open = true; delete pending.attach; askSession = null; }
  if (askSession) {
    askSession.turns.forEach(t => {
      if (t.role === "user") area.appendChild(userTurnView(t.text));
      else {
        const v = h(`<div class="turn"><div class="who">Assistant</div><div class="result"><div class="md">${md(t.text)}</div><div class="btn-row actions"></div></div></div>`);
        addActions(v.querySelector(".actions"), () => t.text, askSession.title, "answer");
        area.appendChild(v);
      }
    });
  }
  document.getElementById("new-btn").onclick = () => { askSession = null; area.innerHTML = ""; q.value = ""; q.focus(); };
  btn.onclick = async () => {
    const text = q.value.trim();
    if (!text) return q.focus();
    btn.disabled = true;
    const ids = await up.ids();
    if (!askSession || ids.length) askSession = { mode: "ask", turns: [], docIds: ids, form: {}, title: text.slice(0, 80) };
    askSession.turns.push({ role: "user", text });
    area.appendChild(userTurnView(text + (ids.length ? `\n(with ${up.names().join(", ")})` : "")));
    q.value = "";
    await runTurn(askSession, area);
    btn.disabled = false;
    q.placeholder = "Ask a follow-up question (the assistant remembers this conversation), or press 'Start a new question'.";
  };
};

function choiceList(name, options, selected) {
  return `<div class="choices">${options.map(o => `
    <label class="choice ${o.id === selected ? "selected" : ""}"><input type="radio" name="${name}" value="${esc(o.id)}" ${o.id === selected ? "checked" : ""}>
    <span>${esc(o.title)}</span></label>`).join("")}</div>`;
}
function wireChoices(root) {
  root.querySelectorAll(".choice input").forEach(inp => inp.addEventListener("change", () => {
    root.querySelectorAll(`input[name="${inp.name}"]`).forEach(o => o.closest(".choice").classList.toggle("selected", o.checked));
  }));
}

screens.vet = () => {
  app.innerHTML = `${backButton()}
    <h1>Check a document</h1>
    <p class="lead">Three simple steps. The assistant reads the whole document and tells you whether it is safe to sign.</p>
    <div class="step"><div class="label">Step 1</div><div class="q">What kind of document is it?</div>${choiceList("vtype", META.vet_types, "nda")}</div>
    <div class="step"><div class="label">Step 2</div><div class="q">Add the document</div><div id="vet-up"></div></div>
    <div class="step"><div class="label">Step 3</div><div class="q">A little background (optional)</div>
      <label class="field" for="role">Which side are we on?</label>
      <select id="role">${META.roles.map(r => `<option>${esc(r)}</option>`).join("")}</select>
      <label class="field" for="concerns">Anything you are particularly worried about?</label>
      <textarea id="concerns" placeholder="For example: They want us to share patient data. The liability clause looks one-sided."></textarea>
    </div>
    <div class="btn-row"><button class="btn big" id="vet-btn">Check this document</button></div>
    <div id="convo"></div>`;
  wireChoices(app);
  const up = makeUploader(document.getElementById("vet-up"));
  if (pending.attach) { up.add(pending.attach); delete pending.attach; }
  const area = document.getElementById("convo"), btn = document.getElementById("vet-btn");
  btn.onclick = async () => {
    if (!up.count()) return flash("Please add the document in Step 2 first - choose a file or paste the text.");
    btn.disabled = true;
    const ids = await up.ids();
    const type = app.querySelector("input[name=vtype]:checked").value;
    const typeTitle = META.vet_types.find(v => v.id === type).title;
    const session = {
      mode: "vet", docIds: ids, title: `Review - ${typeTitle} - ${up.names()[0] || ""}`,
      form: { type, role: document.getElementById("role").value, concerns: document.getElementById("concerns").value },
      turns: [{ role: "user", text: `Check: ${up.names().join(", ")}` }],
    };
    area.innerHTML = "";
    area.appendChild(userTurnView(`Please check ${up.names().join(", ")} (${typeTitle}).`));
    await runTurn(session, area);
    area.after(followUpBox(session, area, "For example: Please redraft clause 9 in our favour. / Is the arbitration clause acceptable?"));
    btn.disabled = false; btn.textContent = "Check again";
  };
};

screens.draft = () => {
  const groups = {};
  META.draft_types.forEach(d => (groups[d.group] = groups[d.group] || []).push(d));
  const chosen = pending.draftType || "nda"; delete pending.draftType;
  app.innerHTML = `${backButton()}
    <h1>Write a document</h1>
    <p class="lead">Pick the document, answer a few questions, and the assistant writes a complete first draft you can download in Word.</p>
    <div class="step"><div class="label">Step 1</div><div class="q">Which document do you need?</div>
      ${Object.entries(groups).map(([g, list]) => `<div class="group-title">${esc(g)}</div>${choiceList("dtype", list, chosen)}`).join("")}</div>
    <div class="step"><div class="label">Step 2</div><div class="q">Tell the assistant the details</div>
      <p style="color:var(--slate);font-size:0.9rem;margin:0">Fill in what you know. Anything left empty will be shown as a blank [LIKE THIS] in the draft.</p>
      <div id="qs"></div></div>
    <div class="step"><div class="label">Step 3 (optional)</div><div class="q">Add a reference document</div>
      <p style="color:var(--slate);font-size:0.9rem;margin-top:0">For example the other side's draft, last year's version, or your rough notes.</p>
      <div id="draft-up"></div></div>
    <div class="btn-row"><button class="btn big" id="draft-btn">Write the document</button></div>
    <div id="convo"></div>`;
  wireChoices(app);
  const qs = document.getElementById("qs");
  function drawQs() {
    const id = app.querySelector("input[name=dtype]:checked").value;
    const d = META.draft_types.find(x => x.id === id);
    qs.innerHTML = d.questions.map(q => `<label class="field" for="f-${q.key}">${esc(q.label)}</label>` +
      (q.kind === "textarea" ? `<textarea id="f-${q.key}" data-k="${q.key}"></textarea>` : `<input type="text" id="f-${q.key}" data-k="${q.key}">`)).join("");
  }
  app.querySelectorAll("input[name=dtype]").forEach(i => i.addEventListener("change", drawQs));
  drawQs();
  const up = makeUploader(document.getElementById("draft-up"));
  if (pending.attach) { up.add(pending.attach); delete pending.attach; }
  const area = document.getElementById("convo"), btn = document.getElementById("draft-btn");
  btn.onclick = async () => {
    btn.disabled = true;
    const ids = await up.ids();
    const id = app.querySelector("input[name=dtype]:checked").value;
    const d = META.draft_types.find(x => x.id === id);
    const answers = {};
    qs.querySelectorAll("[data-k]").forEach(el => answers[el.dataset.k] = el.value);
    const session = { mode: "draft", docIds: ids, title: d.title, form: { type: id, answers },
      turns: [{ role: "user", text: `Draft: ${d.title}` }] };
    area.innerHTML = "";
    area.appendChild(userTurnView(`Please write: ${d.title}`));
    await runTurn(session, area);
    area.after(followUpBox(session, area, "For example: Make the term 3 years and add a non-solicitation clause. / Make it shorter."));
    btn.disabled = false; btn.textContent = "Write it again";
  };
};

/* ---------------------------------------------------------------- calendar */
let calFilter = "all", calFy = null;
screens.calendar = async () => {
  app.innerHTML = `${backButton()}<h1>Filing calendar</h1><p class="lead">Loading...</p>`;
  let c;
  try { c = await api("/api/calendar" + (calFy ? `?fy=${calFy}` : "")); } catch (e) { app.innerHTML += `<div class="banner error">${esc(e.message)}</div>`; return; }
  calFy = c.fy;
  const cats = META.categories;
  const card = r => `
    <div class="card ${r.status}">
      <div><div class="title">${esc(r.title)}</div>
        <div class="meta">${esc(r.period)} &middot; ${esc(r.form || "")}${r.form ? " &middot; " : ""}Handled by: ${esc(r.who)}</div></div>
      <div class="due">${fmtDate(r.due)}<br><span class="pill ${r.status}">${esc(r.status_label)}</span></div>
      <details><summary>What is this?</summary>
        <p>${esc(r.what)}</p><p><strong>Law:</strong> ${esc(r.law)}</p>
        ${r.penalty ? `<p><strong>If late:</strong> ${esc(r.penalty)}</p>` : ""}
        ${r.tip ? `<p><strong>Tip:</strong> ${esc(r.tip)}</p>` : ""}
        ${r.verify ? `<div class="banner warn"><strong>Please check:</strong> ${esc(r.verify)}</div>` : ""}
        ${r.agm_based ? `<p style="color:var(--slate)">This date is worked out from the AGM date shown at the top of this screen.</p>` : ""}
      </details>
      ${r.done_on ? `<div class="meta" style="grid-column:1/-1">Done on ${fmtDate(r.done_on)}${r.done_by ? ` by ${esc(r.done_by)}` : ""}${r.srn ? ` &middot; SRN / Ref: ${esc(r.srn)}` : ""}${r.notes ? ` &middot; ${esc(r.notes)}` : ""}</div>` : ""}
      <div class="actions no-print">
        ${r.done_on ? `<button class="btn light" data-undo="${esc(r.key)}">Mark as NOT done</button>` : `<button class="btn" data-done="${esc(r.key)}">Mark as done</button>`}
        <button class="btn light" data-ask="${esc(r.key)}">Ask the assistant about this</button>
      </div>
    </div>`;
  const all = c.all.filter(r => calFilter === "all" || r.category === calFilter);
  const byMonth = {};
  all.forEach(r => { const k = r.due.slice(0, 7); (byMonth[k] = byMonth[k] || []).push(r); });
  app.innerHTML = `${backButton()}
    <h1>Filing calendar</h1>
    <p class="lead">Today is ${fmtDate(c.today)}. <span class="pill overdue">Overdue</span> <span class="pill soon">Due within 15 days</span> <span class="pill upcoming">Due within 45 days</span><br>
      Dates before ${fmtDate(c.tracking_since)} (when tracking started) are shown in grey - you can change this in Company details.</p>
    <h2>Needs attention now</h2>
    <div class="cards">${c.coming.length ? c.coming.map(card).join("") : `<div class="banner info">Nothing is overdue or due in the next 45 days. Well done.</div>`}</div>
    <h2>Whole year: FY ${esc(c.fy_label)}</h2>
    <div class="step no-print"><div class="inline">
      <div><label class="field" for="agm">AGM date for this year</label><input type="date" id="agm" value="${c.agm_date}"></div>
      <div><button class="btn light" id="agm-save">Save AGM date</button></div>
      <div><button class="btn light" id="prev">&larr; Previous year</button> <button class="btn light" id="next">Next year &rarr;</button></div>
    </div>
    ${c.agm_is_default ? `<p style="color:var(--magenta);font-size:0.9rem;margin-bottom:0">AGM date not set - assumed to be 30 September. AOC-4, MGT-7, ADT-1 and CSR-2 dates are worked out from it.</p>` : ""}
    </div>
    <div class="filters no-print"><button data-f="all" class="${calFilter === "all" ? "on" : ""}">Everything</button>
      ${Object.entries(cats).map(([k, v]) => `<button data-f="${k}" class="${calFilter === k ? "on" : ""}">${esc(v)}</button>`).join("")}</div>
    <div class="btn-row no-print"><button class="btn light" onclick="window.print()">Print this calendar</button></div>
    ${Object.entries(byMonth).map(([m, list]) => `<div class="month">${new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</div><div class="cards">${list.map(card).join("")}</div>`).join("")}
    <p style="color:var(--slate);font-size:0.85rem;margin-top:1.5rem">Event-based filings (like DIR-12, MGT-14, CHG-1, PAS-3) are under <a href="#events">Something happened?</a>. Which items appear depends on the switches in <a href="#settings">Company details</a>.</p>`;
  const find = k => c.all.concat(c.coming).find(r => r.key === k);
  app.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { calFilter = b.dataset.f; screens.calendar(); });
  document.getElementById("prev").onclick = () => { calFy--; screens.calendar(); };
  document.getElementById("next").onclick = () => { calFy++; screens.calendar(); };
  document.getElementById("agm-save").onclick = async () => {
    await api("/api/calendar/agm", { method: "POST", body: JSON.stringify({ fy: c.fy, date: document.getElementById("agm").value }) });
    screens.calendar();
  };
  app.querySelectorAll("[data-undo]").forEach(b => b.onclick = async () => {
    const r = find(b.dataset.undo);
    await api("/api/calendar/mark", { method: "POST", body: JSON.stringify({ key: r.key, id: r.id, due: r.due, done_on: null }) });
    screens.calendar();
  });
  app.querySelectorAll("[data-ask]").forEach(b => b.onclick = () => {
    const r = find(b.dataset.ask);
    pending.question = `Please explain "${r.title}" (${r.form || r.law}) due on ${fmtDate(r.due)} for ${r.period}: what exactly must be filed, the documents and approvals I need, step-by-step process, fees and penalty for delay.`;
    go("ask");
  });
  app.querySelectorAll("[data-done]").forEach(b => b.onclick = () => {
    const r = find(b.dataset.done);
    const d = document.getElementById("dlg");
    d.innerHTML = `<h2 style="margin-top:0">Mark as done</h2><p><strong>${esc(r.title)}</strong><br>${esc(r.period)} &middot; due ${fmtDate(r.due)}</p>
      <label class="field">Date filed / done</label><input type="date" id="m-date" value="${todayIso()}">
      <label class="field">SRN / challan / reference number (optional)</label><input type="text" id="m-srn">
      <label class="field">Notes (optional)</label><input type="text" id="m-notes">
      <div class="btn-row"><button class="btn" id="m-save">Save</button><button class="btn light" onclick="this.closest('dialog').close()">Cancel</button></div>`;
    d.showModal();
    d.querySelector("#m-save").onclick = async () => {
      await api("/api/calendar/mark", { method: "POST", body: JSON.stringify({ key: r.key, id: r.id, due: r.due,
        done_on: d.querySelector("#m-date").value || todayIso(), srn: d.querySelector("#m-srn").value, notes: d.querySelector("#m-notes").value }) });
      d.close(); screens.calendar();
    };
  });
};

/* ------------------------------------------------------------------ events */
screens.events = () => {
  const sel = pending.event; delete pending.event;
  if (sel) {
    const e = META.events.find(x => x.id === sel);
    app.innerHTML = `<button class="btn light back no-print" onclick="go('events')">&larr; Back to the list</button>
      <h1>${esc(e.title)}</h1>
      <p class="lead">Tick each step as you finish it. Law: ${esc(e.law)}</p>
      ${e.verify ? `<div class="banner warn">${esc(e.verify)}</div>` : ""}
      <div class="step"><ul class="checklist">${e.steps.map((s, n) => `<li><input type="checkbox" id="s${n}"><span><label for="s${n}">${esc(s)}</label></span></li>`).join("")}</ul></div>
      <div class="btn-row">
        <button class="btn" id="ev-ask">Ask the assistant for a detailed plan</button>
        <button class="btn light" id="ev-draft">Write the documents needed</button>
        <button class="btn light" onclick="window.print()">Print this checklist</button></div>
      <div class="banner info">These are the usual steps. Check the latest rules for your exact facts - the assistant can help with that.</div>`;
    app.querySelectorAll(".checklist input").forEach(c => c.onchange = () => c.closest("li").classList.toggle("ticked", c.checked));
    document.getElementById("ev-ask").onclick = () => {
      pending.question = `Something has happened: ${e.title}. Please give me a complete, dated action plan for our company - every approval, form, deadline, fee and register entry - and list the documents I will need to prepare.`;
      go("ask");
    };
    document.getElementById("ev-draft").onclick = () => {
      pending.draftType = { legal_notice: "reply_legal_notice", consumer_case: "consumer_reply", govt_notice: "roc_reply" }[e.id] || "board_resolution";
      go("draft");
    };
    return;
  }
  app.innerHTML = `${backButton()}
    <h1>Something happened?</h1>
    <p class="lead">Choose what happened. You will get a checklist of the approvals, forms and deadlines.</p>
    <div class="tiles">${META.events.map(e => `<button class="tile small" data-e="${e.id}"><span class="t">${esc(e.title)}</span></button>`).join("")}</div>
    <div class="banner info" style="margin-top:1rem">Not in the list? <a href="#ask">Ask the assistant</a> - describe what happened in your own words.</div>`;
  app.querySelectorAll("[data-e]").forEach(b => b.onclick = () => { pending.event = b.dataset.e; screens.events(); window.scrollTo(0, 0); });
};

/* ---------------------------------------------------------------- licences */
screens.licences = async () => {
  const list = await api("/api/licences");
  const attention = list.filter(l => ["overdue", "soon", "upcoming"].includes(l.status)).length;
  app.innerHTML = `${backButton()}
    <h1>Licences &amp; renewals</h1>
    <p class="lead">Enter the expiry date of each licence once. The tool warns you 90 days before, and again at 30 days.</p>
    ${attention ? `<div class="banner warn"><strong>${attention} licence${attention > 1 ? "s" : ""} need${attention > 1 ? "" : "s"} attention.</strong></div>` : ""}
    <div class="btn-row no-print"><button class="btn" id="add">+ Add a licence</button><button class="btn light" onclick="window.print()">Print the list</button></div>
    <div class="cards">${list.map(l => `
      <div class="card ${l.status}"><div><div class="title">${esc(l.name)}</div>
        <div class="meta">${esc(l.authority || "")}${l.number ? " &middot; No. " + esc(l.number) : ""}${l.owner ? " &middot; Owner: " + esc(l.owner) : ""}</div>
        ${l.notes ? `<div class="meta">${esc(l.notes)}</div>` : ""}</div>
        <div class="due">${l.expiry ? fmtDate(l.expiry) : ""}<br><span class="pill ${l.status}">${esc(l.status_label)}</span></div>
        <div class="actions no-print"><button class="btn light" data-edit="${l.id}">Edit / enter expiry</button></div></div>`).join("")}</div>`;
  const edit = l => {
    const d = document.getElementById("dlg");
    d.innerHTML = `<h2 style="margin-top:0">${l.id ? "Edit licence" : "Add a licence"}</h2>
      <label class="field">Name of licence</label><input type="text" id="l-name" value="${esc(l.name || "")}">
      <label class="field">Issued by</label><input type="text" id="l-auth" value="${esc(l.authority || "")}">
      <label class="field">Licence / registration number</label><input type="text" id="l-num" value="${esc(l.number || "")}">
      <label class="field">Valid until (expiry date)</label><input type="date" id="l-exp" value="${esc(l.expiry || "")}">
      <label class="field">Who looks after it</label><input type="text" id="l-own" value="${esc(l.owner || "")}">
      <label class="field">Notes</label><input type="text" id="l-notes" value="${esc(l.notes || "")}">
      <div class="btn-row"><button class="btn" id="l-save">Save</button><button class="btn light" id="l-cancel">Cancel</button>
      ${l.id ? `<button class="btn danger" id="l-del">Delete</button>` : ""}</div>`;
    d.showModal();
    d.querySelector("#l-cancel").onclick = () => d.close();
    d.querySelector("#l-save").onclick = async () => {
      try {
        await api("/api/licences", { method: "POST", body: JSON.stringify({ id: l.id, name: d.querySelector("#l-name").value,
          authority: d.querySelector("#l-auth").value, number: d.querySelector("#l-num").value, expiry: d.querySelector("#l-exp").value,
          owner: d.querySelector("#l-own").value, notes: d.querySelector("#l-notes").value }) });
        d.close(); screens.licences();
      } catch (e) { flash(e.message); }
    };
    if (l.id) d.querySelector("#l-del").onclick = async () => {
      if (!confirm("Delete this licence from the list?")) return;
      await api(`/api/licences/${l.id}`, { method: "DELETE" }); d.close(); screens.licences();
    };
  };
  document.getElementById("add").onclick = () => edit({});
  app.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => edit(list.find(l => String(l.id) === b.dataset.edit)));
};

/* ----------------------------------------------------------------- library */
function snippetHtml(s) {
  return esc(s || "").replace(/«/g, "<mark>").replace(/»/g, "</mark>");
}
function docCard(doc) {
  const meta = [doc.category_name, doc.doc_date ? fmtDate(doc.doc_date) : "", doc.filename ? `${doc.filename} (${fmtSize(doc.size || 0)})` : "",
    doc.current_version > 1 ? `version ${doc.current_version}` : "", doc.created_by ? `added by ${doc.created_by}` : ""].filter(Boolean);
  return `<div class="card ${doc.deleted ? "untracked" : "later"}">
    <div><a class="title" href="#doc/${doc.id}">${esc(doc.title)}</a>
      <div class="meta">${meta.map(esc).join(" &middot; ")}</div>
      ${doc.snippet ? `<div class="snippet">${snippetHtml(doc.snippet)}</div>` : ""}
      ${doc.text_status === "scanned" || doc.text_status === "picture" ? `<div class="meta">Scanned copy - the words inside cannot be searched. Add a clear title and note.</div>` : ""}</div>
    <div class="actions no-print">
      ${doc.deleted ? `<button class="btn" data-restore="${doc.id}">Restore</button>`
        : `<a class="btn" href="#doc/${doc.id}">Open</a><a class="btn light" href="/api/library/${doc.id}/file?download=1">Download</a>`}
    </div></div>`;
}
function wireRestore(root, after) {
  root.querySelectorAll("[data-restore]").forEach(b => b.onclick = async () => {
    await api(`/api/library/${b.dataset.restore}/restore`, { method: "POST" }); after();
  });
}

function uploadDialog(folder, after) {
  const d = document.getElementById("dlg");
  d.innerHTML = `<h2 style="margin-top:0">Add documents to the library</h2>
    <label class="field">Which folder?</label><select id="up-folder">${folderOptions(folder || "board")}</select>
    <p class="meta" id="up-hint"></p>
    <label class="field">Choose the file or files</label><input type="file" id="up-files" multiple>
    <label class="field">Title (optional - the file name is used if left empty)</label><input type="text" id="up-title" placeholder="e.g. Minutes of the 142nd Board Meeting">
    <label class="field">Date of the document (optional)</label><input type="date" id="up-date" style="max-width:260px">
    <label class="field">Short note (optional)</label><input type="text" id="up-desc" placeholder="e.g. Signed copy, approved at the 31st AGM">
    <label class="field">Key words (optional)</label><input type="text" id="up-tags" placeholder="e.g. quorum, borrowing, Sec 180">
    <div id="up-msg"></div>
    <div class="btn-row"><button class="btn" id="up-save">Add to library</button><button class="btn light" id="up-cancel">Cancel</button></div>`;
  const hint = () => { d.querySelector("#up-hint").textContent = "Usually kept here: " + (META.library_folders.find(f => f.id === d.querySelector("#up-folder").value) || {}).hint; };
  d.querySelector("#up-folder").onchange = hint; hint();
  d.querySelector("#up-cancel").onclick = () => d.close();
  d.querySelector("#up-save").onclick = async () => {
    const filesIn = d.querySelector("#up-files").files;
    if (!filesIn.length) return flash("Please choose at least one file.");
    const fd = new FormData();
    [...filesIn].forEach(f => fd.append("files", f));
    fd.append("folder", d.querySelector("#up-folder").value);
    fd.append("title", d.querySelector("#up-title").value);
    fd.append("doc_date", d.querySelector("#up-date").value);
    fd.append("description", d.querySelector("#up-desc").value);
    fd.append("tags", d.querySelector("#up-tags").value);
    const btn = d.querySelector("#up-save"); btn.disabled = true; btn.textContent = "Adding...";
    try {
      const r = await postForm("/api/library", fd);
      if (r.errors.length) { d.querySelector("#up-msg").innerHTML = `<div class="banner error">${r.errors.map(esc).join("<br>")}</div>`; btn.disabled = false; btn.textContent = "Add to library"; return; }
      d.close();
      after(r.ids);
    } catch (e) { d.querySelector("#up-msg").innerHTML = `<div class="banner error">${esc(e.message)}</div>`; btn.disabled = false; btn.textContent = "Add to library"; }
  };
  d.showModal();
}

screens.library = async (param) => {
  const folder = param && param !== "removed" ? param : "";
  const removed = param === "removed";
  let q = pending.libQuery || ""; delete pending.libQuery;
  app.innerHTML = `${backButton()}<h1>Document library</h1><p class="lead">Loading...</p>`;
  const r = await api(`/api/library?${new URLSearchParams({ q, folder, deleted: removed ? "1" : "0" })}`);
  const f = META.library_folders.find(x => x.id === folder);
  app.innerHTML = `${folder || removed || q ? `<a class="btn light back no-print" href="#library">&larr; All folders</a>` : backButton()}
    <h1>${removed ? "Removed documents" : f ? esc(f.name) : "Document library"}</h1>
    <p class="lead">${removed ? "Documents that were removed. Restore any that were removed by mistake."
      : f ? "Usually kept here: " + esc(f.hint) : "The CS office's documents in one place. Search, open, and use any of them to ask a question, check or draft."}</p>
    <div class="step no-print"><div class="inline searchrow">
      <div><input type="text" id="lib-q" value="${esc(q)}" placeholder="Search by any word in the title or inside the document"></div>
      <div><button class="btn big" id="lib-go">Search</button></div>
      <div><button class="btn big light" id="lib-add">+ Add documents</button></div></div></div>
    <div id="lib-body"></div>`;
  const body = document.getElementById("lib-body");
  const doSearch = () => { pending.libQuery = document.getElementById("lib-q").value.trim(); screens.library(folder); };
  document.getElementById("lib-go").onclick = doSearch;
  document.getElementById("lib-q").onkeydown = e => { if (e.key === "Enter") doSearch(); };
  document.getElementById("lib-add").onclick = () => uploadDialog(folder, ids => {
    flash(`${ids.length} document${ids.length > 1 ? "s" : ""} added.`);
    screens.library(folder);
  });
  if (q || folder || removed) {
    body.innerHTML = `<h2>${q ? `${r.docs.length} result${r.docs.length === 1 ? "" : "s"} for "${esc(q)}"${f ? " in this folder" : ""}` : `${r.docs.length} document${r.docs.length === 1 ? "" : "s"}`}</h2>
      <div class="cards">${r.docs.map(docCard).join("") || `<div class="banner info">${q ? "Nothing found. Try a different or shorter word." : "No documents here yet. Press '+ Add documents' to add some."}</div>`}</div>`;
    wireRestore(body, () => screens.library(param));
    return;
  }
  body.innerHTML = `<h2>Folders</h2>
    <div class="tiles">${META.library_folders.map(x => `<a class="tile small folder" href="#library/${x.id}">
      <span class="num">${r.counts[x.id] || 0} document${(r.counts[x.id] || 0) === 1 ? "" : "s"}</span><span class="t">${esc(x.name)}</span>
      <div class="d">${esc(x.hint)}</div></a>`).join("")}</div>
    <h2>Recently added or changed</h2><div class="cards" id="recent"><p class="meta">Loading...</p></div>
    ${ME.role === "admin" ? `<p class="meta no-print" style="margin-top:1.4rem"><a href="#library/removed">Show removed documents</a></p>` : ""}`;
  const all = await api("/api/library");
  const recent = all.docs.slice().sort((a, b) => (b.updated || "").localeCompare(a.updated || "")).slice(0, 8);
  document.getElementById("recent").innerHTML = recent.map(docCard).join("") ||
    `<div class="banner info">The library is empty. Start with the company's key documents: Certificate of Incorporation, MOA and AOA, the latest signed Board and AGM minutes, statutory registers and the main policies.</div>`;
};

screens.doc = async (param) => {
  const id = parseInt(param);
  let d;
  try { d = await api(`/api/library/${id}`); } catch (e) { app.innerHTML = `${backButton()}<div class="banner error">${esc(e.message)}</div>`; return; }
  const cur = d.versions[0] || {};
  const isPdf = d.mime === "application/pdf", isImg = /^image\/(png|jpeg|webp)$/.test(d.mime || "");
  app.innerHTML = `<a class="btn light back no-print" href="#library/${d.category}">&larr; ${esc(d.category_name)}</a>
    <div class="kicker">${esc(d.category_name)}${d.deleted ? " · REMOVED" : ""}</div>
    <h1>${esc(d.title)}</h1>
    <div class="metagrid">
      <div><div class="lbl">Date</div>${d.doc_date ? fmtDate(d.doc_date) : "-"}</div>
      <div><div class="lbl">File</div>${esc(d.filename || "")} (${fmtSize(d.size || 0)})</div>
      <div><div class="lbl">Version</div>${d.current_version} &middot; ${fmtDate((cur.uploaded || "").slice(0, 10))}</div>
      <div><div class="lbl">Added by</div>${esc(d.created_by || "-")}</div>
    </div>
    ${d.description ? `<p>${esc(d.description)}</p>` : ""}
    ${d.tags ? `<p class="meta">Key words: ${esc(d.tags)}</p>` : ""}
    <div class="btn-row no-print">
      <a class="btn" href="/api/library/${id}/file?download=1">Download</a>
      <button class="btn light" data-use="ask">Ask about this document</button>
      <button class="btn light" data-use="vet">Check this document</button>
      <button class="btn light" data-use="draft">Use it to write a new document</button>
    </div>
    <div class="btn-row no-print">
      <button class="btn light" id="d-ver">Upload a new version</button>
      <button class="btn light" id="d-edit">Edit details</button>
      ${d.deleted ? `<button class="btn" id="d-restore">Restore</button>` : `<button class="btn danger" id="d-del">Remove</button>`}
    </div>
    <h2>Preview</h2><div id="preview" class="preview"></div>
    <h2>Versions</h2>
    <div class="md"><table><thead><tr><th>No.</th><th>File</th><th>Uploaded</th><th>By</th><th>Note</th><th></th></tr></thead><tbody>
      ${d.versions.map(v => `<tr><td>${v.version_no}</td><td>${esc(v.filename)}</td><td>${fmtDate(v.uploaded.slice(0, 10))}</td><td>${esc(v.uploaded_by || "")}</td>
        <td>${esc(v.note || "")}</td><td><a href="/api/library/${id}/file?v=${v.version_no}&download=1">Download</a></td></tr>`).join("")}</tbody></table></div>`;
  const pv = document.getElementById("preview");
  if (isPdf) pv.innerHTML = `<iframe src="/api/library/${id}/file" title="${esc(d.title)}"></iframe>`;
  else if (isImg) pv.innerHTML = `<img src="/api/library/${id}/file" alt="${esc(d.title)}">`;
  else {
    const t = await api(`/api/library/${id}/text`).catch(() => null);
    pv.innerHTML = t && t.text ? `<div class="textpreview">${esc(t.text)}</div>`
      : `<div class="banner info">No preview for this kind of file. Press Download to open it.</div>`;
  }
  app.querySelectorAll("[data-use]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      pending.attach = await api(`/api/library/${id}/attach`, { method: "POST" });
      if (b.dataset.use === "ask") pending.question = `About the attached document "${d.title}": `;
      go(b.dataset.use);
    } catch (e) { flash(e.message); b.disabled = false; }
  });
  document.getElementById("d-ver").onclick = () => {
    const dl = document.getElementById("dlg");
    dl.innerHTML = `<h2 style="margin-top:0">Upload a new version</h2>
      <p class="meta">The current file is kept as version ${d.current_version}. The new file becomes version ${d.current_version + 1}.</p>
      <label class="field">New file</label><input type="file" id="v-file">
      <label class="field">What changed? (optional)</label><input type="text" id="v-note" placeholder="e.g. Signed copy / amended at the 143rd Board meeting">
      <div id="v-msg"></div>
      <div class="btn-row"><button class="btn" id="v-save">Upload</button><button class="btn light" id="v-cancel">Cancel</button></div>`;
    dl.showModal();
    dl.querySelector("#v-cancel").onclick = () => dl.close();
    dl.querySelector("#v-save").onclick = async () => {
      const file = dl.querySelector("#v-file").files[0];
      if (!file) return;
      const fd = new FormData(); fd.append("file", file); fd.append("note", dl.querySelector("#v-note").value);
      try { await postForm(`/api/library/${id}/version`, fd); dl.close(); screens.doc(id); }
      catch (e) { dl.querySelector("#v-msg").innerHTML = `<div class="banner error">${esc(e.message)}</div>`; }
    };
  };
  document.getElementById("d-edit").onclick = () => {
    const dl = document.getElementById("dlg");
    dl.innerHTML = `<h2 style="margin-top:0">Edit details</h2>
      <label class="field">Title</label><input type="text" id="e-title" value="${esc(d.title)}">
      <label class="field">Folder</label><select id="e-folder">${folderOptions(d.category)}</select>
      <label class="field">Date of the document</label><input type="date" id="e-date" value="${esc(d.doc_date || "")}" style="max-width:260px">
      <label class="field">Short note</label><input type="text" id="e-desc" value="${esc(d.description || "")}">
      <label class="field">Key words</label><input type="text" id="e-tags" value="${esc(d.tags || "")}">
      <div class="btn-row"><button class="btn" id="e-save">Save</button><button class="btn light" id="e-cancel">Cancel</button></div>`;
    dl.showModal();
    dl.querySelector("#e-cancel").onclick = () => dl.close();
    dl.querySelector("#e-save").onclick = async () => {
      try {
        await api(`/api/library/${id}`, { method: "POST", body: JSON.stringify({ title: dl.querySelector("#e-title").value,
          category: dl.querySelector("#e-folder").value, doc_date: dl.querySelector("#e-date").value,
          description: dl.querySelector("#e-desc").value, tags: dl.querySelector("#e-tags").value }) });
        dl.close(); screens.doc(id);
      } catch (e) { flash(e.message); }
    };
  };
  const del = document.getElementById("d-del");
  if (del) del.onclick = async () => {
    if (!confirm(`Remove "${d.title}" from the library? An administrator can restore it later.`)) return;
    await api(`/api/library/${id}`, { method: "DELETE" }); go(`library/${d.category}`);
  };
  const res = document.getElementById("d-restore");
  if (res) res.onclick = async () => { await api(`/api/library/${id}/restore`, { method: "POST" }); screens.doc(id); };
};

/* ------------------------------------------------------------------ guides */
screens.guides = async () => {
  app.innerHTML = `${backButton()}<h1>Guides &amp; official links</h1>
    <p class="lead">Official portals the CS office uses, and a guide to everything the office looks after.</p>
    <h2>Official websites</h2>
    <div class="tiles">${META.links.map(([group, links]) => `<div class="tile small nohover"><span class="num">${esc(group)}</span>
      <ul class="links">${links.map(([t, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join("")}</ul></div>`).join("")}</div>
    <p class="meta">These open the official site in a new tab. If a page has moved, use the search box on that site.</p>
    <div class="btn-row"><a class="btn light" href="#calendar">Filing calendar</a><a class="btn light" href="#events">Event checklists</a>
      <button class="btn light" onclick="window.print()">Print this guide</button></div>
    <h2>What the CS office looks after</h2><div class="result"><div class="md" id="guide">Loading...</div></div>`;
  const gd = await api("/api/guide");
  document.getElementById("guide").innerHTML = md(gd.markdown.replace(/^# .*\n/, ""));
};

/* ---------------------------------------------------------------- settings */
screens.settings = () => {
  const p = META.profile || {}, f = p.flags || {};
  const fields = [["name", "Legal name of the company"], ["brand", "Known as (brand)"], ["cin", "CIN"], ["registered_office", "Registered office address"],
    ["company_type", "Type of company"], ["parent", "Holding / parent company"], ["pan", "PAN"], ["gstin", "GSTIN"],
    ["cs_name", "Company Secretary's name"], ["signatory", "Usual authorised signatory"], ["notes", "Other notes for the assistant"]];
  const admin = ME.role === "admin";
  app.innerHTML = `${backButton()}<h1>Settings</h1>
    <h2>My account</h2>
    <div class="step"><p style="margin-top:0">Signed in as <strong>${esc(ME.full_name)}</strong> (${esc(ME.username)}${admin ? ", administrator" : ""}).</p>
      <div class="inline"><div><label class="field">Current password</label><input type="password" id="pw-cur" autocomplete="current-password"></div>
        <div><label class="field">New password (8 or more characters)</label><input type="password" id="pw-new" autocomplete="new-password"></div>
        <div><button class="btn light" id="pw-save">Change my password</button></div></div></div>
    ${admin ? `<h2>People who can use this site</h2><div class="step" id="users">Loading...</div>
      <h2>Recent activity</h2><div class="step"><p class="meta" style="margin-top:0">Who added, changed or removed documents, marked filings and changed settings.</p><div id="activity">Loading...</div></div>
      <h2>Backup</h2><div class="step"><p style="margin-top:0">Download one file containing the database and every library document. IT should also back up the <code>data</code> folder every night.</p>
        <a class="btn light" href="/api/backup">Download a full backup</a></div>` : ""}
    <h2>Company details</h2>
    <p class="lead">These details are used in drafts and to decide which filings appear in the calendar.${admin ? "" : " Only an administrator can change them."}</p>
    <div class="banner ${META.ai_ready ? "info" : "warn"}">AI service: ${META.ai_ready ? `switched on (model ${esc(META.model)})` : "not set up - see README"}.</div>
    <div class="step">${fields.map(([k, l]) => `<label class="field" for="p-${k}">${l}</label>` +
      (k === "notes" || k === "registered_office" ? `<textarea id="p-${k}">${esc(p[k] || "")}</textarea>` : `<input type="text" id="p-${k}" value="${esc(p[k] || "")}">`)).join("")}</div>
    <div class="step"><div class="q">Which of these apply to the company?</div>
      <div class="choices">${Object.entries(META.flags).map(([k, l]) => `<label class="choice"><input type="checkbox" id="fl-${k}" ${f[k] ? "checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div></div>
    <div class="step"><label class="field" for="p-since" style="margin-top:0">Start tracking filings from</label>
      <input type="date" id="p-since" value="${esc(META.tracking_since || "")}" style="max-width:260px">
      <p style="color:var(--slate);font-size:0.9rem">Due dates before this date are not shown as overdue in the calendar.</p></div>
    ${admin ? `<div class="btn-row"><button class="btn big" id="p-save">Save company details</button></div>` : ""}`;
  if (!admin) app.querySelectorAll(".step input:not([type=password]), .step textarea").forEach(el => el.disabled = true);
  document.getElementById("pw-save").onclick = async () => {
    try {
      await api("/api/me/password", { method: "POST", body: JSON.stringify({ current: document.getElementById("pw-cur").value, new: document.getElementById("pw-new").value }) });
      document.getElementById("pw-cur").value = document.getElementById("pw-new").value = "";
      flash("Your password has been changed.");
    } catch (e) { flash(e.message); }
  };
  if (admin) { drawUsers(); drawActivity(); }
  if (!admin) return;
  document.getElementById("p-save").onclick = async () => {
    const body = { flags: {}, tracking_since: document.getElementById("p-since").value };
    fields.forEach(([k]) => body[k] = document.getElementById("p-" + k).value);
    Object.keys(META.flags).forEach(k => body.flags[k] = document.getElementById("fl-" + k).checked);
    await api("/api/profile", { method: "POST", body: JSON.stringify(body) });
    META = await api("/api/meta"); setCompany();
    flash("Saved.");
  };
};

screens.help = () => {
  app.innerHTML = `${backButton()}<h1>How to use the CS Assistant</h1>
    <div class="step md">
      <h3>Moving around</h3><p>Click <strong>Home</strong> at the top at any time. Use <strong>A+</strong> and <strong>A&minus;</strong> to make the writing bigger or smaller.</p>
      <h3>Asking a question</h3><p>Home &rarr; <strong>Ask a question</strong>. Type as you would to a colleague and press <strong>Ask</strong>. You can keep asking follow-ups; press <strong>Start a new question</strong> for a new topic.</p>
      <h3>Checking a document</h3><p>Home &rarr; <strong>Check a document</strong>. Choose the type, add the file (PDF, Word or a scanned picture), and press <strong>Check this document</strong>. You get a GREEN / AMBER / RED verdict, a table of problems and ready-made wording. Then you can ask for changes, for example "redraft clause 7 in our favour".</p>
      <h3>Writing a document</h3><p>Home &rarr; <strong>Write a document</strong>. Choose the document, fill in the details you know, and press <strong>Write the document</strong>. Press <strong>Download as Word</strong> to open it in Microsoft Word.</p>
      <h3>Filing calendar</h3><p>Shows what is due, worked out for our financial year. When a filing is done, press <strong>Mark as done</strong> and note the SRN. Enter the AGM date so that AOC-4 and MGT-7 dates are right.</p>
      <h3>Licences</h3><p>Enter each licence's expiry date once; the tool warns 90 and 30 days ahead.</p>
      <h3>Document library</h3><p>Home &rarr; <strong>Open the library</strong>, or type in the search box on the Home screen. Documents are kept in folders (Board meetings, registers, policies, contracts, licences and so on). Press <strong>+ Add documents</strong> to add files. Open any document to preview it, download it, upload a newer version (older versions are kept), or press <strong>Ask about this document</strong>, <strong>Check this document</strong> or <strong>Use it to write a new document</strong>. When you ask a question, the assistant also searches the library by itself and names the documents it used.</p>
      <h3>Saving your work</h3><p>After any answer, review or draft, press <strong>Save to library</strong>. It is saved as a Word file in the Lakeshore format, in the folder you choose.</p>
      <h3>Signing in</h3><p>Each person has their own username and password. Press <strong>Sign out</strong> at the top when you leave a shared computer. If you forget your password, ask the administrator to set a new one.</p>
      <h3>Confidentiality</h3><p>Library documents are stored on the hospital's own server and only people with a login can see them. When the assistant reads a document (because you attached it, or it searched the library to answer you), that text is sent securely to the AI service. Files attached only for one question are forgotten after a few hours. Avoid uploading patient names or medical records unless needed - remove or black out personal details first.</p>
      <h3>Important</h3><p>The assistant is a helper, like a well-read deputy. It can make mistakes and the law changes often. Check important points and have major matters reviewed by an advocate.</p>
    </div>`;
};

/* ------------------------------------------------------------------ router */
async function drawUsers() {
  const box = document.getElementById("users");
  const users = await api("/api/users");
  box.innerHTML = `<div class="md"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Last signed in</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.username)}</td><td>${u.role === "admin" ? "Administrator" : "Member"}</td>
      <td>${u.active ? "Active" : "Switched off"}</td><td>${u.last_login ? fmtDate(u.last_login.slice(0, 10)) : "-"}</td>
      <td><button class="btn light" data-u="${u.id}">Change</button></td></tr>`).join("")}</tbody></table></div>
    <div class="btn-row"><button class="btn" id="u-add">+ Add a person</button></div>
    <p class="meta">Members can use everything except user management, backup and company details. Switch a person off when they leave; their name stays in the activity log.</p>`;
  const dlgUser = (u) => {
    const d = document.getElementById("dlg");
    d.innerHTML = `<h2 style="margin-top:0">${u ? "Change " + esc(u.full_name) : "Add a person"}</h2>
      <label class="field">Full name</label><input type="text" id="nu-name" value="${esc(u ? u.full_name : "")}">
      ${u ? "" : `<label class="field">Username (used to sign in)</label><input type="text" id="nu-user" placeholder="e.g. anita.menon">`}
      <label class="field">${u ? "New password (leave empty to keep the current one)" : "Password (8 or more characters)"}</label><input type="password" id="nu-pw" autocomplete="new-password">
      <label class="field">Role</label><select id="nu-role"><option value="member">Member</option><option value="admin" ${u && u.role === "admin" ? "selected" : ""}>Administrator</option></select>
      ${u ? `<label class="choice" style="margin-top:0.8rem"><input type="checkbox" id="nu-active" ${u.active ? "checked" : ""}><span>Allowed to sign in</span></label>` : ""}
      <div class="btn-row"><button class="btn" id="nu-save">Save</button><button class="btn light" id="nu-cancel">Cancel</button></div>`;
    d.showModal();
    d.querySelector("#nu-cancel").onclick = () => d.close();
    d.querySelector("#nu-save").onclick = async () => {
      const body = { full_name: d.querySelector("#nu-name").value, role: d.querySelector("#nu-role").value, password: d.querySelector("#nu-pw").value };
      try {
        if (u) { body.active = d.querySelector("#nu-active").checked; await api(`/api/users/${u.id}`, { method: "POST", body: JSON.stringify(body) }); }
        else { body.username = d.querySelector("#nu-user").value; await api("/api/users", { method: "POST", body: JSON.stringify(body) }); }
        d.close(); drawUsers();
      } catch (e) { flash(e.message); }
    };
  };
  box.querySelector("#u-add").onclick = () => dlgUser(null);
  box.querySelectorAll("[data-u]").forEach(b => b.onclick = () => dlgUser(users.find(x => String(x.id) === b.dataset.u)));
}
async function drawActivity() {
  const rows = await api("/api/activity");
  document.getElementById("activity").innerHTML = rows.length ? `<div class="md"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>
    ${rows.slice(0, 100).map(r => `<tr><td>${esc(r.at.replace("T", " ").slice(0, 16))}</td><td>${esc(r.username || "")}</td><td>${esc(r.action)}</td><td>${esc(r.detail || "")}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="meta">Nothing yet.</p>`;
}

/* ---------------------------------------------------------- signing in */
function showSignIn() {
  document.body.classList.add("signed-out");
  app.innerHTML = `<div class="signin step">
    <div class="label">Company Secretariat &amp; Legal</div>
    <h1>Sign in</h1>
    <p class="lead">Use the username and password given to you by the administrator.</p>
    <label class="field" for="si-user">Username</label><input type="text" id="si-user" autocomplete="username">
    <label class="field" for="si-pw">Password</label><input type="password" id="si-pw" autocomplete="current-password">
    <div id="si-msg"></div>
    <div class="btn-row"><button class="btn big" id="si-go">Sign in</button></div>
    <p class="meta">Forgotten your password? Ask the administrator to set a new one.</p></div>`;
  const go_ = async () => {
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ username: document.getElementById("si-user").value, password: document.getElementById("si-pw").value }) });
      start();
    } catch (e) { document.getElementById("si-msg").innerHTML = `<div class="banner error">${esc(e.message)}</div>`; }
  };
  document.getElementById("si-go").onclick = go_;
  document.getElementById("si-pw").onkeydown = e => { if (e.key === "Enter") go_(); };
  document.getElementById("si-user").focus();
}
function showSetup() {
  document.body.classList.add("signed-out");
  app.innerHTML = `<div class="signin step">
    <div class="label">First-time setup</div>
    <h1>Create the administrator</h1>
    <p class="lead">This person manages who can use the site. You can add the rest of the team afterwards in Settings.</p>
    <label class="field">Full name</label><input type="text" id="su-name" placeholder="Your name, e.g. Anita Menon">
    <label class="field">Username</label><input type="text" id="su-user" autocomplete="username">
    <label class="field">Password (8 or more characters)</label><input type="password" id="su-pw" autocomplete="new-password">
    <div id="su-msg"></div>
    <div class="btn-row"><button class="btn big" id="su-go">Create and sign in</button></div></div>`;
  document.getElementById("su-go").onclick = async () => {
    try {
      await api("/api/setup", { method: "POST", body: JSON.stringify({ full_name: document.getElementById("su-name").value,
        username: document.getElementById("su-user").value, password: document.getElementById("su-pw").value }) });
      start();
    } catch (e) { document.getElementById("su-msg").innerHTML = `<div class="banner error">${esc(e.message)}</div>`; }
  };
}
async function signOut() {
  await fetch("/api/logout", { method: "POST" });
  ME = null; askSession = null;
  document.getElementById("who").hidden = true;
  showSignIn();
}

function go(name) { if (location.hash === "#" + name) route(); else location.hash = name; }
function route() {
  if (!ME) return;
  const [name, param] = (location.hash || "#home").slice(1).split("/");
  (screens[name] || screens.home)(param);
  window.scrollTo(0, 0);
}
function setCompany() {
  const p = META.profile || {};
  document.getElementById("company-name").textContent = `${p.brand || "VPS Lakeshore"} · Company Secretariat & Legal`;
}
window.addEventListener("hashchange", route);
async function start() {
  let me;
  try { me = await api("/api/me"); } catch (e) { app.innerHTML = `<div class="banner error">Cannot reach the CS Assistant server. Is it running?</div>`; return; }
  if (me.needs_setup) return showSetup();
  if (!me.user) return showSignIn();
  ME = me.user;
  document.body.classList.remove("signed-out");
  const who = document.getElementById("who");
  who.hidden = false;
  who.textContent = `Sign out (${ME.full_name.split(" ")[0]})`;
  META = await api("/api/meta");
  setCompany();
  route();
}
start();
