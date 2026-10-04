"""What the tool can draft and check, and the questions it asks for each.

Each draft type has a short list of plain questions. The answers are sent to
Claude together with the type-specific guidance below.
"""

from __future__ import annotations

COMMON_QUESTIONS = [
    ("extra", "Anything else the document must say or avoid? (optional)", "textarea"),
]

DRAFT_TYPES: list[dict] = [
    # ---------------------------------------------------------------- Board
    {
        "id": "board_notice", "group": "Board & Shareholders",
        "title": "Notice and Agenda for a Board Meeting",
        "questions": [
            ("meeting_no", "Meeting number (e.g. 143rd)", "text"),
            ("date_time", "Date, time and place (or video conference)", "text"),
            ("agenda", "Agenda items - one per line", "textarea"),
        ],
        "guidance": "Draft the notice (SS-1: at least 7 days, mention VC facility), the agenda with "
                    "standard opening items (leave of absence, confirmation of previous minutes, action taken "
                    "report, noting of committee minutes, disclosures), and a short note on each agenda item "
                    "with the draft resolution and the section it is passed under.",
    },
    {
        "id": "board_resolution", "group": "Board & Shareholders",
        "title": "Board Resolution / Certified True Copy",
        "questions": [
            ("subject", "What is being approved?", "textarea"),
            ("meeting", "Meeting at which it was / will be passed (number and date)", "text"),
            ("authorised", "Who is authorised to act on it (names and designations)", "text"),
        ],
        "guidance": "Give the resolution in 'RESOLVED THAT ... RESOLVED FURTHER THAT ...' form, citing the "
                    "correct section. Then give it as a Certified True Copy signed by the CS / a director. "
                    "State if MGT-14 is needed.",
    },
    {
        "id": "circular_resolution", "group": "Board & Shareholders",
        "title": "Resolution by Circulation",
        "questions": [
            ("subject", "What is being approved?", "textarea"),
            ("directors", "Names of directors it will be sent to", "textarea"),
        ],
        "guidance": "Follow Sec. 175 and SS-1: covering note, draft resolution with explanatory note, "
                    "approval / dissent form for each director, and the note that it will be noted at the "
                    "next Board meeting. Mention matters that cannot be passed by circulation.",
    },
    {
        "id": "minutes", "group": "Board & Shareholders",
        "title": "Minutes of a Board / Committee Meeting (from rough notes)",
        "questions": [
            ("meeting", "Which meeting (Board / committee, number, date, time, place)", "text"),
            ("present", "Directors and invitees present; leave of absence", "textarea"),
            ("notes", "Your rough notes of what was discussed and decided", "textarea"),
        ],
        "guidance": "Write minutes in SS-1 format: heading, attendance, chairperson, quorum, each item "
                    "with a brief record of discussion and the resolution passed, interested directors not "
                    "participating, and close of meeting. Past tense, third person, no verbatim debate.",
    },
    {
        "id": "agm_notice", "group": "Board & Shareholders",
        "title": "Notice of AGM / EGM with Explanatory Statement",
        "questions": [
            ("meeting", "AGM or EGM, number, date, time and mode (physical / VC)", "text"),
            ("business", "Business items - ordinary and special", "textarea"),
        ],
        "guidance": "Follow Sec. 101-102 and SS-2: notice, ordinary and special business with draft "
                    "resolutions, explanatory statement under Sec. 102 for special business with the "
                    "disclosure of interest, notes (proxy, e-voting if applicable, book closure / record date, "
                    "VC instructions).",
    },
    {
        "id": "board_report", "group": "Board & Shareholders",
        "title": "Section of the Board's Report",
        "questions": [
            ("section", "Which section (e.g. CSR, RPT, risk, POSH, deposits, particulars of loans)", "text"),
            ("facts", "Facts and figures for the year", "textarea"),
        ],
        "guidance": "Draft the section to meet Sec. 134(3) and the Companies (Accounts) Rules 2014, Rule 8.",
    },
    {
        "id": "action_taken_report", "group": "Board & Shareholders",
        "title": "Action Taken Report (matters arising) for the Board",
        "questions": [
            ("meeting", "For which meeting (number and date)", "text"),
            ("items", "Decisions of earlier meetings and what has been done on each", "textarea"),
        ],
        "guidance": "Prepare the agenda note 'Review of matters arising from previous Board meetings' as a table: "
                    "meeting and date, item, decision taken, responsibility, status (completed / in progress / pending), "
                    "action taken and expected date. Lead with a short summary of how many items are closed, in progress and overdue. "
                    "End with a draft resolution or a line that the Board noted the report.",
    },
    {
        "id": "committee_constitution", "group": "Board & Shareholders",
        "title": "Constitution / Terms of Reference of a committee",
        "questions": [
            ("committee", "Which committee (Board committee, Transplant Authorisation Committee, Ethics Committee, POSH IC...)", "text"),
            ("members", "Proposed chair and members", "textarea"),
        ],
        "guidance": "Draft the Board resolution or office order constituting the committee, and its terms of reference: "
                    "the law it is formed under, composition and eligibility rules (independence, women members, external members), "
                    "quorum, frequency of meetings, powers, reporting to the Board, tenure and conflict-of-interest rules. "
                    "Cite the source of each requirement (Companies Act, THOTA Rules 2014, NDCT Rules 2019, POSH Act, NABH).",
    },
    {
        "id": "roc_reply", "group": "Board & Shareholders",
        "title": "Letter to RoC / MCA / Regulator (reply to a notice)",
        "questions": [
            ("to", "To whom (office and address)", "text"),
            ("ref", "Notice reference and date", "text"),
            ("facts", "What the notice says and our facts", "textarea"),
        ],
        "guidance": "Formal reply: reference, brief facts, point-by-point response, documents enclosed, "
                    "request for personal hearing if useful. Measured tone; admit nothing that is not a fact.",
    },
    # ----------------------------------------------------------- Contracts
    {
        "id": "nda", "group": "Contracts",
        "title": "Non-Disclosure Agreement (NDA)",
        "questions": [
            ("other_party", "Other party - full legal name and address", "text"),
            ("kind", "Mutual, or only one side shares information? Which side?", "text"),
            ("purpose", "Why is information being shared? (purpose)", "textarea"),
            ("term", "How long should it last?", "text"),
        ],
        "guidance": "Standard Indian NDA: definitions (include patient data, clinical protocols, pricing, "
                    "tariffs, business plans), exclusions, purpose limitation, permitted disclosures, "
                    "legally compelled disclosure with notice, security, return / destruction, no licence, "
                    "no obligation to proceed, term and survival, injunctive relief, DPDP compliance (no "
                    "patient personal data to be shared without a proper data processing agreement), "
                    "governing law India, arbitration seated at Kochi, Kerala stamp duty note.",
    },
    {
        "id": "consultant_doctor", "group": "Contracts",
        "title": "Consultant / Visiting Doctor Agreement (retainership)",
        "questions": [
            ("doctor", "Doctor's name, qualifications and registration number", "text"),
            ("department", "Department and role", "text"),
            ("fees", "Professional fees / revenue share / retainer", "textarea"),
            ("time", "Days / hours, on-call duties, exclusivity if any", "textarea"),
        ],
        "guidance": "Independent professional (not employment): services, schedule, fee and TDS as "
                    "professional fees, no fee-splitting, NMC / State Council registration and renewal, "
                    "professional indemnity insurance (amount), hospital policies and NABH, medical records "
                    "ownership, confidentiality and DPDP, indemnity, term and termination (with notice, and "
                    "immediately for misconduct or loss of registration), non-solicitation (not a post-term "
                    "non-compete - Sec. 27 Contract Act), dispute resolution.",
    },
    {
        "id": "service_agreement", "group": "Contracts",
        "title": "Vendor / Service / Outsourcing Agreement",
        "questions": [
            ("vendor", "Vendor - full legal name and address", "text"),
            ("service", "What service (housekeeping, security, IT, catering, laundry, etc.)", "textarea"),
            ("price", "Price and payment terms", "textarea"),
            ("term", "Term and any service levels (SLAs)", "textarea"),
        ],
        "guidance": "Include scope, SLAs with service credits, manpower obligations and full labour-code "
                    "compliance by the contractor (wages, PF / ESI, contract labour registration and licence, "
                    "indemnity for statutory dues as principal employer), background checks, infection "
                    "control and hospital policies, data protection, insurance, audit rights, termination "
                    "for convenience and cause, transition, limitation of liability, arbitration at Kochi.",
    },
    {
        "id": "equipment", "group": "Contracts",
        "title": "Equipment Purchase with Warranty / CMC / AMC",
        "questions": [
            ("vendor", "Supplier - full legal name and address", "text"),
            ("equipment", "Equipment, model and quantity", "textarea"),
            ("price", "Price, payment milestones, warranty and CMC period", "textarea"),
        ],
        "guidance": "Include specifications, delivery, installation, acceptance testing, regulatory "
                    "(AERB for radiation equipment, CDSCO medical device registration), training, uptime "
                    "guarantee (e.g. 95%) with penalty and warranty extension, spares availability for "
                    "equipment life, software updates and cybersecurity, performance bank guarantee, "
                    "buy-back if any, liability and indemnity, and arbitration at Kochi.",
    },
    {
        "id": "lease", "group": "Contracts",
        "title": "Lease / Leave and Licence Agreement",
        "questions": [
            ("parties", "Landlord / licensor and tenant / licensee with addresses", "textarea"),
            ("premises", "Premises description and use", "textarea"),
            ("rent", "Rent, deposit, escalation and term (lock-in)", "textarea"),
        ],
        "guidance": "Include premises, permitted use (including hospital / clinic licences), rent and GST, "
                    "deposit, escalation, lock-in, maintenance, fit-outs, approvals and occupancy "
                    "certificate, fire NOC, renewal, termination, handover. Note that a lease for more "
                    "than 11 months must be registered under the Registration Act and stamped under the "
                    "Kerala Stamp Act.",
    },
    {
        "id": "mou_college", "group": "Contracts",
        "title": "MoU with a College / Institution (training, clinical postings)",
        "questions": [
            ("institution", "Institution name, address and affiliation", "text"),
            ("purpose", "Purpose (nursing / paramedical training, research, internships)", "textarea"),
            ("terms", "Numbers, fees, duration", "textarea"),
        ],
        "guidance": "Include purpose, obligations of each side, supervision, student conduct and hospital "
                    "rules, patient consent and confidentiality, liability and insurance, fees, "
                    "regulatory requirements (Kerala Nurses and Midwives Council, University, NMC), term and "
                    "termination; state clearly which clauses are binding.",
    },
    {
        "id": "cta", "group": "Contracts",
        "title": "Clinical Trial Agreement (sponsor / CRO / investigator)",
        "questions": [
            ("parties", "Sponsor, CRO and Principal Investigator", "textarea"),
            ("study", "Protocol number and title", "text"),
            ("budget", "Budget and payment schedule", "textarea"),
        ],
        "guidance": "Follow the New Drugs and Clinical Trials Rules 2019 and ICMR guidelines: approvals "
                    "(DCGI, Ethics Committee, CTRI registration), sponsor's obligation to pay medical "
                    "management and compensation for injury or death, insurance, indemnity by sponsor, "
                    "subject confidentiality and DPDP, publication rights, IP, record retention, audits "
                    "and inspections, termination.",
    },
    {
        "id": "dpa", "group": "Contracts",
        "title": "Data Processing Agreement (DPDP Act)",
        "questions": [
            ("processor", "Processor - name and service (e.g. HIS vendor, lab, cloud)", "text"),
            ("data", "What personal data is involved", "textarea"),
        ],
        "guidance": "Hospital as Data Fiduciary, vendor as Data Processor under the DPDP Act 2023 and Rules "
                    "2025: process only on instructions, security safeguards, breach notice to the hospital "
                    "at once (so the hospital can meet its own timelines), sub-processors, audits, "
                    "deletion on end of purpose, cross-border transfer, CERT-In compliance, indemnity.",
    },
    {
        "id": "empanelment", "group": "Contracts",
        "title": "Empanelment Agreement (corporate / insurer / TPA)",
        "questions": [
            ("party", "Corporate / insurer / TPA name", "text"),
            ("terms", "Tariff / discount, credit period and services covered", "textarea"),
        ],
        "guidance": "Include tariffs and discounts, pre-authorisation process, claim submission and timelines, "
                    "deductions and disputes, credit period and interest, patient data sharing limits, "
                    "term and exit, dispute resolution.",
    },
    # --------------------------------------------------------------- Legal
    {
        "id": "reply_legal_notice", "group": "Legal Letters & Disputes",
        "title": "Reply to a Legal Notice",
        "questions": [
            ("notice", "Who sent it, date, and what it alleges (or paste it)", "textarea"),
            ("facts", "Our version of the facts", "textarea"),
        ],
        "guidance": "Reply through counsel or the company: without prejudice where suitable, deny "
                    "allegations para-wise, set out true facts, rely on consent forms and records, no admission "
                    "of liability, reserve rights. For medical negligence, keep clinical explanation factual "
                    "and brief; avoid blaming individual staff.",
    },
    {
        "id": "legal_notice", "group": "Legal Letters & Disputes",
        "title": "Legal Notice (e.g. recovery of dues, breach of contract)",
        "questions": [
            ("to", "Addressee - full name and address", "text"),
            ("claim", "What is owed or breached, amounts and dates", "textarea"),
        ],
        "guidance": "Facts, contract clauses breached, amount with interest, demand with time to comply "
                    "(usually 15 days), consequences (suit / arbitration / Sec. 138 NI Act if a cheque "
                    "bounced - note its 30-day notice rule), and pre-institution mediation under Sec. 12A "
                    "Commercial Courts Act where applicable.",
    },
    {
        "id": "consumer_reply", "group": "Legal Letters & Disputes",
        "title": "Written Version to a Consumer Commission complaint (first draft)",
        "questions": [
            ("complaint", "Commission, case number and summary of the complaint", "textarea"),
            ("facts", "Our facts and treatment summary", "textarea"),
        ],
        "guidance": "Preliminary objections (limitation, jurisdiction, pecuniary value, misjoinder, "
                    "complicated questions of fact), para-wise reply, statement of facts, standard of care "
                    "(Jacob Mathew, Bolam), informed consent, prayer. Remind that it must be filed within "
                    "30 days (+15 max) of notice.",
    },
    {
        "id": "records_reply", "group": "Legal Letters & Disputes",
        "title": "Reply to a request for records / inspection / summons",
        "questions": [
            ("requester", "Who asked, and how (letter, email, summons, police requisition) with its date and reference", "text"),
            ("asked", "What they asked for", "textarea"),
            ("decision", "What we will do (share, share in part, ask for consent / proper authority, decline)", "textarea"),
        ],
        "guidance": "Write a short, polite reply on the company's behalf. Cite the law that gives or limits the right "
                    "(Companies Act Sec. 94, 119, 128, 136, 171; BNSS Sec. 94; IMC Regulations 2002 Reg. 1.3.2; DPDP Act 2023; "
                    "special laws such as the HIV and AIDS Act, MTP Act Sec. 5A, POCSO Sec. 23 and the POSH Act Sec. 16). "
                    "If sharing, list the documents enclosed as certified copies and ask for an acknowledgement. If not sharing, "
                    "say what is needed (written consent, a requisition under the proper section, a court order). "
                    "Never admit liability. Add a covering line marking the enclosures confidential.",
    },
    {
        "id": "poa", "group": "Legal Letters & Disputes",
        "title": "Power of Attorney / Letter of Authority",
        "questions": [
            ("to_whom", "Who is being authorised (name, designation)", "text"),
            ("powers", "What they can do (sign, appear in court, file, etc.)", "textarea"),
        ],
        "guidance": "Refer to the Board resolution authorising it, list powers precisely, validity period, "
                    "revocation, and stamp duty under the Kerala Stamp Act.",
    },
    # ------------------------------------------------------------ Policies
    {
        "id": "tac_minutes", "group": "Hospital Committees",
        "title": "Transplant Authorisation Committee: minutes and decision",
        "questions": [
            ("meeting", "Meeting date, time, place; members present and quorum", "textarea"),
            ("cases", "Files considered: case number, organ, donor relation, documents seen, interview notes (no patient names unless needed)", "textarea"),
            ("decisions", "Decision on each file, with reasons", "textarea"),
        ],
        "guidance": "Draft the minutes of a hospital-based Authorisation Committee under THOTA 1994 and the THOTA Rules 2014: "
                    "attendance and quorum, a declaration that no member is part of the transplant team, for each file the documents "
                    "verified, the separate interviews of donor and recipient, the committee's findings on relationship, voluntariness "
                    "and the absence of commercial dealing, and the decision with reasons. Then the decision notice to be displayed on the "
                    "notice board, and the letter to the applicants (with the right of appeal if approval is refused). Do not invent form numbers: "
                    "write '[prescribed form under THOTA Rules 2014]' where a form must be named, and add a note to confirm it.",
    },
    {
        "id": "retention_policy", "group": "Policies",
        "title": "Preservation of Documents / Records Retention policy",
        "questions": [
            ("scope", "What it should cover (company records, medical records, HR, IT logs, contracts...)", "textarea"),
        ],
        "guidance": "Draft a Board-approved policy: purpose, scope, a retention schedule table (record, period, legal basis, custodian), "
                    "storage and security, litigation hold, the process for approving and recording destruction, and electronic records. "
                    "Use the statutory minimums (Companies Act Sec. 118, 128(5) and the Management and Administration Rules; IMC Regulations 2002; "
                    "PCPNDT Sec. 29; NDCT Rules 2019; CERT-In Directions 2022; DPDP Act 2023) and mark any period you are not sure of for checking.",
    },
    {
        "id": "policy", "group": "Policies",
        "title": "Company Policy (RPT, CSR, Vigil mechanism, POSH, Code of Conduct...)",
        "questions": [
            ("policy", "Which policy?", "text"),
            ("points", "Points specific to our hospital (optional)", "textarea"),
        ],
        "guidance": "Draft a complete policy meeting the relevant section / rules, with purpose, scope, "
                    "definitions, process, roles, reporting and review.",
    },
    {
        "id": "privacy_notice", "group": "Policies",
        "title": "Patient Privacy Notice and Consent (DPDP)",
        "questions": [
            ("uses", "How we use patient data (treatment, billing, insurance, research, marketing...)", "textarea"),
        ],
        "guidance": "Clear notice in plain language under the DPDP Act and Rules: data collected, purposes, "
                    "consent and withdrawal, rights, grievance officer / DPO contact, Data Protection Board, "
                    "retention. Keep separate consent for anything beyond treatment (e.g. marketing, research).",
    },
    {
        "id": "other", "group": "Other",
        "title": "Any other document",
        "questions": [
            ("what", "What document do you need?", "text"),
            ("details", "Key details", "textarea"),
        ],
        "guidance": "",
    },
]

