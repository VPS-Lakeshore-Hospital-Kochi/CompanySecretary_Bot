"""Compliance calendar: the recurring filings a Company Secretary tracks.

Everything here works without the AI. Dates are worked out for an Indian
financial year (1 April to 31 March). Each item says in plain words what it is,
the law behind it, who normally handles it and when it falls due.

The legal position was checked as of September 2026, but rules change often.
Every item carries a `verify` note where the position recently changed, and the
screen always tells the user to confirm on the MCA / RBI / regulator portal.
"""

from __future__ import annotations

import calendar as _cal
from dataclasses import dataclass, field
from datetime import date, timedelta

# Categories shown as filter buttons on the calendar screen.
CATEGORIES = {
    "company": "Company Law (MCA / RoC)",
    "board": "Board & Meetings",
    "fema": "Foreign Investment (RBI / FEMA)",
    "hospital": "Hospital Regulators",
    "tax_labour": "Tax, GST & Labour (with Finance / HR)",
}

# Company-profile switches that decide whether an item applies.
PROFILE_FLAGS = {
    "unlisted_public": "Unlisted public company",
    "listed": "Shares listed on a stock exchange",
    "foreign_investment": "Has foreign shareholding / FDI",
    "csr": "CSR applies (Section 135)",
    "cost_audit": "Cost audit applies",
    "secretarial_audit": "Secretarial audit applies (Section 204)",
    "pcpndt": "Has ultrasound / imaging registered under PCPNDT Act",
    "track_tax_labour": "Also show tax, GST and labour due dates (handled by Finance / HR)",
}


@dataclass
class Item:
    id: str
    title: str
    what: str
    law: str
    category: str
    who: str
    rule: tuple
    form: str = ""
    applies_if: str | None = None
    penalty: str = ""
    verify: str = ""
    tip: str = ""
    # Which period the filing covers; {fy}=this FY, {pfy}=previous FY, {y}=FY start year.
    period_fmt: str = "FY {fy}"


@dataclass
class Occurrence:
    item: Item
    due: date
    period: str
    extra: dict = field(default_factory=dict)

    @property
    def key(self) -> str:
        return f"{self.item.id}@{self.due.isoformat()}"


