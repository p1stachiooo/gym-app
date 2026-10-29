// Phase 11 — maps our muscle-group names (Phase-7 taxonomy, refined to 17
// groups in Phase 14) onto
// react-native-body-highlighter's body-part slugs, and turns a Phase-9
// per-group LEVEL into a cold->hot fill color. Pure/presentational: no
// Firestore, no engine changes — computeProgress()'s perGroup is the only
// input this module ever reads.
import type { ExtendedBodyPart, Slug } from "react-native-body-highlighter";

import type { RegistryExercise, WorkoutSet } from "./progress";
import { colors } from "./theme";

// Our registry group names -> the library's Slug union (verified against
// react-native-body-highlighter@3.2.0's exported `Slug` type — every slug
// below is a literal member of that union, so no renames were needed).
export const GROUP_TO_SLUGS: Record<string, Slug[]> = {
  Chest: ["chest"],
  Biceps: ["biceps"],
  Triceps: ["triceps"],
  Shoulders: ["deltoids"],
  Traps: ["trapezius"],
  // The Phase-14 back split. The library has no distinct lats slug, so Lats
  // deliberately collides with Upper Back on "upper-back": whichever is
  // higher wins, per buildBodyData's max-aggregation (same trick as Cardio).
  Lats: ["upper-back"],
  "Upper Back": ["upper-back"],
  "Lower Back": ["lower-back"],
  Core: ["abs", "obliques"],
  Glutes: ["gluteal"],
  // Hip adductors get their own slug; there is no abductor/glute-medius slug,
  // so Abductors deliberately collides with Glutes on "gluteal" — again
  // resolved by buildBodyData's max-aggregation.
  Adductors: ["adductors"],
  Abductors: ["gluteal"],
  Hamstrings: ["hamstring"],
  Quads: ["quadriceps"],
  Calves: ["calves"],
  Forearms: ["forearm"],
  // Cardio counts consistency-only (no strength progression/volume — see the
  // §Cardio note in progress.ts), but should still visually light up the
  // body map. It deliberately collides with the leg-strength groups below
  // (Quads/Hamstrings/Calves/Glutes all target the same 4 slugs): whichever
  // is higher wins, per buildBodyData's max-aggregation.
  Cardio: ["quadriceps", "hamstring", "calves", "gluteal"],
};

export const ALL_GROUPS = Object.keys(GROUP_TO_SLUGS);

// Reverse lookup for onBodyPartPress: slug -> our group name.
const SLUG_TO_GROUP = new Map<Slug, string>();
for (const [group, slugs] of Object.entries(GROUP_TO_SLUGS)) {
  for (const slug of slugs) SLUG_TO_GROUP.set(slug, group);
}
export function groupForSlug(slug: Slug | undefined): string | undefined {
  return slug ? SLUG_TO_GROUP.get(slug) : undefined;
}

// Cold -> hot, 5 steps, in the Phase-10 palette family: it opens on a cool
// slate/blue, passes through the theme's emerald "go" accent at the midpoint,
// and closes on a warm amber/orange — so a fully "lit up" group visually
// matches the emerald/amber language ProgressCard already uses.
export const COLORS: readonly string[] = [
  "#3E7CB8", // cold — barely-trained
  "#2FAF97", // cool-to-warm midpoint (blue -> emerald)
  colors.accent, // #34D399 — theme "go" emerald
  "#F2C84C", // warming
  "#F2954A", // hot — well-trained
];

// Untrained (level 0, or a group with no window activity). Distinct from
// both the COLORS ramp and the library's own default fill, and pulled
// straight from theme.ts's stronger hairline tone so it reads as "present
// but dormant" rather than an error state.
export const NEGLECTED = colors.line2;

// Fallback fill for slugs the library renders that aren't one of our tracked
// groups (hands, feet, head, neck, hair, etc.) — kept muted so they recede
// behind the trained/neglected groups we actually care about.
export const UNMAPPED_FILL = colors.raised;

type PerGroup = Record<string, { xp: number; level: number }>;

// Highest level among the groups actually present in perGroup (>=1 so a
// single trained group always buckets into the hottest color rather than
// dividing by itself and landing mid-ramp).
export function getMaxLevel(perGroup: PerGroup): number {
  let max = 1;
  for (const g of Object.values(perGroup)) {
    if (g.level > max) max = g.level;
  }
  return max;
}

function clip01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// Bucket a group's level onto the COLORS ramp, scaled relative to this
// trainee's own highest-level group (`maxLevel`, from getMaxLevel) so the
// ramp always spans the full range someone has actually reached — a lvl-3
// group reads "hot" for a beginner and "cold" for someone with a lvl-20 group.
export function colorForLevel(level: number, maxLevel: number): string {
  if (level <= 0) return NEGLECTED;
  const denom = Math.max(1, maxLevel);
  const ratio = clip01(level / denom);
  const idx = Math.max(0, Math.min(COLORS.length - 1, Math.ceil(ratio * COLORS.length) - 1));
  return COLORS[idx];
}

