/* Board meetings (for the Secretariat) and the Board portal (for directors).
 * Uses the helpers in app.js: api, postForm, esc, h, md, fmtDate, flash, backButton, tabsHtml, go, pending, todayIso.
 * Server side: cs_assistant/board.py and the /api/board and /api/portal routes in app.py.
 */
"use strict";

const BOARD_STATUS = {
  draft: ["unknown", "Draft - not visible to directors"],
  published: ["soon", "Published to directors"],
  held: ["done", "Held"],
  cancelled: ["untracked", "Cancelled"],
};
const CIRC_STATUS = { draft: ["unknown", "Draft"], open: ["soon", "Waiting for replies"], closed: ["done", "Closed"] };

function whenText(m) {
  return `${fmtDate(m.meeting_date)}${m.start_time ? " at " + esc(m.start_time) : ""}`;
}
function checkedIds(root, name) {
  return [...root.querySelectorAll(`input[name=${name}]:checked`)].map(i => Number(i.value));
}
function peopleChecks(name, people, selected) {
  if (!people.length) return `<div class="banner warn">No director logins yet. An administrator adds them in <a href="#settings">Settings</a> with the role "Director (Board portal only)".</div>`;
  return `<div class="choices">${people.map(p => `<label class="choice"><input type="checkbox" name="${name}" value="${p.id}" ${selected.includes(p.id) ? "checked" : ""}><span>${esc(p.full_name || p.name)}</span></label>`).join("")}</div>`;
}
function selectHtml(id, options, value) {
  return `<select id="${id}">${options.map(o => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
}
function fileSizeText(n) { return n ? ` (${fmtSize(n)})` : ""; }

/* What happened to an e-mail send, in a sentence. */
function emailSummary(r) {
  if (!r) return "";
  const parts = [];
  if (r.sent) parts.push(`E-mail sent to ${r.sent} director${r.sent === 1 ? "" : "s"}.`);
  if (r.no_email && r.no_email.length) parts.push(`No e-mail address for: ${r.no_email.join(", ")}.`);
  if (r.failed && r.failed.length) parts.push(`Could not send to: ${r.failed.join(", ")}.`);
  if (r.error) parts.push(r.error);
  return parts.join(" ");
}
function emailLogHtml(rows) {
  if (!rows || !rows.length) return `<p class="meta">No e-mails sent yet.</p>`;
  return `<details><summary>E-mails sent (${rows.length})</summary><div class="md"><table><thead><tr><th>When</th><th>To</th><th>What</th><th>Result</th></tr></thead><tbody>
    ${rows.map(e => `<tr><td>${esc(e.at.replace("T", " ").slice(0, 16))}</td><td>${esc(e.name)}<div class="meta">${esc(e.address || "")}</div></td>
      <td>${esc(e.kind_label)}</td><td>${e.error ? `<span style="color:var(--magenta)">${esc(e.error)}</span>` : "Sent"}</td></tr>`).join("")}</tbody></table></div></details>`;
}
function emailBanner() {
  return META.board.email_ready ? "" : `<div class="banner info">E-mail is not set up on the server, so directors are not told by e-mail. Ask IT to fill in the SMTP settings (see README), or tell them yourself.</div>`;
}

/* ------------------------------------------------------------ Secretariat: list */
let boardTab = "meetings";
screens.board = async (param) => {
  if (param) boardTab = param;
  const B = META.board;
  app.innerHTML = `${backButton()}<h1>Board meetings &amp; portal</h1><p class="lead">Loading...</p>`;
  const data = await api("/api/board/meetings");
  const tabs = [["meetings", "Meetings"], ["circulars", "Resolutions by circulation"]];
  const head = `${backButton()}<h1>Board meetings &amp; portal</h1>
    <p class="lead">Build each meeting's agenda and papers, publish them to the directors' portal, and see who will attend and who has read the papers. Send resolutions by circulation and collect the directors' replies.</p>
    ${tabsHtml(tabs, boardTab)}`;
  const wireTabs = () => app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { boardTab = b.dataset.tab; screens.board(); });

  if (boardTab === "circulars") {
    const list = data.circulars;
    app.innerHTML = head + `<div class="banner warn">${esc(B.circular_verify)}</div>
      <div class="btn-row no-print"><button class="btn" id="c-new">+ New resolution by circulation</button>
        <button class="btn light" id="c-write">Write the covering note and resolution</button></div>
      <div class="cards">${list.length ? list.map(c => {
        const st = c.status === "closed" ? ["done", "Closed: " + c.outcome] : CIRC_STATUS[c.status];
        return `<div class="card ${st[0]}"><div><a class="title" href="#bcircular/${c.id}">${esc(c.title)}</a>
          <div class="meta">${c.status === "draft" ? "Not sent yet" : `Sent ${fmtDate(c.circulated_at.slice(0, 10))} &middot; reply by ${fmtDate(c.respond_by)}`}
          ${c.status !== "draft" ? ` &middot; ${c.tally.replies} of ${c.tally.of} replied` : ""}</div>
          ${c.status === "open" ? `<div class="meta">${esc(c.tally.label)}</div>` : ""}</div>
          <div class="due"><span class="pill ${st[0]}">${esc(st[1])}</span></div>
          <div class="actions no-print"><a class="btn light" href="#bcircular/${c.id}">Open</a></div></div>`;
      }).join("") : `<div class="banner info">No resolutions by circulation yet.</div>`}</div>`;
    wireTabs();
    document.getElementById("c-new").onclick = () => circularDialog(null, id => go(`bcircular/${id}`));
    document.getElementById("c-write").onclick = () => { pending.draftType = "circular_resolution"; go("draft"); };
    return;
  }

  const nd = data.next_due;
  let due = "";
  if (nd) {
    const st = regDue(nd.must_meet_by, "Next Board meeting must be held");
    due = `<div class="banner ${st[0] === "overdue" ? "error" : st[0] === "later" ? "info" : "warn"}">
      <strong>Last Board meeting held on ${fmtDate(nd.last_held)}.</strong> Under Sec. 173(1) the next must be held by <strong>${fmtDate(nd.must_meet_by)}</strong>
      (${nd.days_left < 0 ? `${-nd.days_left} days overdue` : `${nd.days_left} days left`}).
      ${nd.next_scheduled ? `Next one planned for ${fmtDate(nd.next_scheduled)}.` : "None planned yet."}</div>`;
  }
  const upcoming = data.meetings.filter(m => m.meeting_date >= todayIso() && m.status !== "cancelled").reverse();
  const past = data.meetings.filter(m => !upcoming.includes(m));
  const card = m => {
    const st = BOARD_STATUS[m.status];
    return `<div class="card ${st[0]}"><div><a class="title" href="#bmeeting/${m.id}">${esc(m.title)}</a>
      <div class="meta">${esc(m.body)} &middot; ${whenText(m)} &middot; ${m.item_count} agenda item${m.item_count === 1 ? "" : "s"} &middot; ${m.invitees.length} invited</div></div>
      <div class="due"><span class="pill ${st[0]}">${esc(st[1])}</span></div>
      <div class="actions no-print"><a class="btn light" href="#bmeeting/${m.id}">Open</a></div></div>`;
  };
  app.innerHTML = head + due + `
    <div class="btn-row no-print"><button class="btn" id="m-new">+ New meeting</button>
      <button class="btn light" onclick="go('settings')">Add or switch off director logins</button></div>
    <h2>Coming up</h2><div class="cards">${upcoming.length ? upcoming.map(card).join("") : `<div class="banner info">No meetings planned. Press <strong>+ New meeting</strong>.</div>`}</div>
    ${past.length ? `<h2>Earlier meetings</h2><div class="cards">${past.map(card).join("")}</div>` : ""}`;
  wireTabs();
  document.getElementById("m-new").onclick = async () => meetingDialog(null, await api("/api/board/directors"), id => go(`bmeeting/${id}`));
};

/* --------------------------------------------------------- Secretariat: dialogs */
function meetingDialog(m, people, after) {
  const B = META.board, d = document.getElementById("dlg");
  const x = m || { body: B.bodies[0], mode: B.modes[0], invitees: people.map(p => p.id) };
  d.style.maxWidth = "760px";
  d.innerHTML = `<h2 style="margin-top:0">${m ? "Change meeting details" : "New meeting"}</h2>
    <label class="field">Board or committee</label>${selectHtml("bm-body", B.bodies, x.body)}
    <label class="field">Name of the meeting</label><input type="text" id="bm-title" value="${esc(x.title || "")}" placeholder="e.g. 143rd Board Meeting">
    <div class="inline"><div><label class="field">Date</label><input type="date" id="bm-date" value="${esc(x.meeting_date || "")}"></div>
      <div><label class="field">Time</label><input type="text" id="bm-time" value="${esc(x.start_time || "")}" placeholder="e.g. 4:00 pm IST"></div></div>
    <label class="field">How it will be held</label>${selectHtml("bm-mode", B.modes, x.mode)}
    <label class="field">Place</label><input type="text" id="bm-venue" value="${esc(x.venue || "")}" placeholder="e.g. Board Room, 4th floor, Lakeshore Hospital, Maradu">
    <label class="field">Video conference link (if any)</label><input type="text" id="bm-link" value="${esc(x.video_link || "")}" placeholder="https://...">
    <label class="field">Date the notice was sent</label><input type="date" id="bm-notice" value="${esc(x.notice_sent_on || "")}" style="max-width:260px">
    <label class="field">Who is invited (they see this meeting in the portal once published)</label>${peopleChecks("bm-inv", people, x.invitees)}
    <label class="field">Notes for the Secretariat (not shown to directors)</label><textarea id="bm-notes">${esc(x.notes || "")}</textarea>
    <div class="btn-row"><button class="btn" id="bm-save">Save</button><button class="btn light" id="bm-cancel">Cancel</button></div>`;
  d.showModal();
  const close = () => { d.close(); d.style.maxWidth = ""; };
  d.querySelector("#bm-cancel").onclick = close;
  d.querySelector("#bm-save").onclick = async () => {
    const body = { body: d.querySelector("#bm-body").value, title: d.querySelector("#bm-title").value, meeting_date: d.querySelector("#bm-date").value,
      start_time: d.querySelector("#bm-time").value, mode: d.querySelector("#bm-mode").value, venue: d.querySelector("#bm-venue").value,
      video_link: d.querySelector("#bm-link").value.trim(), notice_sent_on: d.querySelector("#bm-notice").value,
      invitees: checkedIds(d, "bm-inv"), notes: d.querySelector("#bm-notes").value };
    try {
      const r = await api(m ? `/api/board/meetings/${m.id}` : "/api/board/meetings", { method: "POST", body: JSON.stringify(body) });
      close(); after(m ? m.id : r.id);
    } catch (e) { flash(e.message); }
  };
}

function itemDialog(mid, it, invited, after) {
  const B = META.board, d = document.getElementById("dlg");
  const x = it || { kind: B.item_kinds[0], withheld_from: [] };
  d.style.maxWidth = "760px";
  d.innerHTML = `<h2 style="margin-top:0">${it ? "Change agenda item" : "Add an agenda item"}</h2>
    <label class="field">Title</label><input type="text" id="bi-title" value="${esc(x.title || "")}" placeholder="e.g. To approve the unaudited financial results for the half-year">
    <div class="inline"><div><label class="field">Type</label>${selectHtml("bi-kind", B.item_kinds, x.kind)}</div>
      <div><label class="field">Presented by</label><input type="text" id="bi-pres" value="${esc(x.presenter || "")}" placeholder="e.g. CFO"></div></div>
    <label class="field">Short note for directors (what is asked and why)</label><textarea id="bi-sum">${esc(x.summary || "")}</textarea>
    <label class="field">Draft resolution (if any)</label><textarea id="bi-res" placeholder="RESOLVED THAT ...">${esc(x.resolution || "")}</textarea>
    <label class="field">Paper${x.paper_name ? ` - now: <strong>${esc(x.paper_name)}</strong>` : ""}</label>
    <input type="file" id="bi-file" accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.png,.jpg,.jpeg">
    <p class="meta">PDF is best: it opens on any tablet and goes into the combined pack. ${x.paper_name ? "Uploading a new file keeps the old one and shows directors the item as revised." : ""}</p>
    ${x.paper_name ? `<label class="choice"><input type="checkbox" id="bi-rm"><span>Remove the paper from this item</span></label>` : ""}
    <label class="field">Withhold this paper from (interested directors, Sec. 184)</label>
    ${invited.length ? peopleChecks("bi-wh", invited, x.withheld_from) : `<p class="meta">Choose who is invited to the meeting first.</p>`}
    <div class="btn-row"><button class="btn" id="bi-save">Save</button><button class="btn light" id="bi-cancel">Cancel</button></div>`;
  d.showModal();
  const close = () => { d.close(); d.style.maxWidth = ""; };
  d.querySelector("#bi-cancel").onclick = close;
  d.querySelector("#bi-save").onclick = async () => {
    const fd = new FormData();
    fd.append("title", d.querySelector("#bi-title").value);
    fd.append("kind", d.querySelector("#bi-kind").value);
    fd.append("presenter", d.querySelector("#bi-pres").value);
    fd.append("summary", d.querySelector("#bi-sum").value);
    fd.append("resolution", d.querySelector("#bi-res").value);
    fd.append("withheld_from", JSON.stringify(checkedIds(d, "bi-wh")));
    const f = d.querySelector("#bi-file").files[0];
    if (f) fd.append("paper", f);
    const rm = d.querySelector("#bi-rm");
    if (rm && rm.checked) fd.append("remove_paper", "1");
    const btn = d.querySelector("#bi-save");
    btn.disabled = true; btn.textContent = "Saving...";
    try {
      await postForm(it ? `/api/board/meetings/${mid}/items/${it.id}` : `/api/board/meetings/${mid}/items`, fd);
      close(); after();
    } catch (e) { btn.disabled = false; btn.textContent = "Save"; flash(e.message); }
  };
}

/* ------------------------------------------------------- Secretariat: one meeting */
screens.bmeeting = async (id) => {
  app.innerHTML = `<p class="lead">Loading...</p>`;
  let ov, people;
  try { [ov, people] = await Promise.all([api(`/api/board/meetings/${id}`), api("/api/board/directors")]); }
  catch (e) { app.innerHTML = `${backButton()}<div class="banner error">${esc(e.message)}</div>`; return; }
  const m = ov.meeting, st = BOARD_STATUS[m.status];
  const invited = ov.people.map(p => ({ id: p.id, name: p.name }));
  const RSVP = META.board.rsvp;
  const levelClass = { ok: "info", warn: "warn", error: "error" };
  app.innerHTML = `<button class="btn light back no-print" onclick="go('board/meetings')">&larr; Back to Board meetings</button>
    <div class="kicker">${esc(m.body)}</div>
    <h1>${esc(m.title)} <span class="pill ${st[0]}" style="vertical-align:middle">${esc(st[1])}</span></h1>
    <p class="lead">${whenText(m)} &middot; ${esc(m.mode || "")}${m.venue ? " &middot; " + esc(m.venue) : ""}
      ${m.video_link ? ` &middot; <a href="${esc(m.video_link)}" target="_blank" rel="noopener">video link</a>` : ""}</p>
    <div class="btn-row no-print">
      <button class="btn light" id="bm-edit">Change details</button>
      ${m.status === "draft" ? `<button class="btn" id="bm-pub">Publish to directors</button>` : ""}
      ${m.status === "published" ? `<button class="btn" data-st="held">Mark as held</button><button class="btn light" data-st="draft">Take back to draft</button>` : ""}
      ${m.status !== "cancelled" && m.status !== "held" ? `<button class="btn light" data-st="cancelled">Cancel the meeting</button>` : ""}
      ${m.status === "cancelled" || m.status === "held" ? `<button class="btn light" data-st="published">Reopen</button>` : ""}
      <a class="btn light" href="/api/board/meetings/${m.id}/pack" target="_blank" rel="noopener">View the combined pack (PDF)</a>
      ${m.status === "draft" ? `<button class="btn danger" id="bm-del">Delete</button>` : ""}
    </div>
    <h2>Checks</h2>
    <div class="step">${ov.compliance.length ? ov.compliance.map(c => `<div class="banner ${levelClass[c.level]}" style="margin:0.3rem 0">${c.level === "ok" ? "&#10003; " : ""}${esc(c.text)}</div>`).join("") : ""}
      <p class="meta">${esc(META.board.meeting_verify)}</p></div>
    <h2>Agenda and papers</h2>
    <div class="btn-row no-print"><button class="btn" id="bi-add">+ Add an agenda item</button>
      <button class="btn light" id="bi-circ">Add circular resolutions for noting</button>
      <button class="btn light" id="bm-notice">Write the notice and agenda</button>
      <button class="btn light" id="bm-minutes">Write the minutes</button></div>
    <div class="cards">${ov.items.length ? ov.items.map((it, n) => `<div class="card ${it.paper_name ? "later" : "unknown"}">
      <div><div class="title">${n + 1}. ${esc(it.title)}</div>
        <div class="meta">${esc(it.kind || "")}${it.presenter ? " &middot; presented by " + esc(it.presenter) : ""}</div>
        <div class="meta">${it.paper_name ? `Paper: <a href="/api/board/items/${it.id}/paper" target="_blank" rel="noopener">${esc(it.paper_name)}</a>${fileSizeText(it.paper_size)}` : "No paper yet"}
          ${it.paper_versions.length ? ` &middot; ${it.paper_versions.length} earlier version${it.paper_versions.length > 1 ? "s" : ""} kept` : ""}</div>
        ${it.withheld_names.length ? `<div class="meta" style="color:var(--magenta)">Withheld from: ${it.withheld_names.map(esc).join(", ")}</div>` : ""}</div>
      <div class="due">${it.revised ? `<span class="pill overdue">Revised after publishing</span>` : ""}</div>
      <div class="actions no-print"><button class="btn light" data-ie="${it.id}">Change</button>
        ${n > 0 ? `<button class="btn light" data-up="${n}" title="Move up">&uarr;</button>` : ""}
        ${n < ov.items.length - 1 ? `<button class="btn light" data-down="${n}" title="Move down">&darr;</button>` : ""}
        <button class="btn danger" data-ix="${it.id}">Remove</button></div></div>`).join("")
      : `<div class="banner info">No agenda items yet. Start with the usual opening items (leave of absence, confirmation of the previous minutes, action taken report), then the business.</div>`}</div>
    <h2>Directors</h2>
    <div class="step md">${ov.people.length ? `<table><thead><tr><th>Director</th><th>Attending?</th><th>Papers opened</th></tr></thead><tbody>
      ${ov.people.map(p => `<tr><td>${esc(p.name)}${p.email ? "" : `<div class="meta" style="color:var(--magenta)">No e-mail address</div>`}</td>
        <td>${p.rsvp ? esc(RSVP[p.rsvp.response]) + (p.rsvp.note ? `<div class="meta">${esc(p.rsvp.note)}</div>` : "") : `<span class="meta">No reply yet</span>`}</td>
        <td>${p.papers ? `${p.opened} of ${p.papers}` : "-"}</td></tr>`).join("")}</tbody></table>
      <p class="meta">${ov.attending} of ${ov.people.length} have said they will attend. Check the quorum under Sec. 174 and the Articles (one-third of the directors or two, whichever is more).</p>`
      : `<p>No one is invited yet. Press <strong>Change details</strong> and tick the directors.</p>`}</div>
    ${m.status === "held" ? minutesSectionHtml(m, ov.minutes) : ""}
    <h2>E-mail the directors</h2>
    <div class="step">${emailBanner()}
      ${m.status === "published" ? `<div class="btn-row no-print">
        <button class="btn light" data-mail="remind_reply">Remind those who have not said if they will attend</button>
        <button class="btn light" data-mail="remind_read">Remind those with papers not opened</button>
        ${ov.items.some(i => i.revised) ? `<button class="btn light" data-mail="revised">Tell everyone a paper was revised</button>` : ""}</div>`
        : `<p class="meta">Directors are e-mailed automatically when the meeting is published.</p>`}
      <p class="meta">E-mails carry only the meeting's name, date and a sign-in link, never the papers.</p>
      ${emailLogHtml(ov.emails)}</div>
    ${m.notes ? `<h2>Secretariat notes</h2><div class="step">${esc(m.notes)}</div>` : ""}`;

  const reload = () => screens.bmeeting(id);
  const setStatus = async (status) => {
    if (status === "cancelled" && !confirm("Mark this meeting as cancelled? Directors will still see it, marked cancelled.")) return;
    try {
      const r = await api(`/api/board/meetings/${m.id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      await reload();
      if (r.email) flash(emailSummary(r.email));
    } catch (e) { flash(e.message); }
  };
  document.getElementById("bm-edit").onclick = () => meetingDialog(m, people, reload);
  if (m.status === "held") wireMinutes(m, ov.minutes, reload);
  app.querySelectorAll("[data-mail]").forEach(b => b.onclick = async () => {
    if (!confirm(`${b.textContent}?`)) return;
    b.disabled = true;
    try { const r = await api(`/api/board/meetings/${m.id}/email`, { method: "POST", body: JSON.stringify({ kind: b.dataset.mail }) }); await reload(); flash(emailSummary(r)); }
    catch (e) { b.disabled = false; flash(e.message); }
  });
  const pub = document.getElementById("bm-pub");
  if (pub) pub.onclick = () => {
    if (confirm(`Publish to ${m.invitees.length} director${m.invitees.length === 1 ? "" : "s"}? They will see the agenda and papers when they sign in.`)) setStatus("published");
  };
  app.querySelectorAll("[data-st]").forEach(b => b.onclick = () => setStatus(b.dataset.st));
  const del = document.getElementById("bm-del");
  if (del) del.onclick = async () => {
    if (!confirm("Delete this draft meeting and its papers?")) return;
    try { await api(`/api/board/meetings/${m.id}`, { method: "DELETE" }); go("board/meetings"); } catch (e) { flash(e.message); }
  };
  document.getElementById("bi-add").onclick = () => itemDialog(m.id, null, invited, reload);
  document.getElementById("bi-circ").onclick = async () => {
    try { await api(`/api/board/meetings/${m.id}/note-circulars`, { method: "POST" }); reload(); } catch (e) { flash(e.message); }
  };
  app.querySelectorAll("[data-ie]").forEach(b => b.onclick = () => itemDialog(m.id, ov.items.find(i => String(i.id) === b.dataset.ie), invited, reload));
  app.querySelectorAll("[data-ix]").forEach(b => b.onclick = async () => {
    if (!confirm("Remove this agenda item and its paper?")) return;
    await api(`/api/board/meetings/${m.id}/items/${b.dataset.ix}`, { method: "DELETE" }); reload();
  });
  const move = async (from, to) => {
    const order = ov.items.map(i => i.id);
    [order[from], order[to]] = [order[to], order[from]];
    await api(`/api/board/meetings/${m.id}/order`, { method: "POST", body: JSON.stringify({ order }) }); reload();
  };
  app.querySelectorAll("[data-up]").forEach(b => b.onclick = () => move(+b.dataset.up, +b.dataset.up - 1));
  app.querySelectorAll("[data-down]").forEach(b => b.onclick = () => move(+b.dataset.down, +b.dataset.down + 1));
  const where = `${whenText(m).replace(/<[^>]+>/g, "")}, ${m.mode || ""}${m.venue ? ", " + m.venue : ""}`;
  document.getElementById("bm-notice").onclick = () => {
    pending.draftType = "board_notice";
    pending.draftAnswers = { meeting_no: m.title, date_time: where, agenda: ov.items.map(i => i.title).join("\n") };
    go("draft");
  };
  document.getElementById("bm-minutes").onclick = () => {
    const present = ov.people.filter(p => p.rsvp && p.rsvp.response !== "absent")
      .map(p => `${p.name}${p.rsvp.response === "video" ? " (through video conference)" : ""}`);
    const absent = ov.people.filter(p => p.rsvp && p.rsvp.response === "absent").map(p => p.name);
    pending.draftType = "minutes";
    pending.draftAnswers = {
      meeting: `${m.title}, ${where}`,
      present: `Expected to attend (confirm against the attendance register): ${present.join(", ") || "-"}.\nLeave of absence requested: ${absent.join(", ") || "none"}.`,
      notes: ov.items.map((i, n) => `${n + 1}. ${i.title}${i.resolution ? "\nDraft resolution: " + i.resolution : ""}\n[What was discussed and decided: ]`).join("\n\n"),
    };
    go("draft");
  };
};

