# Phase 8 — synthetic-data tests for metrics.py. Plain asserts, no pytest,
# no network: `python test_metrics.py`. Every function in metrics.py gets at
# least one case; the numbers below are hand-computed in the comments next
# to the fixtures so a failure is easy to diagnose against the brief's
# metric definitions.
from __future__ import annotations

import math

import pandas as pd

import metrics

UID = "u1"


def build_registry():
    exercises = pd.DataFrame([
        {
            "uid": UID, "name": "Bench Press", "lastWeight": None,
            "muscles": [
                {"group": "Chest", "role": "primary", "weight": 1.0, "emphasis": None},
                {"group": "Triceps", "role": "secondary", "weight": 0.5, "emphasis": None},
            ],
        },
        {
            "uid": UID, "name": "Row", "lastWeight": None,
            "muscles": [
                {"group": "Back", "role": "primary", "weight": 1.0, "emphasis": None},
                {"group": "Biceps", "role": "secondary", "weight": 0.5, "emphasis": None},
            ],
        },
    ], columns=["uid", "name", "muscles", "lastWeight"])

    groups = pd.DataFrame([
        {"uid": UID, "name": "Chest", "order": 0},
        {"uid": UID, "name": "Back", "order": 1},
        {"uid": UID, "name": "Triceps", "order": 2},
        {"uid": UID, "name": "Biceps", "order": 3},
        {"uid": UID, "name": "ColdGroup", "order": 4},
        {"uid": UID, "name": "Legs", "order": 5},
    ], columns=["uid", "name", "order"])

    return exercises, groups


def build_sets():
    # Session A: Bench Press, 2026-07-13 (Mon) — top set: 105x5 (beats 100x5
    # by weight; 95x8 has more reps but less weight so doesn't win).
    # Session B: Bench Press + the unregistered exercise, 2026-07-14 (Tue) —
    # top bench set: 110x3 (higher weight than 100x5).
    # Session C: Row, 2026-07-14 (Tue).
    # Session D: Row, 2026-07-06 (Mon, the ISO week before A/B/C).
    rows = [
        dict(uid=UID, date="2026-07-13", session="A", exercise="Bench Press", weight=100, reps=5, set=1),
        dict(uid=UID, date="2026-07-13", session="A", exercise="Bench Press", weight=105, reps=5, set=2),
        dict(uid=UID, date="2026-07-13", session="A", exercise="Bench Press", weight=95, reps=8, set=3),
        dict(uid=UID, date="2026-07-14", session="B", exercise="Bench Press", weight=110, reps=3, set=1),
        dict(uid=UID, date="2026-07-14", session="B", exercise="Bench Press", weight=100, reps=5, set=2),
        dict(uid=UID, date="2026-07-14", session="B", exercise="Unknown Exercise", weight=50, reps=10, set=1),
        dict(uid=UID, date="2026-07-14", session="C", exercise="Row", weight=90, reps=5, set=1),
        dict(uid=UID, date="2026-07-06", session="D", exercise="Row", weight=80, reps=8, set=1),
        dict(uid=UID, date="2026-07-06", session="D", exercise="Row", weight=85, reps=6, set=2),
    ]
    return pd.DataFrame(rows, columns=["uid", "date", "session", "exercise", "weight", "reps", "set"])


def approx(a, b, tol=1e-6):
    return math.isclose(a, b, abs_tol=tol)


def test_epley_1rm():
    assert approx(metrics.epley_1rm(100, 5), 100 * (1 + 5 / 30))
    assert approx(metrics.epley_1rm(200, 0), 200.0)  # 0 reps -> weight itself
    print("ok: epley_1rm")


def test_iso_week():
    weeks = metrics.iso_week(["2026-07-13", "2026-07-14", "2026-07-06"])
    assert weeks.iloc[0] == weeks.iloc[1], "Mon/Tue of the same ISO week must match"
    assert weeks.iloc[0] != weeks.iloc[2], "the week before must differ"
    assert all(pd.Series(weeks).str.match(r"^\d{4}-W\d{2}$")), "expected 'GGGG-Www' labels"
    print("ok: iso_week")


