/// <reference types="node" />
// Rank engine tests — run via `tsx` (no test framework), matching the style
// of `../progress.test.ts`: a shared `failures` counter, assert helpers that
// log-and-continue instead of throwing, and one ok/FAIL line per case.
//
// Run with: `npx tsx src/rank/rankEngine.test.ts` (from app/), or
// `npm run test:rank`.

import { classifyWeeksForRank, type WorkoutSet } from "../progress";
import { TIERS, XP_PER_DIVISION } from "./rankLadder";
import { applySlip, applyXpGain, evaluateRank, getRank, sessionXp, type RankState } from "./rankEngine";

let failures = 0;

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    failures++;
    console.error(`FAIL ${msg}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

function assertTrue(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
}

function test(name: string, fn: () => void): void {
  const before = failures;
  try {
    fn();
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}: threw ${e instanceof Error ? e.stack : String(e)}`);
  }
  console.log(failures === before ? `ok  - ${name}` : `FAIL - ${name}`);
}

// ─── date fixture helpers (test-local; not part of the engine's surface) ──
const MS_PER_DAY = 86_400_000;

function epochDay(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function addDays(dateStr: string, days: number): string {
  const dt = new Date((epochDay(dateStr) + days) * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

let uid = 0;
/** One session's worth of strength sets, on `dateStr`, with `setCount` rows. */
function session(dateStr: string, setCount: number, kind?: "cardio"): WorkoutSet[] {
  const sess = `s${uid++}`;
  const rows: WorkoutSet[] = [];
  for (let i = 1; i <= setCount; i++) {
    rows.push(
      kind === "cardio"
        ? { date: dateStr, session: sess, exercise: "row", kind: "cardio", duration: 20, set: i }
        : { date: dateStr, session: sess, exercise: "bench", weight: 100, reps: 5, set: i }
    );
  }
  return rows;
}

/** `weekCount` consecutive full weeks starting at the Monday `startMonday`,
 * each with `sessionsPerWeek` sessions (one per day, Monday onward) of
 * `setsPerSession` sets apiece. Weeks NOT covered by this call (gaps left
 * for the caller to leave empty) are simply absent from the log — that's
 * enough for classifyWeeksForRank to see them as 0-attendance weeks. */
function rampWeeks(startMonday: string, weekCount: number, sessionsPerWeek: number, setsPerSession: number): WorkoutSet[] {
  const out: WorkoutSet[] = [];
  for (let w = 0; w < weekCount; w++) {
    const weekStart = addDays(startMonday, w * 7);
    for (let d = 0; d < sessionsPerWeek; d++) {
      out.push(...session(addDays(weekStart, d), setsPerSession));
    }
  }
  return out;
}

const START = "2024-01-01"; // a Monday

// ─── 1. division & tier boundaries (rankId <-> posXp, incl. Kratos) ────────
test("division/tier boundaries: rankId <-> posXp round-trip at every seam", () => {
  const cases: Array<[number, number, string, string | null, boolean]> = [
    [0, 0, "Initiate", "III", false],
    [149, 0, "Initiate", "III", false],
    [150, 1, "Initiate", "II", false],
    [299, 1, "Initiate", "II", false],
    [300, 2, "Initiate", "I", false],
    [449, 2, "Initiate", "I", false],
    [450, 3, "Ephebe", "III", false], // tier boundary: III of tier N -> III of tier N+1
    [8849, 58, "Nike", "II", false], // just below the 59th-division seam
    [8850, 59, "Nike", "I", false], // 59*150 exactly
    [8999, 59, "Nike", "I", false],
    [9000, 60, "Kratos", null, true], // apex threshold, exact
    [50000, 60, "Kratos", null, true], // apex clamps, never exceeds rankId 60
  ];
  for (const [posXp, rankId, tierName, divisionLabel, isApex] of cases) {
    const view = getRank({ xp: posXp, slipOffset: 0 });
    assertEqual(view.rankId, rankId, `posXp=${posXp} rankId`);
    assertEqual(view.tierName, tierName, `posXp=${posXp} tierName`);
    assertEqual(view.divisionLabel, divisionLabel, `posXp=${posXp} divisionLabel`);
    assertEqual(view.isApex, isApex, `posXp=${posXp} isApex`);
  }
  assertEqual(TIERS.length, 21, "TIERS length");
  assertEqual(XP_PER_DIVISION, 150, "XP_PER_DIVISION is the 150 assumed throughout this file");
  // 61 rank states: 0..59 divisioned + 60 apex.
  assertEqual(getRank({ xp: 9000, slipOffset: 0 }).rankId, 60, "highest rankId is 60");
});

// ─── 2. xp never decreases through gains + slips ───────────────────────────
test("xp never decreases across an interleaved sequence of gains and slips", () => {
  let state: RankState = { xp: 0, slipOffset: 0 };
  let prevXp = state.xp;
  const ops = [10, -1 /* slip marker */, 500, -1, -1, 40, -1, 5000, -1, -1, -1];
  for (const op of ops) {
    state = op === -1 ? applySlip(state) : applyXpGain(state, op);
    assertTrue(state.xp >= prevXp, `xp decreased: ${state.xp} < ${prevXp}`);
    assertTrue(getRank(state).posXp >= 0, "posXp went negative");
    prevXp = state.xp;
  }
});

// ─── 3. one un-excused missed week = exactly one division drop ────────────
test("one un-excused missed week drops exactly one division (via evaluateRank)", () => {
  // 2 ramp weeks at 4 sessions x 8 sets (22 xp/session) = 176 xp -> posXp 176,
  // rankId 1 (150 <= 176 < 300). Then one empty (missed) week.
  const sets = rampWeeks(START, 2, 4, 8);
  const asof = epochDay(addDays(START, 7 * 3)); // Monday of the week after the miss
  const result = evaluateRank(sets, [], asof);
  assertEqual(result.slipsApplied, 1, "exactly one slip");
  assertEqual(result.rank.rankId, 0, "rankId dropped from 1 to 0 (exactly one division)");
});

// ─── 4. consecutive misses stack ───────────────────────────────────────────
test("consecutive missed weeks stack, one division per week", () => {
  // 10 ramp weeks x 4 sessions x 8 sets (22 xp) = 880 xp -> rankId 5
  // (750 <= 880 < 900). Then 3 consecutive empty (missed) weeks.
  const sets = rampWeeks(START, 10, 4, 8);
  const asof = epochDay(addDays(START, 7 * 13)); // Monday after the 3 missed weeks
  const before = evaluateRank(sets, [], epochDay(addDays(START, 7 * 10)));
  assertEqual(before.rank.rankId, 5, "sanity: rankId 5 before any misses");

  const after = evaluateRank(sets, [], asof);
  assertEqual(after.slipsApplied, 3, "three slips for three consecutive misses");
  assertEqual(after.rank.rankId, 2, "rankId dropped by exactly 3 (5 -> 2)");
});

// ─── 5. excused (partially vetoed) week -> no slip ─────────────────────────
test("partially-vetoed week whose prorated target is still met -> pass, no slip", () => {
  // Week of 2024-01-01..01-07: 2 sessions, 4 of the 7 days vetoed ->
  // target = 4*(3/7) ~= 1.714; attended 2 -> ratio ~1.167 >= 1 -> pass.
  const sets = [...session("2024-01-01", 5), ...session("2024-01-02", 5)];
  const vetoes = ["2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06"];
  const asof = epochDay("2024-01-08");

  const weeks = classifyWeeksForRank(sets, vetoes, asof);
  assertEqual(weeks.length, 1, "one classified week");
  assertEqual(weeks[0].status, "pass", "prorated target met -> pass");

  const result = evaluateRank(sets, vetoes, asof);
  assertEqual(result.slipsApplied, 0, "no slip on a passed (excused-but-met) week");
});

// ─── 6. fully-excused week -> skipped (no slip, no xp) ─────────────────────
test("fully-vetoed week (all 7 days) -> excused, skipped entirely", () => {
  // VETO_DAYS_PER_MONTH defaults to 6 — a week fully inside one calendar
  // month can never reach all 7 excused days. Use a week that straddles a
  // month boundary (2024-01-29 .. 2024-02-04) so each side draws from its
  // own month's budget: 3 days in January, 4 in February, both well under
  // the 6/month cap, so all 7 get enforced.
  const vetoes = ["2024-01-29", "2024-01-30", "2024-01-31", "2024-02-01", "2024-02-02", "2024-02-03", "2024-02-04"];
  const sets = session("2024-01-29", 1); // anchor a session so the week is classified
  const asof = epochDay("2024-02-05");

  const weeks = classifyWeeksForRank(sets, vetoes, asof);
  assertEqual(weeks.length, 1, "one classified week");
  assertEqual(weeks[0].status, "excused", "fully-vetoed week is excused, not missed");

  const result = evaluateRank(sets, vetoes, asof);
  assertEqual(result.slipsApplied, 0, "no slip on a fully-excused week");
  assertEqual(result.rank.rankId, 0, "no xp, no slip -> still rank 0");
});

// ─── 7. reset-to-floor worked example ──────────────────────────────────────
test("reset-to-floor: Div-9 140/150 slips to Div-8 0/150, costs 290 xp to return", () => {
  const preSlip: RankState = { xp: 1490, slipOffset: 0 }; // posXp 1490 = 9*150 + 140
  const pre = getRank(preSlip);
  assertEqual(pre.rankId, 9, "pre-slip rankId 9");
  assertEqual(pre.xpIntoDivision, 140, "pre-slip 140/150 into the division");

  const postSlip = applySlip(preSlip);
  const post = getRank(postSlip);
  assertEqual(post.rankId, 8, "post-slip rankId 8");
  assertEqual(post.posXp, 1200, "post-slip posXp is exactly Div-8's floor (1200)");
  assertEqual(post.xpIntoDivision, 0, "post-slip progress zeroed");
  assertEqual(postSlip.xp, 1490, "xp itself is untouched by the slip");

  const returned = applyXpGain(postSlip, 290);
  const returnedView = getRank(returned);
  assertEqual(returnedView.posXp, 1490, "290 xp exactly restores the pre-slip posXp");
  assertEqual(returnedView.rankId, 9, "290 xp exactly restores the pre-slip rankId");
});

// ─── 8. multi-week cold-open catch-up ──────────────────────────────────────
test("cold-open catch-up: 4 elapsed un-excused weeks apply as 4 slips in one call", () => {
  // 8 ramp weeks x 4 sessions x 8 sets (22 xp) = 704 xp -> rankId 4
  // (600 <= 704 < 750). Then 4 consecutive empty (missed) weeks, evaluated
  // in a single evaluateRank call (simulating a cold open after 4 weeks away).
  const sets = rampWeeks(START, 8, 4, 8);
  const asof = epochDay(addDays(START, 7 * 12)); // Monday after the 4 missed weeks
  const result = evaluateRank(sets, [], asof);
  assertEqual(result.slipsApplied, 4, "4 slips applied in one pass");
  assertEqual(result.state.xp, 704, "xp itself never touched by the catch-up");
  assertEqual(result.rank.rankId, 0, "4 slips from rankId 4 lands exactly on the floor");
  assertEqual(result.peakRankId, 4, "peak recorded before the misses");
});

test("cold-open catch-up: monthly veto budget is consumed across the whole month, not per-week", () => {
  // January's cap is 6 excused days total. Spend 1 early (01-01, irrelevant
  // to any week's classification on its own), then request all 7 days of
  // the week of 01-22..01-28 as excused. Only 5 of those 7 get enforced
  // (6 monthly slots - 1 already spent), so that week's target is NOT
  // fully zeroed -> it must classify as "missed", not "excused".
  const sets = session("2024-01-01", 4); // anchor a session so the range covers this week
  const vetoes = ["2024-01-01", "2024-01-22", "2024-01-23", "2024-01-24", "2024-01-25", "2024-01-26", "2024-01-27", "2024-01-28"];
  const asof = epochDay("2024-01-29");
  const weeks = classifyWeeksForRank(sets, vetoes, asof);
  const week4 = weeks.find((w) => w.weekMonday === epochDay("2024-01-22"));
  assertTrue(week4 !== undefined, "week of 01-22 was classified");
  assertEqual(week4?.status, "missed", "budget already spent -> not fully excused despite requesting all 7 days");
});

// ─── 9. Kratos slip -> Nike I ──────────────────────────────────────────────
test("a slip from Kratos lands on Nike I (top division of the tier below)", () => {
  const kratos: RankState = { xp: 9500, slipOffset: 0 };
  const view = getRank(kratos);
  assertTrue(view.isApex, "sanity: starts at Kratos");

  const slipped = applySlip(kratos);
  const post = getRank(slipped);
  assertEqual(post.isApex, false, "no longer apex");
  assertEqual(post.tierName, "Nike", "lands in Nike");
  assertEqual(post.divisionLabel, "I", "top division (I)");
  assertEqual(post.rankId, 59, "rankId 59");
});

// ─── 10. floor cannot underflow ────────────────────────────────────────────
test("slip at rankId 0 stays at 0 (hard floor, no underflow)", () => {
  const floor: RankState = { xp: 0, slipOffset: 0 };
  const slipped = applySlip(floor);
  const view = getRank(slipped);
  assertEqual(view.rankId, 0, "still rankId 0");
  assertEqual(view.posXp, 0, "posXp still 0");
  assertEqual(view.xpIntoDivision, 0, "progress still 0");

  // Also from partway into division 0 (not just xp=0 exactly).
  const partial: RankState = { xp: 50, slipOffset: 0 };
  const partialSlipped = applySlip(partial);
  assertEqual(getRank(partialSlipped).rankId, 0, "partial-division floor also holds at 0");
});

// ─── 11. peak never drops ──────────────────────────────────────────────────
test("peakRankId records the high-water mark and never drops with the current rank", () => {
  // Reuses the same 10-ramp-weeks + 3-misses fixture as the stacking test:
  // peak hits 5 during the ramp, current rank ends at 2.
  const sets = rampWeeks(START, 10, 4, 8);
  const asof = epochDay(addDays(START, 7 * 13));
  const result = evaluateRank(sets, [], asof);
  assertEqual(result.peakRankId, 5, "peak stays at the ramp high (5)");
  assertTrue(result.rank.rankId < result.peakRankId, "current rank fell below the peak");
});

// ─── 13. current (in-progress) week's XP is awarded live, no slip ─────────
test("current in-progress week's session XP is awarded immediately, no slip", () => {
  // Week 0 (2024-01-01..07): 4 sessions x 8 sets, passes (meets F_TARGET=4)
  // -> 88 xp, rankId 0, no slip. asof lands mid-week-1 (2024-01-10, the
  // Wednesday of the still-open week), which classifyWeeksForRank excludes
  // entirely (it only classifies *completed* weeks). Compare the same log
  // with vs. without one extra session logged in that open week.
  const base = rampWeeks(START, 1, 4, 8);
  const withCurrentSession = [...base, ...session(addDays(START, 9), 5)]; // 2024-01-10, week 1
  const asof = epochDay(addDays(START, 9));

  const without = evaluateRank(base, [], asof);
  const withXp = evaluateRank(withCurrentSession, [], asof);

  assertEqual(without.state.xp, 88, "sanity: only week 0's xp counted without the current-week session");
  assertEqual(without.slipsApplied, 0, "sanity: no slips (week 0 passed, current week is a no-op)");

  assertEqual(withXp.state.xp, 88 + 16, "current-week session's 16 xp (6 + 2*5) is added live");
  assertTrue(withXp.state.xp > without.state.xp, "logging a current-week session raises xp immediately");
  assertEqual(withXp.slipsApplied, 0, "no slip is ever applied for the in-progress current week");
});

// ─── 14. regression: a completed missed week still slips as before ────────
test("regression: completed missed week still slips exactly once, even with an open current week beyond it", () => {
  // Same shape as the div-drop test above (2 pass weeks, then week 2 missed
  // entirely), but asof now lands mid-week-3 (Friday) instead of exactly on
  // week 3's Monday, so week 3 is an open current week with zero sessions —
  // proving the live-current-week addition is a true no-op and doesn't
  // disturb the completed-weeks slip fold.
  const sets = rampWeeks(START, 2, 4, 8);
  const asof = epochDay(addDays(START, 7 * 3 + 4)); // Friday of week 3 (open, empty)
  const result = evaluateRank(sets, [], asof);
  assertEqual(result.slipsApplied, 1, "exactly one slip, from the completed missed week 2");
  assertEqual(result.rank.rankId, 0, "rankId dropped from 1 to 0 (unchanged from the pre-change behavior)");
});

// ─── 15. peakRankId reflects a division crossed by current-week XP ────────
test("peakRankId updates when live current-week XP crosses a division the completed weeks never reached", () => {
  // Week 0: 4 sessions x 8 sets = 88 xp -> rankId 0 after the completed
  // fold (peak so far: 0). Then 3 sessions logged in the still-open week 1
  // (66 xp) push total xp to 154 -> rankId 1 (150 <= 154 < 300), crossing a
  // division boundary that no *completed* week ever reached.
  const week0 = rampWeeks(START, 1, 4, 8);
  const week1Monday = addDays(START, 7);
  const currentWeekSessions = [
    ...session(week1Monday, 8),
    ...session(addDays(week1Monday, 1), 8),
    ...session(addDays(week1Monday, 2), 8),
  ];
  const sets = [...week0, ...currentWeekSessions];
  const asof = epochDay(addDays(week1Monday, 3)); // Thursday of week 1, still open

  const result = evaluateRank(sets, [], asof);
  assertEqual(result.state.xp, 88 + 66, "88 xp from completed week 0 plus 66 xp (3x22) from the open week 1");
  assertEqual(result.rank.rankId, 1, "live current-week xp crosses into rankId 1");
  assertEqual(result.peakRankId, 1, "peak updates to reflect the division crossed by current-week xp");
  assertEqual(result.slipsApplied, 0, "no slips anywhere in this scenario");
});

// ─── 12. sessionXp unit tests ───────────────────────────────────────────────
test("sessionXp: base + per-set with cap, cardio flat, cap saturates", () => {
  assertEqual(sessionXp(8, false), 22, "full 8+ set session = 22 (6 + 2*8)");
  assertEqual(sessionXp(20, false), 22, "sets cap saturates beyond SETS_CAP");
  assertEqual(sessionXp(0, true), 6, "cardio session = 6 (base only)");
  assertEqual(sessionXp(12, true), 6, "cardio ignores working-set count entirely");
  assertEqual(sessionXp(3, false), 12, "3-set strength session = 6 + 2*3");
  assertEqual(sessionXp(0, false), 6, "0-set strength session still earns the base");
});

// ─── wrap up ────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("\nOK: all rank engine checks passed.");
}
