"""Registers the CS office keeps beyond filings and licences.

    committees  - Board committees and the hospital's statutory committees: who sits on
                  them, when they last met, when they must meet or be reconstituted next.
    transplant  - living-donor files going to the Transplant Authorisation Committee,
                  with the document checklist for each kind of donor.
    decisions   - Board / committee decisions and who must act on them. This is the
                  "matters arising" and Action Taken Report for the next Board pack.
    requests    - requests for records and what was decided (see records.py).

Each register is a list of rows. The fields are described here once, and both the
self-hosted site and the claude.ai artifact draw their forms from this description.
"""

from __future__ import annotations

# Field kinds: text, textarea, date, number, select (options), checklist (items depend on the row).
REGISTERS: dict[str, dict] = {
    "committees": {
        "title": "Committees", "singular": "committee", "required": "name",
        "fields": [
            {"key": "name", "label": "Name of the committee", "kind": "text"},
            {"key": "kind", "label": "Type", "kind": "select",
             "options": ["Board committee", "Hospital statutory committee", "NABH / quality committee", "Management committee"]},
            {"key": "basis", "label": "Law or authority it is formed under", "kind": "text"},
            {"key": "members", "label": "Chair and members (one per line)", "kind": "textarea"},
            {"key": "quorum", "label": "Quorum", "kind": "text"},
            {"key": "every_days", "label": "Must meet at least every ... days (leave blank if it meets only when needed)", "kind": "number"},
            {"key": "last_meeting", "label": "Date of the last meeting", "kind": "date"},
            {"key": "valid_until", "label": "Reconstitution / registration due on (if any)", "kind": "date"},
            {"key": "minutes_to_board", "label": "Are its minutes placed before the Board?", "kind": "select", "options": ["Yes", "No"]},
            {"key": "notes", "label": "Notes", "kind": "textarea"},
        ],
    },
    "transplant": {
        "title": "Transplant Authorisation Committee files", "singular": "file", "required": "case_ref",
        "fields": [
            {"key": "case_ref", "label": "File / case number (do not enter patient names here)", "kind": "text"},
            {"key": "organ", "label": "Organ", "kind": "select", "options": ["Kidney", "Liver (part)", "Other"]},
            {"key": "relation", "label": "Who is the donor?", "kind": "select", "options_from": "DONOR_RELATIONS"},
            {"key": "received_on", "label": "Date the application was received", "kind": "date"},
            {"key": "meeting_on", "label": "Date of the Authorisation Committee meeting", "kind": "date"},
            {"key": "decision", "label": "Decision", "kind": "select", "options": ["Pending", "Approved", "Not approved", "Deferred for more documents"]},
            {"key": "decided_on", "label": "Date of the decision", "kind": "date"},
            {"key": "coordinator", "label": "Transplant coordinator handling the file", "kind": "text"},
            {"key": "checks", "label": "Documents and steps", "kind": "checklist"},
            {"key": "notes", "label": "Notes (no patient names)", "kind": "textarea"},
        ],
    },
    "decisions": {
        "title": "Board decisions to follow up", "singular": "decision", "required": "item",
        "fields": [
            {"key": "meeting", "label": "Meeting (e.g. 142nd Board Meeting, Audit Committee)", "kind": "text"},
            {"key": "meeting_date", "label": "Date of the meeting", "kind": "date"},
            {"key": "item", "label": "Agenda item / subject", "kind": "text"},
            {"key": "decision", "label": "What was decided", "kind": "textarea"},
            {"key": "owner", "label": "Who must act", "kind": "text"},
            {"key": "due", "label": "Due by", "kind": "date"},
            {"key": "filing", "label": "Filing or register entry it needs (e.g. MGT-14 in 30 days, MBP-4)", "kind": "text"},
            {"key": "status", "label": "Status", "kind": "select", "options": ["Open", "In progress", "Done", "Dropped"]},
            {"key": "action", "label": "Action taken so far (this goes into the Action Taken Report)", "kind": "textarea"},
        ],
    },
    "requests": {
        "title": "Requests for records", "singular": "request", "required": "requester_name",
        "fields": [
            {"key": "received_on", "label": "Date received", "kind": "date"},
            {"key": "requester_name", "label": "Who asked (name, organisation, officer and case number)", "kind": "text"},
            {"key": "requester", "label": "Kind of requester", "kind": "select", "options_from": "REQUESTERS"},
            {"key": "record", "label": "Kind of record", "kind": "select", "options_from": "RECORDS"},
            {"key": "what", "label": "What exactly was asked for", "kind": "textarea"},
            {"key": "reply_by", "label": "Reply / produce by", "kind": "date"},
            {"key": "outcome", "label": "Outcome", "kind": "select", "options": ["Pending", "Shared", "Shared in part", "Refused", "Referred to Legal"]},
            {"key": "closed_on", "label": "Date shared / replied", "kind": "date"},
            {"key": "approved_by", "label": "Approved by", "kind": "text"},
            {"key": "notes", "label": "Notes (what was given, acknowledgement)", "kind": "textarea"},
        ],
    },
}