def test_expand_muscle_credits():
    exercises, _ = build_registry()
    sets = build_sets()
    credits = metrics.expand_muscle_credits(sets, exercises)
    # 5 bench sets x 2 credits + 3 row sets x 2 credits + 1 unregistered set x 1 credit
    assert len(credits) == 5 * 2 + 3 * 2 + 1 * 1, f"got {len(credits)} rows"
    unreg = credits[credits["exercise"] == "Unknown Exercise"]
    assert len(unreg) == 1
    assert unreg.iloc[0]["group"] == metrics.UNREGISTERED_GROUP
    assert unreg.iloc[0]["credit_weight"] == metrics.UNREGISTERED_WEIGHT
    print("ok: expand_muscle_credits")


def test_volume_by_group_week():
    exercises, _ = build_registry()
    sets = build_sets()
    vol = metrics.volume_by_group_week(sets, exercises)
    weeks = metrics.iso_week(sets["date"])
    w1, w2 = weeks.iloc[-1], weeks.iloc[0]  # w1 = week of 07-06 (last row), w2 = week of 07-13/14

    def v(week, group):
        m = vol[(vol["iso_week"] == week) & (vol["group"] == group)]
        return float(m["volume"].sum()) if not m.empty else 0.0

    # Week of 07-06: Row only -> volume 80*8 + 85*6 = 1150
    assert approx(v(w1, "Back"), 1150.0)
    assert approx(v(w1, "Biceps"), 1150.0 * 0.5)

    # Week of 07-13/14: Bench (500+525+760+330+500=2615) + Row (450)
    assert approx(v(w2, "Chest"), 2615.0)
    assert approx(v(w2, "Triceps"), 2615.0 * 0.5)
    assert approx(v(w2, "Back"), 450.0)
    assert approx(v(w2, "Biceps"), 450.0 * 0.5)
    assert approx(v(w2, "Unregistered"), 500.0)
    print("ok: volume_by_group_week")


def test_set_credit_by_group():
    exercises, _ = build_registry()
    sets = build_sets()
    sc = metrics.set_credit_by_group(sets, exercises)
    lookup = dict(zip(sc["group"], sc["set_credit"]))
    assert approx(lookup["Chest"], 5.0)     # 5 bench sets x weight 1.0
    assert approx(lookup["Triceps"], 2.5)   # 5 bench sets x weight 0.5
    assert approx(lookup["Back"], 3.0)      # 3 row sets x weight 1.0
    assert approx(lookup["Biceps"], 1.5)    # 3 row sets x weight 0.5
    assert approx(lookup["Unregistered"], 1.0)

    # date-windowed: only the 07-06 row session -> Row credits only
    windowed = metrics.set_credit_by_group(sets, exercises, date_from="2026-07-06", date_to="2026-07-06")
    wl = dict(zip(windowed["group"], windowed["set_credit"]))
    assert "Chest" not in wl
    assert approx(wl["Back"], 2.0)
    print("ok: set_credit_by_group")


def test_top_sets():
    sets = build_sets()
    top = metrics.top_sets(sets, exercise="Bench Press")
    assert list(top["session"]) == ["A", "B"]
    a = top[top["session"] == "A"].iloc[0]
    assert approx(a["weight"], 105) and approx(a["reps"], 5)
    assert approx(a["est_1rm"], 105 * (1 + 5 / 30))
    b = top[top["session"] == "B"].iloc[0]
    assert approx(b["weight"], 110) and approx(b["reps"], 3)
    print("ok: top_sets")


def test_pr_table():
    exercises, _ = build_registry()
    sets = build_sets()
    pr = metrics.pr_table(sets, exercises)
    by_ex = pr.set_index("exercise")

    bench = by_ex.loc["Bench Press"]
    assert approx(bench["max_weight"], 110) and bench["max_weight_date"] == "2026-07-14"
    assert approx(bench["max_weight_reps"], 3)
    assert approx(bench["best_est_1rm"], 105 * (1 + 5 / 30)) and bench["best_est_1rm_date"] == "2026-07-13"
    assert bench["group"] == "Chest"

    row = by_ex.loc["Row"]
    assert approx(row["max_weight"], 90) and row["max_weight_date"] == "2026-07-14"
    assert row["group"] == "Back"

    unknown = by_ex.loc["Unknown Exercise"]
    assert unknown["group"] == metrics.UNREGISTERED_GROUP
    print("ok: pr_table")