ITEMS: list[Item] = [
    # ----------------------------------------------------------- Board & meetings
    Item(
        "board_meeting", "Board Meeting (quarterly)",
        "Hold a Board meeting. The law needs at least four in a year, with not "
        "more than 120 days between two meetings. Send notice at least 7 days before.",
        "Companies Act 2013, Sec. 173; Secretarial Standard SS-1", "board", "CS",
        ("dates", [(6, 30, "quarter Apr-Jun {y}"), (9, 30, "quarter Jul-Sep {y}"), (12, 31, "quarter Oct-Dec {y}"), (3, 31, "quarter Jan-Mar {y1}")]),
        form="Notice, agenda, notes on agenda, minutes",
        penalty="Every officer who fails to give notice of a Board meeting: Rs 25,000 (Sec. 173(4)).",
        tip="Circulate draft minutes within 15 days of the meeting; sign within 30 days (SS-1).",
    ),
    Item(
        "mbp1_dir8", "Directors' disclosures (MBP-1 and DIR-8)",
        "At the first Board meeting of the year collect from every director the "
        "notice of interest (MBP-1) and the declaration of non-disqualification (DIR-8).",
        "Companies Act 2013, Sec. 184(1) and Sec. 164(2)", "board", "CS",
        ("dates", [(6, 30)]),
        form="MBP-1, DIR-8 (kept in records, not filed)",
        tip="Also take fresh MBP-1 whenever a director's interests change. Update the Register of Contracts (MBP-4).",
    ),
    Item(
        "agm", "Annual General Meeting",
        "Hold the AGM within six months of the year end (by 30 September). "
        "Send the notice with the audited accounts and Board's report at least 21 clear days before.",
        "Companies Act 2013, Sec. 96, 101, 129, 134, 136; SS-2", "board", "CS",
        ("dates", [(9, 30)]),
        form="AGM notice, explanatory statement, proxy form, attendance slip",
        penalty="Up to Rs 1 lakh on the company and officers, plus Rs 5,000 per day of default (Sec. 99).",
        tip="Book the Board meeting to approve accounts and Board's report early in August.",
        period_fmt="accounts of FY {pfy}",
    ),
    Item(
        "posh_report", "POSH annual report to District Officer",
        "Internal Committee sends its annual report on sexual-harassment complaints "
        "for the calendar year to the employer and the District Officer (Ernakulam).",
        "Sexual Harassment of Women at Workplace Act 2013, Sec. 21-22", "board", "HR / CS",
        ("dates", [(1, 31)]),
        tip="Number of complaints received and disposed must also appear in the Board's report.",
        period_fmt="calendar year {y}",
    ),
    # ------------------------------------------------------------- Company law
    Item(
        "msme1_h2", "MSME-1 (dues to small suppliers, Oct-Mar)",
        "Half-yearly return of amounts owed to micro and small enterprises for more than 45 days.",
        "Sec. 405 Companies Act; MSMED Act 2006, Sec. 15", "company", "CS / Finance",
        ("dates", [(4, 30)]), form="MSME-1",
        period_fmt="Oct {py} - Mar {y}",
    ),
    Item(
        "msme1_h1", "MSME-1 (dues to small suppliers, Apr-Sep)",
        "Half-yearly return of amounts owed to micro and small enterprises for more than 45 days.",
        "Sec. 405 Companies Act; MSMED Act 2006, Sec. 15", "company", "CS / Finance",
        ("dates", [(10, 31)]), form="MSME-1",
        period_fmt="Apr - Sep {y}",
    ),
    Item(
        "pas6_h2", "PAS-6 (share capital reconciliation, Oct-Mar)",
        "Half-yearly reconciliation of share capital audit report for unlisted public companies.",
        "Companies (Prospectus and Allotment) Rules 2014, Rule 9A(8)", "company", "CS",
        ("dates", [(5, 30)]), form="PAS-6", applies_if="unlisted_public",
        tip="Get the reconciliation report from a practising CS/CA first; RTA provides the data.",
        period_fmt="half-year to 31 Mar {y}",
    ),
    Item(
        "pas6_h1", "PAS-6 (share capital reconciliation, Apr-Sep)",
        "Half-yearly reconciliation of share capital audit report for unlisted public companies.",
        "Companies (Prospectus and Allotment) Rules 2014, Rule 9A(8)", "company", "CS",
        ("dates", [(11, 29)]), form="PAS-6", applies_if="unlisted_public",
        period_fmt="half-year to 30 Sep {y}",
    ),
    Item(
        "dpt3", "DPT-3 (return of deposits / money not treated as deposit)",
        "Annual return of deposits and of loans or money received that are not deposits, as on 31 March, "
        "with auditor's certificate.",
        "Sec. 73; Companies (Acceptance of Deposits) Rules 2014, Rule 16 and 16A", "company", "CS / Finance",
        ("dates", [(6, 30)]), form="DPT-3",
        period_fmt="as on 31 Mar {y}",
    ),
    Item(
        "dir3kyc", "Director KYC (DIR-3 KYC)",
        "KYC of every person holding a DIN.",
        "Companies (Appointment and Qualification of Directors) Rules 2014, Rule 12A", "company", "CS",
        ("dates", [(6, 30)]), form="DIR-3 KYC / DIR-3 KYC-WEB",
        penalty="Rs 5,000 late fee and DIN is deactivated until filed.",
        verify="MCA amended Rule 12A in 2025 to move to a once-in-three-years KYC (due by 30 June) plus an "
               "update within 30 days of any change in mobile, e-mail or address. Confirm the current rule "
               "and which directors are due this year on the MCA portal.",
        period_fmt="FY {fy}",
    ),
    Item(
        "cra2", "CRA-2 (appointment of Cost Auditor)",
        "Intimate appointment of cost auditor: within 30 days of the Board meeting that appoints them, "
        "or within 180 days of the start of the year, whichever is earlier.",
        "Sec. 148; Companies (Cost Records and Audit) Rules 2014, Rule 6", "company", "CS",
        ("fy_start_plus", 179), form="CRA-2", applies_if="cost_audit",
        tip="Healthcare services are covered by the Cost Rules above the turnover thresholds - confirm with the cost auditor.",
    ),
    Item(
        "aoc4", "AOC-4 (financial statements to RoC)",
        "File the audited financial statements (and AOC-4 CFS if there is a subsidiary / associate) "
        "within 30 days of the AGM.",
        "Companies Act 2013, Sec. 137", "company", "CS",
        ("agm_plus", 30), form="AOC-4 / AOC-4 XBRL / AOC-4 CFS",
        penalty="Additional fee of Rs 100 per day; penalty on company and officers under Sec. 137(3).",
        tip="XBRL filing applies to companies with paid-up capital of Rs 5 crore or more, or turnover of Rs 100 crore or more.",
        period_fmt="accounts of FY {pfy}",
    ),
    Item(
        "csr2", "CSR-2 (CSR report)",
        "Report on Corporate Social Responsibility spent for the year, filed with or after AOC-4.",
        "Sec. 135; Companies (CSR Policy) Rules 2014, Rule 12(1A)", "company", "CS",
        ("agm_plus", 30), form="CSR-2", applies_if="csr",
        tip="Unspent amount on ongoing projects must go to the Unspent CSR Account within 30 days of year end.",
        period_fmt="FY {pfy}",
    ),
    Item(
        "adt1", "ADT-1 (auditor appointment)",
        "Intimate appointment / re-appointment of the statutory auditor within 15 days of the AGM "
        "(only in a year when the auditor is appointed).",
        "Companies Act 2013, Sec. 139", "company", "CS",
        ("agm_plus", 15), form="ADT-1",
        period_fmt="AGM {y}",
    ),
    Item(
        "mgt7", "MGT-7 (Annual Return)",
        "File the Annual Return within 60 days of the AGM. A copy must also be placed on the website.",
        "Companies Act 2013, Sec. 92", "company", "CS",
        ("agm_plus", 60), form="MGT-7 (MGT-8 certification if paid-up >= Rs 10 cr or turnover >= Rs 50 cr)",
        penalty="Additional fee of Rs 100 per day; penalty under Sec. 92(5).",
        period_fmt="FY {pfy}",
    ),
    Item(
        "cra4", "CRA-4 (cost audit report)",
        "File the cost audit report within 30 days of receiving it from the cost auditor "
        "(cost auditor must give it within 180 days of year end).",
        "Companies (Cost Records and Audit) Rules 2014, Rule 6(6)", "company", "CS",
        ("fy_start_plus", 209), form="CRA-4 (XBRL)", applies_if="cost_audit",
        period_fmt="FY {pfy}",
    ),
    Item(
        "mr3", "Secretarial Audit Report (MR-3)",
        "Secretarial audit by a practising Company Secretary; report is annexed to the Board's report.",
        "Companies Act 2013, Sec. 204", "company", "CS",
        ("dates", [(8, 15)]), form="MR-3 (annexed to Board's report)", applies_if="secretarial_audit",
        tip="Target date: get the report before the Board meeting that approves the Board's report. Applies to public companies with paid-up capital >= Rs 50 cr, turnover >= Rs 250 cr, or borrowings >= Rs 100 cr.",
        period_fmt="FY {pfy}",
    ),
    # --------------------------------------------------------------------- FEMA
    Item(
        "fla", "FLA Return (Foreign Liabilities and Assets)",
        "Annual return to RBI of foreign investment received / made, as on 31 March.",
        "FEMA 1999; Master Direction - Reporting under FEMA", "fema", "CS / Finance",
        ("dates", [(7, 15)]), form="FLA return on RBI FLAIR portal", applies_if="foreign_investment",
        penalty="Late submission is a contravention; compounding / late submission fee applies.",
        period_fmt="as on 31 Mar {y}",
    ),
    # ----------------------------------------------------------- Hospital regulators
    Item(
        "bmw_annual", "Bio-Medical Waste annual report",
        "Annual report (Form IV) to the Kerala State Pollution Control Board on bio-medical waste generated and disposed.",
        "Bio-Medical Waste Management Rules 2016, Rule 13", "hospital", "Infection Control / Admin",
        ("dates", [(6, 30)]), form="Form IV",
        tip="Also put the annual report on the hospital website.",
        period_fmt="calendar year {py}",
    ),
    Item(
        "pcpndt_formf", "PCPNDT monthly report",
        "Send the monthly report of ultrasound procedures (Form F records) to the Appropriate Authority.",
        "PC&PNDT Act 1994; PC&PNDT Rules 1996, Rule 9(8)", "hospital", "Radiology / Obstetrics",
        ("monthly", 5), applies_if="pcpndt",
        penalty="Record-keeping lapses are treated as offences under the Act - registration can be suspended.",
    ),
    # --------------------------------------------------------- Tax / GST / labour
    Item(
        "tds_deposit", "TDS / TCS payment",
        "Deposit tax deducted at source in the previous month (March deductions: by 30 April).",
        "Income-tax Act 2025 and Rules (earlier Income-tax Act 1961, Sec. 200)", "tax_labour", "Finance",
        ("monthly", 7),
        verify="The Income-tax Act 2025 replaced the 1961 Act from 1 April 2026. Section numbers changed; "
               "confirm due dates with the tax team.",
    ),
    Item(
        "pf_esi", "PF and ESI contributions",
        "Pay Provident Fund and ESI contributions for the previous month.",
        "Code on Social Security 2020 (in force from 21 Nov 2025)", "tax_labour", "HR / Finance",
        ("monthly", 15),
        verify="The four Labour Codes came into force on 21 November 2025. Check the new registers and returns.",
    ),
    Item(
        "gstr1", "GSTR-1 (outward supplies)",
        "Monthly GST return of outward supplies (pharmacy, canteen, rentals and other taxable supplies).",
        "CGST Act 2017, Sec. 37", "tax_labour", "Finance",
        ("monthly", 11),
        tip="Most healthcare services to patients are exempt, but pharmacy sales to outsiders, rentals and food are not.",
    ),
    Item(
        "gstr3b", "GSTR-3B (GST payment)",
        "Monthly summary GST return and tax payment.",
        "CGST Act 2017, Sec. 39", "tax_labour", "Finance",
        ("monthly", 20),
    ),
    Item(
        "tds_return", "TDS quarterly statements",
        "Quarterly TDS statements (salary and non-salary).",
        "Income-tax Act 2025 and Rules", "tax_labour", "Finance",
        ("dates", [(7, 31, "quarter Apr-Jun {y}"), (10, 31, "quarter Jul-Sep {y}"), (1, 31, "quarter Oct-Dec {y}"), (5, 31, "quarter Jan-Mar {y}")]),
        tip="The 31 May date is for the January-March quarter of the year just ended.",
    ),
    Item(
        "advance_tax", "Advance tax instalment",
        "Advance income tax instalments (15%, 45%, 75%, 100%).",
        "Income-tax Act 2025", "tax_labour", "Finance",
        ("dates", [(6, 15, "1st instalment"), (9, 15, "2nd instalment"), (12, 15, "3rd instalment"), (3, 15, "4th instalment")]),
    ),
    Item(
        "itr", "Income tax return and tax audit",
        "Company income tax return with tax audit report.",
        "Income-tax Act 2025", "tax_labour", "Finance",
        ("dates", [(10, 31)]),
        tip="Tax audit report is due one month before the return (30 September).",
        period_fmt="FY {pfy}",
    ),
    Item(
        "gstr9", "GSTR-9 / 9C (GST annual return)",
        "GST annual return and reconciliation statement for the previous year.",
        "CGST Act 2017, Sec. 44", "tax_labour", "Finance",
        ("dates", [(12, 31)]),
        period_fmt="FY {pfy}",
    ),
]