DRAFT_BY_ID = {d["id"]: d for d in DRAFT_TYPES}

# Reference numbers follow the house convention LHRC/<DEPT>/<TYPE>/<YYYY>/<NNN>.
REF_CODES = {
    "board_notice": ("CS", "BM"), "board_resolution": ("CS", "RES"), "circular_resolution": ("CS", "RES"),
    "minutes": ("CS", "MIN"), "agm_notice": ("CS", "AGM"), "board_report": ("CS", "BR"), "roc_reply": ("CS", "NOT"),
    "nda": ("LEG", "NDA"), "consultant_doctor": ("LEG", "CON"), "service_agreement": ("LEG", "SVC"),
    "equipment": ("LEG", "SVC"), "lease": ("LEG", "LSE"), "mou_college": ("LEG", "MOU"), "cta": ("LEG", "CTA"),
    "dpa": ("LEG", "DPA"), "empanelment": ("LEG", "EMP"), "reply_legal_notice": ("LEG", "NOT"),
    "legal_notice": ("LEG", "NOT"), "consumer_reply": ("LEG", "LIT"), "poa": ("LEG", "POA"),
    "policy": ("CS", "POL"), "privacy_notice": ("LEG", "DPDP"), "other": ("LEG", "GEN"),
    "action_taken_report": ("CS", "ATR"), "committee_constitution": ("CS", "COM"), "records_reply": ("LEG", "REC"),
    "tac_minutes": ("CS", "TAC"), "retention_policy": ("CS", "POL"),
}