def test_duplicate_registry_names_do_not_double_count():
    # Two registry docs collapsing to the same (uid, lowercase name) — e.g. a
    # stale duplicate with different tags. The first doc must win whole
    # (never a partial mix), so one logged set earns exactly one doc's
    # credits instead of both fanned out by the merge.
    exercises = pd.DataFrame([
        {
            "uid": UID, "name": "Bench Press", "lastWeight": None,
            "muscles": [
                {"group": "Chest", "role": "primary", "weight": 1.0, "emphasis": None},
                {"group": "Triceps", "role": "secondary", "weight": 0.5, "emphasis": None},
            ],
        },
        {
            "uid": UID, "name": "bench press", "lastWeight": None,  # stale duplicate
            "muscles": [
                {"group": "Chest", "role": "primary", "weight": 1.0, "emphasis": None},
                {"group": "Shoulders", "role": "secondary", "weight": 0.5, "emphasis": None},
            ],
        },
    ], columns=["uid", "name", "muscles", "lastWeight"])
    sets = pd.DataFrame([
        dict(uid=UID, date="2026-07-13", session="A", exercise="Bench Press", weight=100, reps=5, set=1),
    ], columns=["uid", "date", "session", "exercise", "weight", "reps", "set"])

    credits = metrics.expand_muscle_credits(sets, exercises)
    assert len(credits) == 2, f"expected the first doc's 2 credits only, got {len(credits)}"
    sc = metrics.set_credit_by_group(sets, exercises)
    lookup = dict(zip(sc["group"], sc["set_credit"]))
    assert approx(lookup["Chest"], 1.0), f"Chest set-credit doubled: {lookup}"
    assert approx(lookup["Triceps"], 0.5)
    assert "Shoulders" not in lookup, "stale duplicate's tags leaked in"
    print("ok: duplicate_registry_names_do_not_double_count")


def test_untagged_exercise_bucket():
    # Registered but muscles == [] -> the distinct "Untagged" bucket, NOT
    # "Unregistered" — a forgotten tagging must stay distinguishable from an
    # unknown exercise.
    exercises = pd.DataFrame([
        {"uid": UID, "name": "Mystery Move", "lastWeight": None, "muscles": []},
    ], columns=["uid", "name", "muscles", "lastWeight"])
    sets = pd.DataFrame([
        dict(uid=UID, date="2026-07-13", session="A", exercise="Mystery Move", weight=40, reps=10, set=1),
        dict(uid=UID, date="2026-07-13", session="A", exercise="Truly Unknown", weight=30, reps=10, set=1),
    ], columns=["uid", "date", "session", "exercise", "weight", "reps", "set"])

    credits = metrics.expand_muscle_credits(sets, exercises)
    by_ex = credits.set_index("exercise")
    assert by_ex.loc["Mystery Move", "group"] == metrics.UNTAGGED_GROUP
    assert approx(by_ex.loc["Mystery Move", "credit_weight"], metrics.UNTAGGED_WEIGHT)
    assert by_ex.loc["Truly Unknown", "group"] == metrics.UNREGISTERED_GROUP
    print("ok: untagged_exercise_bucket")


def test_neglected_groups():
    exercises, groups = build_registry()
    sets = build_sets()
    neglected = metrics.neglected_groups(sets, exercises, groups, as_of="2026-07-15", window_days=14)
    assert neglected == ["ColdGroup", "Legs"], neglected
    # Trained groups within a 1-day-only window (only 07-15 itself, no sets that day)
    neglected_narrow = metrics.neglected_groups(sets, exercises, groups, as_of="2026-07-15", window_days=0)
    assert set(neglected_narrow) == {"Chest", "Back", "Triceps", "Biceps", "ColdGroup", "Legs"}
    print("ok: neglected_groups")