ITEMS_BY_ID = {i.id: i for i in ITEMS}


def _safe_date(year: int, month: int, day: int) -> date:
    last = _cal.monthrange(year, month)[1]
    return date(year, month, min(day, last))


def fy_label(fy_start_year: int) -> str:
    return f"{fy_start_year}-{str(fy_start_year + 1)[-2:]}"


def current_fy_start(today: date) -> int:
    return today.year if today.month >= 4 else today.year - 1


def default_agm_date(fy_start_year: int) -> date:
    """AGM held in the given FY (for accounts of the previous FY): 30 September."""
    return date(fy_start_year, 9, 30)


def _period(item: Item, y: int) -> str:
    return item.period_fmt.format(fy=fy_label(y), pfy=fy_label(y - 1), y=y, py=y - 1)


def occurrences(fy_start_year: int, profile: dict, agm_date: date | None = None,
                categories: set[str] | None = None) -> list[Occurrence]:
    """All due dates falling in the financial year starting 1 April `fy_start_year`."""
    agm = agm_date or default_agm_date(fy_start_year)
    fy_start = date(fy_start_year, 4, 1)
    out: list[Occurrence] = []
    for item in ITEMS:
        if item.applies_if and not profile.get(item.applies_if, False):
            continue
        if categories and item.category not in categories:
            continue
        if item.category == "tax_labour" and not profile.get("track_tax_labour", False):
            continue
        kind = item.rule[0]
        if kind == "dates":
            for month, day, *label in item.rule[1]:
                year = fy_start_year if month >= 4 else fy_start_year + 1
                period = label[0].format(y=fy_start_year, y1=fy_start_year + 1) if label else _period(item, fy_start_year)
                out.append(Occurrence(item, _safe_date(year, month, day), period))
        elif kind == "monthly":
            # Period April..March; due on `day` of the following month.
            for n in range(12):
                pm = (4 + n - 1) % 12 + 1
                py = fy_start_year if pm >= 4 else fy_start_year + 1
                dm = pm % 12 + 1
                dy = py + 1 if pm == 12 else py
                day = item.rule[1]
                if item.id == "tds_deposit" and pm == 3:
                    day = 30  # March TDS is due 30 April
                out.append(Occurrence(item, _safe_date(dy, dm, day),
                                      f"for {_cal.month_name[pm]} {py}"))
        elif kind == "agm_plus":
            out.append(Occurrence(item, agm + timedelta(days=item.rule[1]),
                                  _period(item, fy_start_year),
                                  {"agm_based": True, "agm": agm.isoformat()}))
        elif kind == "fy_start_plus":
            out.append(Occurrence(item, fy_start + timedelta(days=item.rule[1]),
                                  _period(item, fy_start_year)))
    out.sort(key=lambda o: (o.due, o.item.title))
    return out