VET_TYPES: list[dict] = [
    {"id": "nda", "title": "NDA / Confidentiality Agreement",
     "focus": "one-sided definitions, missing exclusions, excessive term, residuals clause, broad non-solicit "
              "or non-compete, unilateral injunction rights, patient data being shared under an NDA instead "
              "of a DPA, foreign governing law or courts."},
    {"id": "service", "title": "Vendor / Service / Outsourcing Agreement",
     "focus": "SLAs and penalties, labour-code liability as principal employer, auto-renewal, price escalation, "
              "uncapped hospital liability vs capped vendor liability, termination rights, data access."},
    {"id": "equipment", "title": "Equipment Purchase / AMC / CMC",
     "focus": "uptime guarantee, spares and end-of-life support, acceptance, AERB / CDSCO compliance, "
              "warranty start date, bank guarantees, software licences and cybersecurity."},
    {"id": "consultant", "title": "Consultant / Doctor Agreement",
     "focus": "employment vs professional relationship, fee-splitting, registration and indemnity insurance, "
              "non-compete enforceability, record ownership, termination."},
    {"id": "lease", "title": "Lease / Leave and Licence",
     "focus": "registration and stamp duty, lock-in, escalation, permitted use and licences, repairs, "
              "landlord title and approvals, termination and deposit refund."},
    {"id": "mou", "title": "MoU / Collaboration / JV term sheet",
     "focus": "which clauses bind, exclusivity, costs, IP, confidentiality, exit, related-party angle, "
              "Board / shareholder approvals, FEMA if a foreign party is involved."},
    {"id": "cta", "title": "Clinical Trial Agreement",
     "focus": "compliance with NDCT Rules 2019, compensation for trial injury, sponsor indemnity and insurance, "
              "publication and IP, payment for screen failures, subject data."},
    {"id": "empanelment", "title": "Insurer / TPA / Corporate Empanelment",
     "focus": "tariff freeze, unilateral deductions, credit period, audit rights, patient data sharing."},
    {"id": "legal_notice", "title": "Legal Notice or Court / Consumer complaint received",
     "focus": "summarise the allegations, deadlines to reply, limitation and jurisdiction points, strengths "
              "and weaknesses, documents to collect, and give a draft outline of the reply."},
    {"id": "govt_notice", "title": "Notice from RoC / MCA / RBI / Regulator",
     "focus": "what is alleged, the section invoked, the deadline, whether there is a real default, "
              "penalty exposure, compounding / adjudication options, and a draft reply outline."},
    {"id": "transplant_file", "title": "Transplant Authorisation Committee file (living donor)",
     "focus": "whether the file is complete for the kind of donor (near relative, spouse, unrelated, swap, foreign national) under "
              "THOTA 1994 and the THOTA Rules 2014: joint application, identity and age proof, proof of relationship (or DNA test), "
              "medical fitness and psychological evaluation of the donor, recipient's need certificate, HLA reports, counselling and "
              "informed consent, affidavits of no payment, and for unrelated donors the evidence of affection, financial status and "
              "verification reports; embassy certificate for foreign nationals. Flag any sign of commercial dealing, inconsistencies "
              "between documents (names, ages, addresses, signatures), missing signatures or attestation, and anything the committee "
              "should ask in the interview. Give the verdict as: ready for the committee / ready after listed gaps are filled / not ready. "
              "Do not invent form numbers; say 'confirm the prescribed form' where needed."},
    {"id": "records_request", "title": "Request for records, summons or police requisition",
     "focus": "who is asking and under what power (Companies Act Sec. 94, 119, 128, 206, 207; BNSS Sec. 94 or 179; a consumer or "
              "court summons); whether the requisition is valid (signed, officer named, case number, time and place); which records "
              "we may give and on what conditions (patient consent, IMC Regulations 2002 Reg. 1.3.2, DPDP Act, special laws such as "
              "the HIV and AIDS Act, MTP Act Sec. 5A, POCSO, MHCA Sec. 23, POSH Sec. 16); the deadline; and an outline reply."},
    {"id": "board_docs", "title": "Board / Shareholder papers (notice, minutes, resolutions)",
     "focus": "compliance with the Companies Act and SS-1 / SS-2: notice period, quorum, correct section, "
              "interested directors, wording of resolutions, filings triggered (MGT-14 etc.)."},
    {"id": "other", "title": "Any other legal document",
     "focus": "all the standard checks."},
]

