# Rank engine — pytest suite, parity-checked against the shared cross-
# language fixture `rank_vectors.json` (same role as `phase9_vectors.json`
# for the XP engine, and `app/src/rank/rankVectors.test.ts` on the TS side).
# Every `expect` here must be reproduced by `evaluate_rank` exactly (all
# integers) -- a failure means the *engine*, not just this test, drifted
# from the shared fixture.
from __future__ import annotations

import json
from pathlib import Path

import pytest

import rank_engine

HERE = Path(__file__).resolve().parent
VECTORS_PATH = HERE / "rank_vectors.json"


def _load_vectors():
    with open(VECTORS_PATH, encoding="utf-8") as f:
        return json.load(f)


VECTORS = _load_vectors()
VECTORS_BY_NAME = {v["name"]: v for v in VECTORS}


def _run(vector):
    asof_epoch_day = rank_engine.epoch_day_of(vector["asof"])
    return rank_engine.evaluate_rank(vector["sets"], vector["vetoes"], asof_epoch_day)


@pytest.mark.parametrize("vector", VECTORS, ids=[v["name"] for v in VECTORS])
def test_vector_reproduces_expect(vector):
    result = _run(vector)
    expect = vector["expect"]
    actual = {
        "xp": result["state"]["xp"],
        "slipOffset": result["state"]["slipOffset"],
        "rankId": result["rank"]["rankId"],
        "peakRankId": result["peakRankId"],
        "slipsApplied": result["slipsApplied"],
    }
    assert actual == expect, f"{vector['name']}: {actual} != {expect}"


def test_vectors_file_covers_every_required_scenario():
    # Guards against silently losing coverage if the fixture file is hand-edited.
    required_substrings = [
        "empty", "xp_only", "missed_week", "stack", "excused", "cold_open",
        "reset_to_floor", "kratos", "floor_no_underflow", "current_in_progress",
    ]
    names = " ".join(VECTORS_BY_NAME)
    for s in required_substrings:
        assert s in names, f"no vector name mentions {s!r}"


def test_vectors_file_has_at_least_twelve_cases():
    assert len(VECTORS) >= 12


# ─── targeted behavioral assertions (independent of the exact recorded
# numbers, mirroring test_progress.py's style) ─────────────────────────────

def test_one_unexcused_missed_week_drops_exactly_one_division():
    v = VECTORS_BY_NAME["one_unexcused_missed_week_one_slip"]
    result = _run(v)
    assert result["slipsApplied"] == 1
    assert result["rank"]["rankId"] == v["expect"]["rankId"]


def test_consecutive_misses_stack_and_peak_never_drops():
    v = VECTORS_BY_NAME["consecutive_missed_weeks_stack_and_peak_never_drops"]
    result = _run(v)
    assert result["slipsApplied"] == 3
    assert result["peakRankId"] > result["rank"]["rankId"]


def test_fully_excused_week_causes_no_slip():
    v = VECTORS_BY_NAME["fully_excused_week_no_slip"]
    result = _run(v)
    assert result["slipsApplied"] == 0


def test_cold_open_catchup_applies_all_missed_weeks_in_one_pass():
    v = VECTORS_BY_NAME["cold_open_catchup_four_elapsed_missed_weeks"]
    result = _run(v)
    assert result["slipsApplied"] == 4
    # xp itself is never touched by slips, only slipOffset.
    assert result["state"]["xp"] == v["expect"]["xp"]


def test_kratos_slip_lands_on_nike_i_and_peak_stays_at_kratos():
    v = VECTORS_BY_NAME["kratos_apex_reached_then_slip_lands_on_nike_i"]
    result = _run(v)
    assert result["rank"]["tierName"] == "Nike"
    assert result["rank"]["divisionLabel"] == "I"
    assert result["rank"]["isApex"] is False
    assert result["peakRankId"] == rank_engine.MAX_ABS_DIVISION  # Kratos was reached


def test_floor_cannot_underflow():
    v = VECTORS_BY_NAME["floor_no_underflow_from_rank_zero"]
    result = _run(v)
    assert result["rank"]["posXp"] == 0
    assert result["rank"]["rankId"] == 0


def test_current_in_progress_week_xp_is_awarded_live_with_no_slip():
    v = VECTORS_BY_NAME["current_in_progress_week_awards_live_xp_no_slip"]
    result = _run(v)
    assert result["slipsApplied"] == 0
    assert result["state"]["xp"] == v["expect"]["xp"]


def test_sets_cap_saturates_session_xp():
    v = VECTORS_BY_NAME["session_sets_cap_saturates_xp"]
    result = _run(v)
    assert result["state"]["xp"] == 22  # 6 + 2*8, not 6 + 2*20


def test_session_xp_unit_cases():
    assert rank_engine.session_xp(8, False) == 22
    assert rank_engine.session_xp(20, False) == 22  # cap saturates
    assert rank_engine.session_xp(0, True) == 6
    assert rank_engine.session_xp(12, True) == 6
    assert rank_engine.session_xp(3, False) == 12
    assert rank_engine.session_xp(0, False) == 6


def test_get_rank_boundaries():
    cases = [
        (0, 0, "Initiate", "III", False),
        (149, 0, "Initiate", "III", False),
        (150, 1, "Initiate", "II", False),
        (449, 2, "Initiate", "I", False),
        (450, 3, "Ephebe", "III", False),
        (8850, 59, "Nike", "I", False),
        (9000, 60, "Kratos", None, True),
        (50000, 60, "Kratos", None, True),
    ]
    for pos_xp, rank_id, tier_name, division_label, is_apex in cases:
        view = rank_engine.get_rank(rank_engine.RankState(xp=pos_xp, slipOffset=0))
        assert view["rankId"] == rank_id, pos_xp
        assert view["tierName"] == tier_name, pos_xp
        assert view["divisionLabel"] == division_label, pos_xp
        assert view["isApex"] == is_apex, pos_xp


def test_apply_slip_reset_to_floor_worked_example():
    # Div-9 140/150 slips to Div-8 0/150; xp itself is untouched; 290 xp
    # exactly restores the pre-slip posXp/rankId.
    pre_slip = rank_engine.RankState(xp=1490, slipOffset=0)
    pre = rank_engine.get_rank(pre_slip)
    assert pre["rankId"] == 9
    assert pre["xpIntoDivision"] == 140

    post_slip = rank_engine.apply_slip(pre_slip)
    post = rank_engine.get_rank(post_slip)
    assert post["rankId"] == 8
    assert post["posXp"] == 1200
    assert post["xpIntoDivision"] == 0
    assert post_slip.xp == 1490

    returned = rank_engine.apply_xp_gain(post_slip, 290)
    returned_view = rank_engine.get_rank(returned)
    assert returned_view["posXp"] == 1490
    assert returned_view["rankId"] == 9
