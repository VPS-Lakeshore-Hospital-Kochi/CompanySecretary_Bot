# CS Assistant

A simple desk tool for the **Company Secretary and Legal team** of a hospital company in India (built for VPS Lakeshore / Lakeshore Hospital & Research Centre Ltd, Kochi).

It is made for people who do not want to learn new software: big text, six big buttons, plain English, and a **Back to Home** button on every screen.

| Button | What it does |
|---|---|
| **1. Ask a question** | Company law, FEMA, hospital licensing, contracts, disputes. Answers quote the section and form, check official sites (MCA, RBI, India Code...) when needed, and remember the conversation for follow-ups. |
| **2. Check a document** | Upload an NDA, agreement, legal notice, regulator's notice or Board paper (PDF, Word or a scanned picture). You get a **GREEN / AMBER / RED** verdict, a table of problems, ready-to-paste replacement clauses, stamp duty and approval points, and questions for the other side. Then ask for changes ("redraft clause 9 in our favour"). |
| **3. Write a document** | 23 ready document types: Board notice & agenda, minutes from rough notes, resolutions and CTCs, AGM notice, NDA, consultant doctor agreement, vendor / equipment / lease agreements, MoUs, clinical trial agreements, DPA, legal notice and replies, consumer case written version, policies, privacy notice. Download in **Word**. |
| **4. Filing calendar** | Every recurring filing worked out for the financial year: MCA forms, AGM-linked dates, FEMA, PCPNDT, Bio-Medical Waste, POSH (and optionally tax/GST/labour). Red / orange / blue by urgency; **Mark as done** with the SRN. |
| **5. Something happened?** | Checklists for events such as a new director, a loan or charge, a share allotment (with FC-GPR), a related party contract, a legal notice, a consumer case, a data leak or new radiology equipment. |
| **6. Licences & renewals** | Hospital licence register (AERB, PCPNDT, THOTA, drugs, BMW, fire, lifts, NABH, empanelments...). Warns 90 and 30 days before expiry. |

Also: **My saved work** and **Company details** (name, CIN, which rules apply).

The areas of work this tool covers, and why, are set out in [docs/CS_RESPONSIBILITIES.md](docs/CS_RESPONSIBILITIES.md).

---

## Setting it up (for IT, about 10 minutes)

1. Install **Python 3.10 or newer** on the PC or office server.
2. Copy this folder to the machine.
3. Copy `.env.example` to `.env` and put in an Anthropic API key (from https://console.anthropic.com):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
4. Start it:
   - **Windows:** double-click `start.bat`
   - **Mac / Linux:** double-click or run `./start.sh`

   The first start installs what it needs. The browser then opens at **http://localhost:8080**.
5. Open **Company details** once and check the company name, CIN and the switches (unlisted public company, foreign investment, CSR, cost audit, and so on). They decide which filings appear in the calendar.

The Filing calendar, Something happened? and Licences screens work even without the API key.

### Using it for the whole team on the office network

Set these in `.env`, then open `http://<server-name>:8080` from other PCs:

```
HOST=0.0.0.0
APP_PASSWORD=choose-a-strong-password
```

Do not expose it to the internet. For a permanent server, run it behind the hospital's reverse proxy with HTTPS.

### Settings (in `.env`)

| Setting | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Needed for Ask, Check and Write |
| `CS_MODEL` | `claude-opus-5` | Claude model used |
| `CS_EFFORT_ASK` / `CS_EFFORT_DOCS` | `medium` / `high` | How hard the model thinks for questions and for documents. Higher is slower but more thorough. |
| `CS_WEB_SEARCH` | `1` | Lets answers look things up on official Indian government and professional sites only |
| `CS_FALLBACKS` | `1` | If the main model declines a request, retry automatically on Anthropic's recommended fallback model |
| `APP_PASSWORD` | none | Asks for a password when the tool is opened |
| `HOST`, `PORT` | `127.0.0.1`, `8080` | Where it listens |
| `CS_DATA_DIR` | `./data` | Where the small database is kept |

---

## Privacy and records

- Uploaded documents stay in memory only and are cleared after 8 hours. They are sent over an encrypted connection to the Claude API to be read. Anthropic does not train on API data by default. Review your organisation's data agreements before uploading patient information, and redact patient identifiers where you can.
- The database in `data/cs_assistant.db` stores only settings, filings marked done, the licence register and work you choose to save. Back up this file.

## Accuracy

The legal content was prepared as at September 2026. It reflects the BNS/BNSS/BSA, the Income-tax Act 2025, the Labour Codes and the DPDP Rules 2025. The law changes often, so the tool flags points to confirm on the official portal. It is a well-read assistant, not a replacement for the CS's judgement or an advocate's opinion.

- The fixed calendar data is in `cs_assistant/calendar.py`. Each item has its section, due-date rule and a "please check" note. Edit it there if a date changes.
- The assistant's standing instructions and legal background are in `cs_assistant/knowledge.py`.
- The document types and their questions are in `cs_assistant/documents.py`.

## For developers

```
python -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
.venv/bin/python -m pytest -q      # tests run against a local fake of the Claude API
.venv/bin/python app.py
```

- `app.py` is the Flask server and JSON / streaming API.
- `static/` holds the front end: plain HTML, CSS and JS, with no build step and no internet libraries.
- `cs_assistant/llm.py` makes the Claude calls. They are streamed, use adaptive thinking and prompt caching (the system prompt and uploaded documents), and run web search restricted to official domains.
