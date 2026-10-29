# Phase 9 — XP / leveling engine. Pure pandas/py over the resolved training
# log, same discipline as metrics.py: no Firestore/Dash imports, so this is
# testable with synthetic data and safe to port to app/src/progress.ts later.
# `phase9-xp-spec.md` (repo root) is the canonical algorithm spec — every
# section reference in the comments below (§3, §4, ...) points there.
#
# No stored XP/level: this recomputes the whole thing from the log + vetoes
# every call. Vetoes are the only "written" input (an excused-day escape
# valve); everything else is derived.
from __future__ import annotations

import math
import statistics
import sys
from datetime import date, datetime, timedelta
from typing import Optional

import pandas as pd

import metrics

# ─── §9 default parameters — every constant here is meant to be retuned on
# real data, not hardcoded logic. `params` (a plain dict) overrides
# selectively: `dict(DEFAULT_PARAMS, **overrides)`.
DEFAULT_PARAMS = {
    "F_TARGET": 4,               # target sessions/week (before proration)
    "W_WEEKS": 12,                # evaluation window for consistency/weekly[]
    "HALF_LIFE_WEEKS": 3,         # consistency recency decay half-life
    "BASELINE_WEEKS": 4,          # trailing window for the progression axis
    "MIN_SESSIONS_FOR_BASELINE": 2,   # prior sessions required to trust baseline_e
    "DELTA_CAP": 0.10,            # max per-exercise credited gain
    "UNPHYSICAL": 0.75,           # raw gain above this needs 2-session corroboration
    "PROGRESSION_NORM": 0.30,     # Σgain_e / this -> progression 0..1
    "VETO_DAYS_PER_MONTH": 6,     # non-rolling monthly excused-day budget
    "SET_DECAY": 0.6,             # k-th working set worth SET_DECAY**(k-1)
    "VOLUME_WEEKS": 4,            # trailing window for the volume axis
    "TARGET_CREDIT": 1.95,        # credited_e -> ex_vol saturation target (~3 clean sets)
    "PROG_HI": 0.45,              # progression weight at zero tenure
    "PROG_LO": 0.20,              # progression weight at full maturity
    "CONS_LO": 0.35,              # consistency weight at zero tenure
    "CONS_HI": 0.60,              # consistency weight at full maturity
    "MATURE_WEEKS": 52,           # tenure (weeks trained) at full maturity
    "XP_SCALE": 1000,             # score (0..1) -> xp (0..XP_SCALE)
    "LEVEL_K": 10,                 # xp -> level = floor(sqrt(xp / LEVEL_K))
    "STREAK_MIN": 1.0,             # ratio_w threshold a week must clear for streak
}


# ─── date / week helpers ───────────────────────────────────────────────────
def _parse_date(d) -> date:
    if isinstance(d, date):
        return d
    return datetime.strptime(d, "%Y-%m-%d").date()


def _week_monday(d: date) -> date:
    """Monday of the ISO week containing d."""
    return d - timedelta(days=d.isoweekday() - 1)


def _iso_week_label(d: date) -> str:
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _weeks_ending_at(asof: date, n: int) -> list:
    """n Monday dates, oldest first, ending with the Monday of asof's week."""
    end_monday = _week_monday(asof)
    return [end_monday - timedelta(days=7 * k) for k in range(n - 1, -1, -1)]