def test_sessions_per_week():
    sets = build_sets()
    spw = metrics.sessions_per_week(sets)
    weeks = metrics.iso_week(sets["date"])
    w1, w2 = weeks.iloc[-1], weeks.iloc[0]
    lookup = dict(zip(spw["iso_week"], spw["sessions"]))
    assert lookup[w1] == 1  # session D only
    assert lookup[w2] == 3  # sessions A, B, C
    print("ok: sessions_per_week")


def test_kpi_summary():
    sets = build_sets()
    kpi = metrics.kpi_summary(sets, as_of="2026-07-15")  # Wed; week = Mon 07-13..Sun 07-19
    assert kpi["sets_this_week"] == 7  # 5 bench + 1 row + 1 unregistered, all on 07-13/07-14
    expected_volume = (100 * 5 + 105 * 5 + 95 * 8 + 110 * 3 + 100 * 5) + (90 * 5) + (50 * 10)
    assert approx(kpi["volume_this_week"], expected_volume)
    assert kpi["sessions_this_week"] == 3  # A, B, C
    assert kpi["last_session_date"] == "2026-07-14"
    print("ok: kpi_summary")


def build_cardio_sets():
    """`build_sets()` plus two cardio-only sessions in the same ISO week as
    A/B/C (07-13..14) and one strictly after the last strength session, so it
    also becomes the new `last_session_date`:
    - Session E: Running, 2026-07-13 (Mon), duration 30 min.
    - Session F: Cycling, 2026-07-15 (Wed), duration 45 min, no distance.
    Neither exercise is in the registry (build_registry() doesn't tag them),
    which is deliberate: a cardio row must never reach the strength
    (weight/reps-keyed) math regardless of registry status."""
    strength = build_sets().copy()
    strength["kind"] = "strength"
    strength["duration"] = None
    strength["distance"] = None
    cardio = pd.DataFrame([
        dict(uid=UID, date="2026-07-13", session="E", exercise="Running", kind="cardio",
             weight=None, reps=None, set=None, duration=30, distance=5.0),
        dict(uid=UID, date="2026-07-15", session="F", exercise="Cycling", kind="cardio",
             weight=None, reps=None, set=None, duration=45, distance=None),
    ], columns=["uid", "date", "session", "exercise", "kind", "weight", "reps", "set", "duration", "distance"])
    return pd.concat([strength, cardio], ignore_index=True)


