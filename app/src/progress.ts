// Phase 9 — XP / leveling engine. TypeScript port of `desktop/progress.py`,
// mirroring it 1:1 per `phase9-xp-spec.md` (repo root) — every section
// reference in the comments below (§3, §4, ...) points there. This module is
// PURE: no React Native / Firestore / Expo imports, so it is unit-testable
// with plain arrays and safe to call from UI code without pulling in any app
// runtime. No stored XP/level: everything is recomputed from the log +
// vetoes on every call.
//
// The Exercise/MuscleGroup/MuscleCredit-shaped inputs intentionally mirror
// `app/src/registry.ts`'s types rather than importing them, since importing
// registry.ts would drag in `firebase.ts` (impure) — see that file for the
// canonical UI-facing types this module's inputs are shaped after.

// ─── input shapes ──────────────────────────────────────────────────────────

/** One logged set row, as produced by the app's session log.
 *
 * Cardio (§Cardio note, phase9-xp-spec.md): `kind: "cardio"` sets are logged
 * by DURATION, not weight×reps. A missing `kind` means `"strength"`
 * (back-compat with every log recorded before this field existed). Cardio
 * counts toward Consistency only (a session is a session — see
 * `sessionDatesOf`, which is never filtered by kind); it is EXCLUDED from
 * Progression and Volume (see `isStrengthSet`), since those are strength-only
 * axes keyed on weight/reps/est-1RM and a weight-less cardio set would
 * otherwise NaN that math. `weight`/`reps` are meaningless for cardio rows
 * (real data omits them) — callers must never read them without first
 * filtering to strength sets. */
export interface WorkoutSet {
  uid?: string;
  date: string; // "YYYY-MM-DD"
  session: string;
  exercise: string;
  kind?: "strength" | "cardio"; // absent == "strength"
  weight?: number; // strength sets only; cardio sets omit this
  reps?: number; // strength sets only; cardio sets omit this
  set?: number;
  duration?: number; // cardio sets: minutes
  distance?: number; // cardio sets: unit left to the UI (later stage)
}

/** A WorkoutSet narrowed to the strength shape (weight/reps guaranteed
 * present) — the result of filtering with `isStrengthSet` below. */
export type StrengthWorkoutSet = WorkoutSet & { weight: number; reps: number };

/** A WorkoutSet narrowed to the cardio shape (duration guaranteed present).
 * Exported alongside StrengthWorkoutSet so UI code (LogScreen) can narrow to
 * either kind without re-deriving the shape itself. */
export type CardioWorkoutSet = WorkoutSet & { kind: "cardio"; duration: number };

/** Mirrors registry.ts's MuscleCredit shape. */
export interface MuscleCreditLike {
  group: string;
  role: "primary" | "secondary" | string;
  weight: number;
  emphasis?: string | null;
}

/** Mirrors registry.ts's Exercise shape (id omitted — unused by the engine). */
export interface RegistryExercise {
  uid?: string;
  name: string;
  muscles: MuscleCreditLike[] | null;
  lastWeight?: number | null;
}

/** Mirrors registry.ts's MuscleGroup shape (id omitted — unused by the engine). */
export interface RegistryGroup {
  uid?: string;
  name: string;
  order?: number;
}

export interface WeeklyEntry {
  iso_week: string;
  sessions: number;
  ratio: number;
}

export interface BaselineEntry {
  baseline_e1rm: number;
  current_e1rm: number;
  confirmed: boolean;
}

export interface GroupProgress {
  xp: number;
  level: number;
}

export interface Progress {
  xp: number;
  level: number;
  streak: number;
  components: {
    consistency: number;
    progression: number;
    volume: number;
  };
  perGroup: Record<string, GroupProgress>;
  weekly: WeeklyEntry[];
  baselines: Record<string, BaselineEntry>;
  weights: {
    consistency: number;
    progression: number;
    volume: number;
  };
}

