# Phase 9 — pytest suite for progress.py.
#
# (a) A parametrized replay of phase9_vectors.json: the shared cross-language
#     contract (phase9-xp-spec.md §8). Every `expect` must be reproduced by
#     compute_progress to within 1e-6 — this file is what a TS port has to
#     match too, so a failure here means the *engine*, not just this test,
#     drifted from the recorded fixtures.
# (b) Targeted behavioral assertions for each axis's §8 intent, independent
#     of the exact recorded numbers: one-off PR ~0 vs repeated PR > 0, volume
#     saturates visibly between 1 and 3 sets then flattens (8 junk sets ~= 3
#     clean sets), a returning lifter after a layoff scores volume > 0 (not
#     the old baseline-relative zero), a mid-week evaluation doesn't tank
#     volume vs. an end-of-week one, decay lowers consistency after a gap, a
#     fully-excused week drops out (and beats an un-vetoed zero week),
#     overtraining never exceeds ratio 1, an untrained group (no primary
#     sets) is {xp: 0, level: 0} rather than riding the shared consistency,
#     and the per-month veto cap keeps only the earliest N dates.
# (c) Cardio (§Cardio note): a cardio-only log earns consistency but leaves
#     progression/volume at exactly 0 (never NaN), and interleaving cardio
#     into a strength log leaves the strength axes byte-identical while
#     consistency reflects the added sessions.
from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd
import pytest

import progress

HERE = Path(__file__).resolve().parent
VECTORS_PATH = HERE / "phase9_vectors.json"

SET_COLUMNS = ["uid", "date", "session", "exercise", "kind", "weight", "reps", "set", "duration", "distance"]
EXERCISE_COLUMNS = ["uid", "name", "muscles", "lastWeight"]
GROUP_COLUMNS = ["uid", "name", "order"]

TOL = 1e-6


def _frames(vector):
    sets_df = pd.DataFrame(vector["workouts"], columns=SET_COLUMNS)
    ex_df = pd.DataFrame(vector["registry"]["exercises"], columns=EXERCISE_COLUMNS)
    gr_df = pd.DataFrame(vector["registry"]["groups"], columns=GROUP_COLUMNS)
    return sets_df, ex_df, gr_df


def _run(vector):
    sets_df, ex_df, gr_df = _frames(vector)
    return progress.compute_progress(
        sets_df, ex_df, gr_df,
        vetoes=frozenset(vector["vetoes"]),
        params=vector["params"] or None,
        as_of=vector["asOf"],
    )