# ---------------------------------------------------------------------------
# Committees a hospital company of this kind usually has.  The CS edits the list.
# ---------------------------------------------------------------------------
COMMITTEE_PRESETS: list[dict] = [
    {"name": "Audit Committee", "kind": "Board committee", "every_days": 120, "minutes_to_board": "Yes",
     "basis": "Companies Act 2013, Sec. 177; Meetings of Board Rules 2014, Rule 6",
     "notes": "Required for an unlisted public company with paid-up capital of Rs 10 crore or more, turnover of Rs 100 crore or more, "
              "or borrowings above Rs 50 crore. At least 3 directors, with independent directors in the majority. Approves related party transactions "
              "and oversees the vigil mechanism. Meeting every quarter, before the results Board meeting, is good practice."},
    {"name": "Nomination and Remuneration Committee", "kind": "Board committee", "every_days": 365, "minutes_to_board": "Yes",
     "basis": "Companies Act 2013, Sec. 178",
     "notes": "Three or more non-executive directors, at least half of them independent. Handles appointments, KMP remuneration and the Board evaluation."},
    {"name": "CSR Committee", "kind": "Board committee", "every_days": 180, "minutes_to_board": "Yes",
     "basis": "Companies Act 2013, Sec. 135; CSR Policy Rules 2014",
     "notes": "Three or more directors, at least one of them independent. Recommends the CSR policy and the annual action plan, and monitors spending and the Unspent CSR Account."},
    {"name": "Stakeholders Relationship Committee", "kind": "Board committee", "every_days": 365, "minutes_to_board": "Yes",
     "basis": "Companies Act 2013, Sec. 178(5)",
     "notes": "Needed only if there are more than 1,000 shareholders, debenture holders or other security holders. Delete this entry if it does not apply."},
    {"name": "Executive Committee", "kind": "Management committee", "every_days": 60, "minutes_to_board": "Yes",
     "basis": "Board resolution and Delegation of Powers",
     "notes": "Decisions within its delegated powers are placed before the next Board meeting for noting or approval."},
    {"name": "Transplant Authorisation Committee", "kind": "Hospital statutory committee", "every_days": None, "minutes_to_board": "No",
     "basis": "Transplantation of Human Organs and Tissues Act 1994, Sec. 9; THOTA Rules 2014",
     "notes": "Constituted by the State Government for a hospital that does enough transplants. Meets when files are ready. No member may be part of the transplant team. "
              "Interviews donor and recipient, records the proceedings on video and displays its decision on the notice board. Keep the government order constituting it and note the date it expires."},
    {"name": "Institutional Ethics Committee", "kind": "Hospital statutory committee", "every_days": 90, "minutes_to_board": "No",
     "basis": "New Drugs and Clinical Trials Rules 2019; ICMR National Ethical Guidelines 2017",
     "notes": "Registration with CDSCO (clinical trials) and with DHR (biomedical and health research) must be renewed. Enter the expiry under 'Reconstitution / registration due on'."},
    {"name": "POSH Internal Committee", "kind": "Hospital statutory committee", "every_days": None, "minutes_to_board": "No",
     "basis": "Sexual Harassment of Women at Workplace Act 2013, Sec. 4",
     "notes": "A senior woman employee presides. At least half the members are women, and there is one external member from an NGO or a person familiar with the issues. "
              "Members hold office for up to 3 years: enter the reconstitution date. The annual report goes to the District Officer."},
    {"name": "Hospital Infection Control Committee", "kind": "NABH / quality committee", "every_days": 31, "minutes_to_board": "No",
     "basis": "NABH Accreditation Standards for Hospitals", "notes": ""},
    {"name": "Quality and Patient Safety Committee", "kind": "NABH / quality committee", "every_days": 31, "minutes_to_board": "No",
     "basis": "NABH Accreditation Standards for Hospitals", "notes": "Reviews sentinel events, indicators and audits."},
    {"name": "Pharmacy and Therapeutics Committee", "kind": "NABH / quality committee", "every_days": 90, "minutes_to_board": "No",
     "basis": "NABH Accreditation Standards for Hospitals", "notes": ""},
    {"name": "Medical Records and Mortality Review Committee", "kind": "NABH / quality committee", "every_days": 31, "minutes_to_board": "No",
     "basis": "NABH Accreditation Standards for Hospitals", "notes": ""},
]

