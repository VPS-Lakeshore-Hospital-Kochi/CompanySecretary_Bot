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
      ${ov.people.map(p => `<tr><td>${esc(p.name)}</td>
        <td>${p.rsvp ? esc(RSVP[p.rsvp.response]) + (p.rsvp.note ? `<div class="meta">${esc(p.rsvp.note)}</div>` : "") : `<span class="meta">No reply yet</span>`}</td>
        <td>${p.papers ? `${p.opened} of ${p.papers}` : "-"}</td></tr>`).join("")}</tbody></table>
      <p class="meta">${ov.attending} of ${ov.people.length} have said they will attend. Check the quorum under Sec. 174 and the Articles (one-third of the directors or two, whichever is more).</p>`
      : `<p>No one is invited yet. Press <strong>Change details</strong> and tick the directors.</p>`}</div>
    ${m.notes ? `<h2>Secretariat notes</h2><div class="step">${esc(m.notes)}</div>` : ""}`;

  const reload = () => screens.bmeeting(id);
  const setStatus = async (status) => {
    if (status === "cancelled" && !confirm("Mark this meeting as cancelled? Directors will still see it, marked cancelled.")) return;
    try { await api(`/api/board/meetings/${m.id}/status`, { method: "POST", body: JSON.stringify({ status }) }); reload(); }
    catch (e) { flash(e.message); }
  };
  document.getElementById("bm-edit").onclick = () => meetingDialog(m, people, reload);
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
        <button class="btn light" data-close="withdrawn">Withdraw</button>` : ""}
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
    <p class="meta">${esc(META.board.circular_verify)}</p>`;
  const reload = () => screens.bcircular(id);
  const on = (sel, fn) => { const el = document.getElementById(sel); if (el) el.onclick = fn; };
  on("bc-edit", () => circularDialog(cr, reload));
  on("bc-del", async () => { if (confirm("Delete this draft?")) { await api(`/api/board/circulars/${cr.id}`, { method: "DELETE" }); go("board/circulars"); } });
  on("bc-send", async () => {
    if (!confirm("Circulate now? The text cannot be changed after this, and the directors will see it in the portal.")) return;
    try { await api(`/api/board/circulars/${cr.id}/circulate`, { method: "POST" }); reload(); } catch (e) { flash(e.message); }
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
  const card = m => {
    const st = m.status === "held" ? ["done", "Held"] : m.status === "cancelled" ? ["untracked", "Cancelled"]
      : m.rsvp ? ["later", RSVP[m.rsvp]] : ["soon", "Please say if you will attend"];
    return `<div class="card ${st[0]}"><div><a class="title" href="#pmeeting/${m.id}">${esc(m.title)}</a>
      <div class="meta">${esc(m.body)} &middot; ${whenText(m)}${m.venue ? " &middot; " + esc(m.venue) : ""}</div>
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
    <h2>Coming meetings</h2><div class="cards">${up.length ? up.map(card).join("") : `<div class="banner info">No meetings have been published to you yet.</div>`}</div>
    ${PORTAL.circulars.length ? `<h2>Resolutions by circulation</h2><div class="cards">${PORTAL.circulars.map(ccard).join("")}</div>` : ""}
    ${past.length ? `<h2>Earlier meetings</h2><div class="cards">${past.map(card).join("")}</div>` : ""}
    <h2>My account</h2>
    <div class="step"><div class="inline"><div><label class="field">Current password</label><input type="password" id="pw-cur" autocomplete="current-password"></div>
      <div><label class="field">New password (8 or more characters)</label><input type="password" id="pw-new" autocomplete="new-password"></div>
      <div><button class="btn light" id="pw-save">Change my password</button></div></div>
      <p class="meta">Trouble signing in or opening a paper? Contact the Company Secretary${PORTAL.company.cs_name ? `, ${esc(PORTAL.company.cs_name)}` : ""}.</p></div>`;
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
    <h2>Agenda</h2>
    <div class="cards">${pm.items.map((it, n) => `<div class="card ${it.revised ? "overdue" : it.read || !it.paper_name ? "later" : "soon"}">
      <div><div class="title">${n + 1}. ${esc(it.title)}</div>
        <div class="meta">${esc(it.kind || "")}${it.presenter ? " &middot; presented by " + esc(it.presenter) : ""}</div>
        ${it.summary ? `<div class="md" style="font-size:0.95rem">${md(it.summary)}</div>` : ""}
        ${it.resolution ? `<details><summary>Draft resolution</summary><div class="md">${md(it.resolution)}</div></details>` : ""}</div>
      <div class="due">${it.revised ? `<span class="pill overdue">Revised</span>` : it.paper_name ? (it.read ? `<span class="pill later">Opened</span>` : `<span class="pill soon">Not opened</span>`) : ""}</div>
      <div class="actions">${it.paper_name ? `<a class="btn" href="/api/portal/items/${it.id}/paper" target="_blank" rel="noopener" data-open="${it.id}">Open the paper</a>
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
  app.querySelectorAll("[data-savenote]").forEach(b => b.onclick = async () => {
    const iid = b.dataset.savenote;
    try {
      await api(`/api/portal/items/${iid}/note`, { method: "POST", body: JSON.stringify({ text: app.querySelector(`[data-note="${iid}"]`).value }) });
      app.querySelector(`[data-notemsg="${iid}"]`).textContent = "Saved.";
    } catch (e) { flash(e.message); }
  });
};

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
