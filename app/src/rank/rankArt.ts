// Rank art config — pure data, no React/RN imports. Ported VERBATIM from the
// user-approved `rank-ladder.html` preview (METALS, BAND_OF, G glyph paths,
// TIERS glyph order). react-native-svg has no CSS custom-property support
// (the artifact colors every glyph stroke/fill via `var(--bz)`), so each
// glyph is restructured here from raw SVG markup into GLYPHS: an array of
// {d, fill?, w?, color?} parts that RankMedallion.tsx recolors per medallion
// pass (dark glyph pass, then a light highlight pass on non-matte metals).
//
// A few of the artifact's glyphs use non-`<path>` primitives (rect/circle/
// ellipse) that GlyphPart can't represent directly (it only carries `d`), so
// those were converted to an equivalent `d` path (rounded-rect -> two arcs
// forming a pill, circle -> two half-circle arcs, the rotated oar ellipse ->
// an elliptical arc with its rotation baked into the arc's x-axis-rotation
// parameter instead of a wrapping <g transform>). Every genuine `<path d=…>`
// string below is byte-identical to the artifact.

import { TIERS } from "./rankLadder";

// ─── metal palettes — verbatim from METALS in rank-ladder.html ────────────
export interface MetalPalette {
  light: string;
  base: string;
  dark: string;
  matte?: boolean;
}

export const METAL_PALETTES: Record<string, MetalPalette> = {
  bronze: { light: "#C88A47", base: "#9A6528", dark: "#4E3213" },
  iron: { light: "#AEB6BF", base: "#6E767F", dark: "#333A41" },
  silver: { light: "#EAF0F6", base: "#AEB8C2", dark: "#5C666F" },
  stone: { light: "#8E8C82", base: "#63655C", dark: "#393A34", matte: true },
  gold: { light: "#FBE79C", base: "#E3B44A", dark: "#8A5F14" },
  whitegold: { light: "#FFFFFF", base: "#DCEAF2", dark: "#8FB6C4" },
  radiance: { light: "#FFFFFF", base: "#BFE9DF", dark: "#12A37B" },
};

// ─── band mapping — verbatim from BAND_OF in rank-ladder.html ─────────────
// Metal bands (re-mapped for Bellerophon): bronze 1-4 · iron 5-7 · silver
// 8-9 · stone 10-12 · gold 13-18 · white-gold 19-20 · radiance 21.
export function bandOf(i: number): string {
  return i < 4
    ? "bronze"
    : i < 7
      ? "iron"
      : i < 9
        ? "silver"
        : i < 12
          ? "stone"
          : i < 18
            ? "gold"
            : i < 20
              ? "whitegold"
              : "radiance";
}

// ─── glyphs — structured port of G in rank-ladder.html ─────────────────────
// Rendering rule (applied identically for both the dark pass and the light
// highlight pass in RankMedallion): fill = part.fill ? (part.color ??
// passColor) : "none"; stroke = part.w !== undefined ? (part.color ??
// passColor) : "none", stroke-width = part.w. This single rule reproduces
// every case in the artifact, including the two glyphs (bolt, starburst's
// star) that are simultaneously filled AND stroked in the same `var(--bz)`
// color (fill:true plus w set), and the one glyph (spearheel's heel wound)
// that ignores `var(--bz)` entirely via a hardcoded `fill="#C0492E"` — kept
// as `color: "#C0492E"` so it renders that fixed color in both passes, exactly
// like the source (the highlight pass duplicate is a translated, 50%-opacity
// echo of it, same as every other glyph part).
export interface GlyphPart {
  d: string;
  /** True for a `${F}` (filled) shape in the artifact. */
  fill?: boolean;
  /** Stroke width, for a `${S}` (stroked) shape — or additional stroke on a
   * filled shape that the artifact also strokes in the same color. */
  w?: number;
  /** Fixed color override for the one glyph part that ignores `var(--bz)`
   * in the artifact (hardcoded `fill="#C0492E"`). */
  color?: string;
}