# ---------------------------------------------------------------------------
# Transplant Authorisation Committee: documents for a living-donor transplant file.
# ---------------------------------------------------------------------------
DONOR_RELATIONS: list[tuple[str, str]] = [
    ("near", "Near relative (parent, child, sibling, grandparent, grandchild)"),
    ("spouse", "Spouse"),
    ("other", "Other than a near relative (affection / attachment)"),
    ("swap", "Swap (paired exchange) donation"),
    ("foreign", "Donor or recipient is a foreign national"),
]

TRANSPLANT_VERIFY = (
    "The THOTA Rules 2014 prescribe the application and certificate forms, the committee's composition and timelines, "
    "and Kerala adds its own orders and K-SOTTO circulars. Form numbers are not given here on purpose: check each document "
    "against the gazetted Rules and the latest K-SOTTO checklist before the file goes to the committee."
)

# (id, text, which donor relations it applies to; "all" for every file)
TRANSPLANT_CHECKLIST: list[tuple[str, str, str]] = [
    # -------- application and identity
    ("app", "Joint application by the donor and the recipient in the prescribed form, signed by both", "all"),
    ("id", "Identity and address proof of the donor and recipient, with recent photographs (self-attested and verified against originals)", "all"),
    ("photo", "Joint photograph of the donor and recipient", "all"),
    ("age", "Proof of the donor's age: the donor must be an adult. A minor donor is allowed only in exceptional cases with the Appropriate Authority's approval", "all"),
    # -------- medical
    ("recipient_need", "Certificate from the treating specialist that the recipient needs the transplant", "all"),
    ("donor_fitness", "Certificate of the donor's medical fitness from a registered medical practitioner, with the investigation reports", "all"),
    ("psych", "Psychological / psychiatric evaluation of the donor", "all"),
    ("hla", "Tissue typing and cross-match reports (HLA)", "all"),
    # -------- consent and voluntariness
    ("counsel", "Donor counselled on the risks and outcomes by someone independent of the recipient's team; counselling record signed", "all"),
    ("consent", "Donor's informed consent recorded in a language the donor understands", "all"),
    ("affidavit_donor", "Notarised affidavit by the donor: the donation is voluntary and no money or reward is involved", "all"),
    ("affidavit_recipient", "Notarised affidavit by the recipient: no money or reward is involved", "all"),
    # -------- relationship
    ("rel_docs", "Documents proving the relationship (birth certificates, family / legal heirship certificate from the revenue authority, ration card, school records)", "near"),
    ("rel_dna", "If the documents are not conclusive: genetic (DNA / HLA) test of the relationship at an accredited laboratory", "near"),
    ("marriage", "Marriage certificate, proof of how long the couple have been married, and family photographs", "spouse"),
    ("affection", "Evidence of long association, affection or attachment between donor and recipient (photographs, letters, independent statements)", "other"),
    ("finance", "Financial status of the donor and recipient (income proof, tax returns, bank statements) to rule out commercial dealing", "other"),
    ("verification", "Verification report on the donor's address and antecedents from the police / revenue authority, if the committee or the State requires it", "other"),
    ("domicile", "Domicile documents and any NOC needed where the donor and recipient are from different States", "other"),
    ("swap_pairs", "Both donor-recipient pairs' complete files, with the relationship of each donor to their own recipient proved", "swap"),
    ("swap_joint", "Both pairs approved together in the same meeting; surgeries planned together", "swap"),
    ("embassy", "Certificate from the embassy / high commission of the foreign national's country confirming the relationship and that the donation is not commercial", "foreign"),
    ("passport", "Passport and medical visa copies of the foreign national(s)", "foreign"),
    ("foreign_rule", "Confirm that the Rules permit this donor-recipient combination for a foreign national. Restrictions apply when the donor is not a near relative", "foreign"),
    # -------- committee process
    ("interview", "Personal interview of the donor and recipient by the committee, separately and together; interpreter arranged if needed", "all"),
    ("video", "Committee proceedings and interviews recorded on video; recording indexed and stored", "all"),
    ("quorum", "Quorum present; no committee member is part of the transplant team for this case; declarations of interest recorded", "all"),
    ("decision", "Decision recorded with reasons (reasons are essential if approval is refused); minutes signed", "all"),
    ("display", "Decision displayed on the hospital notice board as the Rules require (normally within 24 hours of the meeting)", "all"),
    ("intimate", "Decision and transplant details reported to the Appropriate Authority / K-SOTTO registry", "all"),
    ("appeal", "If approval is refused: applicants told of their right of appeal to the State Government and the time limit", "all"),
]


