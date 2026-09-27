from datetime import date

from cs_assistant import calendar as cal

ALL = {k: True for k in cal.PROFILE_FLAGS}


def by_id(occ, item_id):
    return [o for o in occ if o.item.id == item_id]


def test_agm_linked_dates_follow_agm():
    occ = cal.occurrences(2026, ALL, agm_date=date(2026, 9, 25))
    assert by_id(occ, "aoc4")[0].due == date(2026, 10, 25)
    assert by_id(occ, "mgt7")[0].due == date(2026, 11, 24)
    assert by_id(occ, "adt1")[0].due == date(2026, 10, 10)


def test_default_agm_is_30_september():
    occ = cal.occurrences(2026, ALL)
    assert by_id(occ, "aoc4")[0].due == date(2026, 10, 30)
    assert by_id(occ, "mgt7")[0].due == date(2026, 11, 29)


def test_fixed_dates_fall_in_right_calendar_year():
    occ = cal.occurrences(2026, ALL)
    assert [o.due for o in by_id(occ, "msme1_h2")] == [date(2026, 4, 30)]
    assert by_id(occ, "posh_report")[0].due == date(2027, 1, 31)
    assert by_id(occ, "dpt3")[0].due == date(2026, 6, 30)
    assert by_id(occ, "fla")[0].due == date(2026, 7, 15)
    assert by_id(occ, "cra2")[0].due == date(2026, 9, 27)


def test_monthly_items_twelve_times_and_march_tds_is_30_april():
    occ = cal.occurrences(2026, ALL)
    tds = by_id(occ, "tds_deposit")
    assert len(tds) == 12
    assert tds[0].due == date(2026, 5, 7) and tds[-1].due == date(2027, 4, 30)
    assert len(by_id(occ, "pcpndt_formf")) == 12


def test_profile_switches_hide_items():
    occ = cal.occurrences(2026, {})
    ids = {o.item.id for o in occ}
    assert "fla" not in ids and "pas6_h1" not in ids and "gstr3b" not in ids
    assert "aoc4" in ids and "mgt7" in ids


def test_status_labels():
    t = date(2026, 9, 27)
    assert cal.status_for(date(2026, 9, 20), t, False)[0] == "overdue"
    assert cal.status_for(t, t, False)[0] == "today"
    assert cal.status_for(date(2026, 10, 5), t, False)[0] == "soon"
    assert cal.status_for(date(2026, 9, 20), t, True) == ("done", "Done")


def test_keys_are_unique():
    occ = cal.occurrences(2026, ALL)
    assert len({o.key for o in occ}) == len(occ)
