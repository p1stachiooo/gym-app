# Rank engine — PURE logic only (no Dash/Firestore imports). Python port of
# `app/src/rank/rankEngine.ts`, mirrored 1:1. See RANK_SYSTEM_SPEC.md for the
# narrative spec and the approved implementation brief for the decisions that
# override it (state count, Bellerophon's position, XP pace). Two monotonic
# numbers are the whole state (`xp`, `slipOffset`); everything else --
# division, tier, progress bar -- is derived on read. Never store "current
# rank" as writable state.
#
# Streak/veto logic is intentionally NOT reimplemented here: `evaluate_rank`
# reuses `classify_weeks_for_rank` (added to `progress.py`, itself built on
# the existing, unmodified `_consistency`/`_streak` machinery) for the
# pass/excused/missed call on each week.
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from progress import DEFAULT_PARAMS, classify_weeks_for_rank
from rank_ladder import TIERS, XP_GAIN, XP_PER_DIVISION

# ─── date helpers ───────────────────────────────────────────────────────────
# Deliberately duplicated (not imported) from progress.py's private
# _week_monday/_parse_date: the brief scopes progress.py's public surface to
# exactly one new export (classify_weeks_for_rank), so this module carries
# its own minimal epoch-day <-> date conversion instead of widening that
# file's exports further -- mirrors rankEngine.ts's own duplicated
# epochDayOf/weekMonday helpers (kept in sync with progress.py by hand if
# either changes, same discipline as the TS side).
_EPOCH = date(1970, 1, 1)


def epoch_day_of(s: str) -> int:
    return (date.fromisoformat(s) - _EPOCH).days


def _week_monday(ed: int) -> int:
    d = _EPOCH + timedelta(days=ed)
    return ed - (d.isoweekday() - 1)  # isoweekday(): Monday=1 .. Sunday=7


# ─── §1/§2 state + derived view ────────────────────────────────────────────

# Highest representable division index (Kratos, the un-divisioned apex). 61
# rank states total: abs_division 0..59 are the 20 divisioned tiers x 3
# divisions each; abs_division 60 is Kratos.
MAX_ABS_DIVISION = len(TIERS) * 3 - 3  # (21 tiers - 1 divisionless apex) * 3 = 60

DIVISION_LABELS = ("III", "II", "I")  # within-tier index 0,1,2


def _clamp_abs_division(n: int) -> int:
    return max(0, min(MAX_ABS_DIVISION, n))


