from cs_assistant import documents, records, registers
from cs_assistant import calendar as cal


def test_every_record_and_requester_has_an_answer():
    m = records.matrix()
    for rec in records.RECORDS:
        for req, _ in records.REQUESTERS:
            d = m[rec["id"]][req]
            assert d["verdict"] in records.VERDICTS and d["summary"]
        for req in rec["by"]:
            assert req in records.REQUESTER_TITLE, f"{rec['id']}: unknown requester {req}"


def test_key_positions():
    assert records.decide("board_minutes", "member")["verdict"] == "no"
    assert records.decide("gm_minutes", "member")["verdict"] == "yes"
    assert records.decide("medical", "public")["verdict"] == "no"
    assert "72 hours" in " ".join(records.decide("medical", "self")["conditions"])
    assert records.decide("posh", "public")["verdict"] == "no"


def test_transplant_checklist_depends_on_donor():
    ids = lambda rel: {i["id"] for i in registers.transplant_items(rel)}
    assert "marriage" in ids("spouse") and "marriage" not in ids("near")
    assert {"affection", "finance"} <= ids("other")
    assert "embassy" in ids("foreign")
    assert all("Form " not in t for _, t, _ in registers.TRANSPLANT_CHECKLIST)  # no form numbers from memory
    relations = {r for r, _ in registers.DONOR_RELATIONS}
    assert {rel for _, _, rel in registers.TRANSPLANT_CHECKLIST} <= relations | {"all"}


def test_new_types_are_wired():
    for d in ("action_taken_report", "committee_constitution", "records_reply", "tac_minutes", "retention_policy"):
        assert d in documents.DRAFT_BY_ID and d in documents.REF_CODES
    assert {"transplant_file", "records_request"} <= set(documents.VET_BY_ID)
    assert {"board_meeting_held", "records_request", "transplant_case"} <= {e["id"] for e in cal.EVENTS}
    preset_keys = {f["key"] for f in registers.REGISTERS["committees"]["fields"]}
    for p in registers.COMMITTEE_PRESETS:
        assert set(p) <= preset_keys
        registers.validate("committees", p)
