/* CS Assistant - front end. Plain JavaScript, no external libraries, so it runs on any office PC. */
"use strict";

let META = null;
const app = document.getElementById("app");
const pending = {};           // values handed between screens (e.g. a question to pre-fill)
let askSession = null;        // keep the Ask conversation when moving between screens

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
    let msg = `Something went wrong (${r.status}).`;
    try { const j = await r.json(); if (j.error) msg = j.error; } catch (_) { /* not JSON */ }
    throw new Error(msg);
  }
  return r.json();
}
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
    count() { return docs.length + (box.querySelector(".paste").value.trim() ? 1 : 0); },
  };
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
        s.innerHTML = "<strong>Sources checked:</strong> " + ev.items.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(" &middot; ");
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
  b("Save to My Work", async () => {
    await api("/api/work", { method: "POST", body: JSON.stringify({ kind, title, markdown: getText() }) });
    flash("Saved. You can find it under 'My saved work' on the Home screen.");
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
  const p = META.profile || {};
  app.innerHTML = `
    <h1>Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}. What would you like to do?</h1>
    <p class="lead">Choose one of the boxes below.</p>
    ${META.ai_ready ? "" : `<div class="banner warn"><strong>The AI part is not switched on yet.</strong> The Filing Calendar, 'Something happened?' and Licences screens work now. To ask questions, check and write documents, ask IT to add the access key (see README).</div>`}
    <div id="due-banner"></div>
    <div class="tiles">
      <button class="tile" onclick="go('ask')"><span class="num">01</span><span class="t">Ask a question</span>
        <div class="d">Company law, FEMA, hospital licences, contracts, notices - in plain English, with sections quoted.</div></button>
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
      <button class="tile small" onclick="go('saved')"><span class="t">My saved work</span><div class="d">Answers and drafts you saved.</div></button>
      <button class="tile small" onclick="go('settings')"><span class="t">Company details (Settings)</span><div class="d">Name, CIN, and which rules apply to us.</div></button>
    </div>`;
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
      ${r.done_on ? `<div class="meta" style="grid-column:1/-1">Done on ${fmtDate(r.done_on)}${r.srn ? ` &middot; SRN / Ref: ${esc(r.srn)}` : ""}${r.notes ? ` &middot; ${esc(r.notes)}` : ""}</div>` : ""}
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

/* ------------------------------------------------------------------- saved */
screens.saved = async () => {
  const list = await api("/api/work");
  app.innerHTML = `${backButton()}<h1>My saved work</h1>
    ${list.length ? "" : `<div class="banner info">Nothing saved yet. After an answer or draft, press 'Save to My Work'.</div>`}
    <div class="cards">${list.map(w => `<div class="card later"><div><div class="title">${esc(w.title)}</div>
      <div class="meta">${esc({ vet: "Document check", draft: "Draft", ask: "Answer", answer: "Answer" }[w.kind] || w.kind)} &middot; ${fmtDate(w.created.slice(0, 10))}</div></div>
      <div class="actions"><button class="btn" data-open="${w.id}">Open</button><button class="btn danger" data-del="${w.id}">Delete</button></div></div>`).join("")}</div>
    <div id="viewer"></div>`;
  app.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this saved item?")) return;
    await api(`/api/work/${b.dataset.del}`, { method: "DELETE" }); screens.saved();
  });
  app.querySelectorAll("[data-open]").forEach(b => b.onclick = async () => {
    const w = await api(`/api/work/${b.dataset.open}`);
    const v = document.getElementById("viewer");
    v.innerHTML = `<h2>${esc(w.title)}</h2><div class="result"><div class="md">${md(w.markdown)}</div><div class="btn-row actions"></div></div>`;
    addActions(v.querySelector(".actions"), () => w.markdown, w.title, w.kind);
    v.scrollIntoView({ behavior: "smooth" });
  });
};

/* ---------------------------------------------------------------- settings */
screens.settings = () => {
  const p = META.profile || {}, f = p.flags || {};
  const fields = [["name", "Legal name of the company"], ["brand", "Known as (brand)"], ["cin", "CIN"], ["registered_office", "Registered office address"],
    ["company_type", "Type of company"], ["parent", "Holding / parent company"], ["pan", "PAN"], ["gstin", "GSTIN"],
    ["cs_name", "Company Secretary's name"], ["signatory", "Usual authorised signatory"], ["notes", "Other notes for the assistant"]];
  app.innerHTML = `${backButton()}<h1>Company details</h1>
    <p class="lead">These details are used in drafts and to decide which filings appear in the calendar.</p>
    <div class="banner ${META.ai_ready ? "info" : "warn"}">AI service: ${META.ai_ready ? `switched on (model ${esc(META.model)})` : "not set up - see README"}.</div>
    <div class="step">${fields.map(([k, l]) => `<label class="field" for="p-${k}">${l}</label>` +
      (k === "notes" || k === "registered_office" ? `<textarea id="p-${k}">${esc(p[k] || "")}</textarea>` : `<input type="text" id="p-${k}" value="${esc(p[k] || "")}">`)).join("")}</div>
    <div class="step"><div class="q">Which of these apply to the company?</div>
      <div class="choices">${Object.entries(META.flags).map(([k, l]) => `<label class="choice"><input type="checkbox" id="fl-${k}" ${f[k] ? "checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div></div>
    <div class="step"><label class="field" for="p-since" style="margin-top:0">Start tracking filings from</label>
      <input type="date" id="p-since" value="${esc(META.tracking_since || "")}" style="max-width:260px">
      <p style="color:var(--slate);font-size:0.9rem">Due dates before this date are not shown as overdue in the calendar.</p></div>
    <div class="btn-row"><button class="btn big" id="p-save">Save</button></div>`;
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
      <h3>Confidentiality</h3><p>Documents you upload are sent securely to the AI service to be read, and are not stored by this tool after a few hours. Avoid uploading patient names or medical records unless needed - remove or black out personal details first.</p>
      <h3>Important</h3><p>The assistant is a helper, like a well-read deputy. It can make mistakes and the law changes often. Check important points and have major matters reviewed by an advocate.</p>
    </div>`;
};

/* ------------------------------------------------------------------ router */
function go(name) { if (location.hash === "#" + name) route(); else location.hash = name; }
function route() {
  const name = (location.hash || "#home").slice(1);
  (screens[name] || screens.home)();
  window.scrollTo(0, 0);
}
function setCompany() {
  const p = META.profile || {};
  document.getElementById("company-name").textContent = `${p.brand || "VPS Lakeshore"} · Company Secretariat & Legal`;
}
window.addEventListener("hashchange", route);
(async function start() {
  try { META = await api("/api/meta"); } catch (e) { app.innerHTML = `<div class="banner error">Cannot reach the CS Assistant server. Is it running?</div>`; return; }
  setCompany();
  route();
})();
