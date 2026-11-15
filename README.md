# CS Assistant

An internal website for the **Company Secretary and Legal team** of a hospital company in India (built for VPS Lakeshore / Lakeshore Hospital & Research Centre Ltd, Kochi).

It is made for people who do not want to learn new software: big text, eight big buttons, plain English, and a **Back to Home** button on every screen. Each person signs in with their own username. The site keeps the office's documents in a searchable **Document library** that everyone can refer to and work from.

| Button | What it does |
|---|---|
| **1. Ask a question** | Company law, FEMA, hospital licensing, contracts, disputes. Answers quote the section and form, check official sites (MCA, RBI, India Code...) when needed, and remember the conversation for follow-ups. |
| **2. Check a document** | Upload an NDA, agreement, legal notice, regulator's notice or Board paper (PDF, Word or a scanned picture). You get a **GREEN / AMBER / RED** verdict, a table of problems, ready-to-paste replacement clauses, stamp duty and approval points, and questions for the other side. Then ask for changes ("redraft clause 9 in our favour"). |
| **3. Write a document** | 23 ready document types: Board notice & agenda, minutes from rough notes, resolutions and CTCs, AGM notice, NDA, consultant doctor agreement, vendor / equipment / lease agreements, MoUs, clinical trial agreements, DPA, legal notice and replies, consumer case written version, policies, privacy notice. Download in **Word**. |
| **4. Filing calendar** | Every recurring filing worked out for the financial year: MCA forms, AGM-linked dates, FEMA, PCPNDT, Bio-Medical Waste, POSH (and optionally tax/GST/labour). Colour-coded by urgency; **Mark as done** with the SRN. |
| **5. Something happened?** | Checklists for events such as a new director, a loan or charge, a share allotment (with FC-GPR), a related party contract, a legal notice, a consumer case, a data leak or new radiology equipment. |
| **6. Licences & renewals** | Hospital licence register (AERB, PCPNDT, THOTA, drugs, BMW, fire, lifts, NABH, empanelments...). Warns 90 and 30 days before expiry. |
| **7. Can we share this?** | Someone wants our records: a shareholder, a director, the police, a court, an insurer, a patient's family, the group parent, a buyer's lawyers. Choose the record and the requester to get a first answer (**yes / yes with conditions / get approval first / no**), with the conditions and the law (Companies Act Sec. 94, 119, 128, 171; BNSS Sec. 94; IMC Regulations 72-hour rule; DPDP Act; HIV, MTP, POCSO, MHCA and POSH confidentiality). Then **log the request** in the Requests register, ask the assistant to confirm, or draft the reply. A **How long to keep records** tab gives the retention schedule and the steps before destroying anything. |
| **8. Committees & decisions** | **Directors & KMP:** each director's annual MBP-1, DIR-8 and independence declaration, DIR-3 KYC (three-year cycle, with a yearly option), IICA databank renewal, term end and AGM regularisation, and DIR-12 after a cessation, with what is due and by when. One click drafts the letter asking directors for this year's disclosures. **Committees:** Board committees and the hospital's statutory committees (Audit, NRC, CSR, Executive, Transplant Authorisation, Ethics, POSH IC, NABH committees), pre-loaded, with members, last meeting, when the next is due and when reconstitution or re-registration is due. **Transplant files:** each living-donor file for the Authorisation Committee, with the document checklist for the kind of donor (near relative, spouse, unrelated, swap, foreign national) and the steps after the decision. **Board decisions:** who must act on what, by when. One click writes the **Action Taken Report** for the next Board meeting. |