// ─── §9 default parameters — every constant here is meant to be retuned on
// real data, not hardcoded logic. `params` (a plain object) overrides
// selectively: `{ ...DEFAULT_PARAMS, ...overrides }`.
export const DEFAULT_PARAMS = {
  F_TARGET: 4, // target sessions/week (before proration)
  W_WEEKS: 12, // evaluation window for consistency/weekly[]
  HALF_LIFE_WEEKS: 3, // consistency recency decay half-life
  BASELINE_WEEKS: 4, // trailing window for the progression axis
  MIN_SESSIONS_FOR_BASELINE: 2, // prior sessions required to trust baseline_e
  DELTA_CAP: 0.1, // max per-exercise credited gain
  UNPHYSICAL: 0.75, // raw gain above this needs 2-session corroboration
  PROGRESSION_NORM: 0.3, // Σgain_e / this -> progression 0..1
  VETO_DAYS_PER_MONTH: 6, // non-rolling monthly excused-day budget
  SET_DECAY: 0.6, // k-th working set worth SET_DECAY**(k-1)
  VOLUME_WEEKS: 4, // trailing window for the volume axis
  TARGET_CREDIT: 1.95, // credited_e -> ex_vol saturation target (~3 clean sets)
  PROG_HI: 0.45, // progression weight at zero tenure
  PROG_LO: 0.2, // progression weight at full maturity
  CONS_LO: 0.35, // consistency weight at zero tenure
  CONS_HI: 0.6, // consistency weight at full maturity
  MATURE_WEEKS: 52, // tenure (weeks trained) at full maturity
  XP_SCALE: 1000, // score (0..1) -> xp (0..XP_SCALE)
  LEVEL_K: 10, // xp -> level = floor(sqrt(xp / LEVEL_K))
  STREAK_MIN: 1.0, // ratio_w threshold a week must clear for streak
};

export type ProgressParams = typeof DEFAULT_PARAMS;

// ─── date / week helpers ───────────────────────────────────────────────────
// Everything below works in "epoch days" (integer days since the Unix
// epoch, computed via Date.UTC) rather than local-timezone `Date` objects,
// so there is no DST/timezone drift — pure Y-M-D integer math, matching
// Python's `date` arithmetic exactly.

const MS_PER_DAY = 86_400_000;