/* ------------------------------------------------------ Secretariat: minutes */
function minutesSectionHtml(m, mo) {
  const mn = mo.minutes || {}, levelClass = { ok: "info", warn: "warn", error: "error" };
  const draftLink = mn.draft_name ? `<a href="/api/board/meetings/${m.id}/minutes/file?which=draft" target="_blank" rel="noopener">${esc(mn.draft_name)}</a>` : "";
  const stageText = { none: "No draft yet", drafted: "Draft ready - not yet sent to directors", circulated: `Draft v${mn.version} with directors for comments until ${fmtDate(mn.comments_by)}`, signed: "Signed" }[mo.stage];
  let body = "";
  if (mo.stage === "none" || mo.stage === "drafted" || mo.stage === "circulated") {
    body += `<div class="inline"><div><label class="field">${mo.stage === "none" ? "Upload the draft minutes" : "Upload a revised draft"} (PDF is best for tablets)</label>
        <input type="file" id="mn-file" accept=".pdf,.docx,.doc"></div><div><button class="btn light" id="mn-up">Upload</button></div></div>`;
  }
  if (mo.stage === "drafted" || mo.stage === "circulated") {
    body += `<p>Draft: ${draftLink}</p><div class="btn-row"><button class="btn" id="mn-circ">${mo.stage === "circulated" ? "Send the revised draft again (7 more days)" : "Circulate to directors for comments (7 days)"}</button></div>`;
  }
  if (mo.stage === "circulated") {
    body += `<div class="md"><table><thead><tr><th>Director</th><th>Reply on this draft</th></tr></thead><tbody>
      ${mo.replies.map(r => `<tr><td>${esc(r.name)}</td><td>${r.reply ? (r.reply.kind === "no_comments" ? "No comments" : esc(r.reply.text)) + `<div class="meta">${esc(r.reply.at.replace("T", " ").slice(0, 16))}</div>` : `<span class="meta">No reply yet</span>`}</td></tr>`).join("")}</tbody></table></div>
      ${mo.comments.some(c => c.version < mn.version) ? `<details><summary>Comments on earlier drafts</summary><ul>${mo.comments.filter(c => c.version < mn.version).map(c => `<li>v${c.version} &middot; ${esc(c.name)}: ${c.kind === "no_comments" ? "No comments" : esc(c.text)}</li>`).join("")}</ul></details>` : ""}
      <h3>Record the Chairperson's signature</h3>
      <div class="inline"><div><label class="field">Signed on</label><input type="date" id="mn-on" value="${todayIso()}"></div>
        <div><label class="field">Signed by (Chairperson)</label><input type="text" id="mn-by" placeholder="e.g. Dr Chair Person, Chairman"></div></div>
      <label class="field">Signed copy (scan or digitally signed PDF)</label><input type="file" id="mn-signed" accept=".pdf,.png,.jpg,.jpeg">
      <div class="btn-row"><button class="btn" id="mn-sign">Record as signed</button></div>`;
  }
  if (mo.stage === "signed") {
    body += `<p>&#10003; Signed by <strong>${esc(mn.signed_by)}</strong> on ${fmtDate(mn.signed_on)}:
      <a href="/api/board/meetings/${m.id}/minutes/file?which=signed" target="_blank" rel="noopener">${esc(mn.signed_name)}</a>.
      ${mn.library_doc_id ? `Also saved in the <a href="#doc/${mn.library_doc_id}">document library</a>.` : ""} Directors can now read the signed minutes in the portal.</p>`;
  }
  return `<h2>Minutes</h2><div class="step"><div class="label">${esc(stageText)}</div>
    ${mo.checks.map(c => `<div class="banner ${levelClass[c.level]}" style="margin:0.3rem 0">${c.level === "ok" ? "&#10003; " : ""}${esc(c.text)}</div>`).join("")}
    ${body}<p class="meta">${esc(META.board.minutes_verify)}</p></div>`;
}

