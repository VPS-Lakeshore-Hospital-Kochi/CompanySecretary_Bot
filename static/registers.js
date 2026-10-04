/* Shared by the self-hosted site (static/app.js) and the claude.ai artifact (artifact/src/app.js).
 *
 * The registers (committees, transplant files, Board decisions, records requests) and the
 * "Can we share this?" answer. Field lists and legal content come from cs_assistant/registers.py
 * and cs_assistant/records.py. Each front end draws its own cards and dialogs; this file
 * gives them the statuses, the form fields and the answer panel, so both behave the same.
 *
 * Uses the page's own esc() and fmtDate().
 */
"use strict";

const REG_PAD = (n) => String(n).padStart(2, "0");
function regDays(isoDate) {
  const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 86400000);
}
function regAddDays(isoDate, n) {
  const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
  const x = new Date(y, m - 1, d + Number(n));
  return `${x.getFullYear()}-${REG_PAD(x.getMonth() + 1)}-${REG_PAD(x.getDate())}`;
}
/** [code, label] for a due date, using the calendar's codes (overdue / today / soon / upcoming / later). */
function regDue(isoDate, what = "Due") {
  const days = regDays(isoDate);
  if (days < 0) return ["overdue", `${what} ${-days} day${days === -1 ? "" : "s"} ago`];
  if (days === 0) return ["today", `${what} today`];
  if (days <= 15) return ["soon", `${what} in ${days} day${days === 1 ? "" : "s"}`];
  if (days <= 45) return ["upcoming", `${what} in ${days} days`];
  return ["later", `${what} on ${fmtDate(isoDate)}`];
}
const REG_RANK = { overdue: 0, today: 1, soon: 2, upcoming: 3, unknown: 4, later: 5, done: 6 };
const regWorse = (a, b) => (REG_RANK[a[0]] <= REG_RANK[b[0]] ? a : b);

/** Items of the transplant checklist that apply to a donor relation. */
function transplantItems(checklist, relation) {
  return checklist.filter(([, , rel]) => rel === "all" || rel === relation).map(([id, text]) => ({ id, text }));
}

/** Status of one register row: [code, label]. `ctx.checklist` is the transplant checklist. */
function regStatus(kind, r, ctx) {
  if (kind === "committees") {
    let st = ["later", "Meets when needed"];
    if (r.every_days) {
      if (!r.last_meeting) st = ["unknown", "Enter the date of the last meeting"];
      else {
        const next = regAddDays(r.last_meeting, r.every_days);
        st = regDue(next, "Next meeting due");
        if (st[0] === "later") st = ["later", `Next meeting by ${fmtDate(next)}`];
      }
    }
    if (r.valid_until) {
      const days = regDays(r.valid_until);
      if (days <= 90) st = regWorse(regDue(r.valid_until, days < 0 ? "Reconstitution / renewal was due" : "Reconstitution / renewal due"), st);
    }
    return st;
  }
  if (kind === "decisions") {
    if (r.status === "Done") return ["done", "Done"];
    if (r.status === "Dropped") return ["done", "Dropped"];
    if (!r.due) return ["unknown", r.status === "In progress" ? "In progress - no due date" : "Open - no due date"];
    return regDue(r.due);
  }
  if (kind === "requests") {
    if (r.outcome && r.outcome !== "Pending") return ["done", r.outcome + (r.closed_on ? ` on ${fmtDate(r.closed_on)}` : "")];
    if (!r.reply_by) return ["unknown", "Pending - enter the reply date"];
    return regDue(r.reply_by, "Reply due");
  }
  if (kind === "transplant") {
    const items = transplantItems(ctx.checklist, r.relation);
    const checks = r.checks || {};
    const open = items.filter((i) => !checks[i.id]);
    const AFTER = ["decision", "display", "intimate", "appeal"];
    const before = open.filter((i) => !AFTER.includes(i.id));
    const beforeTotal = items.filter((i) => !AFTER.includes(i.id)).length;
    if (r.decision === "Approved" || r.decision === "Not approved") {
      const after = open.filter((i) => ["decision", "display", "intimate"].includes(i.id) || (i.id === "appeal" && r.decision === "Not approved"));
      if (after.length) return ["soon", `${r.decision}: ${after.length} step${after.length > 1 ? "s" : ""} after the decision still to do`];
      return ["done", `${r.decision}${r.decided_on ? " on " + fmtDate(r.decided_on) : ""}`];
    }
    if (!r.relation) return ["unknown", "Choose who the donor is to see the document list"];
    if (before.length) {
      const meet = r.meeting_on && regDays(r.meeting_on) >= 0 && regDays(r.meeting_on) <= 7;
      return [meet ? "overdue" : "upcoming", `${before.length} of ${beforeTotal} documents / steps before the meeting outstanding${meet ? " - meeting is close" : ""}`];
    }
    return ["soon", r.meeting_on ? `Ready for the meeting on ${fmtDate(r.meeting_on)}` : "File complete - fix the committee meeting"];
  }
  return ["later", ""];
}