function parseYMD(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

/** "YYYY-MM-DD" -> integer days since the Unix epoch (UTC, no TZ drift). */
function epochDay(s: string): number {
  const { y, m, d } = parseYMD(s);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** integer epoch day -> "YYYY-MM-DD". */
function epochDayToISO(ed: number): string {
  const dt = new Date(ed * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** ISO weekday: 1 (Monday) .. 7 (Sunday), matching Python's date.isoweekday(). */
function isoWeekday(ed: number): number {
  const dow = new Date(ed * MS_PER_DAY).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

/** Monday of the ISO week containing the given epoch day. */
function weekMonday(ed: number): number {
  return ed - (isoWeekday(ed) - 1);
}

/** ISO week label "GGGG-Www" (Monday-start week), matching
 * `date.isocalendar()` in Python — using the standard "Thursday trick":
 * a date's ISO week/year equals the week/year of the Thursday in its week. */
function isoWeekLabel(ed: number): string {
  const wd = isoWeekday(ed);
  const thursdayEd = ed + (4 - wd);
  const thursdayDt = new Date(thursdayEd * MS_PER_DAY);
  const year = thursdayDt.getUTCFullYear();
  const yearStartEd = Math.round(Date.UTC(year, 0, 1) / MS_PER_DAY);
  const week = Math.floor((thursdayEd - yearStartEd) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** n Monday epoch-days, oldest first, ending with the Monday of asof's week. */
function weeksEndingAt(asofEd: number, n: number): number[] {
  const endMonday = weekMonday(asofEd);
  const out: number[] = [];
  for (let k = n - 1; k >= 0; k--) out.push(endMonday - 7 * k);
  return out;
}

function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// Cross-language determinism: xp is always >= 0 here. JS `Math.round` and
// this formula agree for non-negatives, but we pin the explicit
// round-half-away-from-zero formula (mirrors progress.py's `_round_half_up`)
// so there is no ambiguity about which convention is in play.
function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

// ─── §5 vetoes: per-calendar-month cap, non-rolling ───────────────────────
function enforceVetoCap(vetoes: readonly string[], cap: number): Set<string> {
  const unique = Array.from(new Set(vetoes));
  const byMonth = new Map<string, string[]>();
  for (const ds of unique) {
    const { y, m } = parseYMD(ds);
    const key = `${y}-${String(m).padStart(2, "0")}`;
    let bucket = byMonth.get(key);
    if (!bucket) {
      bucket = [];
      byMonth.set(key, bucket);
    }
    bucket.push(ds);
  }
  const enforced = new Set<string>();
  const monthKeys = Array.from(byMonth.keys()).sort();
  for (const key of monthKeys) {
    const monthDates = [...byMonth.get(key)!].sort();
    for (const d of monthDates.slice(0, cap)) enforced.add(d);
  }
  return enforced;
}

// ─── session bookkeeping ───────────────────────────────────────────────────
/** session id -> its date (min date of its sets, as an epoch day), §2. */
function sessionDatesOf(sets: readonly WorkoutSet[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of sets) {
    const ed = epochDay(r.date);
    const cur = m.get(r.session);
    if (cur === undefined || ed < cur) m.set(r.session, ed);
  }
  return m;
}

function sessionsInWindow(
  sessionDates: Map<string, number>,
  windowStart: number,
  windowEnd: number
): Set<string> {
  const out = new Set<string>();
  for (const [sess, d] of sessionDates) {
    if (d >= windowStart && d <= windowEnd) out.add(sess);
  }
  return out;
}

// ─── §3 Axis 1 — consistency (with decay) ─────────────────────────────────
interface WeekInfo {
  wmon: number;
  target: number;
  ratio: number;
}

function computeConsistency(
  sessionDates: Map<string, number>,
  enforcedVetoes: Set<string>,
  asof: number,
  params: ProgressParams
): { consistency: number; weekly: WeeklyEntry[]; weekInfo: WeekInfo[] } {
  const weeks = weeksEndingAt(asof, params.W_WEEKS);
  const fTarget = params.F_TARGET;
  const halfLife = params.HALF_LIFE_WEEKS;

  const sessionsByWeek = new Map<number, Set<string>>();
  for (const [sess, d] of sessionDates) {
    const wmon = weekMonday(d);
    let bucket = sessionsByWeek.get(wmon);
    if (!bucket) {
      bucket = new Set();
      sessionsByWeek.set(wmon, bucket);
    }
    bucket.add(sess);
  }

  const currentWeek = weeks[weeks.length - 1];
  const weekly: WeeklyEntry[] = [];
  const weekInfo: WeekInfo[] = [];
  let num = 0;
  let den = 0;

  for (const wmon of weeks) {
    const k = Math.round((currentWeek - wmon) / 7);
    let excused = 0;
    for (let i = 0; i < 7; i++) {
      if (enforcedVetoes.has(epochDayToISO(wmon + i))) excused++;
    }
    const avail = (7 - excused) / 7;
    const targetW = fTarget * avail;
    const attended = sessionsByWeek.get(wmon)?.size ?? 0;

    let ratioW = 0;
    if (targetW > 0) {
      ratioW = Math.min(attended / targetW, 1.0);
      const decayK = Math.pow(0.5, k / halfLife);
      num += decayK * ratioW;
      den += decayK;
    }
    weekly.push({ iso_week: isoWeekLabel(wmon), sessions: attended, ratio: ratioW });
    weekInfo.push({ wmon, target: targetW, ratio: ratioW });
  }

  const consistency = den > 0 ? num / den : 0.0;
  return { consistency, weekly, weekInfo };
}

function computeStreak(weekInfo: WeekInfo[], streakMin: number): number {
  let streak = 0;
  for (let i = weekInfo.length - 1; i >= 0; i--) {
    const { target, ratio } = weekInfo[i];
    if (target === 0) continue; // fully-excused week: skipped, not streak-breaking
    if (ratio >= streakMin) streak++;
    else break;
  }
  return streak;
}

// ─── rank engine support — a read-only per-week pass/excused/missed
// classifier, reusing the exact veto-proration + STREAK_MIN rule already
// implemented above in computeConsistency/computeStreak (neither of which is
// modified here). Consumed by `app/src/rank/rankEngine.ts`'s evaluateRank —
// see RANK_SYSTEM_SPEC.md. Deliberately NOT a rank/XP concept itself: this
// file stays streak-only; the rank module derives from its output. ─────────

/** A single week's classification for the rank engine's slip logic.
 * - "pass": attended/target >= STREAK_MIN — no slip.
 * - "excused": the week's veto-prorated target was fully zeroed (all 7 days
 *   excused) — skipped entirely, same as computeStreak's "neither breaks nor
 *   extends" rule. No slip.
 * - "missed": target > 0 and attended/target < STREAK_MIN — one slip. */
export type WeekStatus = "pass" | "excused" | "missed";

export interface RankWeek {
  weekMonday: number; // epoch day
  status: WeekStatus;
}

/** Classify every completed week from the first logged session's week
 * through the last completed week strictly before `asof`'s current
 * (in-progress) week — that week is excluded because it cannot be judged
 * "missed" yet. Chronological order (oldest first), so callers can fold over
 * it directly. Uses the same veto proration (`target = F_TARGET*(7-excused)/7`)
 * and STREAK_MIN threshold as computeConsistency/computeStreak, applied
 * per-week rather than folded into a single streak count. */
export function classifyWeeksForRank(
  sets: readonly WorkoutSet[],
  vetoes: readonly string[],
  asofEpochDay: number,
  params: ProgressParams = DEFAULT_PARAMS
): RankWeek[] {
  // Mirror computeProgress's own pre-filter (sets.filter(date <= asOf))
  // before deriving session dates, so a stray future-dated row can't shift
  // the classified range or pad a week's attendance count.
  const filteredSets = sets.filter((r) => epochDay(r.date) <= asofEpochDay);
  const sessionDates = sessionDatesOf(filteredSets);
  if (sessionDates.size === 0) return [];

  const enforcedVetoes = enforceVetoCap(vetoes, params.VETO_DAYS_PER_MONTH);

  const sessionsByWeek = new Map<number, Set<string>>();
  let firstWeek = Infinity;
  for (const [sess, d] of sessionDates) {
    const wmon = weekMonday(d);
    if (wmon < firstWeek) firstWeek = wmon;
    let bucket = sessionsByWeek.get(wmon);
    if (!bucket) {
      bucket = new Set();
      sessionsByWeek.set(wmon, bucket);
    }
    bucket.add(sess);
  }

  const currentWeekMonday = weekMonday(asofEpochDay);
  const lastCompletedWeek = currentWeekMonday - 7; // exclude the in-progress week
  if (lastCompletedWeek < firstWeek) return [];

  const fTarget = params.F_TARGET;
  const out: RankWeek[] = [];
  for (let wmon = firstWeek; wmon <= lastCompletedWeek; wmon += 7) {
    let excused = 0;
    for (let i = 0; i < 7; i++) {
      if (enforcedVetoes.has(epochDayToISO(wmon + i))) excused++;
    }
    const avail = (7 - excused) / 7;
    const targetW = fTarget * avail;
    const attended = sessionsByWeek.get(wmon)?.size ?? 0;

    let status: WeekStatus;
    if (targetW === 0) {
      status = "excused";
    } else {
      status = attended / targetW >= params.STREAK_MIN ? "pass" : "missed";
    }
    out.push({ weekMonday: wmon, status });
  }
  return out;
}

// ─── strength/cardio filter — shared by Progression (§4) and Volume (§6);
// Consistency (§3) is deliberately kind-agnostic, see WorkoutSet above. ─────
/** True for a strength set; false for cardio. Missing `kind` == strength.
 * A type predicate so `.filter(isStrengthSet)` narrows weight/reps from
 * optional to required for every downstream reader — every real strength
 * doc is guaranteed to carry finite weight/reps by workouts.ts's seam, so
 * this narrowing is safe, not just convenient. */
function isStrengthSet(r: WorkoutSet): r is StrengthWorkoutSet {
  return r.kind !== "cardio";
}

// ─── §4 Axis 2 — progression-that-holds ───────────────────────────────────
function epley1rm(weight: number, reps: number): number {
  return weight * (1 + reps / 30);
}

interface TopRow {
  exercise: string;
  session: string;
  est1rm: number;
}

/** Top set (max weight, ties broken by higher reps) per (exercise, session),
 * with its Epley est-1RM — mirrors `metrics.top_sets` / progress.py's
 * `_top_set_per_session`. Output is ordered by (exercise, session) ascending
 * to mirror pandas' `groupby(..., sort=True)` default, since later code
 * relies on that ordering for stable tie-breaks on equal session dates. */
function topSetPerSession(rows: readonly StrengthWorkoutSet[]): TopRow[] {
  const groups = new Map<string, Map<string, StrengthWorkoutSet>>();
  for (const r of rows) {
    let inner = groups.get(r.exercise);
    if (!inner) {
      inner = new Map();
      groups.set(r.exercise, inner);
    }
    const cur = inner.get(r.session);
    if (!cur || r.weight > cur.weight || (r.weight === cur.weight && r.reps > cur.reps)) {
      inner.set(r.session, r);
    }
  }
  const out: TopRow[] = [];
  for (const [exercise, inner] of groups) {
    for (const [session, r] of inner) {
      out.push({ exercise, session, est1rm: epley1rm(r.weight, r.reps) });
    }
  }
  out.sort((a, b) => {
    if (a.exercise !== b.exercise) return a.exercise < b.exercise ? -1 : 1;
    if (a.session !== b.session) return a.session < b.session ? -1 : 1;
    return 0;
  });
  return out;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

function computeProgression(
  sets: readonly WorkoutSet[],
  sessionDates: Map<string, number>,
  asof: number,
  params: ProgressParams
): { progression: number; baselines: Record<string, BaselineEntry> } {
  const weeks = weeksEndingAt(asof, params.BASELINE_WEEKS);
  // Progression is strength-only (§Cardio note): cardio sets carry no
  // weight/reps in practice, so they're dropped before any est-1RM math ever
  // touches them.
  const strengthSets = sets.filter(isStrengthSet);
  if (strengthSets.length === 0 || sessionDates.size === 0) return { progression: 0, baselines: {} };

  const windowStart = weeks[0];
  const windowEnd = weeks[weeks.length - 1] + 6;
  const inWindow = sessionsInWindow(sessionDates, windowStart, windowEnd);
  const df = strengthSets.filter((r) => inWindow.has(r.session));
  if (df.length === 0) return { progression: 0, baselines: {} };

  const top = topSetPerSession(df);
  const withD = top.map((r) => ({ ...r, d: sessionDates.get(r.session)! }));

  const byExercise = new Map<string, (TopRow & { d: number })[]>();
  for (const r of withD) {
    let bucket = byExercise.get(r.exercise);
    if (!bucket) {
      bucket = [];
      byExercise.set(r.exercise, bucket);
    }
    bucket.push(r);
  }

  let totalGain = 0;
  const baselines: Record<string, BaselineEntry> = {};
  const exNames = Array.from(byExercise.keys()).sort();

  for (const ex of exNames) {
    const grp = byExercise.get(ex)!;
    // Stable sort by date ascending — ties preserve the (exercise, session)
    // ascending order established by topSetPerSession, matching Python's
    // `grp.sort_values("d")` stability there.
    const recs = [...grp].sort((a, b) => a.d - b.d);
    const prior = recs.slice(0, -1);
    const current = recs[recs.length - 1];
    if (prior.length < params.MIN_SESSIONS_FOR_BASELINE) continue; // not enough history -> skip

    const baselineE = median(prior.map((r) => r.est1rm));
    if (baselineE <= 0) continue;

    const currentE1rm = current.est1rm;
    const rawGain = Math.max(0, currentE1rm / baselineE - 1.0);

    // Confirm-or-zero (anti-ego): counts only if the level has been
    // exceeded (beaten baseline_e) in >=2 distinct sessions in the window.
    const overBaseline = recs.filter((r) => r.est1rm > baselineE).length;
    const confirmed = overBaseline >= 2;

    let gainE: number;
    if (!confirmed) {
      gainE = 0;
    } else if (rawGain > params.UNPHYSICAL) {
      // Unphysical guard: a huge jump only counts (capped) if that same
      // magnitude of jump was itself reproduced in >=2 sessions.
      const overUnphysical = recs.filter((r) => r.est1rm / baselineE - 1.0 > params.UNPHYSICAL).length;
      gainE = overUnphysical >= 2 ? Math.min(rawGain, params.DELTA_CAP) : 0;
    } else {
      gainE = Math.min(rawGain, params.DELTA_CAP); // cap, don't penalize
    }

    totalGain += gainE;
    baselines[ex] = { baseline_e1rm: baselineE, current_e1rm: currentE1rm, confirmed };
  }

  const progression = clip(totalGain / params.PROGRESSION_NORM, 0.0, 1.0);
  return { progression, baselines };
}

// ─── §6 Axis 3 — volume (absolute per-set saturation) ─────────────────────
function computeVolume(
  sets: readonly WorkoutSet[],
  sessionDates: Map<string, number>,
  asof: number,
  params: ProgressParams
): number {
  const weeks = weeksEndingAt(asof, params.VOLUME_WEEKS);
  // Volume is strength-only (§Cardio note): a set-count/decay axis has no
  // meaning for a duration-logged cardio session, so cardio never contributes.
  const strengthSets = sets.filter(isStrengthSet);
  if (strengthSets.length === 0 || sessionDates.size === 0) return 0;

  const windowStart = weeks[0];
  const windowEnd = weeks[weeks.length - 1] + 6;
  const inWindow = sessionsInWindow(sessionDates, windowStart, windowEnd);
  const df = strengthSets.filter((r) => inWindow.has(r.session));
  if (df.length === 0) return 0;

  const setDecay = params.SET_DECAY;
  const targetCredit = params.TARGET_CREDIT;
  const halfLife = params.HALF_LIFE_WEEKS;
  const currentWeek = weeks[weeks.length - 1];

  // (exercise, session) -> set count, via a nested map to avoid any risk of
  // string-key collisions between exercise/session values.
  const groups = new Map<string, Map<string, number>>();
  for (const r of df) {
    let inner = groups.get(r.exercise);
    if (!inner) {
      inner = new Map();
      groups.set(r.exercise, inner);
    }
    inner.set(r.session, (inner.get(r.session) ?? 0) + 1);
  }

  let num = 0;
  let den = 0;
  const exNames = Array.from(groups.keys()).sort();
  for (const ex of exNames) {
    const inner = groups.get(ex)!;
    const sessNames = Array.from(inner.keys()).sort();
    for (const sess of sessNames) {
      const n = inner.get(sess)!;
      let credited = 0;
      for (let k = 0; k < n; k++) credited += Math.pow(setDecay, k); // k=0..n-1 == SET_DECAY**(k-1) for k=1..n
      const exVol = Math.min(credited / targetCredit, 1.0);
      const wmon = weekMonday(sessionDates.get(sess)!);
      const k = Math.round((currentWeek - wmon) / 7);
      const decayK = Math.pow(0.5, k / halfLife);
      num += decayK * exVol;
      den += decayK;
    }
  }

  return den > 0 ? num / den : 0.0;
}

// ─── §7 blend, maturation, level ───────────────────────────────────────────
function maturationWeights(
  tenureWeeks: number,
  params: ProgressParams
): { wCons: number; wProg: number; wVol: number } {
  const m = clip(tenureWeeks / params.MATURE_WEEKS, 0.0, 1.0);
  const wProg = params.PROG_HI + (params.PROG_LO - params.PROG_HI) * m;
  const wCons = params.CONS_LO + (params.CONS_HI - params.CONS_LO) * m;
  const wVol = 1.0 - wProg - wCons;
  return { wCons, wProg, wVol };
}

function scoreToXpLevel(score: number, params: ProgressParams): { xp: number; level: number } {
  const xp = roundHalfUp(score * params.XP_SCALE);
  const level = Math.floor(Math.sqrt(xp / params.LEVEL_K));
  return { xp, level };
}

// ─── registry lookups ──────────────────────────────────────────────────────
/** (exercise name, lowercased) -> its primary muscle-group name. */
function primaryGroupLookup(exercises: readonly RegistryExercise[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const r of exercises) {
    const muscles = r.muscles || [];
    const primary = muscles.find((m) => m.role === "primary");
    if (primary) lookup.set(String(r.name).toLowerCase(), primary.group);
  }
  return lookup;
}

// ─── §1 entry point ─────────────────────────────────────────────────────────
/** Pure function over one user's resolved log -> the §1 Progress object. No
 * stored XP/level anywhere; recomputed fresh from `workouts` + `vetoes` every
 * call. */
export function computeProgress(
  workouts: readonly WorkoutSet[],
  exercises: readonly RegistryExercise[],
  groups: readonly RegistryGroup[],
  vetoes: readonly string[] = [],
  params?: Partial<ProgressParams>,
  asOf?: string
): Progress {
  const p: ProgressParams = { ...DEFAULT_PARAMS, ...(params ?? {}) };

  const asofEd = asOf !== undefined ? epochDay(asOf) : Math.floor(Date.now() / MS_PER_DAY);
  const asOfStr = epochDayToISO(asofEd);

  const sets = workouts.filter((r) => r.date <= asOfStr);

  const enforcedVetoes = enforceVetoCap(vetoes, p.VETO_DAYS_PER_MONTH);
  const sessionDates = sessionDatesOf(sets);

  const { consistency, weekly, weekInfo } = computeConsistency(sessionDates, enforcedVetoes, asofEd, p);
  const streak = computeStreak(weekInfo, p.STREAK_MIN);
  const { progression, baselines } = computeProgression(sets, sessionDates, asofEd, p);
  const volume = computeVolume(sets, sessionDates, asofEd, p);

  const tenureWeeks = new Set<number>();
  for (const d of sessionDates.values()) tenureWeeks.add(weekMonday(d));
  const tenure = tenureWeeks.size;

  const { wCons, wProg, wVol } = maturationWeights(tenure, p);
  const score = wCons * consistency + wProg * progression + wVol * volume;
  const { xp, level } = scoreToXpLevel(score, p);

  const lookup = primaryGroupLookup(exercises);
  const groupNames = groups.map((g) => g.name);

  // §7: "no primary sets in the window" -> untrained group, {xp:0, level:0},
  // not even the shared consistency. "The window" = the same evaluation
  // window used for consistency (§2/§3), W_WEEKS ending at asOf.
  const wWeeks = weeksEndingAt(asofEd, p.W_WEEKS);
  const wWindowStart = wWeeks[0];
  const wWindowEnd = wWeeks[wWeeks.length - 1] + 6;
  const sessionsInWWindow = sessionsInWindow(sessionDates, wWindowStart, wWindowEnd);

  const perGroup: Record<string, GroupProgress> = {};
  for (const g of groupNames) {
    const exInG = new Set<string>();
    for (const [name, grp] of lookup) if (grp === g) exInG.add(name);

    const gSets = sets.length === 0 || exInG.size === 0 ? [] : sets.filter((r) => exInG.has(String(r.exercise).toLowerCase()));

    const gSetsInWindow = gSets.filter((r) => sessionsInWWindow.has(r.session));
    if (gSetsInWindow.length === 0) {
      perGroup[g] = { xp: 0, level: 0 };
      continue;
    }

    // Windowing is keyed by session id -> date, a session-level (not
    // per-exercise) fact, so it always uses the *global* sessionDates even
    // though gSets itself is filtered to this group's exercises.
    const { progression: gProgression } = computeProgression(gSets, sessionDates, asofEd, p);
    const gVolume = computeVolume(gSets, sessionDates, asofEd, p);
    // consistency is shared (global weekly attendance) per spec §7
    const gScore = wCons * consistency + wProg * gProgression + wVol * gVolume;
    const { xp: gXp, level: gLevel } = scoreToXpLevel(gScore, p);
    perGroup[g] = { xp: gXp, level: gLevel };
  }

  return {
    xp,
    level,
    streak,
    components: { consistency, progression, volume },
    perGroup,
    weekly,
    baselines,
    weights: { consistency: wCons, progression: wProg, volume: wVol },
  };
}