def test_cardio_excluded_from_strength_metrics_but_counts_sessions():
    exercises, groups = build_registry()
    strength_only = build_sets()
    mixed = build_cardio_sets()

    # volume_by_group_week / set_credit_by_group / top_sets / pr_table: byte-
    # identical to the cardio-free baseline — cardio must never skew or NaN
    # these (mirrors progress.py's strength-only Progression/Volume axes).
    # check_dtype=False: build_cardio_sets()'s concat leaves the mixed frame's
    # numeric columns as `object` dtype (a fixture-construction artifact of
    # mixing ints with None — real data.py output is always numerically
    # coerced via pd.to_numeric), but the *values* below must match exactly.
    vol_before = metrics.volume_by_group_week(strength_only, exercises).sort_values(["iso_week", "group"]).reset_index(drop=True)
    vol_after = metrics.volume_by_group_week(mixed, exercises).sort_values(["iso_week", "group"]).reset_index(drop=True)
    pd.testing.assert_frame_equal(vol_before, vol_after, check_dtype=False)

    sc_before = metrics.set_credit_by_group(strength_only, exercises).sort_values("group").reset_index(drop=True)
    sc_after = metrics.set_credit_by_group(mixed, exercises).sort_values("group").reset_index(drop=True)
    pd.testing.assert_frame_equal(sc_before, sc_after, check_dtype=False)

    top_before = metrics.top_sets(strength_only, exercise="Bench Press")
    top_after = metrics.top_sets(mixed, exercise="Bench Press")
    pd.testing.assert_frame_equal(top_before, top_after, check_dtype=False)

    pr_before = metrics.pr_table(strength_only, exercises)
    pr_after = metrics.pr_table(mixed, exercises)
    pd.testing.assert_frame_equal(pr_before, pr_after, check_dtype=False)
    assert "Running" not in set(pr_after["exercise"]), "cardio exercise leaked into the PR table"
    assert "Cycling" not in set(pr_after["exercise"])
    assert not pr_after["max_weight"].isna().any(), "no NaN from a cardio row reaching PR math"

    # sessions_per_week: cardio sessions DO count.
    spw_before = metrics.sessions_per_week(strength_only)
    spw_after = metrics.sessions_per_week(mixed)
    weeks = metrics.iso_week(mixed["date"])
    w2 = weeks.iloc[0]  # week of 07-13..07-15 (A, B, C, E, F)
    before_lookup = dict(zip(spw_before["iso_week"], spw_before["sessions"]))
    after_lookup = dict(zip(spw_after["iso_week"], spw_after["sessions"]))
    assert after_lookup[w2] == before_lookup[w2] + 2, "the two cardio sessions must add to the week's session count"

    # kpi_summary: sets/volume stay strength-only; sessions/last-session
    # include cardio; cardio_minutes_this_week sums only the cardio rows.
    kpi_before = metrics.kpi_summary(strength_only, as_of="2026-07-15")
    kpi_after = metrics.kpi_summary(mixed, as_of="2026-07-15")
    assert kpi_after["sets_this_week"] == kpi_before["sets_this_week"], "cardio rows must not count as 'sets'"
    assert approx(kpi_after["volume_this_week"], kpi_before["volume_this_week"]), "cardio rows must not add volume"
    assert kpi_after["sessions_this_week"] == kpi_before["sessions_this_week"] + 2, "cardio sessions must count toward sessions_this_week"
    assert kpi_after["last_session_date"] == "2026-07-15", "cardio session F is the most recent session overall"
    assert approx(kpi_after["cardio_minutes_this_week"], 75.0)  # 30 (E) + 45 (F)
    assert kpi_before["cardio_minutes_this_week"] == 0.0, "no kind column at all -> 0 cardio minutes, not a crash"
    print("ok: cardio_excluded_from_strength_metrics_but_counts_sessions")


def test_kpi_summary_cardio_minutes_ignores_out_of_week_cardio():
    mixed = build_cardio_sets()
    # 07-06 (Row-only week) has no cardio rows at all -> 0 minutes that week.
    kpi = metrics.kpi_summary(mixed, as_of="2026-07-06")
    assert kpi["cardio_minutes_this_week"] == 0.0
    assert kpi["sessions_this_week"] == 1  # session D only
    print("ok: kpi_summary_cardio_minutes_ignores_out_of_week_cardio")


