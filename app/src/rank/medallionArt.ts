// Medallion art config — pure data, no React/RN imports. STAGE A (static)
// port of `Medallions v2.dc.html` (the approved v2 artifact, 1096 lines,
// read in full): 21 entries, index-aligned with rankLadder's TIERS (0
// Initiate .. 20 Kratos). Every rim path, gradient stop, decoration
// coordinate and glyph path below is copied VERBATIM from that HTML. This
// supersedes the v1 art in `./rankArt.ts` (METAL_PALETTES/GLYPHS/TIER_ART) —
// those stay only for `tierIndexOf`/`labelForRankId`, which are generic rank
// helpers unrelated to the visual art.
//
// Structure per tier, in the artifact's own draw order:
//   rim        — the outer disc: an 18-point (12-point for Kratos) faceted
//                polygon for rock tiers (1-6) + the apex (21), or a plain
//                r=56 circle for metal/precious tiers (7-20). Filled with a
//                top-to-bottom linear gradient (`e0N` in the artifact).
//   decorations "rim" layer — rivet studs / dashed accent rings drawn right
//                after the rim, before the face fill (metal tiers only).
//   face       — the r=48 radial-gradient disc (`f0N`), 0-3 specular
//                overlays (`h0N`/`h0Nb`/`h0Nc`/`w11`/`z19`/`c21`, each its
//                own circle at its own gradient), then the vignette
//                (`v0N`) — always cx=.5 cy=.5 r=.5, darkening the rim.
//                Specular position is CONSTANT across every tier that has
//                one (h0N always cx=.34 cy=.26 r=.4; h0Nb always cx=.68
//                cy=.78 r=.3), so those two are built with SPEC1()/SPEC2().
//   decorations "preVignette" layer — only used by Kratos, whose blood
//                streak paints between its core-glow specular and vignette.
//   decorations "postVignette" layer — speckle/rivet-fleck circle groups,
//                the rough-stone edge chips, the brushed-metal/crescent rim
//                sheen, the white/black inner rings, and any static sparkle
//                marks — in the artifact's own DOM order.
//   glyph      — the two-layer glyph: `parts` is the shared geometry drawn
//                once in `highlightColor` (opacity `highlightOpacity`,
//                offset (0,1.6) — the artifact's highlight pass) and once
//                in `mainColor` (opacity 1, no offset — the main pass).
//                `extras` are shapes the artifact draws ONLY in the main
//                pass (fixed-color accents / extra stroked lines) — never
//                duplicated into the highlight pass.
//   aura       — the `<div>`/nested-`<svg>` atmosphere layers BEHIND the
//                medallion (ground shadow, breathing/drifting glows,
//                speckle fields, sweeps, orbit rings, small floating icons,
//                Achilles' prism blobs, Zeus's lightning, Heracles' debris,
//                Perseus' ray burst). STAGE A renders these as static
//                (visible, unanimated) layers; `anim`/`durationS`/`delayS`
//                record the artifact's intended CSS animation for Stage B.
//                This layer is deliberately less strictly typed than the
//                medallion itself (see the STAGE A note at the bottom of
//                this file) — the instructions call the medallion's own
//                paths/gradients the fidelity bar; aura is a faithful but
//                looser capture of the same visual intent.

// ─── shared primitives ─────────────────────────────────────────────────────

export interface Stop {
  offset: number; // 0..1
  color: string;
  opacity?: number; // defaults to 1
}

export interface LinearGradientSpec {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: Stop[];
}

export interface RadialGradientSpec {
  cx: number; // fractional (0..1), objectBoundingBox
  cy: number;
  r: number;
  stops: Stop[];
}

/** A specular/glow overlay circle painted on top of the face. Position
 * (cx/cy/r) usually constant per "slot" — see SPEC1/SPEC2 below. */
export interface Specular extends RadialGradientSpec {
  /** Disc radius this gradient paints onto; defaults to face.r (48).
   * Zeus's core glow (z19) paints onto r=32 instead. */
  paintR?: number;
  /** True for the one case (Prometheus' w11 heat-glow) that paints AFTER
   * the vignette instead of before it. */
  afterVignette?: boolean;
  /** Intended Stage-B animation on this overlay alone (Zeus's z19 "flick"). */
  anim?: string;
  animDurationS?: number;
}

export type Rim =
  | { kind: "polygon"; d: string; gradient: LinearGradientSpec; stroke: string; strokeOpacity: number; strokeWidth: number }
  | { kind: "circle"; r: number; gradient: LinearGradientSpec; stroke: string; strokeOpacity: number; strokeWidth: number };

export interface Face {
  r: number; // 48 in every tier
  gradient: RadialGradientSpec; // f0N
  speculars: Specular[]; // h0N / h0Nb / h0Nc / w11 / z19 / c21, in draw order
  vignette: RadialGradientSpec; // v0N
}

export type DecoLayer = "rim" | "preVignette" | "postVignette";

export interface DecoCircleGroup {
  kind: "circleGroup";
  layer: DecoLayer;
  circles: { cx: number; cy: number; r: number }[];
  fill: string;
  opacity?: number;
}

export interface DecoPath {
  kind: "path";
  layer: DecoLayer;
  d: string;
  fill?: string; // omit = unfilled
  stroke?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  strokeLinecap?: "round" | "butt";
  strokeLinejoin?: "round";
  strokeDasharray?: string;
  strokeDashoffset?: number;
  opacity?: number;
  /** Kratos's blood streak: clipped to the face circle (clip-path: circle
   * r=48 in the artifact). */
  clipToFace?: boolean;
  /** Intended Stage-B animation on this mark (e.g. Lochagos's "flick" heat
   * ripple, the silver/gold/platinum/rhodium/diamond "twinkle" crosses). */
  anim?: string;
  animDurationS?: number;
  animDelayS?: number;
}

export interface DecoRing {
  kind: "ring";
  layer: DecoLayer;
  r: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity?: number;
  strokeDasharray?: string;
  strokeDashoffset?: number;
}

export type Decoration = DecoCircleGroup | DecoPath | DecoRing;

// ─── glyph ──────────────────────────────────────────────────────────────

interface GlyphCommon {
  /** True = filled with the pass color; false/omitted = unfilled. */
  fill?: boolean;
  /** Present = stroked with the pass color at this width. */
  strokeWidth?: number;
  strokeLinecap?: "round" | "square";
  strokeLinejoin?: "round" | "miter";
  strokeDasharray?: string;
  /** Fixed color override for the rare shape that ignores the pass color
   * (e.g. Achilles'/Theseus' wound-red #C0492E). */
  color?: string;
  /** Local transform, e.g. "translate(69 31) rotate(39.5)". */
  transform?: string;
}

export type GlyphShape =
  | ({ kind: "path"; d: string } & GlyphCommon)
  | ({ kind: "circle"; cx: number; cy: number; r: number } & GlyphCommon)
  | ({ kind: "rect"; x: number; y: number; width: number; height: number; rx?: number } & GlyphCommon)
  | ({ kind: "ellipse"; cx: number; cy: number; rx: number; ry: number } & GlyphCommon)
  | { kind: "group"; transform: string; parts: GlyphShape[] };

export interface Glyph {
  /** Shared geometry, drawn twice: once in highlightColor (offset, dimmed —
   * the artifact's highlight pass), once in mainColor (full opacity). */
  parts: GlyphShape[];
  highlightColor: string;
  highlightOpacity: number;
  mainColor: string;
  /** Shapes drawn ONLY in the main pass — fixed-color accents or extra
   * stroked lines the artifact never duplicates into the highlight pass. */
  extras?: GlyphShape[];
}

// ─── aura (Stage A: static; Stage B animates) ──────────────────────────────

export type AuraLayer =
  | { kind: "groundShadow"; opacity?: number }
  | {
      kind: "glow";
      insetPct?: number;
      cxPct: number;
      cyPct: number;
      rxPct: number;
      ryPct: number;
      colorStart: string;
      colorEnd: string;
      midStop?: { pct: number; color: string };
      anim: string;
      durationS: number;
      delayS?: number;
      reverse?: boolean;
    }
  | { kind: "speckleField"; insetPct: number; dotColor: string; dotOpacity: number; sizePx: [number, number]; anim: string; durationS: number }
  | { kind: "sweep"; insetPct: number; color: string; anim: "sweep"; durationS: number }
  | {
      kind: "orbitRing";
      insetPct: number;
      r?: number;
      rx?: number;
      ry?: number;
      rotateDeg?: number;
      stroke: string;
      strokeOpacity: number;
      strokeWidth: number;
      dasharray?: string;
      moon?: { cx: number; cy: number; r: number; color: string };
      anim: "spinCW" | "spinCCW";
      durationS: number;
      groupOpacity?: number;
    }
  | {
      kind: "icon";
      d: string;
      viewBox: number;
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      leftPct: number;
      topPct: number;
      sizePx: number;
      anim: string;
      durationS: number;
      delayS?: number;
    }
  | { kind: "prismBlobs"; insetPct: number; colors: string[]; anim: "spinCW"; durationS: number }
  | {
      kind: "lightning";
      insetPct: number;
      bolts: { d: string; hasGlow: boolean; coreWidth: number; delayS: number; durationS: number }[];
      colorCore: string;
      colorGlow: string;
      glowWidth: number;
      glowOpacity: number;
    }
  | { kind: "debris"; insetPct: number; dots: { cx: number; cy: number; r: number }[]; color: string; opacity: number; anim: "spinCW" | "spinCCW"; durationS: number }
  | { kind: "rayBurst"; insetPct: number; rays: string[]; stroke: string; strokeOpacity: number; strokeWidth: number; anim: "spinCW"; durationS: number };