def _assert_close(actual, expected, path=""):
    """Recursively compare JSON-shaped structures: floats within TOL,
    everything else exact. Path is threaded through for readable failures."""
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: expected dict, got {type(actual)}"
        assert set(actual.keys()) == set(expected.keys()), f"{path}: key mismatch {actual.keys()} != {expected.keys()}"
        for k in expected:
            _assert_close(actual[k], expected[k], f"{path}.{k}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: expected list, got {type(actual)}"
        assert len(actual) == len(expected), f"{path}: length {len(actual)} != {len(expected)}"
        for i, (a, e) in enumerate(zip(actual, expected)):
            _assert_close(a, e, f"{path}[{i}]")
    elif isinstance(expected, float):
        assert isinstance(actual, (int, float)), f"{path}: expected numeric, got {type(actual)}"
        assert math.isclose(actual, expected, abs_tol=TOL), f"{path}: {actual} != {expected} (tol {TOL})"
    else:
        assert actual == expected, f"{path}: {actual!r} != {expected!r}"


def _load_vectors():
    with open(VECTORS_PATH, encoding="utf-8") as f:
        return json.load(f)


VECTORS = _load_vectors()
VECTORS_BY_NAME = {v["name"]: v for v in VECTORS}


# ─── (a) fixture replay ────────────────────────────────────────────────────
@pytest.mark.parametrize("vector", VECTORS, ids=[v["name"] for v in VECTORS])
def test_vector_reproduces_expect(vector):
    actual = _run(vector)
    _assert_close(actual, vector["expect"], path=vector["name"])


def test_vectors_file_covers_every_required_scenario():
    # Guards against silently losing coverage if the fixture file is hand-edited.
    required_substrings = [
        "empty", "perfect_4x", "decay", "one_off", "repeated_pr", "capped_huge",
        "junk", "clean", "veto", "maturation", "returning", "cardio",
    ]
    names = " ".join(VECTORS_BY_NAME)
    for s in required_substrings:
        assert s in names, f"no vector name mentions {s!r}"


# ─── (b) targeted behavioral assertions ────────────────────────────────────
def test_one_off_pr_is_unconfirmed_but_repeated_pr_is_confirmed():
    one_off = _run(VECTORS_BY_NAME["progression_one_off_pr"])
    repeated = _run(VECTORS_BY_NAME["progression_repeated_pr"])
    assert one_off["components"]["progression"] == pytest.approx(0.0, abs=TOL)
    assert one_off["baselines"]["Bench Press"]["confirmed"] is False
    assert repeated["components"]["progression"] > 0.0
    assert repeated["baselines"]["Bench Press"]["confirmed"] is True


def test_gain_is_capped_not_penalized():
    repeated = _run(VECTORS_BY_NAME["progression_repeated_pr"])
    capped = _run(VECTORS_BY_NAME["progression_capped_huge_jump"])
    # A ~15% held gain and a ~50% held gain both land on DELTA_CAP (0.10) --
    # capping, never a negative/penalizing outcome, and never unbounded.
    assert capped["components"]["progression"] == pytest.approx(repeated["components"]["progression"], abs=TOL)
    assert capped["components"]["progression"] > 0.0


def test_unphysical_unrepeated_jump_is_zeroed_despite_weak_confirm():
    v = _run(VECTORS_BY_NAME["progression_unphysical_unrepeated"])
    # The weak "exceeded baseline in >=2 sessions" test does pass (a modest
    # exceedance elsewhere in the window), so `confirmed` is True -- but the
    # unphysical guard must still zero the actual credited gain because the
    # >75% jump itself was never reproduced.
    assert v["baselines"]["Bench Press"]["confirmed"] is True
    assert v["components"]["progression"] == pytest.approx(0.0, abs=TOL)


def test_volume_saturates_between_one_and_three_sets_then_flattens():
    # Mechanism-driven (§6): ex_vol(1 set) sits below the saturation cap --
    # these inputs do NOT all saturate -- while ex_vol(3 sets) and
    # ex_vol(8 sets) both hit TARGET_CREDIT's cap, so junk beyond 3 sets adds
    # ~nothing. Every session in each fixture uses the same set count, so
    # the decay-weighted mean equals that session's ex_vol directly.
    one = _run(VECTORS_BY_NAME["volume_1_set_undersaturated"])
    clean = _run(VECTORS_BY_NAME["volume_3_clean_sets"])
    junk = _run(VECTORS_BY_NAME["volume_8_junk_sets"])
    assert one["components"]["volume"] < clean["components"]["volume"]
    assert junk["components"]["volume"] == pytest.approx(clean["components"]["volume"], abs=TOL)
    assert junk["components"]["volume"] <= 1.0 + TOL
    assert one["components"]["volume"] == pytest.approx(1.0 / progress.DEFAULT_PARAMS["TARGET_CREDIT"], abs=TOL)


def test_decay_lowers_consistency_after_a_gap():
    before = _run(VECTORS_BY_NAME["decay_before_gap"])
    after = _run(VECTORS_BY_NAME["decay_after_gap"])
    assert after["components"]["consistency"] < before["components"]["consistency"]
    assert after["streak"] == 0  # the gap breaks the streak


def test_fully_excused_week_drops_out_and_beats_the_unvetoed_zero_week():
    veto = _run(VECTORS_BY_NAME["veto_full_week_drops"])
    no_veto = _run(VECTORS_BY_NAME["veto_no_veto_zero_week"])
    # Same log, same empty final week -- but vetoed drops the week (neither
    # helps nor harms) while un-vetoed counts it as ratio_w = 0.
    assert veto["components"]["consistency"] > no_veto["components"]["consistency"]
    last_week_veto = veto["weekly"][-1]
    last_week_no_veto = no_veto["weekly"][-1]
    assert last_week_veto["sessions"] == 0 and last_week_no_veto["sessions"] == 0
    assert last_week_veto["ratio"] == pytest.approx(0.0, abs=TOL)  # dropped week reported as 0, not counted


def test_veto_prorates_a_partial_week_target():
    v = _run(VECTORS_BY_NAME["veto_partial_week_prorate"])
    # Week 4: 5 of 7 days excused, only 2 sessions attended -- the prorated
    # target (4 * 2/7 ~= 1.14) is low enough that 2 sessions still saturates
    # ratio_w at the 1.0 cap, unlike the un-prorated baseline weeks (1
    # session vs. target 4 -> ratio 0.25).
    two_session_weeks = [w for w in v["weekly"] if w["sessions"] == 2]
    assert len(two_session_weeks) == 1
    assert two_session_weeks[0]["ratio"] == pytest.approx(1.0, abs=TOL)
    baseline_weeks = [w for w in v["weekly"] if w["sessions"] == 1]
    assert all(w["ratio"] == pytest.approx(0.25, abs=TOL) for w in baseline_weeks)


def test_veto_month_cap_keeps_only_earliest_n_dates():
    # Direct unit coverage of the non-rolling per-month cap (§5): given more
    # excused dates than the monthly budget, only the earliest `cap` dates
    # (ascending) are honored; the rest are ignored, and unused budget from
    # one month never carries into another.
    vetoes = [
        "2025-03-01", "2025-03-02", "2025-03-03", "2025-03-04",
        "2025-03-05", "2025-03-06", "2025-03-07", "2025-03-08",  # month of March: 8 requested
        "2025-04-01", "2025-04-02",  # a different month: within budget
    ]
    enforced = progress._enforce_veto_cap(vetoes, cap=6)
    assert enforced == {
        "2025-03-01", "2025-03-02", "2025-03-03",
        "2025-03-04", "2025-03-05", "2025-03-06",
        "2025-04-01", "2025-04-02",
    }
    assert "2025-03-07" not in enforced and "2025-03-08" not in enforced


def test_maturation_shifts_weights_toward_consistency_on_long_history():
    fresh = _run(VECTORS_BY_NAME["empty_log"])
    mature = _run(VECTORS_BY_NAME["maturation_long_history"])
    assert fresh["weights"]["progression"] == pytest.approx(progress.DEFAULT_PARAMS["PROG_HI"], abs=TOL)
    assert fresh["weights"]["consistency"] == pytest.approx(progress.DEFAULT_PARAMS["CONS_LO"], abs=TOL)
    assert mature["weights"]["progression"] == pytest.approx(progress.DEFAULT_PARAMS["PROG_LO"], abs=TOL)
    assert mature["weights"]["consistency"] == pytest.approx(progress.DEFAULT_PARAMS["CONS_HI"], abs=TOL)
    # Maturation only reweights -- it must never inflate any axis above 1.
    assert mature["components"]["consistency"] <= 1.0 + TOL
    assert mature["components"]["progression"] <= 1.0 + TOL
    assert mature["components"]["volume"] <= 1.0 + TOL


def test_overtraining_never_inflates_consistency_above_one():
    # 6 sessions in a single week against F_TARGET=4 must still cap ratio_w
    # at 1.0, not reward grinding beyond the target.
    rows = []
    monday = "2025-06-02"  # a Monday
    import datetime
    base = datetime.date.fromisoformat(monday)
    for i in range(6):
        d = (base + datetime.timedelta(days=i)).isoformat()
        rows.append({"uid": "u1", "date": d, "session": f"s{i}", "exercise": "Bench Press",
                     "weight": 100, "reps": 5, "set": 1})
    sets_df = pd.DataFrame(rows, columns=SET_COLUMNS)
    ex_df = pd.DataFrame(VECTORS_BY_NAME["empty_log"]["registry"]["exercises"], columns=EXERCISE_COLUMNS)
    gr_df = pd.DataFrame(VECTORS_BY_NAME["empty_log"]["registry"]["groups"], columns=GROUP_COLUMNS)
    as_of = (base + datetime.timedelta(days=6)).isoformat()
    out = progress.compute_progress(sets_df, ex_df, gr_df, as_of=as_of)
    week_with_sessions = [w for w in out["weekly"] if w["sessions"] == 6]
    assert len(week_with_sessions) == 1
    assert week_with_sessions[0]["ratio"] == pytest.approx(1.0, abs=TOL)
    assert out["components"]["consistency"] <= 1.0 + TOL


def test_returning_lifter_after_layoff_scores_volume_above_zero():
    # §6: volume has no baseline, so a returning lifter (several empty weeks,
    # then one hard session in the current week) must not be scored as zero.
    # The old baseline-relative model computed vbase as the median of mostly-
    # empty trailing weeks -> vbase == 0 -> volume == 0 despite a clean,
    # substantive session having just happened.
    v = _run(VECTORS_BY_NAME["returning_lifter_after_layoff"])
    assert v["components"]["volume"] > 0.0


def test_mid_week_evaluation_does_not_tank_volume_vs_end_of_week():
    # §6: volume is a decay-weighted mean over exercise-sessions that actually
    # happened, not a "this week's total vs. baseline weeks' totals" ratio --
    # so evaluating partway through the current week (only one of several
    # planned sessions done so far) must not make an already-completed,
    # perfectly clean session look worse than evaluating at week's end.
    rows = []
    for wk_start in ["2024-12-30", "2025-01-06", "2025-01-13", "2025-01-20"]:
        for s in range(1, 4):  # 3 clean working sets, one session per week
            rows.append({"uid": "u1", "date": wk_start, "session": f"s_{wk_start}",
                         "exercise": "Bench Press", "weight": 100, "reps": 5, "set": s})
    sets_df = pd.DataFrame(rows, columns=SET_COLUMNS)
    ex_df = pd.DataFrame(VECTORS_BY_NAME["empty_log"]["registry"]["exercises"], columns=EXERCISE_COLUMNS)
    gr_df = pd.DataFrame(VECTORS_BY_NAME["empty_log"]["registry"]["groups"], columns=GROUP_COLUMNS)

    mid_week = progress.compute_progress(sets_df, ex_df, gr_df, as_of="2025-01-22")  # Wednesday
    end_of_week = progress.compute_progress(sets_df, ex_df, gr_df, as_of="2025-01-26")  # Sunday
    assert mid_week["components"]["volume"] == pytest.approx(end_of_week["components"]["volume"], abs=TOL)
    assert mid_week["components"]["volume"] == pytest.approx(1.0, abs=TOL)


def test_per_group_with_no_primary_sets_is_untrained_zero():
    # §7: a group with no primary sets in the window is untrained -> {xp: 0,
    # level: 0} -- it must NOT be credited the shared consistency. This
    # fixture only ever logs Bench Press (Chest); Row/Back has zero sets.
    v = _run(VECTORS_BY_NAME["progression_one_off_pr"])
    assert v["perGroup"]["Back"] == {"xp": 0, "level": 0}
    # Sanity: a group that IS trained is unaffected by this rule.
    assert v["perGroup"]["Chest"]["xp"] > 0


# ─── (c) Cardio (§Cardio note): consistency-only, strength-only axes ──────
def test_cardio_only_log_counts_toward_consistency_not_progression_or_volume():
    # A stretch with ONLY cardio sessions must still earn consistency (a
    # session is a session, regardless of kind) while progression and volume
    # -- both strength-only axes keyed on weight/reps/est-1RM -- stay exactly
    # 0, never NaN, since there are no strength sets at all to feed them.
    v = _run(VECTORS_BY_NAME["cardio_only_stretch"])
    assert v["components"]["consistency"] > 0.0
    assert v["components"]["progression"] == pytest.approx(0.0, abs=TOL)
    assert v["components"]["volume"] == pytest.approx(0.0, abs=TOL)
    assert v["baselines"] == {}
    # No primary sets in the window for either group -> untrained, per §7.
    assert v["perGroup"]["Chest"] == {"xp": 0, "level": 0}
    assert v["perGroup"]["Back"] == {"xp": 0, "level": 0}


def test_cardio_interleaved_with_strength_leaves_strength_axes_untouched():
    # Interleaving cardio sessions into an otherwise-pure-strength log (some
    # inside the trailing progression/volume window, some outside it) must
    # not move progression, volume, or baselines by even a bit -- those axes
    # are strength-only and must filter cardio out entirely, not merely
    # happen to not encounter it. Consistency, which IS kind-agnostic, must
    # go up: two of the added cardio sessions land in weeks that previously
    # had zero sessions.
    baseline = _run(VECTORS_BY_NAME["decay_before_gap"])
    interleaved = _run(VECTORS_BY_NAME["cardio_interleaved_with_strength"])
    assert interleaved["components"]["progression"] == pytest.approx(
        baseline["components"]["progression"], abs=TOL
    )
    assert interleaved["components"]["volume"] == pytest.approx(
        baseline["components"]["volume"], abs=TOL
    )
    assert interleaved["baselines"] == baseline["baselines"]
    assert interleaved["components"]["consistency"] > baseline["components"]["consistency"]


def test_empty_log_is_all_zero():
    v = _run(VECTORS_BY_NAME["empty_log"])
    assert v["xp"] == 0
    assert v["level"] == 0
    assert v["streak"] == 0
    assert v["components"] == {"consistency": 0.0, "progression": 0.0, "volume": 0.0}
    assert v["baselines"] == {}