// perGroup -> the `data` array <Body> expects: one entry per distinct slug
// any of our groups maps to (so every rendered body part gets an explicit
// color, including neglected ones — no reliance on the library's own
// defaultFill for groups we track).
//
// Several groups can map to the same slug (Cardio deliberately collides
// with the leg-strength groups — see GROUP_TO_SLUGS), so this aggregates
// per slug by taking the MAX level among all contributing groups before
// coloring, rather than emitting one entry per group (which would silently
// let whichever group iterates last win). Slugs with a single contributing
// group behave exactly as before.
export function buildBodyData(perGroup: PerGroup): ExtendedBodyPart[] {
  const maxLevel = getMaxLevel(perGroup);
  const slugLevels = new Map<Slug, number>();
  for (const group of ALL_GROUPS) {
    const level = perGroup[group]?.level ?? 0;
    for (const slug of GROUP_TO_SLUGS[group]) {
      // Must record the slug even when level is 0 (all-zero contributors
      // still resolve to NEGLECTED below) — `cur === undefined` is the
      // "first time we've seen this slug" case, distinct from "we've seen
      // it and its running max is 0".
      const cur = slugLevels.get(slug);
      if (cur === undefined || level > cur) slugLevels.set(slug, level);
    }
  }
  const out: ExtendedBodyPart[] = [];
  for (const [slug, level] of slugLevels) {
    out.push({ slug, color: colorForLevel(level, maxLevel) });
  }
  return out;
}

// ─── Phase 13 — neglect nudge ──────────────────────────────────────────────
// "Trained" here means the same thing it means to the XP engine: a set on an
// exercise that carries a PRIMARY credit in the group (progress.ts's
// primaryGroupLookup uses the identical rule). Only the tracked groups
// (ALL_GROUPS) are considered, matching the body map.

export interface GroupRecency {
  group: string;
  lastTrained: string | null; // "YYYY-MM-DD", or null if never trained
  daysSince: number; // Infinity if never trained
}

// "YYYY-MM-DD" -> integer days since the Unix epoch (UTC, no TZ drift) —
// mirrors progress.ts's private epochDay(); duplicated rather than exported
// to keep that module's date helpers private to the engine.
function epochDay(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

// name (lowercased) -> primary group, for exercises carrying a primary credit.
function primaryGroupLookup(exercises: readonly RegistryExercise[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const ex of exercises) {
    const primary = (ex.muscles ?? []).find((m) => m.role === "primary");
    if (primary) lookup.set(String(ex.name).toLowerCase(), primary.group);
  }
  return lookup;
}

// Most-recent primary-credited session date for every one of the tracked
// groups, and days since (relative to `asOf`, "YYYY-MM-DD"). Never-trained
// groups get `daysSince: Infinity` so they always sort as most neglected.
export function groupRecency(
  workouts: readonly WorkoutSet[],
  exercises: readonly RegistryExercise[],
  asOf: string
): GroupRecency[] {
  const lookup = primaryGroupLookup(exercises);
  const lastByGroup = new Map<string, string>();
  for (const w of workouts) {
    const group = lookup.get(String(w.exercise).toLowerCase());
    if (!group) continue;
    const cur = lastByGroup.get(group);
    if (!cur || w.date > cur) lastByGroup.set(group, w.date);
  }

  const asOfDay = epochDay(asOf);
  return ALL_GROUPS.map((group) => {
    const lastTrained = lastByGroup.get(group) ?? null;
    const daysSince = lastTrained === null ? Infinity : asOfDay - epochDay(lastTrained);
    return { group, lastTrained, daysSince };
  });
}

// The single coldest of the tracked groups, or null if none exceed
// `thresholdDays` (default 14). Never-trained groups always count as
// neglected once any workout exists at all — an all-empty log (nothing
// logged yet) still returns null, since there's nothing to nudge toward yet.
export function mostNeglectedGroup(
  workouts: readonly WorkoutSet[],
  exercises: readonly RegistryExercise[],
  asOf: string,
  thresholdDays = 14
): GroupRecency | null {
  if (workouts.length === 0) return null;
  const recencies = groupRecency(workouts, exercises, asOf);
  let worst: GroupRecency | null = null;
  for (const r of recencies) {
    if (r.daysSince <= thresholdDays) continue;
    if (!worst || r.daysSince > worst.daysSince) worst = r;
  }
  return worst;
}

// "3 days" / "2 weeks" — natural wording for a days-since gap. Never-trained
// (Infinity) reads as "never".
export function describeGap(daysSince: number): string {
  if (!Number.isFinite(daysSince)) return "never trained";
  const days = Math.floor(daysSince);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}
