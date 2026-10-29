// Rank ladder config — pure data, no logic. See RANK_SYSTEM_SPEC.md §1/§8 and
// the approved implementation brief. 20 named divisioned tiers (III/II/I,
// low→high) + Kratos as a single un-divisioned apex tier. Consumed by
// `./rankEngine.ts`; do not hardcode tier names/thresholds anywhere else.

/** Flat XP cost of one division, uniform across the whole ladder. Tunable. */
export const XP_PER_DIVISION = 150;

/** Session XP gain, tunable. `sessionXp = SESSION_BASE + PER_SET *
 * min(workingSets, SETS_CAP)`; a cardio session earns SESSION_BASE only (no
 * working-set count applies to it). Sized for a roughly 2-year perfect-run
 * climb to Kratos. */
export const XP_GAIN = {
  SESSION_BASE: 6,
  PER_SET: 2,
  SETS_CAP: 8,
};

export interface Tier {
  name: string;
  copy: string;
  /** true only for the final, un-divisioned apex entry (Kratos). */
  apex?: boolean;
}

/** 21 entries: 20 divisioned tiers (indices 0..19) + Kratos apex (index 20).
 * Order is the climb order, low to high. Bellerophon sits at position 16
 * (between Perseus and Achilles) per the approved brief — the spec's §8
 * table predates that insertion. */
export const TIERS: Tier[] = [
  { name: "Initiate", copy: "You have picked up the spear." },
  { name: "Ephebe", copy: "Sworn in, not yet tested." },
  { name: "Peltast", copy: "Fast, light, expendable." },
  { name: "Hoplite", copy: "A soldier of the line." },
  { name: "Phalangite", copy: "You are not one man. You are the wall." },
  { name: "Lochagos", copy: "First command." },
  { name: "Myrmidon", copy: "Elite of the phalanx." },
  { name: "Aristos", copy: "The best of them." },
  { name: "Heros", copy: "A hero — still nameless." },
  { name: "Sisyphus", copy: "The set that never ends." },
  { name: "Prometheus", copy: "You pay for what you give." },
  { name: "Atlas", copy: "Elder, world-holding power." },
  { name: "Odysseus", copy: "Ten years. You got home." },
  { name: "Theseus", copy: "You went in and came out." },
  { name: "Perseus", copy: "You beat what could not be beaten." },
  { name: "Bellerophon", copy: "You bridled the sky." },
  { name: "Achilles", copy: "Glory over long life." },
  { name: "Heracles", copy: "The labors are finished." },
  { name: "Zeus", copy: "You dine on Olympus." },
  { name: "Nike", copy: "Victory itself." },
  { name: "Kratos", copy: "Strength itself.", apex: true },
];
