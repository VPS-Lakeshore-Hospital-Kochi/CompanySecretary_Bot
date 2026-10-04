"""Can we share this record?  Who may see the company's and the hospital's records, and how long to keep them.

The CS office is asked for records every week: a shareholder wants the AGM minutes, the
police want a patient's file, an insurer wants the discharge summary, the group parent
wants the Board papers, a buyer's lawyers want the contracts. This module gives a first
answer for each (record, requester) pair without the AI:

    yes   - share; the law gives them the right
    cond  - share only if the conditions are met
    ask   - do not decide alone: take CS / Legal sign-off or Board approval first
    no    - do not share (unless a court orders it)

The position was checked as of September 2026. Points that are recent, or that depend on
a rule number we could not confirm, carry a "verify" note. The screen always says to
confirm before releasing anything sensitive.
"""

from __future__ import annotations

VERDICTS = {
    "yes": "Yes - share it",
    "cond": "Yes, but only if the conditions below are met",
    "ask": "Not yet - get approval first",
    "no": "No - do not share",
}

REQUESTERS: list[tuple[str, str]] = [
    ("member", "A shareholder (member) of the company"),
    ("director", "A director of the company"),
    ("auditor", "Statutory, internal, secretarial or cost auditor"),
    ("regulator", "RoC / MCA, RBI or another regulator acting under its law"),
    ("court", "A court, Consumer Commission or tribunal (summons or order)"),
    ("police", "Police or an investigating agency"),
    ("self", "The person the record is about (patient, employee, other individual)"),
    ("relative", "A relative, legal heir or representative of the patient"),
    ("insurer", "An insurer or TPA"),
    ("parent", "Our parent company, a group company or a foreign shareholder"),
    ("lender", "A bank or lender"),
    ("investor", "A buyer, investor or their advisers doing due diligence"),
    ("counterparty", "The other party to a contract, or another hospital"),
    ("employee", "One of our employees (not about their own records)"),
    ("public", "Media, the public, or someone filing an RTI application"),
]

# Steps that apply to every request, whatever the answer.
GENERAL_STEPS = [
    "Get the request in writing. Note the date received, who is asking, what exactly they want and the deadline.",
    "Check the requester's identity and authority: ID proof, letter of authority, power of attorney, the court's seal, or the officer's name, rank and case number.",
    "Share only what is asked for and needed. Redact other people's names and personal data.",
    "Give copies, not originals. Keep originals unless a court orders them produced, and then send them through an authorised officer.",
    "Mark copies 'Confidential' and certify them where asked. Take a signed acknowledgement with the date.",
    "Record the request and what was given in the Requests register on this screen.",
]