export const GLYPHS: Record<string, GlyphPart[]> = {
  spear: [
    { d: "M50 22 V80", w: 6 },
    { d: "M50 22 L43 36 M50 22 L57 36", w: 6 },
  ],
  // rect x=24 y=42 w=52 h=16 rx=8 (rx=h/2 => a pill) -> two 8r arcs.
  oathband: [
    { d: "M32 42 H68 A8 8 0 0 1 68 58 H32 A8 8 0 0 1 32 42 Z", w: 5 },
    // circle cx=50 cy=50 r=5
    { d: "M50 45 A5 5 0 1 1 50 55 A5 5 0 1 1 50 45 Z", fill: true },
  ],
  crescent: [
    { d: "M62 24 A30 30 0 1 0 62 76 A24 24 0 1 1 62 24 Z", fill: true },
  ],
  lambda: [{ d: "M32 78 L50 26 L68 78", w: 8 }],
  interlock: [
    { d: "M30 34 h20 v20 a20 20 0 0 1 -20 0 Z", w: 5 },
    { d: "M50 46 h20 v20 a20 20 0 0 1 -20 0 Z", w: 5 },
  ],
  rankbar: [
    { d: "M50 24 V78", w: 9 },
    { d: "M36 34 L50 24 L64 34", w: 6 },
  ],
  crossspear: [
    {
      d: "M28 74 L72 26 M72 26 l-11 2 M72 26 l-2 11 M72 74 L28 26 M28 26 l11 2 M28 26 l2 11",
      w: 5,
    },
  ],
  laurelring: [
    // circle cx=50 cy=50 r=26
    { d: "M50 24 A26 26 0 1 1 50 76 A26 26 0 1 1 50 24 Z", w: 3 },
    {
      d: "M50 40 C40 40 36 46 36 54 C46 54 50 48 50 42 M50 40 C60 40 64 46 64 54 C54 54 50 48 50 42",
      w: 3.4,
    },
  ],
  flame: [
    {
      d: "M50 24 C40 40 60 44 50 60 C44 52 44 50 46 44 C40 50 36 60 44 70 C52 78 66 72 62 56 C60 46 52 40 50 24 Z",
      fill: true,
    },
  ],
  boulder: [
    { d: "M26 80 L70 36", w: 5 },
    // circle cx=58 cy=34 r=14
    { d: "M58 20 A14 14 0 1 1 58 48 A14 14 0 1 1 58 20 Z", w: 5 },
  ],
  chainflame: [
    {
      d: "M50 26 C42 40 58 44 50 58 C45 51 45 49 47 44 C42 50 40 58 47 66 C54 72 64 66 60 54 C58 46 52 40 50 26 Z",
      fill: true,
    },
    // rect x=30 y=66 w=16 h=10 rx=5 (pill)
    { d: "M35 66 H41 A5 5 0 0 1 41 76 H35 A5 5 0 0 1 35 66 Z", w: 4 },
    // rect x=54 y=66 w=16 h=10 rx=5 (pill)
    { d: "M59 66 H65 A5 5 0 0 1 65 76 H59 A5 5 0 0 1 59 66 Z", w: 4 },
  ],
  skyarc: [
    { d: "M24 46 A30 22 0 0 1 76 46", w: 6 },
    { d: "M30 52 V74 M70 52 V74", w: 6 },
  ],
  oar: [
    { d: "M32 76 L64 34", w: 6 },
    // ellipse cx=68 cy=30 rx=9 ry=14 transform="rotate(38 68 30)" — rotation
    // baked into the arc's x-axis-rotation instead of a wrapping <g>.
    { d: "M60.9 24.5 A9 14 38 1 1 75.1 35.5 A9 14 38 1 1 60.9 24.5 Z", w: 4.5 },
  ],
  labyrinth: [{ d: "M50 50 h10 v-14 h-24 v28 h38 v-40 H32", w: 5 }],
  gorgon: [
    // circle cx=50 cy=52 r=18
    { d: "M50 34 A18 18 0 1 1 50 70 A18 18 0 1 1 50 34 Z", w: 4.5 },
    { d: "M40 48 h6 M54 48 h6", w: 4 },
    {
      d: "M32 36 C34 28 40 30 40 36 M50 34 V26 M68 36 C66 28 60 30 60 36 M34 62 C28 66 30 72 36 70 M66 62 C72 66 70 72 64 70",
      w: 3.5,
    },
  ],
  bridle: [
    // circle cx=50 cy=50 r=10
    { d: "M50 40 A10 10 0 1 1 50 60 A10 10 0 1 1 50 40 Z", w: 5 },
    { d: "M40 50 H24 M60 50 H76", w: 5 },
    // circle cx=22 cy=50 r=6
    { d: "M22 44 A6 6 0 1 1 22 56 A6 6 0 1 1 22 44 Z", w: 4 },
    // circle cx=78 cy=50 r=6
    { d: "M78 44 A6 6 0 1 1 78 56 A6 6 0 1 1 78 44 Z", w: 4 },
  ],
  spearheel: [
    { d: "M56 22 L34 74", w: 6 },
    { d: "M56 22 L49 32 M56 22 L60 33", w: 6 },
    // circle cx=34 cy=76 r=6 fill="#C0492E" — fixed color, not var(--bz).
    {
      d: "M34 70 A6 6 0 1 1 34 82 A6 6 0 1 1 34 70 Z",
      fill: true,
      color: "#C0492E",
    },
  ],
  clubpelt: [
    { d: "M34 74 L60 42", w: 9 },
    { d: "M60 42 a12 12 0 1 0 .1 0", w: 6 },
    { d: "M24 40 q10 -12 24 -6", w: 4 },
  ],
  // filled AND stroked in the same var(--bz) color in the artifact.
  bolt: [{ d: "M58 22 L36 54 L50 54 L42 82 L68 44 L53 44 Z", fill: true, w: 2 }],
  wing: [
    {
      d: "M28 64 C44 58 60 46 74 30 C70 46 70 54 74 58 C64 56 58 58 56 64 C58 56 56 52 52 52 C56 62 50 64 46 62 C50 56 46 54 42 56 C46 64 40 66 36 62 Z",
      fill: true,
    },
  ],
  // 12 spokes (Array.from({length:12}) loop, a = i*PI/6, computed the same
  // way the artifact does — inner r=15, outer r=31, toFixed(1)) + the
  // filled/stroked star, verbatim.
  starburst: [
    { d: "M65.0 50.0 L81.0 50.0", w: 3 },
    { d: "M63.0 57.5 L76.8 65.5", w: 3 },
    { d: "M57.5 63.0 L65.5 76.8", w: 3 },
    { d: "M50.0 65.0 L50.0 81.0", w: 3 },
    { d: "M42.5 63.0 L34.5 76.8", w: 3 },
    { d: "M37.0 57.5 L23.2 65.5", w: 3 },
    { d: "M35.0 50.0 L19.0 50.0", w: 3 },
    { d: "M37.0 42.5 L23.2 34.5", w: 3 },
    { d: "M42.5 37.0 L34.5 23.2", w: 3 },
    { d: "M50.0 35.0 L50.0 19.0", w: 3 },
    { d: "M57.5 37.0 L65.5 23.2", w: 3 },
    { d: "M63.0 42.5 L76.8 34.5", w: 3 },
    {
      d: "M50 33 L54 46 L67 46 L56 54 L60 67 L50 59 L40 67 L44 54 L33 46 L46 46 Z",
      fill: true,
      w: 1.5,
    },
  ],
};

