// Rank engine — PURE logic only (no Firestore / React Native / Expo
// imports). See RANK_SYSTEM_SPEC.md for the narrative spec and the approved
// implementation brief for the decisions that override it (state count,
// Bellerophon's position, XP pace). Two monotonic numbers are the whole
// state (`xp`, `slipOffset`); everything else — division, tier, progress
// bar — is derived on read. Never store "current rank" as writable state.
//
// Streak/veto logic is intentionally NOT reimplemented here: `evaluateRank`
// reuses `classifyWeeksForRank` (added to `../progress`, itself built on the
// existing, unmodified computeConsistency/computeStreak machinery) for the
// pass/excused/missed call on each week.

import { DEFAULT_PARAMS, classifyWeeksForRank, type ProgressParams, type WorkoutSet } from "../progress";
import { TIERS, XP_GAIN, XP_PER_DIVISION } from "./rankLadder";

// ─── date helpers ───────────────────────────────────────────────────────────
// Deliberately duplicated (not imported) from progress.ts's private epochDay/
// weekMonday: the brief scopes progress.ts's public surface to exactly one
// new export (classifyWeeksForRank), so this module carries its own minimal
// copy of the same UTC Y-M-D day-bucketing math instead of widening that
// file's exports further. Keep in sync with progress.ts if either changes.
const MS_PER_DAY = 86_400_000;