def status_for(due: date, today: date, filed: bool) -> tuple[str, str]:
    """Return (code, plain-English label) for the screen."""
    if filed:
        return "done", "Done"
    days = (due - today).days
    if days < 0:
        return "overdue", f"OVERDUE by {-days} day{'s' if days != -1 else ''}"
    if days == 0:
        return "today", "Due TODAY"
    if days <= 15:
        return "soon", f"Due in {days} day{'s' if days != 1 else ''}"
    if days <= 45:
        return "upcoming", f"Due in {days} days"
    return "later", f"Due in {days} days"


# ---------------------------------------------------------------------------
# "Something has happened - what must I do?"  Event-based filings.
# ---------------------------------------------------------------------------
EVENTS: list[dict] = [
    {
        "id": "director_appointed",
        "title": "A new Director or Key Managerial Person joins",
        "steps": [
            "Take consent (DIR-2) and declaration of non-disqualification (DIR-8) before appointment; check DIN is active.",
            "Pass Board resolution (additional director / KMP); for independent directors take Sec. 149(7) declaration and check the IICA databank registration.",
            "File DIR-12 with the RoC within 30 days of appointment.",
            "Take MBP-1 disclosure of interest at the first Board meeting attended.",
            "Update Register of Directors and KMP; issue appointment letter (independent directors: letter as per Schedule IV).",
            "Regularise additional director at the next AGM (shareholders' resolution; MGT-14 not needed for ordinary resolution).",
            "If there is foreign shareholding and the director is a foreign national, check FEMA / security clearance requirements.",
        ],
        "law": "Sec. 152, 161, 168, 170, 203; Rules 8 & 18 of Appointment Rules",
    },
    {
        "id": "director_resigns",
        "title": "A Director resigns or leaves",
        "steps": [
            "Receive resignation letter; place it before the Board and note it in minutes.",
            "File DIR-12 within 30 days of receipt of resignation.",
            "Director may file DIR-11 themselves within 30 days (optional).",
            "For an independent director, record the detailed reasons; appoint a replacement within 3 months (if required by Sec. 149).",
            "Update Register of Directors; check if the Board / committee composition still meets the minimum.",
            "Revoke bank / signing authorities and inform the bankers.",
        ],
        "law": "Sec. 168; Rule 15 of Appointment Rules",
    },
    {
        "id": "special_resolution",
        "title": "A Special Resolution (or certain Board resolutions) is passed",
        "steps": [
            "File MGT-14 within 30 days of passing the resolution with a certified true copy and explanatory statement.",
            "Board resolutions needing MGT-14 include approval of accounts and Board's report, borrowing, and investment decisions listed in Sec. 179(3) (private companies are exempt for some).",
            "Record the resolution in the minutes book and update any registers affected.",
        ],
        "law": "Sec. 117, 179(3)",
    },
    {
        "id": "charge",
        "title": "A bank loan is taken or security (charge) is created / modified / repaid",
        "steps": [
            "Check borrowing is within Sec. 180(1)(c) limit approved by shareholders (special resolution) and Board approval under Sec. 179(3)(d).",
            "File CHG-1 within 30 days of creating or modifying the charge (late filing is allowed within the further periods in Sec. 77 with additional / ad valorem fees).",
            "On full repayment, file CHG-4 within 30 days with the lender's no-dues letter.",
            "Update the Register of Charges (CHG-7) and keep a copy of the instrument.",
            "Check stamp duty on the loan and security documents under the Kerala Stamp Act.",
        ],
        "law": "Sec. 77-87; Companies (Registration of Charges) Rules 2014",
    },
    {
        "id": "share_allotment",
        "title": "Shares are issued / allotted (including to a foreign investor)",
        "steps": [
            "Get shareholder approval (special resolution for preferential / private placement under Sec. 42 & 62(1)(c)); file MGT-14 within 30 days.",
            "Obtain valuation report where required; issue offer letter PAS-4 and keep record of offer PAS-5.",
            "Receive money only in a separate bank account; allot within 60 days of receipt.",
            "File PAS-3 (return of allotment) within 15 days of allotment.",
            "Credit shares in demat form (unlisted public companies must issue securities only in demat).",
            "If the investor is foreign: file FC-GPR on the RBI FIRMS portal within 30 days of allotment; check sectoral cap (hospitals: 100% automatic route).",
            "Update the Register of Members (MGT-1).",
        ],
        "law": "Sec. 39, 42, 62; FEMA (Non-debt Instruments) Rules 2019",
    },
    {
        "id": "share_transfer",
        "title": "Shares are transferred between shareholders",
        "steps": [
            "For demat shares, transfer happens through the depository; for any physical share, use SH-4 (physical transfer of shares of unlisted public companies is restricted - check Rule 9A).",
            "If a foreign party buys from / sells to an Indian resident, file FC-TRS within 60 days of receipt / remittance of money; follow pricing guidelines.",
            "Check for significant beneficial owner changes (BEN-1 / BEN-2) and update registers.",
        ],
        "law": "Sec. 56; Rule 9A; FEMA NDI Rules",
    },
    {
        "id": "sbo",
        "title": "Change in Significant Beneficial Owner (SBO)",
        "steps": [
            "Receive BEN-1 declaration from the SBO.",
            "File BEN-2 with the RoC within 30 days of receipt of BEN-1.",
            "Update the Register of Significant Beneficial Owners (BEN-3).",
        ],
        "law": "Sec. 90; Companies (Significant Beneficial Owners) Rules 2018",
    },
    {
        "id": "rpt",
        "title": "A contract with a related party (group company, director, their relatives)",
        "steps": [
            "Check if it is in the ordinary course of business and at arm's length; if not, Board approval under Sec. 188 is needed; above thresholds, shareholders' approval (ordinary resolution, related party not voting).",
            "Audit Committee approval (if the company has one) under Sec. 177.",
            "Interested director must disclose interest (MBP-1) and not take part.",
            "Enter in Register of Contracts (MBP-4); disclose in Board's report (AOC-2).",
            "For transactions with the foreign parent / group, check transfer pricing and FEMA.",
        ],
        "law": "Sec. 184, 188, 177; Rule 15 of Meetings of Board Rules",
    },
    {
        "id": "auditor_resigns",
        "title": "Statutory auditor resigns / casual vacancy",
        "steps": [
            "Auditor files ADT-3 within 30 days of resignation.",
            "Board fills casual vacancy within 30 days; shareholders approve within 3 months (Sec. 139(8)).",
            "File ADT-1 for the new auditor within 15 days.",
        ],
        "law": "Sec. 139(8), 140(2)",
    },
    {
        "id": "registered_office",
        "title": "Registered office is shifted",
        "steps": [
            "Within the same city: Board resolution; file INC-22 within 30 days.",
            "To another city in Kerala: special resolution + MGT-14 + INC-22.",
            "To another state: special resolution, approval of Regional Director (INC-23), alteration of MOA.",
            "Change address on letterhead, website, licences, GST, PAN / TAN and bank records.",
        ],
        "law": "Sec. 12, 13",
    },
    {
        "id": "legal_notice",
        "title": "A legal notice is received (e.g. alleging medical negligence)",
        "steps": [
            "Note the date of receipt and the reply deadline; open a file and inform the Medical Director / unit head.",
            "Intimate the professional indemnity / medical malpractice insurer at once - most policies need prompt notice.",
            "Collect and secure the complete medical records (do not alter them; keep audit trail of the electronic record).",
            "Get a factual note from the treating doctors and nursing staff.",
            "Draft a reply through advocates (use 'Write a document > Reply to legal notice'); do not admit liability.",
            "If the patient asks for records, provide copies within 72 hours as per NMC / IMC regulations, with acknowledgement.",
        ],
        "law": "Consumer Protection Act 2019; Bharatiya Nyaya Sanhita 2023, Sec. 106; NMC / IMC (Professional Conduct) Regulations",
    },
    {
        "id": "consumer_case",
        "title": "A case is filed in the Consumer Commission",
        "steps": [
            "Written version must be filed within 30 days of receiving notice, extendable by up to 15 days only - after 45 days the right to file is lost.",
            "Engage an advocate; share medical records, expert opinion, consent forms and bills.",
            "Inform the indemnity insurer and the concerned doctors (they may be joined as parties).",
            "Keep a case diary with hearing dates.",
        ],
        "law": "Consumer Protection Act 2019, Sec. 35 & 38",
    },
    {
        "id": "data_breach",
        "title": "Patient data leak, cyber attack or ransomware",
        "steps": [
            "Report the cyber incident to CERT-In within 6 hours of noticing it.",
            "Inform the Data Protection Board of India and each affected patient without delay; send a detailed report to the Board within 72 hours (DPDP Rules 2025).",
            "Preserve logs (180 days is required by CERT-In) and evidence; involve IT security and legal counsel.",
            "Inform the insurer if there is a cyber policy; brief the Board / Chairman.",
            "Record the incident, root cause and remedial steps.",
        ],
        "law": "IT Act 2000 Sec. 70B; CERT-In Directions 2022; DPDP Act 2023 & DPDP Rules 2025",
        "verify": "DPDP Rules 2025 came into force in phases; confirm which obligations are already in force.",
    },
    {
        "id": "new_equipment",
        "title": "New radiology / radiation / ultrasound equipment is installed",
        "steps": [
            "AERB: obtain procurement permission / registration / licence on the eLORA portal before use (X-ray, CT, cath lab, radiotherapy, nuclear medicine).",
            "Designate a Radiological Safety Officer; arrange personnel dosimeters (TLD).",
            "Ultrasound: apply to the PCPNDT Appropriate Authority to add the machine to the registration, at least 30 days before any change.",
            "Update the Licences & Renewals register in this tool.",
        ],
        "law": "Atomic Energy (Radiation Protection) Rules 2004; PC&PNDT Rules 1996, Rule 13",
    },
    {
        "id": "new_service",
        "title": "Starting a new service (transplant, blood centre, IVF, dialysis, pharmacy etc.)",
        "steps": [
            "Organ transplant: registration under the Transplantation of Human Organs and Tissues Act (renewed every 5 years); hospital-based Authorisation Committee; K-SOTTO / KNOS registration.",
            "Blood centre: licence from the State Drugs Controller and CDSCO under Drugs & Cosmetics Rules.",
            "IVF / ART: registration under the ART (Regulation) Act 2021 with the National / State Registry.",
            "Pharmacy: retail drug licence (Form 20 / 21); NDPS - Recognised Medical Institution approval for morphine and other essential narcotic drugs.",
            "Psychiatry in-patient: registration with the State Mental Health Authority under the Mental Healthcare Act 2017.",
            "Update Kerala Clinical Establishments registration and the rate display, and add to NABH scope.",
        ],
        "law": "THOTA 1994; Drugs & Cosmetics Act 1940; ART Act 2021; NDPS Act 1985; MHCA 2017; Kerala Clinical Establishments Act 2018",
    },
    {
        "id": "board_meeting_held",
        "title": "A Board or committee meeting has just been held",
        "steps": [
            "Circulate the draft minutes to all directors within 15 days; take comments within 7 days of circulation (SS-1).",
            "Finalise the minutes and get them signed by the chairperson within 30 days of the meeting. Enter them in the minutes book with page numbers.",
            "File MGT-14 within 30 days for resolutions that need it (Sec. 117(3) and 179(3)).",
            "Issue certified true copies to banks, regulators or counterparties who need them.",
            "Update the registers: MBP-1 disclosures, MBP-4 (contracts with interested parties), MBP-2 (loans and investments), directors & KMP.",
            "Enter every decision with its owner and due date in 'Committees & decisions' > Board decisions. That becomes the Action Taken Report for the next meeting.",
            "Note the date in the committee register, and check the next meeting falls within 120 days (Board) or the committee's own cycle.",
        ],
        "law": "Companies Act 2013, Sec. 117, 118, 173, 179; SS-1",
    },
    {
        "id": "records_request",
        "title": "Someone asks for our records (shareholder, police, court, insurer, patient's family)",
        "steps": [
            "Get the request in writing and note the date received and the deadline. A summons or police requisition has a fixed date: diarise it.",
            "Check who is asking and their authority (ID, letter of authority, officer's name and rank, the court's seal).",
            "Use 'Can we share this?' on the home screen to see whether the law allows it and on what conditions.",
            "Patient records: the patient gets copies within 72 hours of a request. For anyone else you need the patient's written consent, a valid requisition or a court order.",
            "Share copies, not originals. Redact other people's details. Mark them 'Confidential', and take an acknowledgement.",
            "Record the request and the outcome in the Requests register. Send anything unusual (media, the parent group, a sensitive record) to Legal first.",
        ],
        "law": "Companies Act 2013, Sec. 94, 119, 128, 171; BNSS 2023, Sec. 94; IMC Regulations 2002, Reg. 1.3.2; DPDP Act 2023",
    },
    {
        "id": "transplant_case",
        "title": "A living-donor transplant file is going to the Authorisation Committee",
        "steps": [
            "Open a file in 'Committees & decisions' > Transplant files, using the case number, not the patient's name. Choose who the donor is to get the right document list.",
            "Check every document on the list is in the file and verified against the originals before fixing the meeting.",
            "Unrelated donor (affection or attachment): check the financial status of both sides and the evidence of association closely. Commercial dealing is an offence (Sec. 18-19).",
            "Foreign national: get the embassy certificate, and confirm the Rules allow this donor-recipient combination.",
            "Fix the meeting with a quorum. Make sure no member is part of the transplant team. Arrange the video recording and an interpreter.",
            "After the meeting: record the decision with reasons, display it on the notice board within the time the Rules allow, and report it to the Appropriate Authority / K-SOTTO.",
            "If approval is refused, tell the applicants in writing of their right of appeal to the State Government.",
        ],
        "law": "THOTA 1994, Sec. 9, 18, 19; THOTA Rules 2014",
        "verify": "Form numbers and timelines are in the THOTA Rules 2014 and Kerala orders. Confirm them against the latest gazetted text and K-SOTTO circulars.",
    },
    {
        "id": "govt_notice",
        "title": "A notice is received from RoC / MCA, RBI, tax or any regulator",
        "steps": [
            "Note the date of receipt, the section invoked and the reply date. Ask for time in writing if needed.",
            "Check the facts from the filings / records; identify any genuine default.",
            "For a genuine default, consider compounding (Sec. 441) or adjudication (Sec. 454) before the matter escalates.",
            "Draft a reply (use 'Check a document' to analyse the notice first) and place the matter before the Board if material.",
        ],
        "law": "Companies Act 2013, Sec. 206, 441, 454",
    },
]

