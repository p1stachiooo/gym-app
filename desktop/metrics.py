# Phase 8 + Stage 4 — pure pandas metric functions over the resolved training
# log.
#
# No Dash or Firestore imports here, on purpose: every function takes plain
# DataFrames (as produced by data.py) and returns a DataFrame/dict/scalar, so
# this module is testable with synthetic data (see test_metrics.py) and
# reusable from anything else that wants these numbers later.
#
# Cardio (see phase9-xp-spec.md's Cardio note): a `kind: "cardio"` set is
# logged by duration, not weight×reps, so it carries no weight/reps/set.
# Mirroring progress.py's `_is_strength` filter (not imported — this module
# has zero imports from the rest of desktop/ by design, and progress.py
# already imports metrics.py, so importing back would cycle): every
# STRENGTH metric (volume, set-credit/balance, top-set progression, PRs)
# filters cardio out via `expand_muscle_credits`/`top_sets`/`pr_table` so a
# weight-less cardio row can never NaN or silently zero out that math.
# Session-based facts (`sessions_per_week`, and `kpi_summary`'s
# sessions/last-session-date) stay kind-agnostic — a session is a session.
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

import pandas as pd

# A registry group with zero set-credit in this trailing window counts as
# "neglected" in the balance chart. Retune here, not scattered through the UI.
NEGLECTED_WINDOW_DAYS = 14

# A logged set whose exercise isn't in the registry is still charted (never
# silently dropped) under this synthetic, muted-styled group.
UNREGISTERED_GROUP = "Unregistered"
UNREGISTERED_WEIGHT = 1.0

# Distinct from Unregistered: the exercise IS in the registry but its
# `muscles` array is empty — a forgotten tagging, not an unknown exercise.
# Kept as a separate bucket so the two failure states stay distinguishable.
UNTAGGED_GROUP = "Untagged"
UNTAGGED_WEIGHT = 1.0

SET_CREDIT_COLUMNS = ["group", "set_credit"]
VOLUME_COLUMNS = ["iso_week", "group", "volume"]
PATTERN_BREAKDOWN_COLUMNS = ["pattern", "sets", "volume"]
CREDIT_ROW_COLUMNS = ["uid", "date", "session", "exercise", "weight", "reps", "set", "group", "role", "credit_weight"]
TOP_SET_COLUMNS = ["exercise", "session", "date", "weight", "reps", "est_1rm"]
PR_COLUMNS = ["group", "exercise", "max_weight", "max_weight_date", "max_weight_reps",
              "best_est_1rm", "best_est_1rm_date"]


def _is_strength(sets_df: pd.DataFrame) -> pd.Series:
    """True for a strength row, False for cardio. A missing `kind` column
    (pre-Stage-4 test fixtures, or any caller that never carries it) means
    every row is strength — back-compat, and exactly what progress.py's
    identically-behaved filter does."""
    if "kind" not in sets_df.columns:
        return pd.Series(True, index=sets_df.index)
    return sets_df["kind"].fillna("strength") != "cardio"


def _parse_dates(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, format="%Y-%m-%d", errors="coerce")


def iso_week(dates) -> pd.Series:
    """ISO week label 'GGGG-Www' (Monday-start week) for YYYY-MM-DD strings."""
    dt = _parse_dates(pd.Series(list(dates)))
    iso = dt.dt.isocalendar()
    return iso["year"].astype("Int64").astype(str) + "-W" + iso["week"].astype("Int64").astype(str).str.zfill(2)


def epley_1rm(weight, reps):
    """Epley estimated 1RM: weight * (1 + reps / 30). Scalar or Series-safe."""
    return weight * (1 + reps / 30.0)


def primary_group_lookup(exercises_df: pd.DataFrame) -> dict:
    """(exercise name, lowercased) -> its primary muscle-group name."""
    lookup = {}
    for _, r in exercises_df.iterrows():
        primary = next((m["group"] for m in (r["muscles"] or []) if m.get("role") == "primary"), None)
        if primary:
            lookup[str(r["name"]).lower()] = primary
    return lookup