function wireMinutes(m, mo, reload) {
  const on = (sel, fn) => { const el = document.getElementById(sel); if (el) el.onclick = fn; };
  on("mn-up", async () => {
    const f = document.getElementById("mn-file").files[0];
    if (!f) return flash("Choose the draft minutes file first.");
    const fd = new FormData(); fd.append("paper", f);
    try { await postForm(`/api/board/meetings/${m.id}/minutes/draft`, fd); reload(); } catch (e) { flash(e.message); }
  });
  on("mn-circ", async () => {
    if (!confirm("Send the draft minutes to the directors for their comments? They will have 7 days.")) return;
    try { const r = await api(`/api/board/meetings/${m.id}/minutes/circulate`, { method: "POST" }); await reload(); if (r.email) flash(emailSummary(r.email)); }
    catch (e) { flash(e.message); }
  });
  on("mn-sign", async () => {
    const f = document.getElementById("mn-signed").files[0];
    const fd = new FormData();
    fd.append("signed_on", document.getElementById("mn-on").value);
    fd.append("signed_by", document.getElementById("mn-by").value);
    if (f) fd.append("paper", f);
    if (!confirm("Record the minutes as signed? They cannot be changed afterwards.")) return;
    try { const r = await postForm(`/api/board/meetings/${m.id}/minutes/sign`, fd); await reload(); if (r.email) flash(emailSummary(r.email)); }
    catch (e) { flash(e.message); }
  });
}