RECORDS: list[dict] = [
    # ---------------------------------------------------------------- company records
    {
        "id": "registers",
        "title": "Statutory registers and annual returns",
        "examples": "Register of members, directors & KMP, charges, contracts (MBP-4), loans & investments (MBP-2), SBO; annual returns (MGT-7)",
        "group": "Company records",
        "default": ("no", "These registers are open to the people the Companies Act names. Others have no right to inspect them.",
                    [], "Companies Act 2013, Sec. 88, 94, 85, 171, 186(10), 189"),
        "by": {
            "member": ("yes", "Members may inspect the statutory registers during business hours and take extracts.",
                       ["Inspection of the register of members, other registers under Sec. 88 and annual returns is free for members (Sec. 94(2)).",
                        "Copies asked for must be sent within the time in the Act and Rules, on payment of any fee set in the Articles.",
                        "Registers of directors & KMP (Sec. 171), contracts with interested parties (Sec. 189) and loans & investments (Sec. 186(10)) are also open to members.",
                        "Inspection is at the registered office, in the presence of a CS office representative."],
                       "Companies Act 2013, Sec. 94, 171, 186(10), 189; Companies (Management and Administration) Rules 2014"),
            "director": ("yes", "Directors are entitled to see every statutory register.", [], "Companies Act 2013, Sec. 171, 189"),
            "auditor": ("yes", "Auditors have a right of access to the company's books and papers.", [], "Companies Act 2013, Sec. 143(1), 204"),
            "regulator": ("yes", "The RoC and inspectors can call for any register.",
                          ["Check the notice cites a section (e.g. Sec. 206 or 207) and is signed by an authorised officer."],
                          "Companies Act 2013, Sec. 206, 207"),
            "court": ("yes", "Produce certified copies as the summons or order directs.", [], "BNSS 2023, Sec. 94; Code of Civil Procedure"),
            "public": ("cond", "Some registers are open to anyone on payment of a fee. Others are for members only.",
                       ["Register of members and annual returns: any person may inspect on paying the fee in the Articles (Sec. 94).",
                        "Register of charges: creditors free, others on a fee (Sec. 85).",
                        "Directors & KMP, MBP-4 and MBP-2 registers are not open to the public. Much of this information is on the MCA portal anyway.",
                        "RTI does not apply to a private hospital company. Point the applicant to the MCA portal."],
                       "Companies Act 2013, Sec. 85, 94"),
            "lender": ("cond", "Lenders can see the register of charges. Other registers are shared under the loan covenants.",
                       ["Register of charges: creditors may inspect free (Sec. 85).", "Anything else: only what the facility agreement requires."],
                       "Companies Act 2013, Sec. 85"),
            "investor": ("ask", "Share for due diligence only under a signed NDA and with management approval.",
                         ["Use a data room with view-only access; log who saw what."], ""),
            "parent": ("cond", "The parent is a member and has a member's inspection rights. Anything more goes through its nominee director or a Board-approved process.", [], "Companies Act 2013, Sec. 94"),
        },
    },
    {
        "id": "gm_minutes",
        "title": "Minutes of general meetings (AGM / EGM) and postal ballot results",
        "examples": "AGM and EGM minutes, scrutiniser's reports, results of postal ballots",
        "group": "Company records",
        "default": ("no", "General meeting minutes are open to members. Others need a legal right or an order.", [], "Companies Act 2013, Sec. 119"),
        "by": {
            "member": ("yes", "Members may inspect the minute book of general meetings free and ask for a copy.",
                       ["Inspection: during business hours, free of charge (Sec. 119(2)).",
                        "Copy: to be given within 7 working days of the request, on payment of the fee in the Articles (Sec. 119(3))."],
                       "Companies Act 2013, Sec. 119; SS-2"),
            "director": ("yes", "Directors may see all minutes.", [], "SS-2"),
            "auditor": ("yes", "Auditors have access to the minute books.", [], "Companies Act 2013, Sec. 143(1), 204"),
            "regulator": ("yes", "Produce them on a notice under the Act.", [], "Companies Act 2013, Sec. 206, 207"),
            "court": ("yes", "Produce certified copies as directed.", [], "BNSS 2023, Sec. 94"),
            "parent": ("yes", "The parent is a member, so it has the same rights as any member.", [], "Companies Act 2013, Sec. 119"),
            "lender": ("cond", "Give certified true copies of the resolutions they need (for example the borrowing resolution under Sec. 180), not the whole minute book.", [], ""),
            "investor": ("ask", "Share copies under an NDA as part of due diligence.", [], ""),
        },
    },
    {
        "id": "board_minutes",
        "title": "Board and committee minutes, Board papers and agenda notes",
        "examples": "Board / Audit / NRC / CSR / Executive Committee minutes, agenda papers, circular resolutions, DoP",
        "group": "Company records",
        "default": ("no", "Board minutes and papers are confidential to the Board. Members have no right to inspect them.",
                    ["Sec. 119 gives members a right only over general meeting minutes, not Board minutes."], "Companies Act 2013, Sec. 118, 119; SS-1"),
        "by": {
            "director": ("yes", "A director may inspect the Board and committee minutes.",
                         ["Inspection is in the CS office. Copies of signed minutes go to directors as SS-1 provides.",
                          "Minutes of a committee the director does not sit on: share them as SS-1 and the Board's practice allow."],
                         "SS-1 (Secretarial Standard on Meetings of the Board of Directors)",
                         ),
            "auditor": ("yes", "Statutory and secretarial auditors are entitled to see the minute books.", [], "Companies Act 2013, Sec. 143(1), 204"),
            "regulator": ("yes", "The RoC and inspectors can call for the minute books.", ["Check the notice cites a section and is signed by an authorised officer."], "Companies Act 2013, Sec. 206, 207"),
            "court": ("yes", "Produce certified copies or extracts as the summons or order directs.", [], "BNSS 2023, Sec. 94; Bharatiya Sakshya Adhiniyam 2023"),
            "police": ("cond", "Only on a written notice or order under the BNSS that names the documents.", ["Send the request to Legal before replying."], "BNSS 2023, Sec. 94"),
            "member": ("no", "Members have no right to inspect Board minutes. If a resolution affects them, give a certified true copy of that resolution only, with the CS's approval.", [], "Companies Act 2013, Sec. 119"),
            "parent": ("ask", "Share only through the parent's nominee director, or under a Board-approved information-sharing arrangement.",
                       ["The parent is a shareholder, not the Board. Related-party and confidentiality duties apply.",
                        "Group consolidation needs financial information, not the minutes."], ""),
            "lender": ("cond", "Give certified true copies of the specific resolutions the lender needs (borrowing, security, authorised signatories). Do not give the full minutes.", [], "Companies Act 2013, Sec. 179, 180"),
            "investor": ("ask", "Share only in a controlled data room under an NDA, with the Board's or MD's approval. Redact matters not relevant to the deal.", [], ""),
            "employee": ("no", "Give an employee only a certified extract of a resolution that concerns them (e.g. their appointment or authority).", [], ""),
            "counterparty": ("cond", "Give a certified true copy of the resolution authorising the contract or signatory, if they ask. Never the minutes.", [], ""),
        },
    },
    {
        "id": "accounts",
        "title": "Books of account, financial statements and MIS",
        "examples": "Ledgers, vouchers, audited accounts, monthly MIS, budgets",
        "group": "Company records",
        "default": ("no", "Books of account are open to directors and auditors only. The audited financial statements filed with the MCA are public.", [], "Companies Act 2013, Sec. 128, 136"),
        "by": {
            "director": ("yes", "Every director may inspect the books of account during business hours.", [], "Companies Act 2013, Sec. 128(3)"),
            "auditor": ("yes", "Auditors have full access.", [], "Companies Act 2013, Sec. 143(1)"),
            "member": ("cond", "Members are entitled to the audited financial statements, the auditor's report and the Board's report, but not the books of account.", ["Send the financial statements with the AGM notice; give a free copy to a member who asks (Sec. 136)."], "Companies Act 2013, Sec. 136"),
            "regulator": ("yes", "RoC, tax and other authorities may inspect under their own laws.", ["Check the notice and the section it cites."], "Companies Act 2013, Sec. 128(3), 206, 207"),
            "court": ("yes", "Produce as directed.", [], "BNSS 2023, Sec. 94"),
            "parent": ("cond", "Share the financial information needed for group consolidation and reporting, under a group confidentiality arrangement.", ["Do not share patient-level data. MIS goes through the Board-approved reporting line."], "Companies Act 2013, Sec. 129(3)"),
            "lender": ("cond", "Share what the loan agreement requires (audited accounts, stock statements, covenant certificates).", [], ""),
            "investor": ("ask", "Share under an NDA in a data room, with management approval.", [], ""),
            "public": ("cond", "Share only what is already public: the audited financial statements filed in AOC-4.", ["The press and communications team handles media questions."], ""),
        },
    },
    {
        "id": "contracts",
        "title": "Contracts and agreements",
        "examples": "Vendor, consultant doctor, lease, empanelment, NDA, MoU, clinical trial agreements",
        "group": "Company records",
        "default": ("ask", "Read the confidentiality clause first. Most contracts forbid disclosure except to advisers, auditors or when the law requires it.", [], "The contract itself; Indian Contract Act 1872"),
        "by": {
            "auditor": ("yes", "Auditors may see them. Most confidentiality clauses allow this.", [], "Companies Act 2013, Sec. 143(1)"),
            "director": ("yes", "Directors may see the company's contracts.", [], ""),
            "regulator": ("cond", "Share it if the authority's notice requires it. Tell the counterparty if the contract asks for notice of a compelled disclosure.", [], ""),
            "court": ("cond", "Produce it as directed. Tell the counterparty if the contract asks for notice of a compelled disclosure.", [], "BNSS 2023, Sec. 94"),
            "counterparty": ("yes", "The parties to a contract can each have a copy.", [], ""),
            "investor": ("ask", "Check each contract's confidentiality clause. Some need the counterparty's consent before disclosure in due diligence. Use a data room.", [], ""),
            "parent": ("cond", "Share it where the confidentiality clause allows disclosure to affiliates and there is a business need.", [], ""),
            "lender": ("cond", "Share it only if the loan agreement requires it (for example a lease or a key agreement offered as security).", [], ""),
            "employee": ("cond", "Share it only with those who need it to perform the contract.", [], ""),
            "public": ("no", "Do not share it.", [], ""),
            "member": ("no", "Members have no right to inspect contracts, except the entries in the MBP-4 register of contracts with interested parties.", [], "Companies Act 2013, Sec. 189"),
        },
    },
    # ---------------------------------------------------------------- hospital records
    {
        "id": "medical",
        "title": "Patient medical records",
        "examples": "Case sheets, discharge summaries, investigation reports, images, bills with diagnosis",
        "group": "Hospital records",
        "default": ("no", "Medical records are confidential. Share them only with the patient, with the patient's consent, or when the law requires it.",
                    ["The hospital is a Data Fiduciary for health data under the DPDP Act."],
                    "IMC (Professional Conduct, Etiquette and Ethics) Regulations 2002, Reg. 1.3, 2.2, 7.14; DPDP Act 2023"),
        "by": {
            "self": ("yes", "The patient has a right to copies of their own records.",
                     ["Supply copies within 72 hours of a written request (IMC Regulations, Reg. 1.3.2). Take ID proof and an acknowledgement.",
                      "Give copies, not originals. The hospital's fee for copies may be charged.",
                      "Mental health patients: access may be withheld only on the grounds in the Mental Healthcare Act (Sec. 25). Record the reason."],
                     "IMC Regulations 2002, Reg. 1.3.2; Mental Healthcare Act 2017, Sec. 25; DPDP Act 2023, Sec. 11"),
            "relative": ("cond", "Share them only with the patient's written authorisation, or with the person entitled to act for the patient.",
                         ["Minor: the parent or lawful guardian.", "Patient who cannot decide: the legal guardian or nominated representative.",
                          "Deceased patient: the legal heirs, on a death certificate and proof of heirship. Get Legal's sign-off.",
                          "The bystander's or relative's word alone is not enough."],
                         "IMC Regulations 2002; Mental Healthcare Act 2017, Sec. 14; DPDP Act 2023, Sec. 9"),
            "police": ("cond", "Share them only on a written requisition from the investigating officer or an order under the BNSS.",
                       ["For a medico-legal case (MLC), give a copy against the officer's signed requisition giving the name, rank, police station and crime number.",
                        "For a non-MLC patient without consent, ask for a notice under BNSS Sec. 94 or a court order.",
                        "Keep the originals. The MRD gives certified copies and keeps the requisition on file."],
                       "BNSS 2023, Sec. 94, 179; IMC Regulations 2002, Reg. 7.14"),
            "court": ("yes", "Produce certified copies as the summons or order directs. Send originals only if the court specifically orders them.",
                      ["An authorised MRD officer takes them. Keep a certified copy set at the hospital."],
                      "BNSS 2023, Sec. 94; Bharatiya Sakshya Adhiniyam 2023, Sec. 63 (electronic records)"),
            "insurer": ("cond", "Share them only with the patient's consent, and only what the claim needs.",
                        ["The claim form or the admission consent usually has the patient's authorisation. Check it is signed.",
                         "Send the discharge summary, bills and the investigations relevant to the claim. Do not send the full case file unless the policy requires it."],
                        "DPDP Act 2023, Sec. 6; IRDAI health insurance regulations"),
            "counterparty": ("cond", "Another treating hospital or doctor may get the records needed for continuity of care, on referral or with the patient's consent.", [], "IMC Regulations 2002, Reg. 7.14"),
            "regulator": ("cond", "Share them with the authority that has power under its own law (e.g. the PCPNDT Appropriate Authority, the THOTA Appropriate Authority, the Drugs Controller or the Clinical Establishments authority), as its notice requires.", [], ""),
            "auditor": ("cond", "NABH and clinical auditors may see records under confidentiality. Financial auditors should get de-identified samples where possible.", [], ""),
            "parent": ("no", "Do not share identifiable patient records with the group. De-identified or aggregated data may be shared under a data processing agreement.", [], "DPDP Act 2023, Sec. 8"),
            "employee": ("cond", "Share them only with the care team and staff who need them for the patient's treatment or for billing.", [], "LHRC MRD policy on security, privacy and confidentiality"),
            "public": ("no", "Never. Disclosing patient information to the media or the public breaches confidentiality and the DPDP Act.", [], "IMC Regulations 2002, Reg. 2.2; DPDP Act 2023"),
            "investor": ("no", "Do not share identifiable patient data in due diligence. Use aggregated or anonymised data.", [], "DPDP Act 2023"),
        },
    },
    {
        "id": "sensitive",
        "title": "Specially protected health records",
        "examples": "HIV status; mental illness; MTP (abortion); PCPNDT forms; POCSO cases; IVF / ART donors; organ donor and recipient files",
        "group": "Hospital records",
        "default": ("no", "Special laws protect these records, and some disclosures are offences. Share them only as that law allows.",
                    ["HIV status: only with informed consent or a court order (HIV and AIDS Act 2017, Sec. 8-11).",
                     "MTP: the woman's name and details must not be revealed except to a person authorised by law (MTP Act, Sec. 5A).",
                     "POCSO: the child's identity must not be disclosed (POCSO Act, Sec. 23). Reporting to the police is mandatory (Sec. 19).",
                     "Mental illness: confidentiality under the Mental Healthcare Act, Sec. 23.",
                     "ART: donor identity is confidential (ART Act 2021)."],
                    "HIV and AIDS Act 2017; MTP Act 1971 Sec. 5A; POCSO Act 2012 Sec. 19, 23; MHCA 2017 Sec. 23; ART Act 2021; PCPNDT Act 1994; THOTA 1994"),
        "by": {
            "self": ("yes", "The patient may have their own records, with the same 72-hour rule as other records.", ["Mental health records: see the Sec. 25 MHCA exception."], "IMC Regulations 2002, Reg. 1.3.2"),
            "court": ("yes", "Produce them as ordered. Ask the court to protect the patient's identity (HIV Act Sec. 34; POCSO Sec. 23).", [], ""),
            "regulator": ("yes", "Give them only to the authority under that specific law (PCPNDT Appropriate Authority, THOTA Appropriate Authority / K-SOTTO, ART Registry, State Mental Health Authority), as its notice requires.", [], ""),
            "police": ("cond", "Share them only as the special law allows: POCSO reports must be made; MTP details only to an officer authorised by law; HIV status only under a court order.", ["Send the request to Legal before replying."], ""),
            "insurer": ("cond", "Share them only with the patient's specific, informed written consent for this disclosure.", [], "HIV and AIDS Act 2017, Sec. 8"),
            "relative": ("ask", "Do not share them without Legal's advice. Most of these laws do not let relatives see the records without the patient's consent.", [], ""),
            "public": ("no", "Never. Disclosure can be a criminal offence.", [], ""),
            "employee": ("cond", "Share them only with the treating team who need to know.", [], ""),
            "parent": ("no", "Do not share them.", [], ""),
            "investor": ("no", "Do not share them.", [], ""),
        },
    },
    {
        "id": "committee",
        "title": "Transplant Authorisation Committee and Ethics Committee files",
        "examples": "THOTA applications, donor-recipient files, interview videos, committee decisions; Ethics Committee submissions and minutes",
        "group": "Hospital records",
        "default": ("no", "These files hold donors', recipients' and trial participants' personal and medical details. Keep them confidential.",
                    [], "THOTA 1994 and Rules 2014; New Drugs and Clinical Trials Rules 2019"),
        "by": {
            "regulator": ("yes", "Give them to the Appropriate Authority under THOTA, K-SOTTO / NOTTO, or CDSCO and its inspectors for the Ethics Committee, as their notice or the rules require.", [], "THOTA 1994, Sec. 13; NDCT Rules 2019"),
            "court": ("yes", "Produce them as ordered.", [], "BNSS 2023, Sec. 94"),
            "police": ("cond", "Share them only on a written notice or order. In a suspected organ-trade case, Legal and the Medical Director handle it at once.", [], "THOTA 1994, Sec. 19; BNSS 2023, Sec. 94"),
            "self": ("cond", "The donor and recipient can have the committee's decision and their own documents. Other people's details stay redacted.", [], ""),
            "public": ("no", "Only the Authorisation Committee's decision is displayed, on the hospital notice board, as the Rules require. Nothing else goes out.", [], "THOTA Rules 2014"),
            "counterparty": ("cond", "Trial sponsor: share only what the clinical trial agreement and the NDCT Rules allow, without participants' identities.", [], "NDCT Rules 2019"),
            "auditor": ("cond", "NABH and regulatory auditors may see them under confidentiality.", [], ""),
        },
    },
    {
        "id": "hr",
        "title": "Staff and doctors' personnel records",
        "examples": "Personnel files, salary, appraisals, disciplinary records, credentialing files",
        "group": "People records",
        "default": ("no", "Personnel records are personal data. Share them only with the employee, with consent, or when the law requires it.", [], "DPDP Act 2023"),
        "by": {
            "self": ("yes", "Employees may have their own records: a summary of their personal data held, and copies of letters and certificates.", [], "DPDP Act 2023, Sec. 11"),
            "regulator": ("yes", "Labour, PF / ESI and tax inspectors may inspect the registers their laws require.", [], "Labour Codes 2025; Income-tax Act 2025"),
            "court": ("yes", "Produce them as ordered.", [], ""),
            "police": ("cond", "Share them only on a written notice under the BNSS.", [], "BNSS 2023, Sec. 94"),
            "counterparty": ("cond", "Background checks by a new employer: confirm only the dates of service and designation, unless the employee has consented in writing to more.", [], ""),
            "parent": ("cond", "Group HR may receive what it needs for group HR processes, under a data processing arrangement.", [], ""),
            "auditor": ("yes", "Auditors may see payroll records.", [], ""),
            "insurer": ("cond", "Share data for group health and term policies only as the employee's enrolment consent allows.", [], ""),
            "public": ("no", "Do not share them.", [], ""),
        },
    },
    {
        "id": "posh",
        "title": "POSH complaint and inquiry records",
        "examples": "Complaints of sexual harassment, Internal Committee proceedings, witness statements, reports",
        "group": "People records",
        "default": ("no", "The POSH Act forbids publishing or communicating the contents of the complaint and inquiry, or the identity of the people involved, to the public, press or media. The RTI Act does not override this.",
                    [], "Sexual Harassment of Women at Workplace Act 2013, Sec. 16, 17"),
        "by": {
            "self": ("cond", "The complainant and the respondent receive the Internal Committee's findings and recommendations (Sec. 13). They do not receive the other party's private material.", [], "POSH Act 2013, Sec. 13"),
            "regulator": ("cond", "The District Officer receives the annual report with the number of cases, not the case files.", [], "POSH Act 2013, Sec. 21, 22"),
            "court": ("yes", "Produce them as ordered, asking the court to protect identities.", [], ""),
            "director": ("cond", "The Board's report carries the number of complaints only. The Board sees case details only if it must take a decision.", [], "Companies (Accounts) Rules 2014, Rule 8"),
            "public": ("no", "Never. It is an offence under Sec. 17.", [], "POSH Act 2013, Sec. 16, 17"),
        },
    },
    {
        "id": "cctv",
        "title": "CCTV footage, access logs and IT system logs",
        "examples": "Camera recordings, door access logs, HIS audit trails, firewall and server logs",
        "group": "Hospital records",
        "default": ("no", "Footage and logs show many people. Share them only for a lawful purpose and preserve them when asked.", [], "DPDP Act 2023; CERT-In Directions 2022"),
        "by": {
            "police": ("cond", "Share it on a written requisition naming the date, time and camera. Preserve the original and keep a hash value for evidence.",
                       ["Electronic evidence needs the certificate under Bharatiya Sakshya Adhiniyam Sec. 63."], "BNSS 2023, Sec. 94; BSA 2023, Sec. 63"),
            "regulator": ("cond", "CERT-In may call for logs. Logs must be kept for 180 days and produced on direction.", [], "CERT-In Directions 28 April 2022"),
            "court": ("yes", "Produce it as ordered, with the Sec. 63 certificate.", [], "BSA 2023, Sec. 63"),
            "self": ("ask", "A person may ask for footage of themselves. Blur or redact other people before sharing, and take Legal's sign-off.", [], "DPDP Act 2023, Sec. 11"),
            "insurer": ("cond", "Share it for a claim involving the hospital (e.g. fire, theft) where the policy requires it.", [], ""),
            "public": ("no", "Do not share it.", [], ""),
        },
    },
]