// ─── tier art table — glyph key per TIERS index (rank-ladder.html TIERS) ──
const GLYPH_KEYS: readonly string[] = [
  "spear", // 0 Initiate
  "oathband", // 1 Ephebe
  "crescent", // 2 Peltast
  "lambda", // 3 Hoplite
  "interlock", // 4 Phalangite
  "rankbar", // 5 Lochagos
  "crossspear", // 6 Myrmidon
  "laurelring", // 7 Aristos
  "flame", // 8 Heros
  "boulder", // 9 Sisyphus
  "chainflame", // 10 Prometheus
  "skyarc", // 11 Atlas
  "oar", // 12 Odysseus
  "labyrinth", // 13 Theseus
  "gorgon", // 14 Perseus
  "bridle", // 15 Bellerophon
  "spearheel", // 16 Achilles
  "clubpelt", // 17 Heracles
  "bolt", // 18 Zeus
  "wing", // 19 Nike
  "starburst", // 20 Kratos
];

export interface TierArt {
  metal: string;
  glyph: string;
}

/** 21 entries, index-for-index with rankLadder's TIERS. */
export const TIER_ART: TierArt[] = GLYPH_KEYS.map((glyph, i) => ({
  metal: bandOf(i),
  glyph,
}));

// ─── rankId -> tier/label helpers ──────────────────────────────────────────
// Duplicated from rankEngine's private MAX_ABS_DIVISION/DIVISION_LABELS
// (same 60/["III","II","I"] derivation) rather than widening rankEngine's
// exports beyond the one epochDayOf helper the brief scopes it to — mirrors
// the same "keep a small duplicate copy" pattern rankEngine itself uses for
// progress.ts's epochDay/weekMonday.
const MAX_ABS_DIVISION = TIERS.length * 3 - 3;
const DIVISION_LABELS: readonly string[] = ["III", "II", "I"];

/** 0..20 tier index for a rankId (0..60, 60 = Kratos apex). */
export function tierIndexOf(rankId: number): number {
  return rankId >= MAX_ABS_DIVISION ? TIERS.length - 1 : Math.floor(rankId / 3);
}

/** "<Tier> <III|II|I>", or just "<Tier>" for the apex — for display
 * contexts (like a peak-rank readout) that only have a bare rankId, not a
 * full RankView. */
export function labelForRankId(rankId: number): string {
  const tierIndex = tierIndexOf(rankId);
  const name = TIERS[tierIndex].name;
  if (rankId >= MAX_ABS_DIVISION) return name;
  return `${name} ${DIVISION_LABELS[rankId % 3]}`;
}