/* ------------------------------------------------- Secretariat: circular resolutions */
function circularDialog(cr, after) {
  const B = META.board, d = document.getElementById("dlg");
  api("/api/board/directors").then(people => {
    const x = cr || { recipients: people.map(p => p.id), interested: [] };
    const defaultBy = (() => { const t = new Date(); t.setDate(t.getDate() + 7); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 10); })();
    d.style.maxWidth = "760px";
    d.innerHTML = `<h2 style="margin-top:0">${cr ? "Change the draft" : "New resolution by circulation"}</h2>
      <details class="banner warn"><summary style="cursor:pointer"><strong>Matters that need a Board meeting and cannot be passed by circulation</strong></summary>
        <ul>${B.meeting_only.map(t => `<li>${esc(t)}</li>`).join("")}</ul><p class="meta">Sec. 179(3) and Rule 8. Check the Articles too.</p></details>
      <label class="field">Subject</label><input type="text" id="bc-title" value="${esc(x.title || "")}" placeholder="e.g. Opening of a current account with Federal Bank">
      <label class="field">Text of the resolution</label><textarea id="bc-res" style="min-height:8rem" placeholder="RESOLVED THAT ...">${esc(x.resolution || "")}</textarea>
      <label class="field">Explanatory note (why it is needed, and why it cannot wait for the next meeting)</label><textarea id="bc-exp">${esc(x.explanation || "")}</textarea>
      <label class="field">Supporting paper (optional)${cr && cr.paper_name ? ` - now: ${esc(cr.paper_name)}` : ""}</label>
      <input type="file" id="bc-file" accept=".pdf,.docx,.doc,.xlsx,.xls,.png,.jpg,.jpeg">
      <label class="field">Reply by (SS-1: not more than 7 days)</label><input type="date" id="bc-by" value="${esc(x.respond_by || defaultBy)}" style="max-width:260px">
      <label class="field">Send to (Sec. 175 needs every director)</label>${peopleChecks("bc-to", people, x.recipients)}
      <label class="field">Interested directors (they receive it but do not vote)</label>${peopleChecks("bc-int", people, x.interested)}
      <div class="btn-row"><button class="btn" id="bc-save">Save the draft</button><button class="btn light" id="bc-cancel">Cancel</button></div>`;
    d.showModal();
    const close = () => { d.close(); d.style.maxWidth = ""; };
    d.querySelector("#bc-cancel").onclick = close;
    d.querySelector("#bc-save").onclick = async () => {
      const fd = new FormData();
      fd.append("title", d.querySelector("#bc-title").value);
      fd.append("resolution", d.querySelector("#bc-res").value);
      fd.append("explanation", d.querySelector("#bc-exp").value);
      fd.append("respond_by", d.querySelector("#bc-by").value);
      fd.append("recipients", JSON.stringify(checkedIds(d, "bc-to")));
      fd.append("interested", JSON.stringify(checkedIds(d, "bc-int")));
      const f = d.querySelector("#bc-file").files[0];
      if (f) fd.append("paper", f);
      try {
        const r = await postForm(cr ? `/api/board/circulars/${cr.id}` : "/api/board/circulars", fd);
        close(); after(cr ? cr.id : r.id);
      } catch (e) { flash(e.message); }
    };
  }).catch(e => flash(e.message));
}