def test_pattern_breakdown():
    # Phase 14: two Push exercises, one Pull, one cardio (kind="cardio",
    # pattern="Cardio"), one strength set on an exercise the registry
    # doesn't know. Cardio must be EXCLUDED (strength-only volume); the
    # unregistered/pattern-less exercise must land in "Untagged".
    exercises = pd.DataFrame([
        {
            "uid": UID, "name": "Bench Press", "lastWeight": None, "pattern": "Push",
            "muscles": [{"group": "Chest", "role": "primary", "weight": 1.0, "emphasis": None}],
        },
        {
            "uid": UID, "name": "Overhead Press", "lastWeight": None, "pattern": "Push",
            "muscles": [{"group": "Shoulders", "role": "primary", "weight": 1.0, "emphasis": None}],
        },
        {
            "uid": UID, "name": "Row", "lastWeight": None, "pattern": "Pull",
            "muscles": [{"group": "Lats", "role": "primary", "weight": 1.0, "emphasis": None}],
        },
        {
            "uid": UID, "name": "Running", "lastWeight": None, "pattern": "Cardio",
            "muscles": [],
        },
    ], columns=["uid", "name", "muscles", "lastWeight", "pattern"])
    sets = pd.DataFrame([
        dict(uid=UID, date="2026-07-13", session="A", exercise="Bench Press", kind="strength",
             weight=100, reps=5, set=1, duration=None),
        dict(uid=UID, date="2026-07-13", session="A", exercise="Overhead Press", kind="strength",
             weight=60, reps=8, set=1, duration=None),
        dict(uid=UID, date="2026-07-13", session="A", exercise="Row", kind="strength",
             weight=90, reps=5, set=1, duration=None),
        dict(uid=UID, date="2026-07-13", session="A", exercise="No Pattern Move", kind="strength",
             weight=40, reps=10, set=1, duration=None),
        dict(uid=UID, date="2026-07-13", session="B", exercise="Running", kind="cardio",
             weight=None, reps=None, set=None, duration=30),
    ], columns=["uid", "date", "session", "exercise", "kind", "weight", "reps", "set", "duration"])

    pb = metrics.pattern_breakdown(sets, exercises)
    assert list(pb.columns) == metrics.PATTERN_BREAKDOWN_COLUMNS
    lookup = pb.set_index("pattern")
    assert "Cardio" not in lookup.index, "cardio row leaked into the strength-only breakdown"
    assert int(lookup.loc["Push", "sets"]) == 2  # Bench + OHP
    assert approx(float(lookup.loc["Push", "volume"]), 100 * 5 + 60 * 8)  # 980
    assert int(lookup.loc["Pull", "sets"]) == 1  # Row
    assert approx(float(lookup.loc["Pull", "volume"]), 90 * 5)  # 450
    assert int(lookup.loc[metrics.UNTAGGED_GROUP, "sets"]) == 1  # No Pattern Move
    assert approx(float(lookup.loc[metrics.UNTAGGED_GROUP, "volume"]), 40 * 10)  # 400
    assert set(lookup.index) == {"Push", "Pull", metrics.UNTAGGED_GROUP}

    # Empty input -> empty frame with the same columns (sibling-metric shape).
    empty = metrics.pattern_breakdown(sets.iloc[0:0], exercises)
    assert empty.empty and list(empty.columns) == metrics.PATTERN_BREAKDOWN_COLUMNS
    print("ok: pattern_breakdown")


def test_empty_inputs_do_not_crash():
    empty_sets = pd.DataFrame(columns=["uid", "date", "session", "exercise", "weight", "reps", "set"])
    empty_exercises = pd.DataFrame(columns=["uid", "name", "muscles", "lastWeight"])
    empty_groups = pd.DataFrame(columns=["uid", "name", "order"])
    assert metrics.expand_muscle_credits(empty_sets, empty_exercises).empty
    assert metrics.volume_by_group_week(empty_sets, empty_exercises).empty
    assert metrics.set_credit_by_group(empty_sets, empty_exercises).empty
    assert metrics.top_sets(empty_sets).empty
    assert metrics.pr_table(empty_sets, empty_exercises).empty
    assert metrics.neglected_groups(empty_sets, empty_exercises, empty_groups, as_of="2026-07-15") == []
    assert metrics.sessions_per_week(empty_sets).empty
    kpi = metrics.kpi_summary(empty_sets)
    assert kpi["sets_this_week"] == 0 and kpi["last_session_date"] is None
    print("ok: empty_inputs_do_not_crash")


def main():
    tests = [
        test_epley_1rm,
        test_iso_week,
        test_expand_muscle_credits,
        test_volume_by_group_week,
        test_set_credit_by_group,
        test_top_sets,
        test_pr_table,
        test_duplicate_registry_names_do_not_double_count,
        test_untagged_exercise_bucket,
        test_neglected_groups,
        test_sessions_per_week,
        test_kpi_summary,
        test_cardio_excluded_from_strength_metrics_but_counts_sessions,
        test_kpi_summary_cardio_minutes_ignores_out_of_week_cardio,
        test_pattern_breakdown,
        test_empty_inputs_do_not_crash,
    ]
    for t in tests:
        t()
    print(f"\n{len(tests)}/{len(tests)} test functions passed")


if __name__ == "__main__":
    main()