| **9. Board meetings & portal** | **For the CS team:** set up each Board or committee meeting (date, mode, venue, video link, who is invited), add the agenda items with their papers and draft resolutions, and **publish** them to the directors. Checks show whether notice and papers went out at least 7 days before (SS-1), the gap since the last Board meeting (120-day rule) and whether a video meeting has its link. A table shows who will attend and who has opened the papers. Papers can be **withheld from interested directors** (Sec. 184). Replacing a paper keeps the old one and flags the item as revised. One click writes the notice and agenda, or the minutes, from the meeting. **Resolutions by circulation (Sec. 175):** send to all directors, mark interested directors, and watch the count (majority of directors entitled to vote; one-third can ask for a meeting). Passed resolutions go onto the next meeting's agenda for noting. **Minutes (SS-1):** after the meeting, upload the draft minutes and circulate them; directors reply with comments or "no comments" in the portal within 7 days. Revised drafts can go out again. Record the Chairperson's signature with the signed copy, which is also filed in the library. Checks show the 15-day and 30-day dates. **E-mail:** directors are told when papers are published, a resolution is circulated or minutes are ready, and you can chase those who have not replied or not read their papers. E-mails carry only a sign-in link, never the papers. **For directors:** a separate sign-in, with a code from an authenticator app as well as the password, that shows only the **Board portal**. Directors see their meetings and read each paper in the built-in viewer, where they can highlight passages and add comments that only they can see. They can also open the whole pack as one bookmarked PDF stamped with their name. They keep private notes on each item, say whether they will attend, comment on draft minutes, read the signed minutes, and approve or dissent on circular resolutions. It works on a tablet or phone. |
| **Document library** | The CS office's documents in folders: constitution (MOA/AOA), Board and general meetings, statutory registers, MCA filings, director records, policies and delegation of powers, contracts, licences, FEMA, litigation, templates and precedents, laws and opinions. It offers:<br>• search across titles and the words inside PDFs and Word files<br>• preview in the browser, and download<br>• new versions uploaded on top of old ones (older versions are kept)<br>• one-click **Ask about this document**, **Check this document** or **Use it to write a new document**<br>• **Save to library** after any answer or draft, which stores a Lakeshore-format Word file |

**The assistant uses the library.** When a question depends on the company's own papers ("what does our AOA say about quorum?", "what did the Board approve on borrowing?"), the assistant searches the library itself and reads the relevant documents. It names the documents it relied on, with links to open them. When drafting, it looks for our own templates and precedents; when checking a document, it compares it with our approved formats and policies.

Also: **Guides & official links** (the MCA, RBI, AERB and other portals, plus the CS responsibilities guide) and **Settings** (company details, users, activity log, backup).

**Look and feel.** The screens and every Word file use the VPS Lakeshore 2.0 brand ("In good hands"). That means DM Sans, navy `#001E5F` with a single magenta accent, cream panels and the official logo. Word files are built on the house document grammar: the kicker, a reference pill (`LHRC/LEG/NDA/2026/[NNN]`), a navy title rule, navy-header tables and magenta clause numbers, with "Template for guidance · Have Legal review before execution" in the footer. DM Sans is embedded in each file, so documents look right on PCs that do not have the font installed.

The areas of work this tool covers, and why, are set out in [docs/CS_RESPONSIBILITIES.md](docs/CS_RESPONSIBILITIES.md).

---

## Two ways to run it

- **On claude.ai, as a private artifact (no server).** Built from `artifact/` with `python artifact/build.py`, then published as a claude.ai artifact. Access is managed with the artifact's Share menu:
  - **Editors** add library files and change company details.
  - **Contributors** ask, check and draft; they also mark filings and update licences.
  - **Viewers** read.

  The assistant runs on each viewer's own Claude account, and the page's own storage holds the records and library files. It cannot look things up on the web, and it reads long documents in parts.
- **On your own server** (the rest of this README). This version adds web look-ups of official sites, individual logins and a backup file.

Both versions share the same legal knowledge, calendar, checklists and document types (`cs_assistant/`), so improve those once and rebuild.

## Setting it up (for IT)

### Option A - an internal site for the team (recommended)

Run it on a hospital server and give the team an address such as `https://cs.lakeshore.internal`.