export interface MedallionArt {
  material: string;
  auraLabel: string;
  rim: Rim;
  face: Face;
  decorations: Decoration[];
  glyph: Glyph;
  aura: AuraLayer[];
}

// ─── builder helpers (cut repetition, not fidelity — every literal passed
// into these below is copied verbatim from the HTML) ───────────────────────

const S = (offset: number, color: string, opacity?: number): Stop => (opacity === undefined ? { offset, color } : { offset, color, opacity });
const linear = (stops: Stop[]): LinearGradientSpec => ({ x1: 0, y1: 0, x2: 0, y2: 1, stops });
const faceGrad = (stops: Stop[]): RadialGradientSpec => ({ cx: 0.38, cy: 0.3, r: 0.9, stops });
const spec1 = (stops: Stop[], extra: Partial<Specular> = {}): Specular => ({ cx: 0.34, cy: 0.26, r: 0.4, stops, ...extra });
const spec2 = (stops: Stop[], extra: Partial<Specular> = {}): Specular => ({ cx: 0.68, cy: 0.78, r: 0.3, stops, ...extra });
const vig = (op: number, firstStop = 0.7): RadialGradientSpec => ({ cx: 0.5, cy: 0.5, r: 0.5, stops: [S(firstStop, "#000000", 0), S(1, "#000000", op)] });

const rimPolygon = (d: string, stops: Stop[], stroke: string, strokeOpacity: number, strokeWidth = 2): Rim => ({
  kind: "polygon",
  d,
  gradient: linear(stops),
  stroke,
  strokeOpacity,
  strokeWidth,
});
const rimCircle = (stops: Stop[], strokeOpacity: number, strokeWidth = 1.6, stroke = "#000000"): Rim => ({
  kind: "circle",
  r: 56,
  gradient: linear(stops),
  stroke,
  strokeOpacity,
  strokeWidth,
});

const circleGroup = (circles: { cx: number; cy: number; r: number }[], fill: string, opacity: number, layer: DecoLayer = "postVignette"): DecoCircleGroup => ({
  kind: "circleGroup",
  layer,
  circles,
  fill,
  opacity,
});
const pth = (d: string, opts: Partial<Omit<DecoPath, "kind" | "d" | "layer">> = {}, layer: DecoLayer = "postVignette"): DecoPath => ({
  kind: "path",
  layer,
  d,
  ...opts,
});
const ring = (r: number, stroke: string, strokeWidth: number, opts: Partial<Omit<DecoRing, "kind" | "r" | "stroke" | "strokeWidth" | "layer">> = {}, layer: DecoLayer = "rim"): DecoRing => ({
  kind: "ring",
  layer,
  r,
  stroke,
  strokeWidth,
  ...opts,
});

// Rock tiers (1-6) share this exact 5-circle speckle layout for both the
// light and dark speckle passes, and the same two-chip edge crack.
const SPECK_LIGHT = [
  { cx: 42, cy: 34, r: 1.4 },
  { cx: 78, cy: 46, r: 1.1 },
  { cx: 34, cy: 66, r: 1.2 },
  { cx: 70, cy: 84, r: 1.4 },
  { cx: 56, cy: 24, r: 1 },
];
const SPECK_DARK = [
  { cx: 50, cy: 88, r: 1.5 },
  { cx: 82, cy: 66, r: 1.2 },
  { cx: 30, cy: 48, r: 1.4 },
  { cx: 64, cy: 30, r: 1.1 },
  { cx: 40, cy: 78, r: 1 },
];
const chip = (color: string) => pth("M26 32 a48 48 0 0 1 6 -7 M92 76 a48 48 0 0 1 -5 7", { stroke: color, strokeWidth: 3, strokeLinecap: "round" });

const brushArc = (op: number) =>
  pth("M28 44 a38 38 0 0 1 22 -20 M92 74 a38 38 0 0 1 -20 21", { stroke: "#ffffff", strokeOpacity: op, strokeWidth: 2.5, strokeLinecap: "round" });
const crescentArc = (color: string, op: number) =>
  pth("M27 40 A40 40 0 0 1 52 21", { stroke: color, strokeOpacity: op, strokeWidth: 2.6, strokeLinecap: "round" });
const innerRingWhite = (op: number) => ring(48, "#ffffff", 1, { strokeOpacity: op }, "postVignette");
const innerRingBlack = (op: number) => ring(41, "#000000", 1.4, { strokeOpacity: op }, "postVignette");
const twinkle = (d: string, color = "#ffffff", durationS = 3, delayS?: number) =>
  pth(d, { stroke: color, strokeWidth: 1.6, strokeLinecap: "round", anim: "twinkle", animDurationS: durationS, animDelayS: delayS });

const groundShadow = (opacity = 0.55): AuraLayer => ({ kind: "groundShadow", opacity });

// Rock tiers' outer facet-rim gradient always runs top(light)->bottom(dark),
// same 2 stops the face's own edge tones use.
function rockGlyph(parts: GlyphShape[], highlightColor: string, mainColor: string, highlightOpacity = 0.35): Glyph {
  return { parts, highlightColor, highlightOpacity, mainColor };
}

// P/C/R/E/GRP — terse glyph-part constructors.
const P = (d: string, opts: Partial<GlyphCommon> = {}): GlyphShape => ({ kind: "path", d, ...opts });
const C = (cx: number, cy: number, r: number, opts: Partial<GlyphCommon> = {}): GlyphShape => ({ kind: "circle", cx, cy, r, ...opts });
const R = (x: number, y: number, width: number, height: number, rx: number, opts: Partial<GlyphCommon> = {}): GlyphShape => ({
  kind: "rect",
  x,
  y,
  width,
  height,
  rx,
  ...opts,
});
const E = (cx: number, cy: number, rx: number, ry: number, opts: Partial<GlyphCommon> = {}): GlyphShape => ({ kind: "ellipse", cx, cy, rx, ry, ...opts });
const GRP = (transform: string, parts: GlyphShape[]): GlyphShape => ({ kind: "group", transform, parts });

// ─── the 21 tiers ───────────────────────────────────────────────────────────