# ---------------------------------------------------------------------------
# Licences a hospital in Kerala usually holds (seeded into the register).
# ---------------------------------------------------------------------------
DEFAULT_LICENCES: list[tuple[str, str]] = [
    ("Kerala Clinical Establishments permanent registration", "District Registering Authority"),
    ("PCPNDT registration (ultrasound)", "PCPNDT Appropriate Authority, Ernakulam"),
    ("AERB licences - X-ray / CT / Cath lab / Radiotherapy", "AERB (eLORA)"),
    ("Organ transplant registration (THOTA)", "Appropriate Authority, Govt. of Kerala"),
    ("Blood centre licence", "State Drugs Controller / CDSCO"),
    ("Retail pharmacy drug licences (Form 20/21)", "State Drugs Controller"),
    ("NDPS - Recognised Medical Institution", "State Drugs Controller"),
    ("Bio-Medical Waste authorisation", "Kerala State Pollution Control Board"),
    ("Consent to Operate (Air & Water Acts)", "Kerala State Pollution Control Board"),
    ("Fire NOC", "Kerala Fire & Rescue Services"),
    ("Lift licences", "Electrical Inspectorate, Kerala"),
    ("Boiler certificate", "Factories & Boilers Department"),
    ("Diesel generator / HT installation approval", "Electrical Inspectorate, Kerala"),
    ("FSSAI licence (kitchen / canteen)", "Food Safety Department"),
    ("Legal Metrology stamping (weighing machines)", "Legal Metrology Department"),
    ("Ethics Committee registration (clinical trials)", "CDSCO / DHR"),
    ("NABH accreditation", "NABH"),
    ("NABL accreditation (laboratory)", "NABL"),
    ("Insurance empanelments (CGHS / ECHS / KASP-PMJAY / TPAs)", "Respective agencies"),
    ("Professional indemnity insurance policy", "Insurer"),
    ("Trade licence / D&O licence", "Local body (Corporation / Panchayat)"),
]