/** One-line summary under the card title. */
function regMeta(kind, r, ctx) {
  const opt = (field, v) => { const o = (field.options || []).find((x) => x[0] === v); return o ? o[1] : v; };
  const f = (k) => ctx.spec[kind].fields.find((x) => x.key === k);
  const bits = {
    committees: [r.kind, r.basis, r.last_meeting ? `last met ${fmtDate(r.last_meeting)}` : "", r.every_days ? `meets at least every ${r.every_days} days` : ""],
    decisions: [r.meeting, r.meeting_date ? fmtDate(r.meeting_date) : "", r.owner ? `Action: ${r.owner}` : "", r.filing],
    requests: [r.requester ? opt(f("requester"), r.requester) : "", r.record ? opt(f("record"), r.record) : "", r.received_on ? `received ${fmtDate(r.received_on)}` : ""],
    transplant: [r.organ, r.relation ? opt(f("relation"), r.relation).replace(/ \(.*\)$/, "") : "", r.received_on ? `received ${fmtDate(r.received_on)}` : "", r.coordinator ? `coordinator ${r.coordinator}` : ""],
  }[kind] || [];
  return bits.filter(Boolean).map((b) => esc(b)).join(" &middot; ");
}

function regTitle(kind, r) {
  return { committees: r.name, decisions: r.item, requests: r.requester_name, transplant: `File ${r.case_ref}` }[kind] || "";
}

/** Sort rows: most urgent first. */
function regSort(kind, rows, ctx) {
  return rows.map((r) => ({ r, st: regStatus(kind, r, ctx) }))
    .sort((a, b) => REG_RANK[a.st[0]] - REG_RANK[b.st[0]] || String(regTitle(kind, a.r)).localeCompare(String(regTitle(kind, b.r))));
}

function regChecklistHtml(ctx, relation, checks) {
  const items = transplantItems(ctx.checklist, relation);
  if (!relation) return `<p class="meta">Choose who the donor is (above) to see the documents this file needs.</p>`;
  return `<ul class="checklist">${items.map((i) => `<li class="${checks[i.id] ? "ticked" : ""}"><input type="checkbox" id="rc-${i.id}" data-check="${i.id}" ${checks[i.id] ? "checked" : ""}><label for="rc-${i.id}">${esc(i.text)}</label></li>`).join("")}</ul>`;
}

/** The form fields for a row (inside a dialog). */
function regFormHtml(kind, r, ctx) {
  const spec = ctx.spec[kind];
  return spec.fields.map((f) => {
    const id = `rf-${f.key}`, v = r[f.key];
    const lab = `<label class="field" for="${id}">${esc(f.label)}</label>`;
    if (f.kind === "textarea") return lab + `<textarea id="${id}" data-k="${f.key}">${esc(v || "")}</textarea>`;
    if (f.kind === "date") return lab + `<input type="date" id="${id}" data-k="${f.key}" value="${esc(v || "")}">`;
    if (f.kind === "number") return lab + `<input type="number" min="1" id="${id}" data-k="${f.key}" value="${esc(v ?? "")}">`;
    if (f.kind === "select") return lab + `<select id="${id}" data-k="${f.key}"><option value="">-</option>${f.options.map(([val, l]) => `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    if (f.kind === "checklist") return `<div class="field" style="margin-top:1rem;font-weight:500">${esc(f.label)}</div><div id="rf-checks">${regChecklistHtml(ctx, r.relation, r[f.key] || {})}</div>`;
    return lab + `<input type="text" id="${id}" data-k="${f.key}" value="${esc(v || "")}">`;
  }).join("");
}