export const MEDALLION_ART: MedallionArt[] = [
  // 00 — Initiate · Gravel
  {
    material: "Gravel",
    auraLabel: "Dusty gray particulate, sinks",
    rim: rimPolygon(
      "M115.6 60.0 L109.7 78.1 L102.1 95.4 L88.5 109.3 L69.4 113.1 L50.3 115.1 L32.1 108.3 L18.0 95.2 L6.0 79.7 L5.7 60.0 L10.5 42.0 L16.6 23.6 L32.8 12.9 L50.5 6.3 L69.6 5.4 L86.6 13.9 L100.2 26.2 L112.8 40.8 Z",
      [S(0, "#6f6a61"), S(1, "#3a352f")],
      "#000000",
      0.45
    ),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#9a958c"), S(0.55, "#6f6a61"), S(1, "#3a352f")]),
      speculars: [],
      vignette: vig(0.5),
    },
    decorations: [
      ring(48, "#ffffff", 1, { strokeOpacity: 0.07 }, "postVignette"),
      circleGroup(SPECK_LIGHT, "#9a958c", 0.22),
      circleGroup(SPECK_DARK, "#3a352f", 0.45),
      chip("#3a352f"),
    ],
    glyph: rockGlyph(
      [P("M50 12 C44 22 44 29 50 38 C56 29 56 22 50 12 Z", { fill: true }), P("M50 38 V82", { strokeWidth: 5 }), P("M43 82 H57", { strokeWidth: 5 })],
      "#9a958c",
      "#2e2a25"
    ),
    aura: [
      groundShadow(),
      { kind: "speckleField", insetPct: 8.4, dotColor: "rgba(138,133,120,0.5)", dotOpacity: 0.5, sizePx: [10, 12], anim: "sinkFall", durationS: 3.2 },
      { kind: "glow", insetPct: 2.1, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(138,133,120,0.18)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 6 },
    ],
  },

  // 01 — Ephebe · Sandstone
  {
    material: "Sandstone",
    auraLabel: "Faint tan haze",
    rim: rimPolygon(
      "M116.9 60.0 L113.7 79.5 L100.5 94.0 L87.2 107.2 L69.9 116.2 L50.8 112.4 L32.8 107.1 L17.9 95.4 L7.7 79.0 L6.3 60.0 L10.1 41.8 L16.2 23.2 L32.8 12.8 L50.7 7.4 L69.5 5.9 L87.0 13.3 L100.6 25.9 L112.7 40.8 Z",
      [S(0, "#b0956a"), S(1, "#655132")],
      "#000000",
      0.45
    ),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#d8c49a"), S(0.55, "#b0956a"), S(1, "#655132")]),
      speculars: [],
      vignette: vig(0.5),
    },
    decorations: [
      ring(48, "#ffffff", 1, { strokeOpacity: 0.07 }, "postVignette"),
      circleGroup(SPECK_LIGHT, "#d8c49a", 0.25),
      circleGroup(SPECK_DARK, "#655132", 0.45),
      chip("#655132"),
    ],
    glyph: rockGlyph(
      [P("M33 66 A23 23 0 1 1 67 66", { strokeWidth: 6.5 }), C(33, 66, 5.5, { fill: true }), C(67, 66, 5.5, { fill: true })],
      "#d8c49a",
      "#54401f"
    ),
    aura: [
      groundShadow(),
      { kind: "glow", cxPct: 42, cyPct: 46, rxPct: 55, ryPct: 45, colorStart: "rgba(201,168,120,0.3)", colorEnd: "rgba(0,0,0,0)", anim: "driftXY", durationS: 7 },
      { kind: "glow", cxPct: 60, cyPct: 55, rxPct: 55, ryPct: 45, colorStart: "rgba(201,168,120,0.22)", colorEnd: "rgba(0,0,0,0)", anim: "driftXY", durationS: 9, reverse: true },
    ],
  },

  // 02 — Peltast · Slate
  {
    material: "Slate",
    auraLabel: "Flat matte shimmer",
    rim: rimPolygon(
      "M113.3 60.0 L113.0 79.3 L102.7 95.8 L88.5 109.4 L69.6 114.3 L50.4 114.6 L33.6 105.8 L17.7 95.5 L9.5 78.4 L7.0 60.0 L9.7 41.7 L19.6 26.1 L32.7 12.7 L50.1 3.6 L69.5 6.3 L87.3 12.7 L101.0 25.6 L112.7 40.8 Z",
      [S(0, "#57687f"), S(1, "#28303f")],
      "#000000",
      0.45
    ),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#93a4c0"), S(0.55, "#57687f"), S(1, "#28303f")]),
      speculars: [],
      vignette: vig(0.5),
    },
    decorations: [
      ring(48, "#ffffff", 1, { strokeOpacity: 0.07 }, "postVignette"),
      circleGroup(SPECK_LIGHT, "#93a4c0", 0.22),
      circleGroup(SPECK_DARK, "#28303f", 0.45),
      chip("#28303f"),
    ],
    glyph: rockGlyph(
      [
        P("M33 25 L67 71 M67 25 L33 71", { strokeWidth: 3.5 }),
        P("M22 46 C24 66 40 78 50 78 C60 78 76 66 78 46 C70 56 30 56 22 46 Z", { fill: true }),
      ],
      "#93a4c0",
      "#1f2634"
    ),
    aura: [
      groundShadow(),
      { kind: "glow", insetPct: 2.1, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(147,164,192,0.16)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 6 },
      { kind: "sweep", insetPct: 8.4, color: "rgba(170,195,230,0.42)", anim: "sweep", durationS: 5.5 },
    ],
  },

  // 03 — Hoplite · Limestone
  {
    material: "Limestone",
    auraLabel: "Chalky white drift",
    rim: rimPolygon(
      "M114.7 60.0 L112.3 79.0 L101.0 94.4 L87.3 107.2 L69.2 112.5 L50.9 111.8 L31.8 108.8 L17.6 95.6 L6.6 79.4 L2.6 60.0 L9.3 41.5 L19.2 25.8 L32.7 12.7 L50.2 4.7 L69.4 6.8 L87.6 12.2 L101.4 25.3 L112.7 40.8 Z",
      [S(0, "#c2bcac"), S(1, "#7a7365")],
      "#000000",
      0.45
    ),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#e8e3d7"), S(0.55, "#c2bcac"), S(1, "#7a7365")]),
      speculars: [],
      vignette: vig(0.45),
    },
    decorations: [
      ring(48, "#ffffff", 1, { strokeOpacity: 0.1 }, "postVignette"),
      circleGroup(SPECK_LIGHT, "#ffffff", 0.3),
      circleGroup(SPECK_DARK, "#7a7365", 0.5),
      chip("#7a7365"),
    ],
    glyph: rockGlyph(
      [
        C(50, 50, 28, { strokeWidth: 5 }),
        // Main pass renders this ring at opacity .65; approximated the same
        // in both passes (see Stage-A note at the bottom of this file).
        C(50, 50, 20.5, { strokeWidth: 1.8 }),
        P("M40.5 61 L50 35 L59.5 61", { strokeWidth: 6 }),
      ],
      "#ffffff",
      "#6b6455",
      0.4
    ),
    aura: [
      groundShadow(),
      { kind: "glow", cxPct: 44, cyPct: 44, rxPct: 55, ryPct: 45, colorStart: "rgba(232,227,215,0.22)", colorEnd: "rgba(0,0,0,0)", anim: "driftXY", durationS: 8 },
      { kind: "glow", cxPct: 58, cyPct: 56, rxPct: 55, ryPct: 45, colorStart: "rgba(232,227,215,0.15)", colorEnd: "rgba(0,0,0,0)", anim: "driftXY", durationS: 10, reverse: true },
    ],
  },

  // 04 — Phalangite · Granite
  {
    material: "Granite",
    auraLabel: "Speckled gray pulse",
    rim: rimPolygon(
      "M116.1 60.0 L111.6 78.8 L103.2 96.2 L88.5 109.4 L69.8 115.5 L50.5 114.0 L32.6 107.5 L17.5 95.7 L8.4 78.8 L3.2 60.0 L8.9 41.4 L18.8 25.4 L32.6 12.6 L50.4 5.8 L69.3 7.3 L87.9 11.6 L101.8 24.9 L112.7 40.8 Z",
      [S(0, "#877068"), S(1, "#4a3c36")],
      "#000000",
      0.45
    ),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#bca8a0"), S(0.55, "#877068"), S(1, "#4a3c36")]),
      speculars: [],
      vignette: vig(0.5),
    },
    decorations: [
      ring(48, "#ffffff", 1, { strokeOpacity: 0.07 }, "postVignette"),
      circleGroup(
        [
          { cx: 42, cy: 34, r: 1.4 },
          { cx: 78, cy: 46, r: 1.1 },
          { cx: 34, cy: 66, r: 1.2 },
          { cx: 70, cy: 84, r: 1.4 },
          { cx: 56, cy: 24, r: 1 },
          { cx: 66, cy: 58, r: 1 },
          { cx: 46, cy: 72, r: 1.1 },
        ],
        "#bca8a0",
        0.3
      ),
      circleGroup(
        [
          { cx: 50, cy: 88, r: 1.5 },
          { cx: 82, cy: 66, r: 1.2 },
          { cx: 30, cy: 48, r: 1.4 },
          { cx: 64, cy: 30, r: 1.1 },
          { cx: 40, cy: 78, r: 1 },
          { cx: 74, cy: 72, r: 1.2 },
        ],
        "#2e2b27",
        0.55
      ),
      chip("#4a3c36"),
    ],
    glyph: rockGlyph(
      [
        R(24, 35, 15, 31, 7.5, { strokeWidth: 4 }),
        R(42.5, 33, 15, 35, 7.5, { strokeWidth: 4 }),
        R(61, 35, 15, 31, 7.5, { strokeWidth: 4 }),
        C(31.5, 50.5, 2, { fill: true }),
        C(50, 50.5, 2, { fill: true }),
        C(68.5, 50.5, 2, { fill: true }),
      ],
      "#bca8a0",
      "#3a2f2a"
    ),
    aura: [
      groundShadow(),
      { kind: "speckleField", insetPct: 5.26, dotColor: "rgba(188,160,150,0.55)", dotOpacity: 0.55, sizePx: [9, 9], anim: "flick", durationS: 3 },
      { kind: "glow", insetPct: 2.1, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(188,160,150,0.15)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 6 },
    ],
  },

  // 05 — Lochagos · Basalt
  {
    material: "Basalt",
    auraLabel: "Dark heat ripple",
    rim: rimPolygon(
      "M112.5 60.0 L110.9 78.5 L101.5 94.9 L87.3 107.3 L69.5 113.7 L50.1 116.2 L33.3 106.3 L17.3 95.8 L10.1 78.1 L3.9 60.0 L8.5 41.3 L18.4 25.1 L32.6 12.5 L50.6 6.9 L69.2 7.8 L88.3 11.0 L102.2 24.6 L112.6 40.8 Z",
      [S(0, "#62666a"), S(1, "#1b1d1f")],
      "#000000",
      0.45
    ),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#62666a"), S(0.55, "#393c40"), S(1, "#1b1d1f")]),
      speculars: [],
      vignette: vig(0.55),
    },
    decorations: [
      ring(48, "#ffffff", 1, { strokeOpacity: 0.06 }, "postVignette"),
      pth("M38 78 l8 -9 -5 -6 9 -10 M70 82 l-6 -10 M84 50 l-10 5", {
        stroke: "#e06a2e",
        strokeOpacity: 0.55,
        strokeWidth: 1.6,
        strokeLinecap: "round",
        anim: "flick",
        animDurationS: 3.4,
      }),
      circleGroup(SPECK_LIGHT, "#8a8e93", 0.25),
      circleGroup(SPECK_DARK, "#101214", 0.6),
      chip("#101214"),
    ],
    glyph: rockGlyph(
      [
        P("M50 20 V82", { strokeWidth: 5 }),
        C(50, 29, 7, { strokeWidth: 4.5 }),
        P("M35 46 H65", { strokeWidth: 5 }),
        P("M38 59 H62", { strokeWidth: 5 }),
      ],
      "#8a8e93",
      "#121416",
      0.4
    ),
    aura: [
      groundShadow(),
      { kind: "glow", insetPct: 3.16, cxPct: 50, cyPct: 50, rxPct: 55, ryPct: 55, colorStart: "rgba(0,0,0,0)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 48, color: "rgba(192,73,46,0.4)" }, anim: "ringOut", durationS: 3.4 },
      { kind: "glow", insetPct: 3.16, cxPct: 50, cyPct: 50, rxPct: 55, ryPct: 55, colorStart: "rgba(0,0,0,0)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 48, color: "rgba(192,73,46,0.32)" }, anim: "ringOut", durationS: 3.4, delayS: 1.7 },
      { kind: "glow", cxPct: 50, cyPct: 72, rxPct: 50, ryPct: 40, colorStart: "rgba(192,73,46,0.2)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 4 },
    ],
  },

  // 06 — Myrmidon · Iron
  {
    material: "Iron",
    auraLabel: "Rust flecks, a marching column",
    rim: rimCircle([S(0, "#aeb6bf"), S(1, "#333a41")], 0.45),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#aeb6bf"), S(0.5, "#6e767f"), S(1, "#333a41")]),
      speculars: [spec1([S(0, "#ffffff", 0.5), S(1, "#ffffff", 0)])],
      vignette: vig(0.45),
    },
    decorations: [
      circleGroup(
        [
          { cx: 112.0, cy: 60.0, r: 2.2 },
          { cx: 96.8, cy: 96.8, r: 2.2 },
          { cx: 60.0, cy: 112.0, r: 2.2 },
          { cx: 23.2, cy: 96.8, r: 2.2 },
          { cx: 8.0, cy: 60.0, r: 2.2 },
          { cx: 23.2, cy: 23.2, r: 2.2 },
          { cx: 60.0, cy: 8.0, r: 2.2 },
          { cx: 96.8, cy: 23.2, r: 2.2 },
        ],
        "#272d34",
        1,
        "rim"
      ),
      circleGroup([{ cx: 34, cy: 42, r: 4 }, { cx: 80, cy: 72, r: 5 }, { cx: 72, cy: 34, r: 2.6 }], "#c86a2e", 0.3),
      brushArc(0.12),
      innerRingWhite(0.2),
      innerRingBlack(0.22),
    ],
    glyph: {
      parts: [
        P("M31 77 L69 31", { strokeWidth: 4.5 }),
        P("M69 77 L31 31", { strokeWidth: 4.5 }),
        GRP("translate(69 31) rotate(39.5)", [P("M0 8 C-5 0 -5 -8 0 -16 C5 -8 5 0 0 8 Z", { fill: true })]),
        GRP("translate(31 31) rotate(-39.5)", [P("M0 8 C-5 0 -5 -8 0 -16 C5 -8 5 0 0 8 Z", { fill: true })]),
      ],
      highlightColor: "#dbe2e9",
      highlightOpacity: 0.4,
      mainColor: "#272d34",
    },
    aura: [
      groundShadow(),
      { kind: "orbitRing", insetPct: 5.26, r: 88, stroke: "#c86a2e", strokeOpacity: 0.5, strokeWidth: 2.4, dasharray: "2.4 7", anim: "spinCW", durationS: 26 },
      { kind: "speckleField", insetPct: 6.32, dotColor: "rgba(200,106,46,0.55)", dotOpacity: 0.55, sizePx: [9, 10], anim: "flick", durationS: 2.8 },
      { kind: "glow", insetPct: 1.05, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(200,106,46,0.16)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 5 },
    ],
  },

  // 07 — Aristos · Copper
  {
    material: "Copper",
    auraLabel: "Verdigris smoke",
    rim: rimCircle([S(0, "#e89a54"), S(1, "#54301a")], 0.45),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#e89a54"), S(0.5, "#b56430"), S(1, "#54301a")]),
      speculars: [spec1([S(0, "#ffe9d2", 0.55), S(1, "#ffe9d2", 0)])],
      vignette: vig(0.45),
    },
    decorations: [
      ring(52.5, "#2f8a68", 4.5, { strokeDasharray: "7 4" }, "rim"),
      circleGroup([{ cx: 30, cy: 70, r: 6 }, { cx: 82, cy: 46, r: 4.5 }, { cx: 66, cy: 88, r: 3.5 }], "#3fae86", 0.35),
      brushArc(0.14),
      innerRingWhite(0.22),
      innerRingBlack(0.22),
    ],
    glyph: {
      parts: [
        P("M50 80 C37 75 29 62 30 45", { strokeWidth: 3.6 }),
        P("M0 0 C-5 -5 -6 -12 -2 -18 C4 -13 5 -5 0 0 Z", { fill: true, transform: "translate(33 66) rotate(-38)" }),
        P("M0 0 C-5 -5 -6 -12 -2 -18 C4 -13 5 -5 0 0 Z", { fill: true, transform: "translate(30 55) rotate(-18)" }),
        P("M0 0 C-5 -5 -6 -12 -2 -18 C4 -13 5 -5 0 0 Z", { fill: true, transform: "translate(30 45)" }),
        P("M0 0 C-5 -5 -6 -12 -2 -18 C4 -13 5 -5 0 0 Z", { fill: true, transform: "translate(34 35) rotate(20)" }),
        P("M0 0 C-5 -5 -6 -12 -2 -18 C4 -13 5 -5 0 0 Z", { fill: true, transform: "translate(41 28) rotate(42)" }),
        GRP("translate(100 0) scale(-1 1)", [
          P("M50 80 C37 75 29 62 30 45", { strokeWidth: 3.6 }),
          P("M0 0 C-5 -5 -6 -12 -2 -18 C4 -13 5 -5 0 0 Z", { fill: true, transform: "translate(33 66) rotate(-38)" }),
          P("M0 0 C-5 -5 -6 -12 -2 -18 C4 -13 5 -5 0 0 Z", { fill: true, transform: "translate(30 55) rotate(-18)" }),
          P("M0 0 C-5 -5 -6 -12 -2 -18 C4 -13 5 -5 0 0 Z", { fill: true, transform: "translate(30 45)" }),
          P("M0 0 C-5 -5 -6 -12 -2 -18 C4 -13 5 -5 0 0 Z", { fill: true, transform: "translate(34 35) rotate(20)" }),
          P("M0 0 C-5 -5 -6 -12 -2 -18 C4 -13 5 -5 0 0 Z", { fill: true, transform: "translate(41 28) rotate(42)" }),
        ]),
      ],
      highlightColor: "#ffd9ae",
      highlightOpacity: 0.4,
      mainColor: "#4a2d16",
    },
    aura: [
      groundShadow(),
      { kind: "glow", cxPct: 50, cyPct: 44, rxPct: 28, ryPct: 28, colorStart: "rgba(63,174,134,0.32)", colorEnd: "rgba(0,0,0,0)", anim: "riseSmoke", durationS: 4.5 },
      { kind: "glow", cxPct: 54, cyPct: 50, rxPct: 24, ryPct: 24, colorStart: "rgba(63,174,134,0.26)", colorEnd: "rgba(0,0,0,0)", anim: "riseSmoke", durationS: 4.5, delayS: 2.2 },
      { kind: "glow", insetPct: 2.1, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(63,174,134,0.12)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 6 },
    ],
  },

  // 08 — Heros · Bronze
  {
    material: "Bronze",
    auraLabel: "Warm amber glow",
    rim: rimCircle([S(0, "#c88a47"), S(1, "#4e3213")], 0.45),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#c88a47"), S(0.5, "#9a6528"), S(1, "#4e3213")]),
      speculars: [spec1([S(0, "#ffe4b8", 0.55), S(1, "#ffe4b8", 0)])],
      vignette: vig(0.45),
    },
    decorations: [
      ring(52, "#4e3213", 3, { strokeDasharray: "1.8 2.4" }, "rim"),
      brushArc(0.14),
      innerRingWhite(0.22),
      innerRingBlack(0.22),
    ],
    glyph: {
      parts: [
        P(
          "M50 15 C45 27 59 33 53 45 C51 39 47 38 47.5 33 C39 41 35 52 42 62 C34 57 30 47 33.5 37 C27 49 30.5 64 42.5 71.5 C55 79 69 71 68.5 57.5 C68 45 56.5 41 59 29 C54 34 52 25 50 15 Z",
          { fill: true }
        ),
      ],
      highlightColor: "#ffd9a0",
      highlightOpacity: 0.4,
      mainColor: "#3f2810",
    },
    aura: [
      groundShadow(),
      { kind: "glow", cxPct: 50, cyPct: 50, rxPct: 60, ryPct: 60, colorStart: "rgba(227,164,74,0.4)", colorEnd: "rgba(0,0,0,0)", anim: "breathe", durationS: 4.5, insetPct: -4.2 },
      { kind: "glow", insetPct: 1.05, cxPct: 50, cyPct: 50, rxPct: 64, ryPct: 64, colorStart: "rgba(0,0,0,0)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 58, color: "rgba(227,164,74,0.35)" }, anim: "breatheSoft", durationS: 4.5 },
      { kind: "glow", cxPct: 32.4, cyPct: 32.4, rxPct: 2.4, ryPct: 2.4, colorStart: "rgba(255,170,80,0.9)", colorEnd: "rgba(0,0,0,0)", anim: "riseSmoke", durationS: 3.2 },
      { kind: "glow", cxPct: 64.4, cyPct: 27.8, rxPct: 1.8, ryPct: 1.8, colorStart: "rgba(255,170,80,0.9)", colorEnd: "rgba(0,0,0,0)", anim: "riseSmoke", durationS: 4.1, delayS: 1.3 },
      { kind: "glow", cxPct: 49.6, cyPct: 21.6, rxPct: 1.6, ryPct: 1.6, colorStart: "rgba(255,200,120,0.9)", colorEnd: "rgba(0,0,0,0)", anim: "riseSmoke", durationS: 3.7, delayS: 2.2 },
    ],
  },

  // 09 — Sisyphus · Nickel
  {
    material: "Nickel",
    auraLabel: "The boulder, orbiting forever",
    rim: rimCircle([S(0, "#d8e8dc"), S(1, "#42584a")], 0.45),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#d8e8dc"), S(0.5, "#8fac9c"), S(1, "#42584a")]),
      speculars: [spec1([S(0, "#ffffff", 0.55), S(1, "#ffffff", 0)])],
      vignette: vig(0.45),
    },
    decorations: [
      ring(52, "#42584a", 3, { strokeDasharray: "1.8 2.4" }, "rim"),
      brushArc(0.14),
      innerRingWhite(0.22),
      innerRingBlack(0.22),
    ],
    glyph: {
      parts: [
        P("M18 82 L82 34 L82 82 Z", { fill: true }),
        C(56, 38, 12, { fill: true }),
        C(37, 51, 4, { fill: true }),
        P("M39 55 L33 64 M33 64 L27 70 M33 64 L37 72 M40 56 L46 49 M42 59 L48 53", { strokeWidth: 3 }),
      ],
      highlightColor: "#eef3f6",
      highlightOpacity: 0.4,
      mainColor: "#324a3c",
    },
    aura: [
      groundShadow(),
      { kind: "speckleField", insetPct: 6.32, dotColor: "rgba(150,220,190,0.5)", dotOpacity: 0.5, sizePx: [9, 9], anim: "flick", durationS: 2.2 },
      {
        kind: "orbitRing",
        insetPct: -2.1,
        r: 88,
        stroke: "#a8c4ae",
        strokeOpacity: 0.25,
        strokeWidth: 1.6,
        dasharray: "3 10",
        moon: { cx: 100, cy: 12, r: 6, color: "#a8c4ae" },
        anim: "spinCW",
        durationS: 6,
      },
      { kind: "glow", insetPct: 1.05, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(150,220,190,0.16)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 5.5 },
    ],
  },

  // 10 — Prometheus · Steel
  {
    material: "Steel",
    auraLabel: "Blue-white edge flare",
    rim: rimCircle([S(0, "#c2cad2"), S(1, "#3f474d")], 0.45),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#c2cad2"), S(0.5, "#828b93"), S(1, "#3f474d")]),
      speculars: [
        spec1([S(0, "#ffffff", 0.5), S(1, "#ffffff", 0)]),
        { cx: 0.5, cy: 0.92, r: 0.55, stops: [S(0, "#ff9a4a", 0.4), S(1, "#ff9a4a", 0)], afterVignette: true },
      ],
      vignette: vig(0.45),
    },
    decorations: [
      ring(52.5, "#3f474d", 3.4, { strokeDasharray: "9 5.4" }, "rim"),
      ring(52.5, "#828b93", 3.4, { strokeDasharray: "9 5.4", strokeDashoffset: 7.2, strokeOpacity: 0.5 }, "rim"),
      brushArc(0.14),
      innerRingWhite(0.22),
      innerRingBlack(0.22),
    ],
    glyph: {
      parts: [
        GRP("translate(50 36) scale(0.78) translate(-50 -44)", [
          P(
            "M50 15 C45 27 59 33 53 45 C51 39 47 38 47.5 33 C39 41 35 52 42 62 C34 57 30 47 33.5 37 C27 49 30.5 64 42.5 71.5 C55 79 69 71 68.5 57.5 C68 45 56.5 41 59 29 C54 34 52 25 50 15 Z",
            { fill: true }
          ),
        ]),
        R(25, 63, 19, 13, 6.5, { strokeWidth: 4.2 }),
        R(56, 63, 19, 13, 6.5, { strokeWidth: 4.2 }),
        P("M50 64 l4 5.5 -4 5.5 -4 -5.5 Z", { fill: true }),
      ],
      highlightColor: "#e9f2fa",
      highlightOpacity: 0.4,
      mainColor: "#2c3339",
    },
    aura: [
      groundShadow(),
      { kind: "glow", insetPct: 1.05, cxPct: 50, cyPct: 50, rxPct: 64, ryPct: 64, colorStart: "rgba(0,0,0,0)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 57, color: "rgba(255,150,70,0.55)" }, anim: "breathe", durationS: 5 },
      { kind: "glow", insetPct: -3.16, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(188,216,242,0.18)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 5 },
      { kind: "glow", cxPct: 40.2, cyPct: 28.2, rxPct: 2.1, ryPct: 2.1, colorStart: "rgba(255,154,74,0.9)", colorEnd: "rgba(0,0,0,0)", anim: "riseSmoke", durationS: 3.4 },
      { kind: "glow", cxPct: 59.6, cyPct: 21.6, rxPct: 1.6, ryPct: 1.6, colorStart: "rgba(255,154,74,0.9)", colorEnd: "rgba(0,0,0,0)", anim: "riseSmoke", durationS: 4.4, delayS: 1.8 },
    ],
  },

  // 11 — Atlas · Tungsten
  {
    material: "Tungsten",
    auraLabel: "The heavens wheel overhead",
    rim: rimCircle([S(0, "#a89468"), S(1, "#2a2418")], 0.5),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#a89468"), S(0.5, "#665838"), S(1, "#2a2418")]),
      speculars: [spec1([S(0, "#f2e2b8", 0.4), S(1, "#f2e2b8", 0)])],
      vignette: vig(0.5),
    },
    decorations: [
      ring(57.5, "#1c1912", 3, {}, "rim"),
      ring(52, "#2a2418", 3, { strokeDasharray: "1.8 2.4" }, "rim"),
      brushArc(0.1),
      innerRingWhite(0.16),
      innerRingBlack(0.25),
    ],
    glyph: {
      parts: [
        C(50, 34, 15, { strokeWidth: 4.5 }),
        P("M35.5 34 H64.5", { strokeWidth: 2 }),
        E(50, 34, 6, 15, { strokeWidth: 2 }),
        P("M38 62 C38 54 40 50 44 47 M62 62 C62 54 60 50 56 47", { strokeWidth: 4.5 }),
        C(50, 60, 5, { strokeWidth: 3.6 }),
        P("M45 68 L40 82 M55 68 L60 82 M36 86 H64", { strokeWidth: 4 }),
      ],
      highlightColor: "#e8d9ae",
      highlightOpacity: 0.35,
      mainColor: "#1f1c15",
    },
    aura: [
      groundShadow(),
      { kind: "glow", insetPct: 1.05, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(184,154,90,0.16)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 6 },
      { kind: "sweep", insetPct: 7.37, color: "rgba(184,154,90,0.42)", anim: "sweep", durationS: 6 },
      {
        kind: "orbitRing",
        insetPct: -4.2,
        rx: 88,
        ry: 26,
        rotateDeg: -18,
        stroke: "#c9ae6a",
        strokeOpacity: 1,
        strokeWidth: 1.6,
        moon: { cx: 18, cy: 76, r: 2.6, color: "#e8d9ae" },
        anim: "spinCCW",
        durationS: 20,
        groupOpacity: 0.35,
      },
    ],
  },

  // 12 — Odysseus · Silver
  {
    material: "Silver",
    auraLabel: "Moonlit homeward sheen",
    rim: rimCircle([S(0, "#e6f0fc"), S(1, "#41556e")], 0.4),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#e6f0fc"), S(0.5, "#a4bad6"), S(1, "#41556e")]),
      speculars: [spec1([S(0, "#ffffff", 0.68), S(1, "#ffffff", 0)]), spec2([S(0, "#ffffff", 0.18), S(1, "#ffffff", 0)])],
      vignette: vig(0.4),
    },
    decorations: [
      ring(52.5, "#41556e", 5, { strokeDasharray: "1 7.4" }, "rim"),
      crescentArc("#ffffff", 0.55),
      innerRingWhite(0.3),
      innerRingBlack(0.18),
      twinkle("M40 30 v8 M36 34 h8", "#ffffff", 2.8),
    ],
    glyph: {
      parts: [
        P("M30 78 L62 37", { strokeWidth: 5 }),
        GRP("translate(68 29) rotate(38)", [P("M0 16 C-8 7 -8 -7 0 -18 C8 -7 8 7 0 16 Z", { fill: true })]),
        P("M20 72 q6 -5.5 12 0 t12 0 t12 0 M26 80 q6 -5.5 12 0 t12 0 M34 87 q6 -5.5 12 0", { strokeWidth: 3 }),
      ],
      highlightColor: "#ffffff",
      highlightOpacity: 0.5,
      mainColor: "#39485c",
    },
    aura: [
      groundShadow(),
      { kind: "glow", insetPct: -2.1, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(207,224,240,0.22)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 5 },
      { kind: "sweep", insetPct: 7.37, color: "rgba(207,224,240,0.55)", anim: "sweep", durationS: 5 },
      { kind: "icon", d: "M28 6 A14 14 0 1 0 28 34 A11 11 0 1 1 28 6 Z", viewBox: 40, fill: "#dce9f5", leftPct: 10, topPct: 6, sizePx: 22, anim: "driftXY", durationS: 9 },
      { kind: "glow", insetPct: 4.2, cxPct: 50, cyPct: 50, rxPct: 57, ryPct: 57, colorStart: "rgba(0,0,0,0)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 50, color: "rgba(90,170,190,0.45)" }, anim: "ringOut", durationS: 4.2 },
      { kind: "icon", d: "M10 2 V18 M2 10 H18", viewBox: 20, stroke: "#ffffff", strokeWidth: 2, leftPct: 66, topPct: 14, sizePx: 15, anim: "twinkle", durationS: 3 },
      { kind: "icon", d: "M10 2 V18 M2 10 H18", viewBox: 20, stroke: "#ffffff", strokeWidth: 2, leftPct: 16, topPct: 66, sizePx: 11, anim: "twinkle", durationS: 3.8, delayS: 1.2 },
    ],
  },

  // 13 — Theseus · Titanium
  {
    material: "Titanium",
    auraLabel: "Iridescent violet-blue arc",
    rim: rimCircle([S(0, "#c2bede"), S(1, "#38345c")], 0.45),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#c2bede"), S(0.5, "#7d78a8"), S(1, "#38345c")]),
      speculars: [spec1([S(0, "#cdd6ff", 0.6), S(1, "#cdd6ff", 0)]), spec2([S(0, "#8fd0e0", 0.22), S(1, "#8fd0e0", 0)])],
      vignette: vig(0.45),
    },
    decorations: [
      ring(52.5, "#38345c", 3.6, { strokeDasharray: "8 3 3 3" }, "rim"),
      crescentArc("#ffffff", 0.5),
      innerRingWhite(0.26),
      innerRingBlack(0.2),
    ],
    glyph: {
      parts: [P("M50 50 h12 v-12 h-24 v24 h36 v-36 h-48 v48 h48", { strokeWidth: 4.6, strokeLinecap: "square", strokeLinejoin: "miter" })],
      highlightColor: "#e6e9f2",
      highlightOpacity: 0.45,
      mainColor: "#2a2646",
      extras: [C(50, 47, 3, { fill: true, color: "#C0492E" })],
    },
    aura: [
      groundShadow(),
      { kind: "glow", insetPct: -1.05, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(124,140,240,0.16)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 5 },
      { kind: "orbitRing", insetPct: -2.1, r: 86, stroke: "#7c8cf0", strokeOpacity: 0.5, strokeWidth: 2.5, dasharray: "10 14", anim: "spinCW", durationS: 16 },
      { kind: "orbitRing", insetPct: 3.16, r: 82, stroke: "#8fd0e0", strokeOpacity: 0.45, strokeWidth: 2, dasharray: "6 18", anim: "spinCCW", durationS: 22 },
    ],
  },

  // 14 — Perseus · Gold
  {
    material: "Gold",
    auraLabel: "Radiant yellow corona",
    rim: rimCircle([S(0, "#fbe79c"), S(1, "#8a5f14")], 0.4),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#fbe79c"), S(0.5, "#e3b44a"), S(1, "#8a5f14")]),
      speculars: [spec1([S(0, "#fff6d8", 0.75), S(1, "#fff6d8", 0)]), spec2([S(0, "#fff6d8", 0.22), S(1, "#fff6d8", 0)])],
      vignette: vig(0.4),
    },
    decorations: [
      ring(53, "#8a5f14", 7, { strokeDasharray: "4 8.4" }, "rim"),
      crescentArc("#fff6d8", 0.65),
      innerRingWhite(0.3),
      innerRingBlack(0.2),
      twinkle("M80 36 v7 M76.5 39.5 h7", "#fff6d8", 3.2),
    ],
    glyph: {
      parts: [
        C(50, 54, 16, { strokeWidth: 4 }),
        P("M42 48 l7 2.5 M58 48 l-7 2.5", { strokeWidth: 3 }),
        C(45.5, 53.5, 1.8, { fill: true }),
        C(54.5, 53.5, 1.8, { fill: true }),
        P("M44 60.5 Q50 65 56 60.5", { strokeWidth: 3 }),
        P("M46.5 62.5 l1.2 4 M53.5 62.5 l-1.2 4", { strokeWidth: 2.2 }),
        P(
          "M50 38 C47 31 53 26 50 17 M41 40 C35 33 39 26 33 20 M59 40 C65 33 61 26 67 20 M35 47 C27 43 25 34 18 33 M65 47 C73 43 75 34 82 33 M37 64 C29 68 29 75 21 74 M63 64 C71 68 71 75 79 74",
          { strokeWidth: 3 }
        ),
        C(50, 17, 2, { fill: true }),
        C(33, 20, 2, { fill: true }),
        C(67, 20, 2, { fill: true }),
        C(18, 33, 2, { fill: true }),
        C(82, 33, 2, { fill: true }),
        C(21, 74, 2, { fill: true }),
        C(79, 74, 2, { fill: true }),
      ],
      highlightColor: "#fff1c4",
      highlightOpacity: 0.45,
      mainColor: "#6b4a0e",
    },
    aura: [
      groundShadow(),
      { kind: "glow", insetPct: -5.26, cxPct: 50, cyPct: 50, rxPct: 60, ryPct: 60, colorStart: "rgba(255,200,60,0.55)", colorEnd: "rgba(0,0,0,0)", anim: "breathe", durationS: 4 },
      { kind: "glow", insetPct: 1.05, cxPct: 50, cyPct: 50, rxPct: 64, ryPct: 64, colorStart: "rgba(0,0,0,0)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 57, color: "rgba(255,210,74,0.4)" }, anim: "breatheSoft", durationS: 4 },
      {
        kind: "rayBurst",
        insetPct: -7.37,
        rays: [
          "M172 100 L196 100",
          "M162.4 136 L174.5 143",
          "M136 162.4 L148 183.1",
          "M100 172 L100 186",
          "M64 162.4 L52 183.1",
          "M37.6 136 L25.5 143",
          "M28 100 L4 100",
          "M37.6 64 L25.5 57",
          "M64 37.6 L52 16.9",
          "M100 28 L100 14",
          "M136 37.6 L148 16.9",
          "M162.4 64 L174.5 57",
        ],
        stroke: "#ffd24a",
        strokeOpacity: 0.85,
        strokeWidth: 3,
        anim: "spinCW",
        durationS: 30,
      },
    ],
  },

  // 15 — Bellerophon · Platinum
  {
    material: "Platinum",
    auraLabel: "Falling pegasus feathers",
    rim: rimCircle([S(0, "#f0fafc"), S(1, "#7fa2b0")], 0.35),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#f0fafc"), S(0.5, "#c8e2ea"), S(1, "#7fa2b0")]),
      speculars: [spec1([S(0, "#ffffff", 0.7), S(1, "#ffffff", 0)]), spec2([S(0, "#ffffff", 0.2), S(1, "#ffffff", 0)])],
      vignette: vig(0.35),
    },
    decorations: [
      ring(52, "#7fa2b0", 3, { strokeDasharray: "1.8 2.4" }, "rim"),
      crescentArc("#ffffff", 0.7),
      innerRingWhite(0.4),
      innerRingBlack(0.14),
      twinkle("M79 70 v7 M75.5 73.5 h7", "#ffffff", 3.4, 0.6),
    ],
    glyph: {
      parts: [
        P("M28 58 H72", { strokeWidth: 5 }),
        C(24, 58, 6.5, { strokeWidth: 4 }),
        C(76, 58, 6.5, { strokeWidth: 4 }),
        P("M47 52 C43 40 35 30 23 26 C33 26 41 31 47 37 C45 29 41 23 35 19 C43 21 48 27 50 35 Z", { fill: true }),
        P("M53 52 C57 40 65 30 77 26 C67 26 59 31 53 37 C55 29 59 23 65 19 C57 21 52 27 50 35 Z", { fill: true }),
      ],
      highlightColor: "#ffffff",
      highlightOpacity: 0.55,
      mainColor: "#4e6a78",
    },
    aura: [
      groundShadow(),
      { kind: "glow", cxPct: 50, cyPct: 50, rxPct: 64, ryPct: 64, colorStart: "rgba(0,0,0,0)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 57, color: "rgba(150,215,245,0.6)" }, anim: "breathe", durationS: 5.5 },
      { kind: "glow", insetPct: -4.2, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(150,215,245,0.24)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 5.5 },
      { kind: "icon", d: "M10 1 C6 7 6 13 10 19 C14 13 14 7 10 1 Z", viewBox: 20, fill: "#eaf6fb", leftPct: 72, topPct: 14, sizePx: 13, anim: "featherFall", durationS: 4.5 },
      { kind: "icon", d: "M10 1 C6 7 6 13 10 19 C14 13 14 7 10 1 Z", viewBox: 20, fill: "#eaf6fb", leftPct: 20, topPct: 20, sizePx: 10, anim: "featherFall", durationS: 5.6, delayS: 2.1 },
    ],
  },

  // 16 — Achilles · Iridium
  {
    material: "Iridium",
    auraLabel: "Prismatic oil-slick swirl",
    rim: rimCircle([S(0, "#d2ccd8"), S(1, "#4a4656")], 0.42),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#d2ccd8"), S(0.5, "#948e9e"), S(1, "#4a4656")]),
      speculars: [
        spec1([S(0, "#ffffff", 0.6), S(1, "#ffffff", 0)]),
        spec2([S(0, "#d86ac8", 0.3), S(1, "#d86ac8", 0)]),
        { cx: 0.25, cy: 0.72, r: 0.42, stops: [S(0, "#4ac8b8", 0.28), S(1, "#4ac8b8", 0)] },
      ],
      vignette: vig(0.42),
    },
    decorations: [ring(52.5, "#4a4656", 6, { strokeDasharray: "3 6" }, "rim"), crescentArc("#ffffff", 0.5), innerRingWhite(0.28), innerRingBlack(0.2)],
    glyph: {
      parts: [
        P("M70 17 L48 58", { strokeWidth: 4 }),
        P("M70 17 l-10 1 M70 17 l3 10 M66 25 l-10 1 M66 25 l3 10", { strokeWidth: 3 }),
        P("M48 58 L44.5 49 L54 52.5 Z", { fill: true }),
        P("M26 76 C26 66 32 60 40 61 C45 62 47 66 52 68 C58 70 66 71 68 76 C68 78 66 79 63 79 L29 79 C27 78 26 77 26 76 Z", { fill: true }),
      ],
      highlightColor: "#f0f4f6",
      highlightOpacity: 0.5,
      mainColor: "#343b41",
      extras: [C(45, 61, 3.6, { fill: true, color: "#C0492E" }), P("M38 55 l-4 -3 M52 57 l4 -4", { strokeWidth: 2, color: "#C0492E" })],
    },
    aura: [
      groundShadow(),
      { kind: "prismBlobs", insetPct: -4.2, colors: ["#e0402e", "#e3a24a", "#5ec98a", "#5a9df0", "#8c6ef0", "#d86ac8"], anim: "spinCW", durationS: 12 },
      { kind: "glow", insetPct: 4.2, cxPct: 50, cyPct: 50, rxPct: 60, ryPct: 60, colorStart: "rgba(255,255,255,0.14)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 5 },
    ],
  },

  // 17 — Heracles · Osmium
  {
    material: "Osmium",
    auraLabel: "Gravity well, orbiting debris",
    rim: rimCircle([S(0, "#90a4c8"), S(1, "#232c44")], 0.5),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#90a4c8"), S(0.5, "#4e5f80"), S(1, "#232c44")]),
      speculars: [spec1([S(0, "#bcd0e8", 0.5), S(1, "#bcd0e8", 0)])],
      vignette: vig(0.55),
    },
    decorations: [
      circleGroup(
        [
          { cx: 109.7, cy: 75.4, r: 2.6 },
          { cx: 91.2, cy: 101.6, r: 2.6 },
          { cx: 60.7, cy: 112.0, r: 2.6 },
          { cx: 30.0, cy: 102.5, r: 2.6 },
          { cx: 10.8, cy: 76.8, r: 2.6 },
          { cx: 10.3, cy: 44.6, r: 2.6 },
          { cx: 28.8, cy: 18.4, r: 2.6 },
          { cx: 59.3, cy: 8.0, r: 2.6 },
          { cx: 90.0, cy: 17.5, r: 2.6 },
          { cx: 109.2, cy: 43.2, r: 2.6 },
        ],
        "#141a2a",
        1,
        "rim"
      ),
      crescentArc("#ffffff", 0.4),
      innerRingWhite(0.22),
      innerRingBlack(0.25),
    ],
    glyph: {
      parts: [
        P("M33 86 L47 60 L59 38 C61 29 71 26 77 32 C83 38 79 48 70 50 L56 66 L41 90 Z", { fill: true }),
        P("M19 27 L40 46 M28 19 L49 38 M38 13 L59 32", { strokeWidth: 4.5 }),
      ],
      highlightColor: "#c4cede",
      highlightOpacity: 0.45,
      mainColor: "#141a2a",
      extras: [C(66, 38, 1.7, { fill: true, color: "#4e5f80" }), C(72, 42, 1.7, { fill: true, color: "#4e5f80" }), C(65, 45, 1.7, { fill: true, color: "#4e5f80" })],
    },
    aura: [
      groundShadow(),
      { kind: "glow", insetPct: 7.37, cxPct: 50, cyPct: 50, rxPct: 70, ryPct: 70, colorStart: "rgba(0,0,0,0.5)", colorEnd: "rgba(0,0,0,0)", anim: "none", durationS: 0 },
      { kind: "glow", insetPct: 1.05, cxPct: 50, cyPct: 50, rxPct: 58, ryPct: 58, colorStart: "rgba(0,0,0,0)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 50, color: "rgba(96,118,200,0.5)" }, anim: "collapse", durationS: 3.6 },
      { kind: "glow", insetPct: -3.16, cxPct: 50, cyPct: 50, rxPct: 62, ryPct: 62, colorStart: "rgba(0,0,0,0)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 54, color: "rgba(96,118,200,0.28)" }, anim: "collapse", durationS: 3.6, delayS: -1.8 },
      { kind: "debris", insetPct: 3.16, dots: [{ cx: 100, cy: 14, r: 3.4 }, { cx: 168, cy: 140, r: 2.6 }, { cx: 30, cy: 130, r: 2.2 }], color: "#8ea6c8", opacity: 0.7, anim: "spinCW", durationS: 9 },
    ],
  },

  // 18 — Zeus · Rhodium
  {
    material: "Rhodium",
    auraLabel: "Forked blue lightning",
    rim: rimCircle([S(0, "#4f7cc4"), S(1, "#0a1630")], 0.3),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#4f7cc4"), S(0.5, "#274b8c"), S(1, "#0a1630")]),
      speculars: [
        spec1([S(0, "#eaf4ff", 0.8), S(1, "#eaf4ff", 0)]),
        spec2([S(0, "#6eaaff", 0.3), S(1, "#6eaaff", 0)]),
        { cx: 0.5, cy: 0.05, r: 0.7, stops: [S(0, "#02060f", 0.75), S(1, "#02060f", 0)] },
        { cx: 0.5, cy: 0.5, r: 0.5, stops: [S(0, "#7cc0ff", 0.55), S(1, "#7cc0ff", 0)], paintR: 32, afterVignette: true, anim: "flick", animDurationS: 2.6 },
      ],
      vignette: vig(0.3),
    },
    decorations: [
      ring(52, "#0a1630", 3, { strokeDasharray: "1.8 2.4" }, "rim"),
      crescentArc("#ffffff", 0.85),
      innerRingWhite(0.5),
      innerRingBlack(0.12),
      twinkle("M38 32 v8 M34 36 h8", "#ffffff", 2.6),
      pth("M20 42 l7 3 -5 6 8 4 M98 76 l-7 -2 5 -7 -8 -3", { stroke: "#bfe0ff", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", anim: "boltFlash", animDurationS: 2.3, animDelayS: 0.4 }),
    ],
    glyph: {
      parts: [P("M57 13 L36 51 L47.5 51 L40 87 L66 43 L53.5 43 Z", { fill: true })],
      highlightColor: "#0f2547",
      highlightOpacity: 0.55,
      mainColor: "#f2f8ff",
    },
    aura: [
      groundShadow(),
      { kind: "glow", insetPct: -7.37, cxPct: 50, cyPct: 50, rxPct: 65, ryPct: 65, colorStart: "rgba(80,140,255,0.5)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 40, color: "rgba(30,60,140,0.25)" }, anim: "breathe", durationS: 3.4 },
      { kind: "glow", insetPct: 1.05, cxPct: 50, cyPct: 50, rxPct: 63, ryPct: 63, colorStart: "rgba(0,0,0,0)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 56, color: "rgba(160,210,255,0.65)" }, anim: "flick", durationS: 1.6 },
      {
        kind: "lightning",
        insetPct: -5.26,
        colorCore: "#e6f2ff",
        colorGlow: "#6eaaff",
        glowWidth: 6,
        glowOpacity: 0.35,
        bolts: [
          { d: "M100 6 L94 26 L103 24 L96 44", hasGlow: true, coreWidth: 2.6, delayS: 0, durationS: 3.1 },
          { d: "M178 62 L160 72 L168 76 L150 88", hasGlow: true, coreWidth: 2.4, delayS: 1.1, durationS: 4.3 },
          { d: "M18 128 L38 122 L32 116 L52 108", hasGlow: true, coreWidth: 2.4, delayS: 0.6, durationS: 3.7 },
          { d: "M150 178 L142 160 L136 168 L126 148", hasGlow: true, coreWidth: 2.2, delayS: 2, durationS: 5.1 },
          { d: "M52 34 L62 50 L52 52 L64 68", hasGlow: false, coreWidth: 2.2, delayS: 2.8, durationS: 4.7 },
          { d: "M40 168 L52 152 L44 148 L58 132", hasGlow: true, coreWidth: 2.3, delayS: 1.7, durationS: 3.3 },
          { d: "M168 130 L152 128 L158 120 L140 112", hasGlow: false, coreWidth: 2, delayS: 0.9, durationS: 2.9 },
        ],
      },
    ],
  },

  // 19 — Nike · Diamond
  {
    material: "Diamond",
    auraLabel: "Refracting rainbow lattice",
    rim: rimCircle([S(0, "#ffffff"), S(1, "#a9cfd8")], 0.28),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#ffffff"), S(0.5, "#dff0f5"), S(1, "#a9cfd8")]),
      speculars: [
        spec1([S(0, "#ffffff", 0.85), S(1, "#ffffff", 0)]),
        spec2([S(0, "#ff6ec7", 0.26), S(1, "#ff6ec7", 0)]),
        { cx: 0.22, cy: 0.75, r: 0.4, stops: [S(0, "#6ec7ff", 0.24), S(1, "#6ec7ff", 0)] },
      ],
      vignette: vig(0.28),
    },
    decorations: [
      ring(52.5, "#8fb8c2", 6, { strokeDasharray: "10 3" }, "rim"),
      crescentArc("#ffffff", 0.9),
      innerRingWhite(0.55),
      innerRingBlack(0.1),
      twinkle("M42 30 v8 M38 34 h8", "#ffffff", 2.2),
      twinkle("M78 72 v7 M74.5 75.5 h7", "#ffffff", 3, 1.4),
    ],
    glyph: {
      parts: [
        GRP("translate(50 50) scale(1.4) translate(-50 -50)", [
          P("M20 46 H31 M16 54 H25 M20 62 H27", { strokeWidth: 2.4, strokeLinecap: "round" }),
          P("M28 64 C44 58 60 46 74 30 C70 46 70 54 74 58 C64 56 58 58 56 64 C58 56 56 52 52 52 C56 62 50 64 46 62 C50 56 46 54 42 56 C46 64 40 66 36 62 Z", { fill: true }),
        ]),
      ],
      highlightColor: "#ffffff",
      highlightOpacity: 0.6,
      mainColor: "#4e7c8a",
    },
    aura: [
      groundShadow(),
      { kind: "glow", insetPct: -3.16, cxPct: 50, cyPct: 50, rxPct: 60, ryPct: 60, colorStart: "rgba(255,255,255,0.22)", colorEnd: "rgba(0,0,0,0)", anim: "breatheSoft", durationS: 4.5 },
      { kind: "orbitRing", insetPct: -3.16, r: 86, stroke: "#ff6ec7", strokeOpacity: 0.5, strokeWidth: 2.5, dasharray: "10 14", anim: "spinCW", durationS: 14 },
      { kind: "orbitRing", insetPct: 2.1, r: 82, stroke: "#6ec7ff", strokeOpacity: 0.5, strokeWidth: 2, dasharray: "6 18", anim: "spinCCW", durationS: 20 },
      { kind: "icon", d: "M10 2 V18 M2 10 H18", viewBox: 20, stroke: "#ffffff", strokeWidth: 2, leftPct: 60, topPct: 10, sizePx: 16, anim: "twinkle", durationS: 2.6 },
      { kind: "icon", d: "M10 2 V18 M2 10 H18", viewBox: 20, stroke: "#ffffff", strokeWidth: 2, leftPct: 14, topPct: 70, sizePx: 12, anim: "twinkle", durationS: 3.4, delayS: 1 },
    ],
  },

  // 20 — Kratos · Neutronium (apex)
  {
    material: "Neutronium",
    auraLabel: "Ash, embers, burning rage",
    rim: rimPolygon(
      "M110.7 60.0 L109.5 88.6 L88.2 108.9 L60.0 115.4 L32.3 108.0 L15.1 85.9 L3.7 60.0 L13.0 32.9 L31.0 9.8 L60.0 2.9 L88.6 10.4 L104.6 34.2 Z",
      [S(0, "#3a1c1e"), S(1, "#050202")],
      "#e0402e",
      0.4,
      1.5
    ),
    face: {
      r: 48,
      gradient: faceGrad([S(0, "#413a36"), S(0.55, "#191413"), S(1, "#040202")]),
      speculars: [{ cx: 0.5, cy: 0.47, r: 0.42, stops: [S(0, "#e0402e", 0.85), S(1, "#3a1214", 0)] }],
      vignette: vig(0.6, 0.66),
    },
    decorations: [
      ring(52, "#2a0f0c", 3, { strokeDasharray: "1.8 2.4" }, "rim"),
      pth("M46 10 C54 38 54 82 44 110", { stroke: "#b01e1e", strokeOpacity: 0.8, strokeWidth: 11, clipToFace: true }, "preVignette"),
      pth("M50 34 l7 9 -5 8 8 10 M74 54 l9 -5 M40 64 l-10 6 M64 78 l6 8", { stroke: "#e0402e", strokeOpacity: 0.5, strokeWidth: 1.6, strokeLinecap: "round" }),
      ring(48, "#ff6a52", 1, { strokeOpacity: 0.14 }, "postVignette"),
    ],
    glyph: {
      parts: [P("M28 76 C36 62 48 48 66 36 C58 50 48 64 36 76 Z M72 76 C64 62 52 48 34 36 C42 50 52 64 64 76 Z", { fill: true })],
      highlightColor: "#5c1210",
      highlightOpacity: 0.6,
      mainColor: "#d8d2cc",
      extras: [P("M31 79 L18 90 M69 79 L82 90", { strokeWidth: 3, strokeDasharray: "2.5 4" })],
    },
    aura: [
      groundShadow(0.7),
      { kind: "glow", insetPct: -7.37, cxPct: 50, cyPct: 50, rxPct: 68, ryPct: 68, colorStart: "rgba(224,64,46,0.28)", colorEnd: "rgba(0,0,0,0)", midStop: { pct: 40, color: "rgba(122,20,16,0.18)" }, anim: "breathe", durationS: 3.2 },
      {
        kind: "glow",
        insetPct: -1.05,
        cxPct: 50,
        cyPct: 50,
        rxPct: 66,
        ryPct: 66,
        colorStart: "rgba(0,0,0,0)",
        colorEnd: "rgba(0,0,0,0)",
        midStop: { pct: 48, color: "rgba(224,64,46,0.55)" },
        anim: "collapse",
        durationS: 3,
      },
      { kind: "glow", cxPct: 38, cyPct: 30, rxPct: 2.1, ryPct: 2.1, colorStart: "rgba(255,110,60,0.95)", colorEnd: "rgba(0,0,0,0)", anim: "riseSmoke", durationS: 2.9 },
      { kind: "glow", cxPct: 63, cyPct: 25, rxPct: 1.6, ryPct: 1.6, colorStart: "rgba(255,110,60,0.95)", colorEnd: "rgba(0,0,0,0)", anim: "riseSmoke", durationS: 3.8, delayS: 1.6 },
      { kind: "orbitRing", insetPct: -3.16, r: 84, stroke: "#e0402e", strokeOpacity: 0.6, strokeWidth: 2, dasharray: "3 9", anim: "spinCW", durationS: 7 },
      { kind: "orbitRing", insetPct: -3.16, r: 72, stroke: "#ff8a5e", strokeOpacity: 0.35, strokeWidth: 1.6, dasharray: "2 14", anim: "spinCW", durationS: 7 },
      { kind: "orbitRing", insetPct: 1.05, r: 64, stroke: "#e0402e", strokeOpacity: 0.4, strokeWidth: 1.6, dasharray: "2 11", anim: "spinCCW", durationS: 11 },
    ],
  },
];

// ─── STAGE A note ───────────────────────────────────────────────────────────
// Two deliberate, documented approximations (both cosmetic, both called out
// per the brief's "list any tier whose structure you had to approximate"):
//
// 1. Hoplite's helmet browguard (tier index 3): the artifact's main pass
//    sets `opacity="0.65"` on just the inner 20.5r ring, while the highlight
//    pass has no such override (it's covered by the group's own 0.4
//    opacity). This file renders that ring at full pass-opacity in both
//    passes — a ~melodic difference on a thin 1.8-stroke ring, invisible at
//    card/modal medallion sizes.
// 2. Kratos's second aura glow (the `collapse`-animated inner burst) is a
//    4-stop CSS radial-gradient (transparent 36% / red 48% / near-black 58%
//    / transparent 66%); this file's `glow` shape only supports a 3-stop
//    (start/mid/end) gradient, so the darker 58% band is folded into the
//    same red mid-stop rather than kept as a fourth, separate stop. Stage B
//    (or a future aura-schema pass) can widen `midStop` to an array if that
//    nuance ever matters.