def pattern_lookup(exercises_df: pd.DataFrame) -> dict:
    """(exercise name, lowercased) -> its movement pattern (Phase 14), for
    exercises that carry one. Mirrors primary_group_lookup's shape."""
    lookup = {}
    for _, r in exercises_df.iterrows():
        pattern = r.get("pattern")
        if isinstance(pattern, str) and pattern:
            lookup[str(r["name"]).lower()] = pattern
    return lookup


def pattern_breakdown(sets_df: pd.DataFrame, exercises_df: pd.DataFrame) -> pd.DataFrame:
    """Set count + raw volume (sum weight*reps, NOT muscle weighted) per
    movement pattern — the push/pull-balance axis (Phase 14).

    STRENGTH-only (§Cardio note): a duration-logged cardio row has no
    weight/reps volume, so it's filtered out via `_is_strength` before any
    math — a "Cardio"-patterned exercise therefore never appears here. Sets
    whose exercise carries no pattern (or isn't registered at all) group
    under UNTAGGED_GROUP rather than being silently dropped.
    """
    if sets_df.empty:
        return pd.DataFrame(columns=PATTERN_BREAKDOWN_COLUMNS)
    df = sets_df[_is_strength(sets_df)]
    if df.empty:
        return pd.DataFrame(columns=PATTERN_BREAKDOWN_COLUMNS)
    lookup = pattern_lookup(exercises_df)
    df = df.copy()
    df["pattern"] = df["exercise"].map(lambda e: lookup.get(str(e).lower(), UNTAGGED_GROUP))
    df["volume"] = df["weight"] * df["reps"]
    out = df.groupby("pattern", as_index=False).agg(
        sets=("pattern", "size"), volume=("volume", "sum"))
    return out[PATTERN_BREAKDOWN_COLUMNS]


def expand_muscle_credits(sets_df: pd.DataFrame, exercises_df: pd.DataFrame) -> pd.DataFrame:
    """One row per (set x muscle credit) — the read-time registry resolution.

    Matches on (uid, exercise name lowercased), per the Phase 7 registry
    design. A set whose exercise isn't registered still gets a row (never
    silently dropped) filed under UNREGISTERED_GROUP at weight 1.0; a
    registered exercise whose muscles array is empty files under
    UNTAGGED_GROUP instead, so a forgotten tagging isn't disguised as an
    unknown exercise.
    """
    if sets_df.empty:
        return pd.DataFrame(columns=CREDIT_ROW_COLUMNS)

    # Strength-only (§Cardio note): credits are muscle-group *volume*/*set*
    # credit, which has no meaning for a duration-logged cardio row. Filtering
    # here — the one shared resolution step — is what keeps both
    # volume_by_group_week and set_credit_by_group (balance) cardio-clean.
    sets_df = sets_df[_is_strength(sets_df)]
    if sets_df.empty:
        return pd.DataFrame(columns=CREDIT_ROW_COLUMNS)

    credit_rows = []
    # Dedupe whole exercises on (uid, name_lower), first doc wins — two
    # registry docs collapsing to the same lowercase name would fan out the
    # merge below and double-count every credit. Exercise-level (not
    # per-group) dedupe so a re-tagged exercise can't partially mix with a
    # stale duplicate.
    seen = set()
    for _, r in exercises_df.iterrows():
        name_lower = str(r["name"]).lower()
        key = (r["uid"], name_lower)
        if key in seen:
            continue
        seen.add(key)
        muscles = r["muscles"] or []
        for m in muscles:
            credit_rows.append({
                "uid": r["uid"],
                "name_lower": name_lower,
                "group": m["group"],
                "role": m.get("role", "secondary"),
                "credit_weight": float(m["weight"]),
            })
        if not muscles:
            credit_rows.append({
                "uid": r["uid"],
                "name_lower": name_lower,
                "group": UNTAGGED_GROUP,
                "role": "primary",
                "credit_weight": UNTAGGED_WEIGHT,
            })
    credits = pd.DataFrame(credit_rows, columns=["uid", "name_lower", "group", "role", "credit_weight"])

    s = sets_df.copy()
    s["name_lower"] = s["exercise"].astype(str).str.lower()
    merged = s.merge(credits, on=["uid", "name_lower"], how="left")

    matched = merged["group"].notna()
    unmatched = merged.loc[~matched].copy()
    if not unmatched.empty:
        unmatched["group"] = UNREGISTERED_GROUP
        unmatched["role"] = "primary"
        unmatched["credit_weight"] = UNREGISTERED_WEIGHT

    out = pd.concat([merged.loc[matched], unmatched], ignore_index=True)
    return out.drop(columns=["name_lower"])[CREDIT_ROW_COLUMNS]