def _abs_division_of(pos_xp: int) -> int:
    """floor(posXp / XP_PER_DIVISION), clamped to 0..60 (60 = Kratos apex)."""
    return _clamp_abs_division(pos_xp // XP_PER_DIVISION)


@dataclass(frozen=True)
class RankState:
    """The whole persisted state. Both fields only ever increase -- `xp` from
    earned sessions, `slipOffset` from streak misses. Never write anything
    else (no stored "current rank"); always derive via `get_rank`. Field
    names mirror rankEngine.ts's `RankState` interface exactly (camelCase
    `slipOffset`), not PEP 8, so the two engines read as the same contract."""

    xp: int
    slipOffset: int


def get_rank(state: RankState) -> dict:
    """Mirrors rankEngine.ts's `getRank` -> `RankView`. Returned as a dict
    with the exact same (camelCase) field names as the TS `RankView`
    interface, for 1:1 parity with the shared JSON vectors."""
    pos_xp = max(0, state.xp - state.slipOffset)
    rank_id = _abs_division_of(pos_xp)
    is_apex = rank_id >= MAX_ABS_DIVISION
    tier_index = (len(TIERS) - 1) if is_apex else rank_id // 3
    within = None if is_apex else rank_id % 3  # 0,1,2 => III,II,I
    division = None if within is None else 3 - within
    division_label = None if within is None else DIVISION_LABELS[within]
    tier = TIERS[tier_index]

    return {
        "rankId": rank_id,
        "tierIndex": tier_index,
        "tierName": tier["name"],
        "copy": tier["copy"],
        "isApex": is_apex,
        "division": division,
        "divisionLabel": division_label,
        "posXp": pos_xp,
        "xpIntoDivision": pos_xp - rank_id * XP_PER_DIVISION,
        "xpForDivision": XP_PER_DIVISION,
    }


# ─── §2 XP gain ─────────────────────────────────────────────────────────────

def session_xp(working_sets: int, is_cardio: bool) -> int:
    """XP earned by one logged session. Cardio sessions earn a flat base (no
    per-set component -- duration-logged, not set-logged); strength sessions
    earn the base plus a per-set bonus that saturates at SETS_CAP."""
    if is_cardio:
        return XP_GAIN["SESSION_BASE"]
    return XP_GAIN["SESSION_BASE"] + XP_GAIN["PER_SET"] * min(max(0, working_sets), XP_GAIN["SETS_CAP"])


def apply_xp_gain(state: RankState, amount: int) -> RankState:
    """`xp` only ever rises. `slipOffset` is untouched."""
    return RankState(xp=state.xp + amount, slipOffset=state.slipOffset)


def apply_slip(state: RankState) -> RankState:
    """One un-excused missed week: drop exactly one division, zero progress
    within it, `xp` untouched (so it stays monotonic). `d` = current
    abs_division; `target = max(0, d-1) * XP_PER_DIVISION`; `slipOffset = xp -
    target`. Hard-floors at abs_division 0 (cannot underflow) and, from
    Kratos, lands on the top division (I) of the tier directly below via the
    same formula (d=60 -> target = 59*XP_PER_DIVISION)."""
    pos_xp = max(0, state.xp - state.slipOffset)
    d = _abs_division_of(pos_xp)
    target = max(0, d - 1) * XP_PER_DIVISION
    return RankState(xp=state.xp, slipOffset=state.xp - target)


# ─── §6 lazy evaluation — the one-pass cold-open catch-up ─────────────────

def _session_dates_of(sets) -> dict:
    """session id -> minimum epoch day among its sets (mirrors
    rankEngine.ts's private sessionDatesOf, duplicated here for the same
    reason as the epoch-day helpers above)."""
    m: dict = {}
    for r in sets:
        ed = epoch_day_of(r["date"])
        cur = m.get(r["session"])
        if cur is None or ed < cur:
            m[r["session"]] = ed
    return m


def evaluate_rank(
    sets,
    vetoes,
    asof_epoch_day: int,
    params: Optional[dict] = None,
) -> dict:
    """Fold a full log (sets + vetoes) into a final rank state in one pass:
    group sets into sessions, compute each session's XP, bucket that XP by
    the ISO week it falls in, classify every completed week as
    pass/excused/missed via `classify_weeks_for_rank`, then walk the weeks
    chronologically applying that week's XP gain and -- on a miss -- a slip.
    Then award the current (in-progress) week's XP live (no slip); peak is
    sampled after both the fold and the live addition.

    `sets` is a list of dict rows shaped like WorkoutSet (must have "date",
    "session"; "kind" absent/!="cardio" means strength -- one row == one
    working set for XP purposes, mirroring the TS side's `rows.length`).
    `vetoes` is a list of "YYYY-MM-DD" strings. Returns a dict:
    `{"state": {"xp", "slipOffset"}, "rank": <RankView dict>, "peakRankId",
    "slipsApplied"}`.
    """
    p = dict(DEFAULT_PARAMS)
    if params:
        p.update(params)

    by_session: dict = {}
    for r in sets:
        by_session.setdefault(r["session"], []).append(r)
    session_date = _session_dates_of(sets)

    week_xp: dict = {}
    for sess, rows in by_session.items():
        is_cardio = all(r.get("kind") == "cardio" for r in rows)
        xp = session_xp(len(rows), is_cardio)
        d = session_date.get(sess)
        if d is None:
            continue
        wmon = _week_monday(d)
        week_xp[wmon] = week_xp.get(wmon, 0) + xp

    weeks = classify_weeks_for_rank(sets, vetoes, asof_epoch_day, p)

    state = RankState(xp=0, slipOffset=0)
    peak_rank_id = get_rank(state)["rankId"]
    slips_applied = 0

    for week in weeks:
        state = apply_xp_gain(state, week_xp.get(week["weekMonday"], 0))
        if week["status"] == "missed":
            state = apply_slip(state)
            slips_applied += 1
        rank_id = get_rank(state)["rankId"]
        if rank_id > peak_rank_id:
            peak_rank_id = rank_id

    # Current (in-progress) week: award its session XP live, with no slip --
    # classify_weeks_for_rank excludes this week entirely (it only classifies
    # completed weeks), so it can never appear in `weeks` above and this is
    # the only place its XP is added. Sample peak_rank_id again afterward so
    # a division crossed by live current-week XP still counts toward peak.
    current_week_monday = _week_monday(asof_epoch_day)
    current_week_xp = week_xp.get(current_week_monday, 0)
    if current_week_xp > 0:
        state = apply_xp_gain(state, current_week_xp)
    final_rank_id = get_rank(state)["rankId"]
    if final_rank_id > peak_rank_id:
        peak_rank_id = final_rank_id

    return {
        "state": {"xp": state.xp, "slipOffset": state.slipOffset},
        "rank": get_rank(state),
        "peakRankId": peak_rank_id,
        "slipsApplied": slips_applied,
    }