def transplant_items(relation: str) -> list[dict]:
    return [{"id": i, "text": t} for i, t, rel in TRANSPLANT_CHECKLIST if rel in ("all", relation)]


def spec() -> dict:
    """Everything the screens need, ready to send as JSON."""
    from . import records
    out = {}
    lookups = {
        "DONOR_RELATIONS": [list(x) for x in DONOR_RELATIONS],
        "REQUESTERS": [list(x) for x in records.REQUESTERS],
        "RECORDS": [[r["id"], r["title"]] for r in records.RECORDS],
    }
    for kind, reg in REGISTERS.items():
        fields = []
        for f in reg["fields"]:
            f = dict(f)
            if "options_from" in f:
                f["options"] = lookups[f.pop("options_from")]
            elif "options" in f:
                f["options"] = [[o, o] for o in f["options"]]
            fields.append(f)
        out[kind] = {**reg, "fields": fields}
    return out


def validate(kind: str, data: dict) -> dict:
    """Keep only the known fields, as plain values. Raises ValueError for a missing name."""
    if kind not in REGISTERS:
        raise ValueError("Unknown register.")
    reg = REGISTERS[kind]
    clean: dict = {}
    for f in reg["fields"]:
        v = data.get(f["key"])
        if f["kind"] == "checklist":
            clean[f["key"]] = {str(k): bool(x) for k, x in (v or {}).items()} if isinstance(v, dict) else {}
        elif f["kind"] == "number":
            try:
                clean[f["key"]] = int(v) if str(v or "").strip() else None
            except (TypeError, ValueError):
                raise ValueError(f"'{f['label']}' must be a number.") from None
        else:
            clean[f["key"]] = str(v or "").strip()[:5000]
    if not clean.get(reg["required"]):
        label = next(f["label"] for f in reg["fields"] if f["key"] == reg["required"])
        raise ValueError(f"Please fill in: {label}.")
    return clean