def volume_by_group_week(sets_df: pd.DataFrame, exercises_df: pd.DataFrame) -> pd.DataFrame:
    """Weekly volume credit per group: sum(weight * reps * credit_weight)."""
    credits = expand_muscle_credits(sets_df, exercises_df)
    if credits.empty:
        return pd.DataFrame(columns=VOLUME_COLUMNS)
    credits = credits.copy()
    credits["iso_week"] = iso_week(credits["date"])
    credits["volume"] = credits["weight"] * credits["reps"] * credits["credit_weight"]
    return credits.groupby(["iso_week", "group"], as_index=False)["volume"].sum()


def set_credit_by_group(
    sets_df: pd.DataFrame,
    exercises_df: pd.DataFrame,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> pd.DataFrame:
    """Set-credit per group: sum(credit_weight), optionally windowed by date
    (both bounds inclusive, compared as YYYY-MM-DD strings)."""
    credits = expand_muscle_credits(sets_df, exercises_df)
    if credits.empty:
        return pd.DataFrame(columns=SET_CREDIT_COLUMNS)
    if date_from:
        credits = credits[credits["date"] >= date_from]
    if date_to:
        credits = credits[credits["date"] <= date_to]
    if credits.empty:
        return pd.DataFrame(columns=SET_CREDIT_COLUMNS)
    out = credits.groupby("group", as_index=False)["credit_weight"].sum()
    return out.rename(columns={"credit_weight": "set_credit"})


def top_sets(sets_df: pd.DataFrame, exercise: Optional[str] = None) -> pd.DataFrame:
    """Top set per exercise per session: max weight that session, ties broken
    by higher reps. Includes each top set's Epley est-1RM.

    Strength-only (§Cardio note): a cardio row has no weight/reps, so it's
    filtered out before the max-weight sort — otherwise it could sort in as
    a "top set" or NaN the comparison entirely."""
    df = sets_df[_is_strength(sets_df)] if not sets_df.empty else sets_df
    if exercise is not None:
        df = df[df["exercise"] == exercise]
    if df.empty:
        return pd.DataFrame(columns=TOP_SET_COLUMNS)
    ordered = df.sort_values(["weight", "reps"], ascending=[False, False])
    top = ordered.groupby(["exercise", "session"], as_index=False).first()
    top["est_1rm"] = epley_1rm(top["weight"], top["reps"])
    return top[TOP_SET_COLUMNS].sort_values("date").reset_index(drop=True)


def pr_table(sets_df: pd.DataFrame, exercises_df: pd.DataFrame) -> pd.DataFrame:
    """Per-exercise PRs: max weight ever (+ date, reps at that weight) and
    best est-1RM ever (+ its date) — the two need not be the same set. Sorted
    by (registry primary group, exercise).

    Strength-only (§Cardio note): a PR is a weight/est-1RM record, which a
    duration-logged cardio row can't have — filtered out before est_1rm is
    even computed, so a cardio exercise (e.g. "Running") never appears here
    with a NaN or bogus max_weight."""
    if sets_df.empty:
        return pd.DataFrame(columns=PR_COLUMNS)
    sets_df = sets_df[_is_strength(sets_df)]
    if sets_df.empty:
        return pd.DataFrame(columns=PR_COLUMNS)

    df = sets_df.copy()
    df["est_1rm"] = epley_1rm(df["weight"], df["reps"])

    by_weight = df.sort_values(
        ["exercise", "weight", "reps", "date"], ascending=[True, False, False, True]
    )
    max_w = (
        by_weight.groupby("exercise", as_index=False)
        .first()[["exercise", "weight", "reps", "date"]]
        .rename(columns={"weight": "max_weight", "reps": "max_weight_reps", "date": "max_weight_date"})
    )

    by_1rm = df.sort_values(["exercise", "est_1rm", "date"], ascending=[True, False, True])
    best_1rm = (
        by_1rm.groupby("exercise", as_index=False)
        .first()[["exercise", "est_1rm", "date"]]
        .rename(columns={"est_1rm": "best_est_1rm", "date": "best_est_1rm_date"})
    )

    out = max_w.merge(best_1rm, on="exercise", how="outer")
    lookup = primary_group_lookup(exercises_df)
    out["group"] = out["exercise"].map(lambda e: lookup.get(str(e).lower(), UNREGISTERED_GROUP))
    out = out.sort_values(["group", "exercise"]).reset_index(drop=True)
    return out[PR_COLUMNS]


def neglected_groups(
    sets_df: pd.DataFrame,
    exercises_df: pd.DataFrame,
    groups_df: pd.DataFrame,
    as_of: Optional[str] = None,
    window_days: int = NEGLECTED_WINDOW_DAYS,
):
    """Registry group names with zero set-credit in the trailing window
    ending on `as_of` (defaults to real today; pass explicitly for
    deterministic tests)."""
    if as_of is None:
        as_of = date.today().isoformat()
    end = datetime.strptime(as_of, "%Y-%m-%d").date()
    start = (end - timedelta(days=window_days)).isoformat()
    window = set_credit_by_group(sets_df, exercises_df, date_from=start, date_to=as_of)
    trained = set(window.loc[window["set_credit"] > 0, "group"]) if not window.empty else set()
    all_groups = set(groups_df["name"]) if not groups_df.empty else set()
    return sorted(all_groups - trained)


def sessions_per_week(sets_df: pd.DataFrame) -> pd.DataFrame:
    """Distinct session-id count per ISO week. Columns: iso_week, sessions."""
    if sets_df.empty:
        return pd.DataFrame(columns=["iso_week", "sessions"])
    df = sets_df.copy()
    df["iso_week"] = iso_week(df["date"])
    return df.groupby("iso_week")["session"].nunique().reset_index(name="sessions")


def kpi_summary(sets_df: pd.DataFrame, as_of: Optional[str] = None) -> dict:
    """This-ISO-week set count, raw volume (sum weight*reps, NOT muscle
    weighted), cardio minutes, session count, and the most recent session
    date overall.

    Strength-vs-kind-agnostic split (§Cardio note): `sets_this_week` and
    `volume_this_week` are STRENGTH-only — a cardio row has no weight/reps
    to count as a "set" or sum into volume, and including it would either
    NaN the sum or (if coerced) misrepresent a duration-logged session as a
    lift. `cardio_minutes_this_week` is the cardio-only counterpart.
    `sessions_this_week`/`last_session_date` are kind-agnostic: a session is
    a session whether it's a lift or a run, same as progress.py's
    Consistency axis."""
    empty = {
        "sets_this_week": 0,
        "volume_this_week": 0.0,
        "cardio_minutes_this_week": 0.0,
        "sessions_this_week": 0,
        "last_session_date": None,
    }
    if sets_df.empty:
        return empty

    if as_of is None:
        as_of = date.today().isoformat()
    as_of_dt = datetime.strptime(as_of, "%Y-%m-%d").date()
    monday = as_of_dt - timedelta(days=as_of_dt.isoweekday() - 1)
    sunday = monday + timedelta(days=6)

    week = sets_df[(sets_df["date"] >= monday.isoformat()) & (sets_df["date"] <= sunday.isoformat())]
    strength_week = week[_is_strength(week)] if not week.empty else week
    cardio_week = week[~_is_strength(week)] if not week.empty else week

    cardio_minutes = 0.0
    if not cardio_week.empty and "duration" in cardio_week.columns:
        cardio_minutes = float(pd.to_numeric(cardio_week["duration"], errors="coerce").fillna(0.0).sum())

    return {
        "sets_this_week": int(len(strength_week)),
        "volume_this_week": float((strength_week["weight"] * strength_week["reps"]).sum()) if not strength_week.empty else 0.0,
        "cardio_minutes_this_week": cardio_minutes,
        "sessions_this_week": int(week["session"].nunique()) if not week.empty else 0,
        "last_session_date": sets_df["date"].max(),
    }