VET_BY_ID = {v["id"]: v for v in VET_TYPES}

OUR_ROLE_OPTIONS = [
    "Not sure - please work it out",
    "We (the hospital) are buying / receiving the service",
    "We are providing the service / being paid",
    "Both sides share information / obligations equally",
    "We received this notice / complaint",
]


def build_vet_prompt(vet_id: str, our_role: str, concerns: str, names: list[str]) -> str:
    v = VET_BY_ID.get(vet_id, VET_BY_ID["other"])
    parts = [
        f"Please vet the attached document(s): {', '.join(names) or 'pasted text below'}.",
        f"Type of document: {v['title']}.",
        f"Our side: {our_role or 'Not stated - work it out'}.",
        f"Pay particular attention to: {v['focus']}",
    ]
    if concerns.strip():
        parts.append(f"The CS is specifically worried about: {concerns.strip()}")
    parts.append("Follow the vetting structure in your instructions exactly.")
    return "\n".join(parts)


def build_draft_prompt(draft_id: str, answers: dict, names: list[str]) -> str:
    d = DRAFT_BY_ID.get(draft_id, DRAFT_BY_ID["other"])
    lines = [f"Please draft: {d['title']}.", ""]
    for key, label, _ in d["questions"] + COMMON_QUESTIONS:
        val = str(answers.get(key, "") or "").strip()
        lines.append(f"- {label}: {val if val else '[not given - leave a blank]'}")
    if d["guidance"]:
        lines += ["", f"Guidance for this document: {d['guidance']}"]
    if names:
        lines += ["", f"Reference material attached: {', '.join(names)}. Use it where relevant "
                      "(e.g. follow the other side's draft or our earlier format)."]
    lines += ["", "Write the complete document in Markdown (use # headings, numbered clauses and tables), "
                  "then the 'Notes for the CS' section."]
    return "\n".join(lines)