export function epochDayOf(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function isoWeekday(ed: number): number {
  const dow = new Date(ed * MS_PER_DAY).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

function weekMonday(ed: number): number {
  return ed - (isoWeekday(ed) - 1);
}

// ─── §1/§2 state + derived view ────────────────────────────────────────────

/** The whole persisted state. Both fields only ever increase — `xp` from
 * earned sessions, `slipOffset` from streak misses. Never write anything
 * else (no stored "current rank"); always derive via `getRank`. */
export interface RankState {
  xp: number;
  slipOffset: number;
}

/** Highest representable division index (Kratos, the un-divisioned apex).
 * 61 rank states total: absDivision 0..59 are the 20 divisioned tiers x 3
 * divisions each; absDivision 60 is Kratos. */
const MAX_ABS_DIVISION = TIERS.length * 3 - 3; // (21 tiers - 1 divisionless apex) * 3 = 60

const DIVISION_LABELS: readonly string[] = ["III", "II", "I"]; // within-tier index 0,1,2

function clampAbsDivision(n: number): number {
  return Math.max(0, Math.min(MAX_ABS_DIVISION, n));
}

/** floor(posXp / XP_PER_DIVISION), clamped to 0..60 (60 = Kratos apex). */
function absDivisionOf(posXp: number): number {
  return clampAbsDivision(Math.floor(posXp / XP_PER_DIVISION));
}

export interface RankView {
  /** 0..60 — also the absolute division index; this IS the rank identity. */
  rankId: number;
  /** 0..20 — index into TIERS. */
  tierIndex: number;
  tierName: string;
  copy: string;
  isApex: boolean;
  /** 3 | 2 | 1 (III/II/I, low->high) or null for the apex. */
  division: number | null;
  divisionLabel: string | null;
  /** xp - slipOffset, floored at 0. Never negative. */
  posXp: number;
  /** Progress within the current division: posXp - rankId*XP_PER_DIVISION.
   * For Kratos this is NOT clamped to 0..XP_PER_DIVISION — it is posXp minus
   * the apex's own threshold (9000), so it keeps counting up uncapped as a
   * "XP past Kratos" figure rather than resetting/saturating at 150. That is
   * the documented choice for the apex case the spec leaves open (§Kratos
   * has no divisions to bound progress within). */
  xpIntoDivision: number;
  /** XP_PER_DIVISION, always — including at the apex, where it's the cost
   * of the division that was last climbed into Kratos, not a "next" target
   * (there is no next). Kept constant so callers don't need an apex special
   * case just to read this field. */
  xpForDivision: number;
}

export function getRank(state: RankState): RankView {
  const posXp = Math.max(0, state.xp - state.slipOffset);
  const rankId = absDivisionOf(posXp);
  const isApex = rankId >= MAX_ABS_DIVISION;
  const tierIndex = isApex ? TIERS.length - 1 : Math.floor(rankId / 3);
  const within = isApex ? null : rankId % 3; // 0,1,2 => III,II,I
  const division = within === null ? null : 3 - within;
  const divisionLabel = within === null ? null : DIVISION_LABELS[within];
  const tier = TIERS[tierIndex];

  return {
    rankId,
    tierIndex,
    tierName: tier.name,
    copy: tier.copy,
    isApex,
    division,
    divisionLabel,
    posXp,
    xpIntoDivision: posXp - rankId * XP_PER_DIVISION,
    xpForDivision: XP_PER_DIVISION,
  };
}

// ─── §2 XP gain ─────────────────────────────────────────────────────────────

/** XP earned by one logged session. Cardio sessions earn a flat base (no
 * per-set component — duration-logged, not set-logged); strength sessions
 * earn the base plus a per-set bonus that saturates at SETS_CAP. */
export function sessionXp(workingSets: number, isCardio: boolean): number {
  if (isCardio) return XP_GAIN.SESSION_BASE;
  return XP_GAIN.SESSION_BASE + XP_GAIN.PER_SET * Math.min(Math.max(0, workingSets), XP_GAIN.SETS_CAP);
}

/** `xp` only ever rises. `slipOffset` is untouched. */
export function applyXpGain(state: RankState, amount: number): RankState {
  return { xp: state.xp + amount, slipOffset: state.slipOffset };
}

/** One un-excused missed week: drop exactly one division, zero progress
 * within it, `xp` untouched (so it stays monotonic). `d = current
 * absDivision; target = max(0, d-1) * XP_PER_DIVISION; slipOffset = xp -
 * target`. Hard-floors at absDivision 0 (cannot underflow) and, from Kratos,
 * lands on the top division (I) of the tier directly below via the same
 * formula (d=60 -> target = 59*XP_PER_DIVISION). */
export function applySlip(state: RankState): RankState {
  const posXp = Math.max(0, state.xp - state.slipOffset);
  const d = absDivisionOf(posXp);
  const target = Math.max(0, d - 1) * XP_PER_DIVISION;
  return { xp: state.xp, slipOffset: state.xp - target };
}

// ─── §6 lazy evaluation — the one-pass cold-open catch-up ─────────────────

export interface RankResult {
  state: RankState;
  rank: RankView;
  /** Highest rankId ever reached during the fold. Never decremented. */
  peakRankId: number;
  /** Count of "missed" weeks that triggered a slip during this fold. */
  slipsApplied: number;
}

/** session id -> minimum epoch day among its sets (mirrors progress.ts's
 * private sessionDatesOf, duplicated here for the same reason as the
 * epochDay/weekMonday helpers above). */
function sessionDatesOf(sets: readonly WorkoutSet[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of sets) {
    const ed = epochDayOf(r.date);
    const cur = m.get(r.session);
    if (cur === undefined || ed < cur) m.set(r.session, ed);
  }
  return m;
}

/** Fold a full log (sets + vetoes) into a final RankState in one pass:
 * group sets into sessions, compute each session's XP, bucket that XP by
 * the ISO week it falls in, classify every completed week as
 * pass/excused/missed via `classifyWeeksForRank`, then walk the weeks
 * chronologically applying that week's XP gain and — on a miss — a slip.
 * This is the whole lazy-evaluation story: no background job, no stored
 * "current rank"; a cold open after an arbitrary absence just folds over
 * however many weeks accumulated, consuming the veto budget correctly
 * because classifyWeeksForRank (via enforceVetoCap) evaluates the whole
 * vetoes list up front, exactly as computeConsistency does. */
export function evaluateRank(
  sets: readonly WorkoutSet[],
  vetoes: readonly string[],
  asofEpochDay: number,
  params: ProgressParams = DEFAULT_PARAMS
): RankResult {
  const bySession = new Map<string, WorkoutSet[]>();
  for (const r of sets) {
    let bucket = bySession.get(r.session);
    if (!bucket) {
      bucket = [];
      bySession.set(r.session, bucket);
    }
    bucket.push(r);
  }
  const sessionDate = sessionDatesOf(sets);

  const weekXp = new Map<number, number>();
  for (const [sess, rows] of bySession) {
    const isCardio = rows.every((r) => r.kind === "cardio");
    const xp = sessionXp(rows.length, isCardio);
    const d = sessionDate.get(sess);
    if (d === undefined) continue;
    const wmon = weekMonday(d);
    weekXp.set(wmon, (weekXp.get(wmon) ?? 0) + xp);
  }

  const weeks = classifyWeeksForRank(sets, vetoes, asofEpochDay, params);

  let state: RankState = { xp: 0, slipOffset: 0 };
  let peakRankId = getRank(state).rankId;
  let slipsApplied = 0;

  for (const week of weeks) {
    state = applyXpGain(state, weekXp.get(week.weekMonday) ?? 0);
    if (week.status === "missed") {
      state = applySlip(state);
      slipsApplied++;
    }
    const rankId = getRank(state).rankId;
    if (rankId > peakRankId) peakRankId = rankId;
  }

  // Current (in-progress) week: award its session XP live, with no slip —
  // classifyWeeksForRank excludes this week entirely (it only classifies
  // completed weeks), so it can never appear in `weeks` above and this is
  // the only place its XP is added. Sample peakRankId again afterward so a
  // division crossed by live current-week XP still counts toward the peak.
  const currentWeekMonday = weekMonday(asofEpochDay);
  const currentWeekXp = weekXp.get(currentWeekMonday) ?? 0;
  if (currentWeekXp > 0) {
    state = applyXpGain(state, currentWeekXp);
  }
  const finalRankId = getRank(state).rankId;
  if (finalRankId > peakRankId) peakRankId = finalRankId;

  return { state, rank: getRank(state), peakRankId, slipsApplied };
}