screens.bcircular = async (id) => {
  app.innerHTML = `<p class="lead">Loading...</p>`;
  let cr;
  try { cr = await api(`/api/board/circulars/${id}`); } catch (e) { app.innerHTML = `${backButton()}<div class="banner error">${esc(e.message)}</div>`; return; }
  const V = META.board.votes, t = cr.tally;
  const st = cr.status === "closed" ? ["done", "Closed: " + cr.outcome] : CIRC_STATUS[cr.status];
  app.innerHTML = `<button class="btn light back no-print" onclick="go('board/circulars')">&larr; Back to resolutions by circulation</button>
    <div class="kicker">Resolution by circulation &middot; Sec. 175</div>
    <h1>${esc(cr.title)} <span class="pill ${st[0]}" style="vertical-align:middle">${esc(st[1])}</span></h1>
    ${cr.status !== "draft" ? `<div class="banner ${t.state === "majority" ? "info" : t.state === "waiting" ? "warn" : "error"}"><strong>${esc(t.label)}</strong>
      ${cr.respond_by ? ` Replies due by ${fmtDate(cr.respond_by)}.` : ""}</div>` : ""}
    <div class="btn-row no-print">
      ${cr.status === "draft" ? `<button class="btn" id="bc-send">Circulate to ${cr.recipients.length} director${cr.recipients.length === 1 ? "" : "s"}</button>
        <button class="btn light" id="bc-edit">Change the draft</button><button class="btn danger" id="bc-del">Delete</button>` : ""}
      ${cr.status === "open" ? `${t.state === "majority" ? `<button class="btn" data-close="passed">Record as passed</button>` : ""}
        ${t.state === "meeting" ? `<button class="btn" data-close="referred to meeting">Refer to the next Board meeting</button>` : ""}
        ${t.state === "failed" ? `<button class="btn" data-close="not passed">Record as not passed</button>` : ""}
        <button class="btn light" data-close="withdrawn">Withdraw</button>
        ${META.board.email_ready && t.replies < t.of ? `<button class="btn light" id="bc-remind">E-mail a reminder to those who have not replied</button>` : ""}` : ""}
      ${cr.status === "closed" && cr.outcome === "passed" ? `<button class="btn light" id="bc-dec">Add to Board decisions to follow up</button>` : ""}
      <button class="btn light" onclick="window.print()">Print</button>
    </div>
    ${cr.status === "closed" && cr.outcome === "passed" ? `<div class="banner warn">Place it before the next Board meeting for noting and record it in those minutes (Sec. 175(2)).
      ${cr.noted_meeting_id ? `Added to <a href="#bmeeting/${cr.noted_meeting_id}">that meeting's agenda</a>.` : "Open the next meeting and press <strong>Add circular resolutions for noting</strong>."} Check whether MGT-14 is needed.</div>` : ""}
    <div class="step"><div class="label">Resolution</div><div class="md">${md(cr.resolution)}</div>
      ${cr.explanation ? `<div class="label" style="margin-top:1rem">Explanatory note</div><div class="md">${md(cr.explanation)}</div>` : ""}
      ${cr.paper_name ? `<p><a href="/api/board/circulars/${cr.id}/paper" target="_blank" rel="noopener">${esc(cr.paper_name)}</a></p>` : ""}</div>
    <h2>Replies</h2>
    <div class="step md"><table><thead><tr><th>Director</th><th>Reply</th><th>When</th></tr></thead><tbody>
      ${cr.replies.map(r => `<tr><td>${esc(r.name)}${r.interested ? ` <span class="pill later">Interested - not counted</span>` : ""}</td>
        <td>${r.vote ? esc(V[r.vote.vote]) + (r.vote.comment ? `<div class="meta">${esc(r.vote.comment)}</div>` : "") : `<span class="meta">${cr.status === "draft" ? "-" : "No reply yet"}</span>`}</td>
        <td>${r.vote ? esc(r.vote.at.replace("T", " ").slice(0, 16)) : ""}</td></tr>`).join("")}</tbody></table>
      ${cr.status !== "draft" ? `<p class="meta">${t.entitled} director${t.entitled === 1 ? "" : "s"} entitled to vote; ${t.needed} approvals make a majority. ${t.meeting_needed} request${t.meeting_needed === 1 ? "" : "s"} for a meeting would send it to the Board.</p>` : ""}</div>
    ${cr.status !== "draft" ? `<h2>E-mails</h2><div class="step">${emailBanner()}${emailLogHtml(cr.emails)}</div>` : ""}
    <p class="meta">${esc(META.board.circular_verify)}</p>`;
  const reload = () => screens.bcircular(id);
  const on = (sel, fn) => { const el = document.getElementById(sel); if (el) el.onclick = fn; };
  on("bc-edit", () => circularDialog(cr, reload));
  on("bc-del", async () => { if (confirm("Delete this draft?")) { await api(`/api/board/circulars/${cr.id}`, { method: "DELETE" }); go("board/circulars"); } });
  on("bc-send", async () => {
    if (!confirm("Circulate now? The text cannot be changed after this, and the directors will see it in the portal.")) return;
    try { const r = await api(`/api/board/circulars/${cr.id}/circulate`, { method: "POST" }); await reload(); if (r.email) flash(emailSummary(r.email)); }
    catch (e) { flash(e.message); }
  });
  on("bc-remind", async () => {
    try { const r = await api(`/api/board/circulars/${cr.id}/email`, { method: "POST" }); await reload(); flash(emailSummary(r)); } catch (e) { flash(e.message); }
  });
  app.querySelectorAll("[data-close]").forEach(b => b.onclick = async () => {
    if (!confirm(`Close this resolution as "${b.dataset.close}"? Directors can no longer reply.`)) return;
    try { await api(`/api/board/circulars/${cr.id}/close`, { method: "POST", body: JSON.stringify({ outcome: b.dataset.close }) }); reload(); }
    catch (e) { flash(e.message); }
  });
  on("bc-dec", () => regEdit("decisions", {}, () => flash("Added to Board decisions to follow up."), {
    meeting: "Resolution by circulation", meeting_date: (cr.closed_at || "").slice(0, 10), item: cr.title,
    decision: cr.resolution, status: "Open" }));
};

/* =================================================================== the Board portal */
let PORTAL = null;

screens.portal = async () => {
  app.innerHTML = `<p class="lead">Loading...</p>`;
  PORTAL = await api("/api/portal/home");
  const RSVP = PORTAL.spec.rsvp;
  const today = todayIso();
  const up = PORTAL.meetings.filter(m => m.meeting_date >= today && m.status !== "cancelled").reverse();
  const past = PORTAL.meetings.filter(m => !up.includes(m));
  const waiting = PORTAL.circulars.filter(c => c.status === "open" && !c.my_vote && !c.interested);
  const minutesWaiting = PORTAL.meetings.filter(m => m.minutes && m.minutes.reply_needed).length;
  const card = m => {
    const st = m.status === "held" ? ["done", "Held"] : m.status === "cancelled" ? ["untracked", "Cancelled"]
      : m.rsvp ? ["later", RSVP[m.rsvp]] : ["soon", "Please say if you will attend"];
    return `<div class="card ${st[0]}"><div><a class="title" href="#pmeeting/${m.id}">${esc(m.title)}</a>
      <div class="meta">${esc(m.body)} &middot; ${whenText(m)}${m.venue ? " &middot; " + esc(m.venue) : ""}</div>
      ${m.minutes && m.minutes.reply_needed ? `<div class="meta" style="color:var(--magenta)"><strong>Draft minutes waiting for your comments (by ${fmtDate(m.minutes.comments_by)})</strong></div>` : ""}
      ${m.minutes && m.minutes.stage === "signed" ? `<div class="meta">Signed minutes available</div>` : ""}
      <div class="meta">${m.papers} paper${m.papers === 1 ? "" : "s"}${m.unread ? ` &middot; <strong>${m.unread} not opened yet</strong>` : m.papers ? " &middot; all opened" : ""}${m.revised ? ` &middot; <span style="color:var(--magenta)">${m.revised} revised</span>` : ""}</div></div>
      <div class="due"><span class="pill ${st[0]}">${esc(st[1])}</span></div>
      <div class="actions"><a class="btn" href="#pmeeting/${m.id}">Open the papers</a></div></div>`;
  };
  const ccard = c => {
    const st = c.status === "closed" ? ["done", "Closed: " + c.outcome] : c.interested ? ["later", "For your information"]
      : c.my_vote ? ["later", "You replied: " + PORTAL.spec.votes[c.my_vote]] : ["soon", `Please reply by ${fmtDate(c.respond_by)}`];
    return `<div class="card ${st[0]}"><div><a class="title" href="#pcircular/${c.id}">${esc(c.title)}</a>
      <div class="meta">Sent ${fmtDate(c.circulated_at.slice(0, 10))}</div></div>
      <div class="due"><span class="pill ${st[0]}">${esc(st[1])}</span></div>
      <div class="actions"><a class="btn ${c.status === "open" && !c.my_vote && !c.interested ? "" : "light"}" href="#pcircular/${c.id}">Open</a></div></div>`;
  };
  const hour = new Date().getHours();
  app.innerHTML = `<div class="kicker">${esc(PORTAL.company.name || "")}</div>
    <h1>Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${esc(ME.full_name)}.</h1>
    <p class="lead">Your Board and committee papers. They are confidential: please do not forward or print copies for others.</p>
    ${waiting.length ? `<div class="banner warn"><strong>${waiting.length} resolution${waiting.length > 1 ? "s" : ""} by circulation waiting for your reply.</strong></div>` : ""}
    ${minutesWaiting ? `<div class="banner warn"><strong>Draft minutes of ${minutesWaiting} meeting${minutesWaiting > 1 ? "s" : ""} waiting for your comments.</strong> See Earlier meetings below.</div>` : ""}
    <h2>Coming meetings</h2><div class="cards">${up.length ? up.map(card).join("") : `<div class="banner info">No meetings have been published to you yet.</div>`}</div>
    ${PORTAL.circulars.length ? `<h2>Resolutions by circulation</h2><div class="cards">${PORTAL.circulars.map(ccard).join("")}</div>` : ""}
    ${past.length ? `<h2>Earlier meetings</h2><div class="cards">${past.map(card).join("")}</div>` : ""}
    <h2>My account</h2>
    <div class="step"><div class="inline"><div><label class="field">Current password</label><input type="password" id="pw-cur" autocomplete="current-password"></div>
      <div><label class="field">New password (8 or more characters)</label><input type="password" id="pw-new" autocomplete="new-password"></div>
      <div><button class="btn light" id="pw-save">Change my password</button></div></div>
      <p class="meta">Trouble signing in or opening a paper? Contact the Company Secretary${PORTAL.company.cs_name ? `, ${esc(PORTAL.company.cs_name)}` : ""}.</p></div>
    ${twoStepHtml()}`;
  wireTwoStep("portal");
  document.getElementById("pw-save").onclick = async () => {
    try {
      await api("/api/me/password", { method: "POST", body: JSON.stringify({ current: document.getElementById("pw-cur").value, new: document.getElementById("pw-new").value }) });
      document.getElementById("pw-cur").value = document.getElementById("pw-new").value = "";
      flash("Your password has been changed.");
    } catch (e) { flash(e.message); }
  };
};