RECORDS_BY_ID = {r["id"]: r for r in RECORDS}
REQUESTER_TITLE = dict(REQUESTERS)


def _expand(entry) -> dict:
    verdict, summary, conditions, law = entry
    return {"verdict": verdict, "label": VERDICTS[verdict], "summary": summary, "conditions": list(conditions), "law": law}


def decide(record_id: str, requester_id: str) -> dict:
    """The first answer for one record type and one requester."""
    rec = RECORDS_BY_ID[record_id]
    entry = rec["by"].get(requester_id, rec["default"])
    out = _expand(entry)
    out["default_used"] = requester_id not in rec["by"]
    if out["default_used"] and rec["default"][2] and not out["conditions"]:
        out["conditions"] = list(rec["default"][2])
    return out


def matrix() -> dict:
    """Every answer, for the screens: {record_id: {requester_id: decision}}."""
    return {r["id"]: {q: decide(r["id"], q) for q, _ in REQUESTERS} for r in RECORDS}


# ---------------------------------------------------------------------------
# How long to keep records.  The house policy can set longer periods; never shorter.
# ---------------------------------------------------------------------------
RETENTION: list[dict] = [
    {"record": "Minutes books: Board, committees and general meetings", "keep": "Permanently",
     "law": "Companies Act 2013, Sec. 118; SS-1 and SS-2", "note": "Keep the signed originals in the CS office's custody."},
    {"record": "Register of members, register of charges, MBP-2 and MBP-4 registers", "keep": "Permanently",
     "law": "Companies (Management and Administration) Rules 2014; Registration of Charges Rules 2014; Meetings of Board Rules 2014",
     "note": "Instruments of charge: 8 years from the date the charge is satisfied.", "verify": "Confirm the rule numbers against the current Rules."},
    {"record": "Annual returns and copies of certificates and documents filed with them", "keep": "8 years from filing",
     "law": "Companies (Management and Administration) Rules 2014", "verify": "Confirm the current rule."},
    {"record": "Books of account and vouchers", "keep": "8 financial years before the current year",
     "law": "Companies Act 2013, Sec. 128(5)", "note": "Longer if an investigation has been ordered."},
    {"record": "Attendance registers, office copies of notices, proxies and postal ballot papers", "keep": "At least 8 years (attendance register); proxies and ballots until the period for challenge is over",
     "law": "SS-1, SS-2; Companies Act 2013, Sec. 105, 110"},
    {"record": "GST records", "keep": "72 months from the due date of the annual return for the year",
     "law": "CGST Act 2017, Sec. 36", "note": "Longer if an appeal or proceeding is pending."},
    {"record": "Patient medical records (in-patients)", "keep": "At least 3 years from the start of treatment by law. The hospital's MRD policy sets longer periods; follow it.",
     "law": "IMC Regulations 2002, Reg. 1.3.1; LHRC Medical Records manual (LHRC/PPM/27)",
     "note": "Medico-legal cases: keep until all proceedings, including appeals, are over. Records of minors: at least until the patient turns 21 plus the limitation period."},
    {"record": "PCPNDT records (Form F, consent forms, images)", "keep": "2 years, or until any proceeding ends", "law": "PC&PNDT Act 1994, Sec. 29"},
    {"record": "MTP admission register and opinion forms", "keep": "5 years from the end of the calendar year", "law": "MTP Regulations 2003",
     "verify": "Confirm the period in the current Regulations."},
    {"record": "Transplant Authorisation Committee files and interview videos", "keep": "Permanently (house practice)",
     "law": "THOTA 1994 and Rules 2014", "note": "The Appropriate Authority can inspect them at any time. Keep the videos securely with an index."},
    {"record": "Ethics Committee and clinical trial records", "keep": "At least 5 years after the trial is completed",
     "law": "New Drugs and Clinical Trials Rules 2019", "verify": "Check the CTA too: sponsors often ask for longer."},
    {"record": "Bio-Medical Waste records", "keep": "5 years", "law": "Bio-Medical Waste Management Rules 2016"},
    {"record": "IT and security logs", "keep": "180 days on a rolling basis, within India", "law": "CERT-In Directions 2022"},
    {"record": "Personal data generally (patients, staff, visitors)", "keep": "Only as long as the purpose needs, or as another law requires; then erase",
     "law": "DPDP Act 2023, Sec. 8(7); DPDP Rules 2025",
     "verify": "The DPDP Rules 2025 set minimum log retention and erasure timelines and are being phased in. Confirm what is in force."},
    {"record": "POSH complaint files", "keep": "No period is fixed by the Act. Keep them securely for at least 8 years, and longer if litigation is pending (house practice).",
     "law": "POSH Act 2013"},
    {"record": "Contracts", "keep": "The term of the contract plus 8 years", "law": "Limitation Act 1963 (3 years for most contract claims); Companies Act 2013, Sec. 128",
     "note": "Leases, title deeds and IP assignments: permanently."},
    {"record": "Litigation files", "keep": "Until the case is finally disposed of and the appeal period is over, then 3 years", "law": "House practice"},
]

DESTRUCTION_STEPS = [
    "Destroy records only under the Board-approved Preservation of Documents / Records Retention policy.",
    "Never destroy anything under a litigation hold, a pending notice or an inspection, even if its period has expired.",
    "Prepare a list of the records to be destroyed. The department head and the CS approve it.",
    "Shred paper and wipe electronic copies securely. Keep a destruction register: what was destroyed, when, by whom and the approval.",
]