/** Wire the form: re-draw the transplant checklist when the donor relation changes. */
function regWireForm(kind, root, ctx) {
  const tick = () => root.querySelectorAll("#rf-checks input").forEach((c) => { c.onchange = () => c.closest("li").classList.toggle("ticked", c.checked); });
  tick();
  const rel = root.querySelector("#rf-relation");
  if (kind === "transplant" && rel) rel.onchange = () => {
    root.querySelector("#rf-checks").innerHTML = regChecklistHtml(ctx, rel.value, regReadChecks(root));
    tick();
  };
}
function regReadChecks(root) {
  const out = {};
  root.querySelectorAll("#rf-checks [data-check]").forEach((c) => { if (c.checked) out[c.dataset.check] = true; });
  return out;
}

/** Read the form back into a plain object (the server checks it again). */
function regReadForm(kind, root, ctx) {
  const spec = ctx.spec[kind];
  const out = {};
  for (const f of spec.fields) {
    if (f.kind === "checklist") { out[f.key] = regReadChecks(root); continue; }
    const el = root.querySelector(`[data-k="${f.key}"]`);
    const v = el ? el.value.trim() : "";
    out[f.key] = f.kind === "number" ? (v ? parseInt(v, 10) || null : null) : v;
  }
  const missing = !out[spec.required];
  return { data: out, missing: missing ? spec.fields.find((f) => f.key === spec.required).label : "" };
}

/** Text for the Action Taken Report draft, from the decisions register. */
function atrText(rows) {
  const keep = rows.filter((r) => r.status !== "Dropped");
  return keep.map((r, n) => `${n + 1}. ${r.meeting || "Meeting"}${r.meeting_date ? " (" + fmtDate(r.meeting_date) + ")" : ""} - ${r.item}: ${r.decision || ""} | Responsibility: ${r.owner || "-"} | Due: ${r.due ? fmtDate(r.due) : "-"} | Status: ${r.status || "Open"} | Action taken: ${r.action || "-"}`).join("\n");
}

/* ------------------------------------------------------------- can we share this? */
const SHARE_BANNER = { yes: "info", cond: "warn", ask: "warn", no: "error" };

function shareAnswerHtml(rec, reqTitle, d, generalSteps) {
  return `<div class="banner ${SHARE_BANNER[d.verdict]}" style="font-size:1.1rem"><strong>${esc(d.label)}</strong></div>
    <p style="font-size:1.05rem">${esc(d.summary)}</p>
    ${d.conditions.length ? `<p style="margin-bottom:0.3rem"><strong>${d.verdict === "no" ? "Points to note" : "Conditions and how to do it"}</strong></p><ul>${d.conditions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    ${d.law ? `<p><strong>Law:</strong> ${esc(d.law)}</p>` : ""}
    ${d.default_used ? `<p class="meta">This is the general rule for ${esc(rec.title.toLowerCase())}. This requester has no special right to them.</p>` : ""}
    <details><summary>Always do this, whatever the answer</summary><ol>${generalSteps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></details>`;
}

function shareQuestion(rec, reqTitle, d, detail) {
  return `${reqTitle} has asked us for: ${rec.title} (${rec.examples}).${detail ? " Details: " + detail : ""}\n` +
    `The tool's first answer is "${d.label}": ${d.summary} ${d.conditions.join(" ")} (${d.law || "no specific section"}).\n` +
    `Please confirm whether we can share, on what conditions and within what time; what we must check about the requester's authority; ` +
    `what to redact; and give a short reply we can send.`;
}