def _clip(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _round_half_up(x: float) -> int:
    # Cross-language determinism: xp is always >= 0 here, and JS Math.round
    # rounds half-away-from-zero for non-negatives while Python's builtin
    # round() is banker's-rounding (round-half-to-even). Pin one convention
    # so the TS port matches this file's phase9_vectors.json to the letter.
    return math.floor(x + 0.5)


# ─── §5 vetoes: per-calendar-month cap, non-rolling ───────────────────────
def _enforce_veto_cap(vetoes, cap: int) -> set:
    """Keep the earliest `cap` excused dates per calendar month (ascending);
    excess dates in that month are ignored (and reported to stderr), never
    accumulated across months."""
    by_month: dict = {}
    for ds in vetoes:
        d = _parse_date(ds)
        by_month.setdefault((d.year, d.month), []).append(ds)
    enforced = set()
    ignored = []
    for key in sorted(by_month):
        month_dates = sorted(by_month[key])
        enforced.update(month_dates[:cap])
        ignored.extend(month_dates[cap:])
    if ignored:
        print(
            f"warning: {len(ignored)} veto(s) exceed the {cap}/month cap and are ignored: {ignored}",
            file=sys.stderr,
        )
    return enforced


def _session_dates(sets_df: pd.DataFrame) -> dict:
    """session id -> its date (min date of its sets), per spec §2."""
    if sets_df.empty:
        return {}
    return sets_df.groupby("session")["date"].min().to_dict()


def _sessions_in_window(session_dates: dict, window_start: date, window_end: date) -> set:
    return {
        sess for sess, d in session_dates.items()
        if window_start <= _parse_date(d) <= window_end
    }


# ─── strength/cardio filter — shared by Progression (§4) and Volume (§6);
# Consistency (§3) is deliberately kind-agnostic (see the Cardio note in
# phase9-xp-spec.md): a cardio set is logged by DURATION, not weight×reps, so
# it carries no weight/reps in practice and must never reach the est-1RM /
# set-count math those two axes are built on -- a missing `kind` column (or a
# missing/NaN value in it) means "strength", for back-compat with logs
# recorded before this field existed.
def _is_strength(sets_df: pd.DataFrame) -> pd.Series:
    if "kind" not in sets_df.columns:
        return pd.Series(True, index=sets_df.index)
    return sets_df["kind"].fillna("strength") != "cardio"


# ─── §3 Axis 1 — consistency (with decay) ─────────────────────────────────
def _consistency(sets_df, session_dates, enforced_vetoes, asof, params):
    weeks = _weeks_ending_at(asof, params["W_WEEKS"])
    f_target = params["F_TARGET"]
    half_life = params["HALF_LIFE_WEEKS"]

    sessions_by_week: dict = {}
    for sess, d in session_dates.items():
        wmon = _week_monday(_parse_date(d))
        sessions_by_week.setdefault(wmon, set()).add(sess)

    current_week = weeks[-1]
    weekly_out = []
    week_info = []  # (monday, target_w, ratio_w) for streak
    num = 0.0
    den = 0.0
    for wmon in weeks:
        k = (current_week - wmon).days // 7
        excused = sum(
            1 for i in range(7) if (wmon + timedelta(days=i)).isoformat() in enforced_vetoes
        )
        avail = (7 - excused) / 7
        target_w = f_target * avail
        attended = len(sessions_by_week.get(wmon, set()))
        if target_w > 0:
            ratio_w = min(attended / target_w, 1.0)
            decay_k = 0.5 ** (k / half_life)
            num += decay_k * ratio_w
            den += decay_k
        else:
            ratio_w = 0.0  # fully-excused week: dropped from num/den, reported as 0
        weekly_out.append({"iso_week": _iso_week_label(wmon), "sessions": attended, "ratio": ratio_w})
        week_info.append((wmon, target_w, ratio_w))

    consistency = (num / den) if den > 0 else 0.0
    return consistency, weekly_out, week_info


def _streak(week_info, streak_min: float) -> int:
    """Consecutive most-recent non-excused weeks with ratio_w >= streak_min.
    Fully-excused weeks (target_w == 0) are skipped, not streak-breaking."""
    streak = 0
    for _, target_w, ratio_w in reversed(week_info):
        if target_w == 0:
            continue
        if ratio_w >= streak_min:
            streak += 1
        else:
            break
    return streak


# ─── rank engine support — a read-only per-week pass/excused/missed
# classifier, reusing the exact veto-proration + STREAK_MIN rule already
# implemented above in `_consistency`/`_streak` (neither of which is modified
# here). Consumed by `desktop/rank_engine.py`'s `evaluate_rank` — mirrors
# `app/src/progress.ts`'s `classifyWeeksForRank` 1:1. Deliberately NOT a
# rank/XP concept itself: this file stays streak-only; the rank module
# derives from its output.
#
# `asof_epoch_day` is an integer day count (days since 1970-01-01), matching
# the TS side's numeric epoch-day API; `_epoch_day_to_date`/
# `_date_to_epoch_day` are the only bits of epoch-day arithmetic this file
# needs, scoped to this one function -- everywhere else in this module keeps
# working in plain `date` objects, same as always. ─────────────────────────
_EPOCH = date(1970, 1, 1)


def _epoch_day_to_date(ed: int) -> date:
    return _EPOCH + timedelta(days=ed)


def _date_to_epoch_day(d: date) -> int:
    return (d - _EPOCH).days


def classify_weeks_for_rank(
    sets,
    vetoes,
    asof_epoch_day: int,
    params: Optional[dict] = None,
) -> list:
    """Classify every completed week from the first logged session's week
    through the last completed week strictly before `asof`'s current
    (in-progress) week -- that week is excluded because it cannot be judged
    "missed" yet. Chronological order (oldest first).

    `sets` is a list of dict rows shaped like WorkoutSet (must have "date"
    and "session"; other keys are ignored here). `vetoes` is a list of
    "YYYY-MM-DD" strings. Returns a list of
    `{"weekMonday": <epoch day int>, "status": "pass" | "excused" | "missed"}`.
    """
    p = dict(DEFAULT_PARAMS)
    if params:
        p.update(params)

    asof_date = _epoch_day_to_date(asof_epoch_day)
    asof_str = asof_date.isoformat()

    # Mirror compute_progress's own pre-filter (date <= as_of) before
    # deriving session dates, so a stray future-dated row can't shift the
    # classified range or pad a week's attendance count.
    filtered_sets = [r for r in sets if r["date"] <= asof_str]
    if not filtered_sets:
        return []
    sets_df = pd.DataFrame(filtered_sets)
    session_dates = _session_dates(sets_df)
    if not session_dates:
        return []

    enforced_vetoes = _enforce_veto_cap(vetoes, p["VETO_DAYS_PER_MONTH"])

    sessions_by_week: dict = {}
    first_week: Optional[date] = None
    for sess, d in session_dates.items():
        wmon = _week_monday(_parse_date(d))
        if first_week is None or wmon < first_week:
            first_week = wmon
        sessions_by_week.setdefault(wmon, set()).add(sess)

    current_week_monday = _week_monday(asof_date)
    last_completed_week = current_week_monday - timedelta(days=7)
    if first_week is None or last_completed_week < first_week:
        return []

    f_target = p["F_TARGET"]
    out = []
    wmon = first_week
    while wmon <= last_completed_week:
        excused = sum(
            1 for i in range(7) if (wmon + timedelta(days=i)).isoformat() in enforced_vetoes
        )
        avail = (7 - excused) / 7
        target_w = f_target * avail
        attended = len(sessions_by_week.get(wmon, set()))

        if target_w == 0:
            status = "excused"
        else:
            status = "pass" if attended / target_w >= p["STREAK_MIN"] else "missed"
        out.append({"weekMonday": _date_to_epoch_day(wmon), "status": status})
        wmon += timedelta(days=7)
    return out


# ─── §4 Axis 2 — progression-that-holds ───────────────────────────────────
def _top_set_per_session(df: pd.DataFrame) -> pd.DataFrame:
    """Top set (max weight, ties broken by higher reps) per (exercise,
    session), with its Epley est-1RM. Mirrors metrics.top_sets."""
    ordered = df.sort_values(["weight", "reps"], ascending=[False, False])
    top = ordered.groupby(["exercise", "session"], as_index=False).first()
    top["est_1rm"] = metrics.epley_1rm(top["weight"], top["reps"])
    return top


def _progression(sets_df, session_dates, asof, params):
    weeks = _weeks_ending_at(asof, params["BASELINE_WEEKS"])
    if not sets_df.empty:
        sets_df = sets_df[_is_strength(sets_df)]  # strength-only axis
    if sets_df.empty or not session_dates:
        return 0.0, {}

    window_start, window_end = weeks[0], weeks[-1] + timedelta(days=6)
    in_window = _sessions_in_window(session_dates, window_start, window_end)
    df = sets_df[sets_df["session"].isin(in_window)]
    if df.empty:
        return 0.0, {}

    top = _top_set_per_session(df)
    top = top.copy()
    top["d"] = top["session"].map(lambda s: _parse_date(session_dates[s]))

    total_gain = 0.0
    baselines = {}
    for ex, grp in top.groupby("exercise"):
        recs = grp.sort_values("d").to_dict("records")
        prior = recs[:-1]
        current = recs[-1]
        if len(prior) < params["MIN_SESSIONS_FOR_BASELINE"]:
            continue  # not enough history to trust a baseline -> exercise skipped
        baseline_e = statistics.median(r["est_1rm"] for r in prior)
        if baseline_e <= 0:
            continue
        current_e1rm = current["est_1rm"]
        raw_gain = max(0.0, current_e1rm / baseline_e - 1.0)

        # Confirm-or-zero (anti-ego): counts only if the level has been
        # exceeded (beaten baseline_e) in >=2 distinct sessions in the window.
        over_baseline = sum(1 for r in recs if r["est_1rm"] > baseline_e)
        confirmed = over_baseline >= 2

        if not confirmed:
            gain_e = 0.0
        elif raw_gain > params["UNPHYSICAL"]:
            # Unphysical guard: a huge jump only counts (capped) if that same
            # magnitude of jump was itself reproduced in >=2 sessions, not
            # merely "some session exceeded baseline" — otherwise a single
            # freak/typo session would ride in on a weaker session's coattails.
            over_unphysical = sum(
                1 for r in recs if (r["est_1rm"] / baseline_e - 1.0) > params["UNPHYSICAL"]
            )
            gain_e = min(raw_gain, params["DELTA_CAP"]) if over_unphysical >= 2 else 0.0
        else:
            gain_e = min(raw_gain, params["DELTA_CAP"])  # cap, don't penalize

        total_gain += gain_e
        baselines[ex] = {
            "baseline_e1rm": float(baseline_e),
            "current_e1rm": float(current_e1rm),
            "confirmed": bool(confirmed),
        }

    progression = _clip(total_gain / params["PROGRESSION_NORM"], 0.0, 1.0)
    return progression, baselines


# ─── §6 Axis 3 — volume (absolute per-set saturation) ─────────────────────
def _volume(sets_df, session_dates, asof, params) -> float:
    """No baseline: each exercise-session is scored purely on its own working
    sets (saturating around ~3 clean sets), then decay-averaged by recency
    over the trailing VOLUME_WEEKS. A returning lifter or a mid-week view is
    never zeroed just because other weeks in the window are empty -- only
    exercise-sessions that actually happened are scored (empty window -> 0)."""
    weeks = _weeks_ending_at(asof, params["VOLUME_WEEKS"])
    if not sets_df.empty:
        sets_df = sets_df[_is_strength(sets_df)]  # strength-only axis
    if sets_df.empty or not session_dates:
        return 0.0

    window_start, window_end = weeks[0], weeks[-1] + timedelta(days=6)
    in_window = _sessions_in_window(session_dates, window_start, window_end)
    df = sets_df[sets_df["session"].isin(in_window)]
    if df.empty:
        return 0.0

    set_decay = params["SET_DECAY"]
    target_credit = params["TARGET_CREDIT"]
    half_life = params["HALF_LIFE_WEEKS"]
    current_week = weeks[-1]

    num = 0.0
    den = 0.0
    for (ex, sess), grp in df.groupby(["exercise", "session"]):
        n = len(grp)
        credited_e = sum(set_decay ** k for k in range(n))  # k=0..n-1 == SET_DECAY**(k-1) for k=1..n
        ex_vol = min(credited_e / target_credit, 1.0)
        wmon = _week_monday(_parse_date(session_dates[sess]))
        k = (current_week - wmon).days // 7
        decay_k = 0.5 ** (k / half_life)
        num += decay_k * ex_vol
        den += decay_k

    return (num / den) if den > 0 else 0.0


# ─── §7 blend, maturation, level ───────────────────────────────────────────
def _maturation_weights(tenure_weeks: int, params) -> tuple:
    m = _clip(tenure_weeks / params["MATURE_WEEKS"], 0.0, 1.0)
    w_prog = params["PROG_HI"] + (params["PROG_LO"] - params["PROG_HI"]) * m
    w_cons = params["CONS_LO"] + (params["CONS_HI"] - params["CONS_LO"]) * m
    w_vol = 1.0 - w_prog - w_cons
    return w_cons, w_prog, w_vol


def _score_to_xp_level(score: float, params) -> tuple:
    xp = _round_half_up(score * params["XP_SCALE"])
    level = math.floor(math.sqrt(xp / params["LEVEL_K"]))
    return xp, level


def compute_progress(
    sets_df: pd.DataFrame,
    exercises_df: pd.DataFrame,
    groups_df: pd.DataFrame,
    vetoes=frozenset(),
    params: Optional[dict] = None,
    as_of: Optional[str] = None,
) -> dict:
    """Pure function over one user's resolved log -> the §1 Progress dict.
    No stored XP/level anywhere; recomputed fresh from `sets_df` + `vetoes`
    every call. `sets_df`/`exercises_df`/`groups_df` are the frame shapes
    produced by data.py (already scoped to one uid)."""
    p = dict(DEFAULT_PARAMS)
    if params:
        p.update(params)

    asof_date = date.today() if as_of is None else _parse_date(as_of)
    as_of_str = asof_date.isoformat()

    if not sets_df.empty:
        sets_df = sets_df[sets_df["date"] <= as_of_str]

    enforced_vetoes = _enforce_veto_cap(vetoes, p["VETO_DAYS_PER_MONTH"])
    session_dates = _session_dates(sets_df)

    consistency, weekly, week_info = _consistency(sets_df, session_dates, enforced_vetoes, asof_date, p)
    streak = _streak(week_info, p["STREAK_MIN"])
    progression, baselines = _progression(sets_df, session_dates, asof_date, p)
    volume = _volume(sets_df, session_dates, asof_date, p)

    tenure = len({_week_monday(_parse_date(d)) for d in session_dates.values()})
    w_cons, w_prog, w_vol = _maturation_weights(tenure, p)

    score = w_cons * consistency + w_prog * progression + w_vol * volume
    xp, level = _score_to_xp_level(score, p)

    lookup = metrics.primary_group_lookup(exercises_df)  # (name lower) -> primary group
    group_names = list(groups_df["name"]) if not groups_df.empty else []

    # §7: "no primary sets in the window" -> untrained group, {xp:0, level:0},
    # not even the shared consistency. "The window" = the same evaluation
    # window used for consistency (§2/§3), W_WEEKS ending at asOf.
    w_weeks = _weeks_ending_at(asof_date, p["W_WEEKS"])
    w_window_start, w_window_end = w_weeks[0], w_weeks[-1] + timedelta(days=6)
    sessions_in_w_window = _sessions_in_window(session_dates, w_window_start, w_window_end)

    per_group = {}
    for g in group_names:
        ex_in_g = {name for name, grp in lookup.items() if grp == g}
        if sets_df.empty or not ex_in_g:
            g_sets = sets_df.iloc[0:0]
        else:
            g_sets = sets_df[sets_df["exercise"].astype(str).str.lower().isin(ex_in_g)]

        g_sets_in_window = (
            g_sets[g_sets["session"].isin(sessions_in_w_window)] if not g_sets.empty else g_sets
        )
        if g_sets_in_window.empty:
            per_group[g] = {"xp": 0, "level": 0}
            continue

        # windowing is keyed by session id -> date, a session-level (not
        # per-exercise) fact, so it always uses the *global* session_dates
        # even though g_sets itself is filtered to this group's exercises.
        g_progression, _ = _progression(g_sets, session_dates, asof_date, p)
        g_volume = _volume(g_sets, session_dates, asof_date, p)
        # consistency is shared (global weekly attendance) per spec §7
        g_score = w_cons * consistency + w_prog * g_progression + w_vol * g_volume
        g_xp, g_level = _score_to_xp_level(g_score, p)
        per_group[g] = {"xp": g_xp, "level": g_level}

    return {
        "xp": xp,
        "level": level,
        "streak": streak,
        "components": {
            "consistency": consistency,
            "progression": progression,
            "volume": volume,
        },
        "perGroup": per_group,
        "weekly": weekly,
        "baselines": baselines,
        "weights": {
            "consistency": w_cons,
            "progression": w_prog,
            "volume": w_vol,
        },
    }