screens.pmeeting = async (id) => {
  app.innerHTML = `<p class="lead">Loading...</p>`;
  if (!PORTAL) PORTAL = await api("/api/portal/home");
  let pm;
  try { pm = await api(`/api/portal/meetings/${id}`); }
  catch (e) { app.innerHTML = `<button class="btn light back" onclick="go('portal')">&larr; Back</button><div class="banner error">This meeting is not available to you.</div>`; return; }
  const m = pm.meeting, RSVP = PORTAL.spec.rsvp;
  const open = m.status === "published";
  app.innerHTML = `<button class="btn light back no-print" onclick="go('portal')">&larr; Back to my papers</button>
    <div class="kicker">${esc(m.body)}</div>
    <h1>${esc(m.title)}</h1>
    <p class="lead">${whenText(m)} &middot; ${esc(m.mode || "")}${m.venue ? " &middot; " + esc(m.venue) : ""}</p>
    ${m.status === "cancelled" ? `<div class="banner error"><strong>This meeting has been cancelled.</strong></div>` : ""}
    <div class="btn-row">
      <a class="btn" href="/api/portal/meetings/${m.id}/pack" target="_blank" rel="noopener">Open the whole pack (one PDF)</a>
      ${m.video_link && open ? `<a class="btn light" href="${esc(m.video_link)}" target="_blank" rel="noopener">Join the video conference</a>` : ""}
    </div>
    ${open ? `<div class="step"><div class="label">Will you attend?</div>
      <div class="choices" id="rsvp">${Object.entries(RSVP).map(([k, l]) => `<label class="choice ${pm.rsvp && pm.rsvp.response === k ? "selected" : ""}"><input type="radio" name="rsvp" value="${k}" ${pm.rsvp && pm.rsvp.response === k ? "checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div>
      <label class="field">Message to the Company Secretary (optional)</label><input type="text" id="rsvp-note" value="${esc(pm.rsvp ? pm.rsvp.note || "" : "")}" placeholder="e.g. I will join from Delhi">
      <div class="btn-row"><button class="btn" id="rsvp-save">Send my reply</button><span class="meta" id="rsvp-msg">${pm.rsvp ? "Reply sent on " + esc(pm.rsvp.at.replace("T", " ").slice(0, 16)) : ""}</span></div></div>` : ""}
    ${portalMinutesHtml(m, pm.minutes)}
    <h2>Agenda</h2>
    <div class="cards">${pm.items.map((it, n) => `<div class="card ${it.revised ? "overdue" : it.read || !it.paper_name ? "later" : "soon"}">
      <div><div class="title">${n + 1}. ${esc(it.title)}</div>
        <div class="meta">${esc(it.kind || "")}${it.presenter ? " &middot; presented by " + esc(it.presenter) : ""}</div>
        ${it.summary ? `<div class="md" style="font-size:0.95rem">${md(it.summary)}</div>` : ""}
        ${it.resolution ? `<details><summary>Draft resolution</summary><div class="md">${md(it.resolution)}</div></details>` : ""}</div>
      <div class="due">${it.revised ? `<span class="pill overdue">Revised</span>` : it.paper_name ? (it.read ? `<span class="pill later">Opened</span>` : `<span class="pill soon">Not opened</span>`) : ""}</div>
      <div class="actions">${it.paper_name ? `${it.paper_mime === "application/pdf" ? `<a class="btn" href="#pview/${it.id}">Read and highlight</a>` : ""}
        <a class="btn ${it.paper_mime === "application/pdf" ? "light" : ""}" href="/api/portal/items/${it.id}/paper" target="_blank" rel="noopener" data-open="${it.id}">${it.paper_mime === "application/pdf" ? "Open in a new tab" : "Open the paper"}</a>
        <span class="meta" style="align-self:center">${esc(it.paper_name)}${fileSizeText(it.paper_size)}</span>` : ""}</div>
      <details ${it.note ? "open" : ""}><summary>My private notes${it.note ? "" : " (only you can see them)"}</summary>
        <textarea data-note="${it.id}" placeholder="Questions to ask, points to raise...">${esc(it.note)}</textarea>
        <div class="btn-row"><button class="btn light" data-savenote="${it.id}">Save my notes</button><span class="meta" data-notemsg="${it.id}"></span></div></details>
    </div>`).join("")}</div>`;
  app.querySelectorAll("#rsvp input").forEach(i => i.onchange = () => app.querySelectorAll("#rsvp .choice").forEach(c => c.classList.toggle("selected", c.querySelector("input").checked)));
  const save = document.getElementById("rsvp-save");
  if (save) save.onclick = async () => {
    const r = app.querySelector("input[name=rsvp]:checked");
    if (!r) return flash("Please choose one of the answers.");
    try {
      await api(`/api/portal/meetings/${m.id}/rsvp`, { method: "POST", body: JSON.stringify({ response: r.value, note: document.getElementById("rsvp-note").value }) });
      document.getElementById("rsvp-msg").textContent = "Thank you. Your reply has been sent.";
    } catch (e) { flash(e.message); }
  };
  app.querySelectorAll("[data-open]").forEach(a => a.addEventListener("click", () => {
    const card = a.closest(".card");
    const pill = card.querySelector(".due .pill");
    if (pill && !pill.classList.contains("overdue")) { pill.className = "pill later"; pill.textContent = "Opened"; }
  }));
  const minSend = async (kind) => {
    try {
      await api(`/api/portal/meetings/${m.id}/minutes/comment`, { method: "POST", body: JSON.stringify({ kind, text: kind === "comment" ? document.getElementById("pmin-text").value : "" }) });
      flash("Thank you. Your reply has been sent to the Company Secretary."); screens.pmeeting(id);
    } catch (e) { flash(e.message); }
  };
  if (document.getElementById("pmin-send")) {
    document.getElementById("pmin-send").onclick = () => minSend("comment");
    document.getElementById("pmin-none").onclick = () => minSend("no_comments");
  }
  app.querySelectorAll("[data-savenote]").forEach(b => b.onclick = async () => {
    const iid = b.dataset.savenote;
    try {
      await api(`/api/portal/items/${iid}/note`, { method: "POST", body: JSON.stringify({ text: app.querySelector(`[data-note="${iid}"]`).value }) });
      app.querySelector(`[data-notemsg="${iid}"]`).textContent = "Saved.";
    } catch (e) { flash(e.message); }
  });
};

function portalMinutesHtml(m, mn) {
  if (!mn) return "";
  if (mn.stage === "signed") {
    return `<div class="step"><div class="label">Minutes</div>
      <p style="margin-top:0.3rem">Signed by ${esc(mn.signed_by)} on ${fmtDate(mn.signed_on)}.</p>
      <div class="btn-row"><a class="btn" href="/api/portal/meetings/${m.id}/minutes/file?which=signed" target="_blank" rel="noopener">Open the signed minutes</a></div></div>`;
  }
  const r = mn.my_reply;
  return `<div class="step" id="pmin"><div class="label">Draft minutes for your comments</div>
    <p style="margin-top:0.3rem">Please read the draft and reply by <strong>${fmtDate(mn.comments_by)}</strong>.</p>
    <div class="btn-row"><a class="btn" href="/api/portal/meetings/${m.id}/minutes/file?which=draft" target="_blank" rel="noopener">Open the draft minutes</a></div>
    ${r ? `<div class="banner info">You replied ${r.kind === "no_comments" ? "<strong>No comments</strong>" : "with comments"} on ${esc(r.at.replace("T", " ").slice(0, 16))}. You can send another reply below.</div>` : ""}
    <label class="field" for="pmin-text">Your comments on the draft</label>
    <textarea id="pmin-text" placeholder="e.g. Item 4: please record that I asked for the receivables ageing to be placed at the next meeting."></textarea>
    <div class="btn-row"><button class="btn" id="pmin-send">Send my comments</button><button class="btn light" id="pmin-none">I have no comments</button></div></div>`;
}

screens.pcircular = async (id) => {
  app.innerHTML = `<p class="lead">Loading...</p>`;
  if (!PORTAL) PORTAL = await api("/api/portal/home");
  let c;
  try { c = await api(`/api/portal/circulars/${id}`); }
  catch (e) { app.innerHTML = `<button class="btn light back" onclick="go('portal')">&larr; Back</button><div class="banner error">This resolution is not available to you.</div>`; return; }
  const V = PORTAL.spec.votes;
  const canVote = c.status === "open";
  const options = Object.entries(V).filter(([k]) => !c.interested || k === "meeting");
  app.innerHTML = `<button class="btn light back no-print" onclick="go('portal')">&larr; Back to my papers</button>
    <div class="kicker">Resolution by circulation</div>
    <h1>${esc(c.title)}</h1>
    <p class="lead">Sent ${fmtDate(c.circulated_at.slice(0, 10))}${c.respond_by ? ` &middot; please reply by <strong>${fmtDate(c.respond_by)}</strong>` : ""}</p>
    ${c.status === "closed" ? `<div class="banner info"><strong>Closed: ${esc(c.outcome)}.</strong> ${esc(c.result || "")}</div>` : ""}
    ${c.interested ? `<div class="banner warn">You are recorded as interested in this matter, so it is sent to you for information and you do not vote on it. You can still ask for it to be decided at a Board meeting.</div>` : ""}
    <div class="step"><div class="label">Resolution</div><div class="md">${md(c.resolution)}</div>
      ${c.explanation ? `<div class="label" style="margin-top:1rem">Explanatory note</div><div class="md">${md(c.explanation)}</div>` : ""}
      ${c.paper_name ? `<div class="btn-row"><a class="btn light" href="/api/portal/circulars/${c.id}/paper" target="_blank" rel="noopener">Open the supporting paper</a></div>` : ""}</div>
    ${canVote ? `<div class="step"><div class="label">Your reply</div>
      <div class="choices" id="vote">${options.map(([k, l]) => `<label class="choice ${c.my_vote && c.my_vote.vote === k ? "selected" : ""}"><input type="radio" name="vote" value="${k}" ${c.my_vote && c.my_vote.vote === k ? "checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div>
      <label class="field">Comment (optional)</label><textarea id="vote-comment">${esc(c.my_vote ? c.my_vote.comment || "" : "")}</textarea>
      <div class="btn-row"><button class="btn big" id="vote-save">${c.my_vote ? "Change my reply" : "Send my reply"}</button>
        <span class="meta" id="vote-msg">${c.my_vote ? "You replied on " + esc(c.my_vote.at.replace("T", " ").slice(0, 16)) + ". You can change it until it closes." : ""}</span></div>
      <p class="meta">Your reply is recorded with your name and the time, as your signed approval or dissent under Sec. 175.</p></div>`
      : c.my_vote ? `<div class="banner info">You replied: <strong>${esc(V[c.my_vote.vote])}</strong> on ${esc(c.my_vote.at.replace("T", " ").slice(0, 16))}.</div>` : ""}`;
  app.querySelectorAll("#vote input").forEach(i => i.onchange = () => app.querySelectorAll("#vote .choice").forEach(x => x.classList.toggle("selected", x.querySelector("input").checked)));
  const save = document.getElementById("vote-save");
  if (save) save.onclick = async () => {
    const r = app.querySelector("input[name=vote]:checked");
    if (!r) return flash("Please choose your reply.");
    if (!confirm(`Send this reply: "${V[r.value]}"?`)) return;
    try {
      await api(`/api/portal/circulars/${c.id}/vote`, { method: "POST", body: JSON.stringify({ vote: r.value, comment: document.getElementById("vote-comment").value }) });
      PORTAL = null; screens.pcircular(id);
    } catch (e) { flash(e.message); }
  };
};

/* ----------------------------------------------------------- the paper viewer
 * Renders a PDF paper page by page with pdf.js (kept in static/vendor/pdfjs) and lets the director
 * draw highlight boxes with comments. Highlights are private to the director and stored as fractions
 * of the page, so they stay in place at any zoom.
 */
let PDFJS = null;
async function loadPdfJs() {
  if (!PDFJS) {
    PDFJS = await import("/static/vendor/pdfjs/pdf.min.mjs");
    PDFJS.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/pdf.worker.min.mjs";
  }
  return PDFJS;
}
const MARK_FILL = { magenta: "rgba(181, 23, 90, 0.22)", navy: "rgba(0, 30, 95, 0.18)" };
const MARK_EDGE = { magenta: "#B5175A", navy: "#001E5F" };

screens.pview = async (id) => {
  app.innerHTML = `<p class="lead">Opening the paper...</p>`;
  let info;
  try { info = await api(`/api/portal/items/${id}`); }
  catch (e) { app.innerHTML = `<button class="btn light back" onclick="go('portal')">&larr; Back</button><div class="banner error">This paper is not available to you.</div>`; return; }
  const it = info.item, paperUrl = `/api/portal/items/${it.id}/paper`;
  if (it.paper_mime !== "application/pdf") { location.href = paperUrl + "?download=1"; go(`pmeeting/${info.meeting.id}`); return; }
  let marks = info.marks, scale = Math.min(1.6, Math.max(0.6, (Math.min(window.innerWidth, 1100) - 60) / 612)), drawing = false;

  app.innerHTML = `<div class="viewer-bar no-print">
      <button class="btn light" id="pv-back">&larr; Back to the agenda</button>
      <div class="viewer-title"><div class="kicker">${esc(info.meeting.title)}</div><strong>${esc(it.title)}</strong>${it.revised ? ` <span class="pill overdue">Revised</span>` : ""}</div>
      <div class="viewer-tools">
        <button class="btn light" id="pv-out" title="Smaller" aria-label="Zoom out">&minus;</button>
        <button class="btn light" id="pv-in" title="Bigger" aria-label="Zoom in">+</button>
        <button class="btn" id="pv-mark" aria-pressed="false">Highlight</button>
        <button class="btn light" id="pv-list">My highlights (<span id="pv-count">0</span>)</button>
        <a class="btn light" href="${paperUrl}?download=1">Download</a>
      </div></div>
    <p class="meta no-print" id="pv-help">Press <strong>Highlight</strong>, then drag across the part of the page you want to mark. You can add a comment. Only you can see your highlights.</p>
    <div class="viewer-wrap"><div id="pv-pages" class="viewer-pages"><p class="lead">Loading pages...</p></div>
      <aside id="pv-side" class="viewer-side" hidden></aside></div>`;
  document.getElementById("pv-back").onclick = () => go(`pmeeting/${info.meeting.id}`);

  let pdf;
  try {
    const lib = await loadPdfJs();
    pdf = await lib.getDocument({ url: paperUrl, withCredentials: true, isEvalSupported: false }).promise;
  } catch (e) {
    document.getElementById("pv-pages").innerHTML = `<div class="banner error">This PDF could not be shown here. <a href="${paperUrl}" target="_blank" rel="noopener">Open it in a new tab</a> instead.</div>`;
    return;
  }
  const pagesBox = document.getElementById("pv-pages");
  const pageEls = [];
  const rendered = new Map();   // page number -> scale it was drawn at

  async function renderPage(n) {
    const holder = pageEls[n - 1];
    if (rendered.get(n) === scale) return;
    rendered.set(n, scale);
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale });
    const ratio = window.devicePixelRatio || 1;
    const canvas = holder.querySelector("canvas");
    canvas.width = Math.floor(vp.width * ratio); canvas.height = Math.floor(vp.height * ratio);
    canvas.style.width = vp.width + "px"; canvas.style.height = vp.height + "px";
    holder.style.width = vp.width + "px"; holder.style.height = vp.height + "px";
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null }).promise;
  }
  async function layout() {
    const first = await pdf.getPage(1);
    const base = first.getViewport({ scale });
    pagesBox.innerHTML = "";
    pageEls.length = 0; rendered.clear();
    for (let n = 1; n <= pdf.numPages; n++) {
      const el = h(`<div class="viewer-page" data-page="${n}" style="width:${base.width}px;height:${base.height}px">
        <canvas></canvas><div class="viewer-overlay"></div><div class="viewer-pno">${n} / ${pdf.numPages}</div></div>`);
      pagesBox.appendChild(el); pageEls.push(el);
      wireOverlay(el.querySelector(".viewer-overlay"), n);
    }
    observer.disconnect();
    pageEls.forEach(el => observer.observe(el));
    drawMarks();
  }
  const observer = new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) renderPage(Number(en.target.dataset.page)).catch(() => {});
  }), { rootMargin: "600px 0px" });

  function drawMarks() {
    pageEls.forEach(el => el.querySelectorAll(".viewer-mark").forEach(m => m.remove()));
    const current = marks.filter(m => m.current);
    current.forEach(m => {
      const el = pageEls[m.page - 1];
      if (!el) return;
      const box = h(`<div class="viewer-mark" data-mark="${m.id}" title="${esc(m.text || "Highlight")}"
        style="left:${m.x * 100}%;top:${m.y * 100}%;width:${m.w * 100}%;height:${m.h * 100}%;background:${MARK_FILL[m.colour]};border-color:${MARK_EDGE[m.colour]}">
        ${m.text ? `<span class="viewer-mark-dot" style="background:${MARK_EDGE[m.colour]}">&#8230;</span>` : ""}</div>`);
      box.onclick = (e) => { if (drawing) return; e.stopPropagation(); editMark(m); };
      el.querySelector(".viewer-overlay").appendChild(box);
    });
    document.getElementById("pv-count").textContent = marks.length;
    if (!document.getElementById("pv-side").hidden) drawSide();
  }

  function wireOverlay(ov, n) {
    let start = null, ghost = null;
    const pos = (e) => { const r = ov.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
    ov.addEventListener("pointerdown", e => {
      if (!drawing) return;
      e.preventDefault(); ov.setPointerCapture(e.pointerId);
      start = pos(e);
      ghost = h(`<div class="viewer-mark ghost"></div>`); ov.appendChild(ghost);
    });
    ov.addEventListener("pointermove", e => {
      if (!start) return;
      const p = pos(e);
      Object.assign(ghost.style, { left: Math.min(start.x, p.x) * 100 + "%", top: Math.min(start.y, p.y) * 100 + "%",
        width: Math.abs(p.x - start.x) * 100 + "%", height: Math.abs(p.y - start.y) * 100 + "%" });
    });
    const finish = async (e) => {
      if (!start) return;
      const p = pos(e), s0 = start; start = null; ghost.remove();
      const box = { page: n, x: Math.min(s0.x, p.x), y: Math.min(s0.y, p.y), w: Math.abs(p.x - s0.x), h: Math.abs(p.y - s0.y) };
      if (box.w < 0.01 || box.h < 0.005) return;   // a tap, not a drag
      newMark(box);
    };
    ov.addEventListener("pointerup", finish);
    ov.addEventListener("pointercancel", () => { start = null; if (ghost) ghost.remove(); });
  }

  function markDialog(title, m, onSave, onDelete) {
    const d = document.getElementById("dlg");
    d.innerHTML = `<h2 style="margin-top:0">${title}</h2>
      <label class="field">Comment (optional, only you can see it)</label><textarea id="mk-text" placeholder="e.g. Ask the CFO why receivables over 180 days went up">${esc(m.text || "")}</textarea>
      <label class="field">Colour</label><div class="choices">${Object.keys(MARK_FILL).map(c => `<label class="choice ${(m.colour || "magenta") === c ? "selected" : ""}">
        <input type="radio" name="mk-col" value="${c}" ${(m.colour || "magenta") === c ? "checked" : ""}><span><span class="swatch" style="background:${MARK_FILL[c]};border-color:${MARK_EDGE[c]}"></span>${c === "magenta" ? "Magenta" : "Navy"}</span></label>`).join("")}</div>
      <div class="btn-row"><button class="btn" id="mk-save">Save</button><button class="btn light" id="mk-cancel">Cancel</button>
        ${onDelete ? `<button class="btn danger" id="mk-del">Delete highlight</button>` : ""}</div>`;
    d.showModal();
    d.querySelectorAll("input[name=mk-col]").forEach(i => i.onchange = () => d.querySelectorAll(".choice").forEach(c => c.classList.toggle("selected", c.querySelector("input").checked)));
    d.querySelector("#mk-cancel").onclick = () => d.close();
    d.querySelector("#mk-save").onclick = async () => {
      try { await onSave({ text: d.querySelector("#mk-text").value, colour: d.querySelector("input[name=mk-col]:checked").value }); d.close(); }
      catch (e) { flash(e.message); }
    };
    if (onDelete) d.querySelector("#mk-del").onclick = async () => { try { await onDelete(); d.close(); } catch (e) { flash(e.message); } };
    d.querySelector("#mk-text").focus();
  }
  async function reloadMarks() { marks = (await api(`/api/portal/items/${it.id}`)).marks; drawMarks(); }
  function newMark(box) {
    markDialog("Add a highlight", {}, async (v) => {
      await api(`/api/portal/items/${it.id}/marks`, { method: "POST", body: JSON.stringify({ ...box, ...v }) });
      await reloadMarks();
    });
  }
  function editMark(m) {
    markDialog(`Highlight on page ${m.page}`, m,
      async (v) => { await api(`/api/portal/marks/${m.id}`, { method: "POST", body: JSON.stringify(v) }); await reloadMarks(); },
      async () => { await api(`/api/portal/marks/${m.id}`, { method: "DELETE" }); await reloadMarks(); });
  }
  function drawSide() {
    const side = document.getElementById("pv-side");
    const cur = marks.filter(m => m.current), old = marks.filter(m => !m.current);
    side.innerHTML = `<div class="label">My highlights</div>
      ${cur.length ? cur.map(m => `<button class="viewer-side-item" data-go="${m.id}"><span class="swatch" style="background:${MARK_FILL[m.colour]};border-color:${MARK_EDGE[m.colour]}"></span>
        <span><strong>Page ${m.page}</strong><br>${m.text ? esc(m.text) : `<span class="meta">No comment</span>`}</span></button>`).join("") : `<p class="meta">None yet.</p>`}
      ${old.length ? `<div class="label" style="margin-top:1rem">On an earlier version of this paper</div><p class="meta">The paper was replaced after you made these, so they are not drawn on the pages.</p>
        ${old.map(m => `<div class="viewer-side-item old"><span><strong>Page ${m.page}</strong><br>${m.text ? esc(m.text) : `<span class="meta">No comment</span>`}</span>
          <button class="btn light" data-delold="${m.id}">Delete</button></div>`).join("")}` : ""}`;
    side.querySelectorAll("[data-go]").forEach(b => b.onclick = () => {
      const el = pagesBox.querySelector(`[data-mark="${b.dataset.go}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    side.querySelectorAll("[data-delold]").forEach(b => b.onclick = async () => { await api(`/api/portal/marks/${b.dataset.delold}`, { method: "DELETE" }); await reloadMarks(); });
  }

  const markBtn = document.getElementById("pv-mark");
  markBtn.onclick = () => {
    drawing = !drawing;
    markBtn.setAttribute("aria-pressed", drawing);
    markBtn.textContent = drawing ? "Done highlighting" : "Highlight";
    pagesBox.classList.toggle("drawing", drawing);
  };
  document.getElementById("pv-list").onclick = () => {
    const side = document.getElementById("pv-side");
    side.hidden = !side.hidden;
    if (!side.hidden) drawSide();
  };
  const zoom = async (f) => {
    const keep = window.scrollY / Math.max(1, document.body.scrollHeight);
    scale = Math.min(3, Math.max(0.5, scale * f));
    await layout();
    window.scrollTo(0, keep * document.body.scrollHeight);
  };
  document.getElementById("pv-in").onclick = () => zoom(1.2);
  document.getElementById("pv-out").onclick = () => zoom(1 / 1.2);
  await layout();
};