1. On a Linux server with Docker, copy this folder and create `.env` from `.env.example` with:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   COOKIE_SECURE=1
   ADMIN_USERNAME=cs
   ADMIN_NAME=<Company Secretary's name>
   ADMIN_PASSWORD=<a strong password - change it after first sign-in>
   ```
2. `docker compose up -d`. The site listens on port 8080 of the server itself only.
3. Put it behind HTTPS with the hospital's reverse proxy. `deploy/nginx.conf` is a ready example. It turns off buffering so answers appear as they are written, and allows uploads of up to 120 MB. It can also be limited to the hospital network.
4. Sign in as the administrator. Then:
   - **Settings → People who can use this site**: add the rest of the team.
   - **Settings → Company details**: check the company name, CIN and the switches (unlisted public company, foreign investment, CSR, cost audit and so on). They decide which filings appear in the calendar.
5. **Back up the `data` folder every night.** It holds the database and every library file. **Settings → Download a full backup** also gives one zip file.

Without Docker, a Linux server can use `deploy/cs-assistant.service` (systemd + gunicorn). If `ADMIN_USERNAME` is not set, the first person to open the site sees a one-time "Create the administrator" screen, so open it yourself straight after installing.

**Do not publish it on the internet or on a public GitHub Pages site.** The library holds confidential company records, and the site needs its server for the AI, the database and the files.

### Option B - one PC

1. Install **Python 3.10 or newer**, copy this folder, and create `.env` with the `ANTHROPIC_API_KEY`.
2. **Windows:** double-click `start.bat`. **Mac / Linux:** run `./start.sh`. The browser opens at **http://localhost:8080**.
3. Create the administrator on the first screen.

The library, Filing calendar, Something happened? and Licences screens work even without the API key.

### Who can do what

| | Director | Member | Administrator |
|---|---|---|---|
| Board portal: the meetings and circular resolutions sent to them, their own notes, attendance and replies | Yes | - | - |
| Ask, Check, Write, calendar, licences, events, Board meetings | - | Yes | Yes |
| Add, update, version and remove library documents | - | Yes | Yes |
| Restore removed documents | - | - | Yes |
| Change company details, manage users, see the activity log, download backups | - | - | Yes |

Directors are added in **Settings → People who can use this site** with the role **Director (Board portal only)** and their e-mail address. The server refuses every other page to them, so they cannot reach the library, the registers or the assistant. When a director leaves, switch their login off and they are signed out at once. Every paper opened and every pack downloaded goes into the activity log.

**Two-step sign-in.** At their first sign-in, directors scan a QR code with Google or Microsoft Authenticator. After that they type the 6-digit code from the app after their password. They also get eight one-time recovery codes for a lost phone. If a phone is lost, an administrator ticks **Reset two-step sign-in** for that person. `TWO_STEP` in `.env` decides who must use it: `directors` (the default), `all` or `off`. Anyone can turn it on for themselves in Settings. Changing a password, resetting two-step sign-in or switching a person off ends all their other sign-ins at once.

**E-mail.** Fill in `SMTP_HOST`, `SMTP_FROM` and the other SMTP settings, and `SITE_URL` (see `.env.example`), to use the hospital's own mail server. Every e-mail sent, and any that bounced, is listed on the meeting or resolution page.

**Before giving directors access from outside the hospital:** serve the site over HTTPS only (`COOKIE_SECURE=1`), have IT decide whether to publish it beyond the hospital network, and get each director's written agreement to receive Board papers electronically (needed for Sec. 175 and SS-1 delivery). Recording the signed minutes is a record, not an e-signature: keep the Chairperson's signed copy. The Board portal is only in the self-hosted version, not the claude.ai artifact.

Every change is recorded in the activity log with the person's name: documents added, changed or removed, filings marked, licences, settings, users and sign-ins. Nothing in the library is ever deleted outright. "Remove" hides a document, and older versions are always kept.

### Settings (in `.env`)

| Setting | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Needed for Ask, Check and Write |
| `CS_MODEL` | `claude-opus-5` | Claude model used |
| `CS_EFFORT_ASK` / `CS_EFFORT_DOCS` | `medium` / `high` | How hard the model thinks for questions and for documents. Higher is slower but more thorough. |
| `CS_WEB_SEARCH` | `1` | Lets answers look things up on official Indian government and professional sites only |
| `CS_FALLBACKS` | `1` | If the main model declines a request, retry automatically on Anthropic's recommended fallback model |
| `ADMIN_USERNAME`, `ADMIN_NAME`, `ADMIN_PASSWORD` | none | Creates the first administrator on first start |
| `COOKIE_SECURE` | `0` | Set to `1` when the site is served over HTTPS |
| `SECRET_KEY` | generated | Signs the sign-in cookie; stored in the data folder if not set |
| `HOST`, `PORT` | `127.0.0.1`, `8080` | Where it listens (Option B) |
| `CS_DATA_DIR` | `./data` | Where the database and library files are kept |

---

## Privacy and records

- **Library documents** are stored on your own server in `data/library/`, with their details and searchable text in `data/cs_assistant.db`. Only signed-in users can see them.
- **Sent to the AI:** a document's text goes to the Claude API, over an encrypted connection, when someone attaches it to a question, check or draft, or when the assistant searches the library to answer. Files attached only for one question are kept in memory and cleared after 8 hours. Anthropic does not train on API data by default. Review your organisation's data agreements before uploading patient information, and redact patient identifiers where you can.
- **Sign-in:** passwords are stored only as salted hashes. Sign-in cookies are HTTP-only and same-site (secure-only with `COOKIE_SECURE=1`). Five wrong passwords lock that username for five minutes.

## Accuracy

The legal content was prepared as at September 2026. It reflects the BNS/BNSS/BSA, the Income-tax Act 2025, the Labour Codes and the DPDP Rules 2025. The law changes often, so the tool flags points to confirm on the official portal. It is a well-read assistant, not a replacement for the CS's judgement or an advocate's opinion.

- The fixed calendar data is in `cs_assistant/calendar.py`. Each item has its section, due-date rule and a "please check" note. Edit it there if a date changes.
- The assistant's standing instructions and legal background are in `cs_assistant/knowledge.py`.
- The document types and their questions are in `cs_assistant/documents.py`.
- Who may see which records, and the retention schedule, are in `cs_assistant/records.py`.
- The committees, transplant file checklist and other registers are in `cs_assistant/registers.py`.
- Board meetings, the directors' portal, circular resolutions and the combined PDF pack are in `cs_assistant/board.py` (screens in `static/board.js`). Papers are kept in `data/board/` and are included in the backup. The screen logic shared by both versions is in `static/registers.js`.

## For developers

```
python -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
.venv/bin/python -m pytest -q      # tests run against a local fake of the Claude API
.venv/bin/python app.py
```

- `app.py` is the Flask server and JSON / streaming API, including sign-in, users and the activity log.
- `cs_assistant/library.py` is the document library. Files are on disk, versions and search (SQLite FTS5) in the database.
- `static/` holds the front end: plain HTML, CSS and JS, with no build step and no internet libraries. The Board paper viewer uses pdf.js (Apache 2.0), kept in `static/vendor/pdfjs/`. The brand logo is in `static/brand/` and DM Sans (SIL Open Font Licence) is in `static/fonts/`.
- `cs_assistant/export.py` builds the Word files in the Lakeshore template. The tokens at the top of that file match the brand book.
- `cs_assistant/llm.py` makes the Claude calls. They are streamed and use adaptive thinking and prompt caching (the system prompt and uploaded documents). They carry two library tools (`search_library`, `read_library_document`) and web search restricted to official domains.
