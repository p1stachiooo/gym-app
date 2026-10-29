// Renderer for `./medallionArt.ts` — the v2 artifact (`Medallions v2.dc.html`)
// ported 1:1 to react-native-svg. One component walks a `MedallionArt` entry
// and draws, in the artifact's own DOM order: rim -> "rim"-layer decorations
// (rivets/dashed accent rings) -> face fill -> pre-vignette specular overlays
// -> "preVignette"-layer decorations (Kratos's clipped streak only, so the
// vignette's dark rim-ramp fades its outer extents) -> vignette -> post-
// vignette specular overlays -> "postVignette"-layer decorations (speckles,
// sheen, inner rings, sparkle marks) -> glyph highlight pass -> glyph main
// pass -> glyph main-only extras. This disc/glyph stack is STAGE A (static)
// and untouched by Stage B.
//
// STAGE B: aura layers (behind the medallion) are now animated — see
// `useReduceMotion`, `useAuraDriver`, `auraStyle` and the `AuraLayers`
// component below. Each animated aura layer is wrapped in a native-driver
// `Animated.View` that loops the artifact's own `@keyframes` (breathe,
// breatheSoft, ringOut, spinCW/CCW, flick, sinkFall, collapse, sweep,
// driftXY, riseSmoke, twinkle, boltFlash, featherFall — see
// `Medallions v2.dc.html` lines ~17-31). When the OS "reduce motion"
// setting is on, every aura layer falls back to the STAGE A static render.
//
// SVG -> react-native-svg mapping notes:
//  - camelCase attrs: stroke-width -> strokeWidth, stroke-opacity ->
//    strokeOpacity, fill-opacity -> fillOpacity, stroke-dasharray ->
//    strokeDasharray, stroke-linecap -> strokeLinecap, stroke-linejoin ->
//    strokeLinejoin, stroke-dashoffset -> strokeDashoffset.
//  - `currentColor` (the artifact's `color="..."` + `stroke="currentColor"`/
//    `fill="currentColor"` pattern) has no RN-svg / RN equivalent, so
//    medallionArt.ts already resolves every glyph part to an explicit
//    `highlightColor`/`mainColor`/`color` prop consumed here.
//  - Every `<radialGradient>`/`<linearGradient>` id in the artifact (e01,
//    f01, v01, h07, w11, z19, c21, k21 clip, ...) is regenerated per
//    instance via `useId()` below (`${uid}-rim`, `${uid}-face`,
//    `${uid}-spec${i}`, `${uid}-vig`, `${uid}-clip`) so the 21 medallions
//    RankLadderModal renders at once never collide on <Defs> ids.
//  - `clip-path: circle(...)` (Kratos's blood streak) becomes a <ClipPath>
//    def + `clipPath="url(#...)"` on the <Path>.
import React, { useEffect, useId, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

import { MEDALLION_ART, type AuraLayer, type Decoration, type Glyph, type GlyphShape, type MedallionArt, type Specular } from "./medallionArt";
import { tierIndexOf } from "./rankArt";

const CX = 60;
const CY = 60;
const url = (id: string) => `url(#${id})`;
const pct = (v: number) => `${v * 100}%`;

// ─── glyph ──────────────────────────────────────────────────────────────

function GlyphShapeNode({ shape, passColor, k }: { shape: GlyphShape; passColor: string; k: string }) {
  if (shape.kind === "group") {
    return (
      <G transform={shape.transform}>
        {shape.parts.map((p, i) => (
          <GlyphShapeNode key={i} shape={p} passColor={passColor} k={`${k}-${i}`} />
        ))}
      </G>
    );
  }
  const color = shape.color ?? passColor;
  const common = {
    fill: shape.fill ? color : "none",
    stroke: shape.strokeWidth !== undefined ? color : "none",
    strokeWidth: shape.strokeWidth,
    strokeLinecap: shape.strokeLinecap ?? "round",
    strokeLinejoin: shape.strokeLinejoin ?? "round",
    strokeDasharray: shape.strokeDasharray,
    transform: shape.transform,
  } as const;
  switch (shape.kind) {
    case "path":
      return <Path d={shape.d} {...common} />;
    case "circle":
      return <Circle cx={shape.cx} cy={shape.cy} r={shape.r} {...common} />;
    case "rect":
      return <Rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} {...common} />;
    case "ellipse":
      return <Ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...common} />;
  }
}

function GlyphLayers({ glyph }: { glyph: Glyph }) {
  // The artifact draws every glyph in a 0-100 space (centered ~50,50) and maps
  // it onto the disc center via this wrapper: translate to (60,60), scale 1.02,
  // then shift the glyph's own origin. Without it the glyph sits ~10px up-and-
  // left of the disc center. The highlight pass keeps its own (0 1.6) offset
  // INSIDE this wrapper, exactly as the source nests the two <g> groups.
  return (
    <G transform="translate(60 60) scale(1.02) translate(-50 -50)">
      <G transform="translate(0 1.6)" opacity={glyph.highlightOpacity}>
        {glyph.parts.map((p, i) => (
          <GlyphShapeNode key={i} shape={p} passColor={glyph.highlightColor} k={`h${i}`} />
        ))}
      </G>
      <G>
        {glyph.parts.map((p, i) => (
          <GlyphShapeNode key={i} shape={p} passColor={glyph.mainColor} k={`m${i}`} />
        ))}
        {glyph.extras?.map((p, i) => (
          <GlyphShapeNode key={`x${i}`} shape={p} passColor={glyph.mainColor} k={`x${i}`} />
        ))}
      </G>
    </G>
  );
}

// ─── decorations ────────────────────────────────────────────────────────

function DecorationNode({ dec, clipId }: { dec: Decoration; clipId: string }) {
  switch (dec.kind) {
    case "circleGroup":
      return (
        <G fill={dec.fill} opacity={dec.opacity}>
          {dec.circles.map((c, i) => (
            <Circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
          ))}
        </G>
      );
    case "ring":
      return (
        <Circle
          cx={CX}
          cy={CY}
          r={dec.r}
          fill="none"
          stroke={dec.stroke}
          strokeWidth={dec.strokeWidth}
          strokeOpacity={dec.strokeOpacity}
          strokeDasharray={dec.strokeDasharray}
          strokeDashoffset={dec.strokeDashoffset}
        />
      );
    case "path":
      return (
        <Path
          d={dec.d}
          fill={dec.fill ?? "none"}
          stroke={dec.stroke}
          strokeWidth={dec.strokeWidth}
          strokeOpacity={dec.strokeOpacity}
          strokeLinecap={dec.strokeLinecap}
          strokeLinejoin={dec.strokeLinejoin}
          strokeDasharray={dec.strokeDasharray}
          strokeDashoffset={dec.strokeDashoffset}
          opacity={dec.opacity}
          clipPath={dec.clipToFace ? url(clipId) : undefined}
        />
      );
  }
}

// ─── medallion (rim + face + decorations + glyph) ──────────────────────

function Medallion({ art, uid }: { art: MedallionArt; uid: string }) {
  const rimId = `${uid}-rim`;
  const faceId = `${uid}-face`;
  const vigId = `${uid}-vig`;
  const clipId = `${uid}-clip`;
  const specIds = art.face.speculars.map((_, i) => `${uid}-spec${i}`);
  const needsClip = art.decorations.some((d) => d.kind === "path" && d.clipToFace);

  const rimDecos = art.decorations.filter((d) => d.layer === "rim");
  const preVigDecos = art.decorations.filter((d) => d.layer === "preVignette");
  const postVigDecos = art.decorations.filter((d) => d.layer === "postVignette");

  const specBefore = art.face.speculars
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.afterVignette);
  const specAfter = art.face.speculars
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !!s.afterVignette);

  return (
    <>
      <Defs>
        <LinearGradient id={rimId} x1={pct(art.rim.gradient.x1)} y1={pct(art.rim.gradient.y1)} x2={pct(art.rim.gradient.x2)} y2={pct(art.rim.gradient.y2)}>
          {art.rim.gradient.stops.map((s, i) => (
            <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
          ))}
        </LinearGradient>
        <RadialGradient id={faceId} cx={pct(art.face.gradient.cx)} cy={pct(art.face.gradient.cy)} r={pct(art.face.gradient.r)}>
          {art.face.gradient.stops.map((s, i) => (
            <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
          ))}
        </RadialGradient>
        {art.face.speculars.map((s: Specular, i) => (
          <RadialGradient key={i} id={specIds[i]} cx={pct(s.cx)} cy={pct(s.cy)} r={pct(s.r)}>
            {s.stops.map((st, j) => (
              <Stop key={j} offset={st.offset} stopColor={st.color} stopOpacity={st.opacity ?? 1} />
            ))}
          </RadialGradient>
        ))}
        <RadialGradient id={vigId} cx={pct(art.face.vignette.cx)} cy={pct(art.face.vignette.cy)} r={pct(art.face.vignette.r)}>
          {art.face.vignette.stops.map((s, i) => (
            <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
          ))}
        </RadialGradient>
        {needsClip && (
          <ClipPath id={clipId}>
            <Circle cx={CX} cy={CY} r={art.face.r} />
          </ClipPath>
        )}
      </Defs>

      {art.rim.kind === "polygon" ? (
        <Path d={art.rim.d} fill={url(rimId)} stroke={art.rim.stroke} strokeOpacity={art.rim.strokeOpacity} strokeWidth={art.rim.strokeWidth} strokeLinejoin="round" />
      ) : (
        <Circle cx={CX} cy={CY} r={art.rim.r} fill={url(rimId)} stroke={art.rim.stroke} strokeOpacity={art.rim.strokeOpacity} strokeWidth={art.rim.strokeWidth} />
      )}

      {rimDecos.map((d, i) => (
        <DecorationNode key={i} dec={d} clipId={clipId} />
      ))}

      <Circle cx={CX} cy={CY} r={art.face.r} fill={url(faceId)} />
      {specBefore.map(({ i }) => (
        <Circle key={i} cx={CX} cy={CY} r={art.face.speculars[i].paintR ?? art.face.r} fill={url(specIds[i])} />
      ))}
      {/* preVignette decorations paint BEFORE the vignette, so the vignette's
          dark rim-ramp fades their outer extents (Kratos's blood streak). */}
      {preVigDecos.map((d, i) => (
        <DecorationNode key={i} dec={d} clipId={clipId} />
      ))}
      <Circle cx={CX} cy={CY} r={art.face.r} fill={url(vigId)} />
      {specAfter.map(({ i }) => (
        <Circle key={i} cx={CX} cy={CY} r={art.face.speculars[i].paintR ?? art.face.r} fill={url(specIds[i])} />
      ))}
      {postVigDecos.map((d, i) => (
        <DecorationNode key={i} dec={d} clipId={clipId} />
      ))}

      <GlyphLayers glyph={art.glyph} />
    </>
  );
}

// ─── aura (Stage B: animated) ────────────────────────────────────────────
// Two coordinate conventions carried over from the artifact: most layers
// (glow/speckleField/sweep/icon/groundShadow) are positioned as percentages
// of the artifact's 190x190 layout box; the "outer ring" family
// (orbitRing/prismBlobs/lightning/debris/rayBurst) all come from the
// artifact's nested `<svg viewBox="0 0 200 200">` overlays, so they're
// rendered in that same 200-unit space. Both stacks render at `boxSize` and
// overlap exactly — `insetPct` is carried on the data for provenance but not
// re-derived into per-layer box sizes here (a Stage A simplification that
// Stage B keeps as-is; only motion changed).
//
// Every animated layer below is its OWN `<Svg>` (rather than Stage A's two
// shared `<Svg>` batches) wrapped in an absolutely-positioned `View`/
// `Animated.View` sized to the full aura box, so its 190/200 viewBox scaling
// — and therefore its on-disc alignment — is identical to Stage A; only a
// transform/opacity is layered on top of that same static content.

function gradStops(colorStart: string, colorEnd: string, midStop?: { pct: number; color: string }) {
  if (!midStop) return [{ offset: 0, color: colorStart }, { offset: 1, color: colorEnd }];
  return [
    { offset: 0, color: colorStart },
    { offset: midStop.pct / 100, color: midStop.color },
    { offset: 1, color: colorEnd },
  ];
}

/** Reads the OS "reduce motion" accessibility setting once on mount, then
 * subscribes to live changes. While true, `AuraLayers` renders every layer
 * exactly as Stage A did — static, no loops. */
function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduceMotion;
}

// Anim names this file knows how to loop (mirrors the artifact's
// `@keyframes` list). Anything else (undefined, or the literal "none" used
// by Heracles' static ambient shadow glow) renders as a plain, unanimated
// layer — identical to the reduce-motion fallback.
const SUPPORTED_ANIMS = new Set([
  "breathe",
  "breatheSoft",
  "ringOut",
  "spinCW",
  "spinCCW",
  "flick",
  "sinkFall",
  "collapse",
  "sweep",
  "driftXY",
  "riseSmoke",
  "twinkle",
  "featherFall",
  "boltFlash",
]);

function easingFor(anim: string): (value: number) => number {
  switch (anim) {
    case "spinCW":
    case "spinCCW":
    case "sinkFall":
      // The artifact declares these explicitly `linear` per-card.
      return Easing.linear;
    case "ringOut":
      return Easing.out(Easing.quad);
    default:
      // Browser default keyframe timing (~ease) for everything else
      // (breathe/breatheSoft/flick/collapse/sweep/driftXY/riseSmoke/
      // twinkle/featherFall/boltFlash).
      return Easing.inOut(Easing.ease);
  }
}

/** Drives a single native-driver `Animated.Value` (0→1) on an infinite loop
 * matching CSS `animation: <name> <duration>s ... infinite` semantics,
 * including one-shot `animation-delay` (positive: wait, then start at 0;
 * negative: start already `|delay|` into the cycle — e.g. Heracles' two
 * "collapse" glows use +0/-1.8s so they pulse out of phase). Manual
 * recursion (not `Animated.loop`) so the delay only applies once, not every
 * iteration. Returns the driver; effect cleans up on unmount/anim change. */
function useAuraDriver(anim: string | undefined, durationS: number | undefined, delayS: number | undefined, active: boolean): Animated.Value {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active || !anim || !SUPPORTED_ANIMS.has(anim) || !durationS) {
      t.setValue(0);
      return;
    }
    const durationMs = Math.max(1, durationS * 1000);
    const easing = easingFor(anim);
    let cancelled = false;
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    let current: Animated.CompositeAnimation | undefined;

    const cycle = () => {
      if (cancelled) return;
      t.setValue(0);
      current = Animated.timing(t, { toValue: 1, duration: durationMs, easing, useNativeDriver: true });
      current.start(({ finished }) => {
        if (finished && !cancelled) cycle();
      });
    };

    if (delayS && delayS > 0) {
      delayTimer = setTimeout(cycle, delayS * 1000);
    } else if (delayS && delayS < 0) {
      // Negative delay: jump straight into the cycle at the equivalent phase.
      const phase = ((-delayS * 1000) % durationMs) / durationMs;
      t.setValue(phase);
      current = Animated.timing(t, { toValue: 1, duration: durationMs * (1 - phase), easing, useNativeDriver: true });
      current.start(({ finished }) => {
        if (finished && !cancelled) cycle();
      });
    } else {
      cycle();
    }

    return () => {
      cancelled = true;
      if (delayTimer) clearTimeout(delayTimer);
      current?.stop();
    };
  }, [active, anim, durationS, delayS, t]);
  return t;
}

/** Maps a driver (0→1, looping) to the transform/opacity for one anim name,
 * reproducing the artifact's own keyframe stops. `k` converts the
 * artifact's original px offsets (authored against a 190px box) to this
 * render's actual box size; `boxSize` is used directly for the sweep's
 * translateX (percentage-of-own-width in the artifact). `reverse` flips a
 * driftXY blob's drift direction (Sandstone/Limestone's paired haze). */
function auraStyle(
  anim: string,
  t: Animated.Value,
  opts: { k: number; boxSize: number; reverse?: boolean }
): { opacity?: Animated.AnimatedInterpolation<string | number>; transform?: any[] } {
  const { k, boxSize, reverse } = opts;
  switch (anim) {
    case "breathe":
      return {
        opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 0.9, 0.45] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.94, 1.05, 0.94] }) }],
      };
    case "breatheSoft":
      return {
        opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 0.6, 0.3] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.95, 1.04, 0.95] }) }],
      };
    case "ringOut":
      return {
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1.28] }) }],
      };
    case "spinCW":
      return { transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] };
    case "spinCCW":
      return { transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] }) }] };
    case "flick":
      return { opacity: t.interpolate({ inputRange: [0, 0.45, 0.7, 1], outputRange: [0.3, 0.75, 0.4, 0.3] }) };
    case "sinkFall":
      // Approximates the CSS background-position scroll: the dot layer
      // drifts down while fading, instead of tiling.
      return {
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.15] }),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-16 * k, 18 * k] }) }],
      };
    case "collapse":
      return {
        opacity: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.9, 0.55, 0.9] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1.12, 0.7, 1.12] }) }],
      };
    case "driftXY": {
      const s = reverse ? -1 : 1;
      return {
        opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.35, 0.65, 0.35] }),
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-4 * k * s, 4 * k * s, -4 * k * s] }) },
          { translateY: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [3 * k * s, -3 * k * s, 3 * k * s] }) },
        ],
      };
    }
    case "riseSmoke":
      return {
        opacity: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.55, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [12 * k, -18 * k] }) },
          { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] }) },
        ],
      };
    case "twinkle":
      return {
        opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.15, 0.95, 0.15] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1.15, 0.6] }) }],
      };
    case "featherFall":
      return {
        opacity: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.85, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-14 * k, 18 * k] }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["-10deg", "12deg"] }) },
        ],
      };
    case "boltFlash":
      // 0%,7.9%,12.1%,100%: 0 · 8%,9%: 1 · 10%: .2 · 11%,12%: .85
      return {
        opacity: t.interpolate({
          inputRange: [0, 0.079, 0.08, 0.09, 0.1, 0.11, 0.12, 0.121, 1],
          outputRange: [0, 0, 1, 1, 0.2, 0.85, 0.85, 0, 0],
        }),
      };
    default:
      return {};
  }
}

/** Wraps one aura layer's static content in an absolutely-positioned
 * `Animated.View` looping its `anim`, or a plain `View` (no transform) when
 * motion is off / the anim is unsupported / the layer has no anim at all
 * (groundShadow) — the Stage A look, pixel for pixel.
 *
 * `origin` is the layer shape's OWN center as a `[x%, y%]` transformOrigin
 * (percent of the full aura box). The animated view is `absoluteFill` (the
 * whole box), so without this a `scale`/`rotate` would pivot about the box
 * center — fine for the centered glows/orbits, but off-center marks (Poseidon
 * feathers, Selene/Nike twinkle crosses, the riseSmoke ember sparks) would
 * swing/lunge instead of scaling/rotating in place. Pinning the origin to
 * each shape's center restores the artifact's in-place motion. Omitted =
 * default center origin (translate/opacity-only anims don't need it). */
function AnimatedAuraLayer({
  anim,
  durationS,
  delayS,
  reverse,
  boxSize,
  coordSize,
  origin,
  reduceMotion,
  children,
}: {
  anim?: string;
  durationS?: number;
  delayS?: number;
  reverse?: boolean;
  boxSize: number;
  coordSize: number;
  origin?: [number, number];
  reduceMotion: boolean;
  children: React.ReactNode;
}) {
  const active = !reduceMotion && !!anim && SUPPORTED_ANIMS.has(anim);
  const t = useAuraDriver(anim, durationS, delayS, active);

  if (!active) {
    return (
      <View style={styles.layer} pointerEvents="none">
        {children}
      </View>
    );
  }

  const style = auraStyle(anim!, t, { k: boxSize / coordSize, boxSize, reverse });
  const transformOrigin = origin ? [`${origin[0]}%`, `${origin[1]}%`, 0] : undefined;
  return (
    <Animated.View style={[styles.layer, transformOrigin ? { transformOrigin } : null, style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
}

/** Shape-center transformOrigin (percent of the 190 box) for a box190 layer,
 * or undefined (= box-center default) for the layers that are already
 * centered / translate-only. */
function originFor190(layer: AuraLayer): [number, number] | undefined {
  if (layer.kind === "glow") return [layer.cxPct, layer.cyPct];
  if (layer.kind === "icon") {
    // Icon path is centered in its own viewBox, so its on-box center is the
    // translate corner plus half the rendered size.
    const cx = ((layer.leftPct / 100) * 190 + layer.sizePx / 2) / 190 * 100;
    const cy = ((layer.topPct / 100) * 190 + layer.sizePx / 2) / 190 * 100;
    return [cx, cy];
  }
  return undefined; // speckleField (centered); sweep doesn't reach here — see `SweepLayer`
}

const styles = StyleSheet.create({
  layer: StyleSheet.absoluteFill,
});

function Box190Layer({ layer, i, uid }: { layer: AuraLayer; i: number; uid: string }) {
  switch (layer.kind) {
    case "groundShadow":
      return (
        <Svg width="100%" height="100%" viewBox="0 0 190 190">
          <Defs>
            <RadialGradient id={`${uid}-ground`} cx="50%" cy="50%" r="50%">
              <Stop offset={0} stopColor="rgba(0,0,0,0.55)" />
              <Stop offset={0.7} stopColor="rgba(0,0,0,0)" />
            </RadialGradient>
          </Defs>
          <Ellipse cx={95} cy={169} rx={56} ry={9} fill={`url(#${uid}-ground)`} opacity={(layer.opacity ?? 0.55) / 0.55} />
        </Svg>
      );
    case "glow": {
      const id = `${uid}-a${i}`;
      return (
        <Svg width="100%" height="100%" viewBox="0 0 190 190">
          <Defs>
            <RadialGradient id={id} cx="50%" cy="50%" r="50%">
              {gradStops(layer.colorStart, layer.colorEnd, layer.midStop).map((s, j) => (
                <Stop key={j} offset={s.offset} stopColor={s.color} />
              ))}
            </RadialGradient>
          </Defs>
          <Ellipse
            cx={(layer.cxPct / 100) * 190}
            cy={(layer.cyPct / 100) * 190}
            rx={(layer.rxPct / 100) * 190}
            ry={(layer.ryPct / 100) * 190}
            fill={`url(#${id})`}
          />
        </Svg>
      );
    }
    case "speckleField":
      return (
        <Svg width="100%" height="100%" viewBox="0 0 190 190">
          <Circle cx={95} cy={95} r={80} fill={layer.dotColor} opacity={Math.min(0.25, layer.dotOpacity * 0.4)} />
        </Svg>
      );
    case "icon": {
      const x = (layer.leftPct / 100) * 190;
      const y = (layer.topPct / 100) * 190;
      const scale = layer.sizePx / layer.viewBox;
      return (
        <Svg width="100%" height="100%" viewBox="0 0 190 190">
          <G transform={`translate(${x} ${y}) scale(${scale})`}>
            <Path d={layer.d} fill={layer.fill ?? "none"} stroke={layer.stroke} strokeWidth={layer.strokeWidth} strokeLinecap="round" />
          </G>
        </Svg>
      );
    }
    default:
      return null;
  }
}

// The "sweep" aura (Peltast/Atlas/Odysseus's shimmer materials) is a thin
// diagonal light band that has to be CLIPPED to a static circle over the disc
// while only the band itself translates — unlike every other box190 layer,
// which is fine translating/scaling as a whole `Animated.View` (see
// `AnimatedAuraLayer` above). That means sweep can't share the generic
// transform-driven path: it needs its `x` attribute animated on a single
// `<Rect>` INSIDE a static `<ClipPath>`, which `Animated.View` transforms
// can't express. So it gets its own component, routed directly from
// `AuraLayers` (filtered out of `box190` there) with a dedicated,
// JS-driven (`useNativeDriver:false` — SVG attributes aren't native-drivable)
// loop, rather than reusing `useAuraDriver`/`auraStyle`.
const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** Same loop/cleanup discipline as `useAuraDriver` (cancel flag + explicit
 * `stop()`, manual recursion so it's leak-safe under the 21-medallion modal),
 * but JS-driven since it animates an SVG `x` attribute rather than a
 * transform/opacity style. */
function useSweepDriver(durationS: number | undefined, active: boolean): Animated.Value {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active || !durationS) {
      t.setValue(0);
      return;
    }
    const durationMs = Math.max(1, durationS * 1000);
    const easing = Easing.inOut(Easing.ease);
    let cancelled = false;
    let current: Animated.CompositeAnimation | undefined;

    const cycle = () => {
      if (cancelled) return;
      t.setValue(0);
      current = Animated.timing(t, { toValue: 1, duration: durationMs, easing, useNativeDriver: false });
      current.start(({ finished }) => {
        if (finished && !cancelled) cycle();
      });
    };
    cycle();

    return () => {
      cancelled = true;
      current?.stop();
    };
  }, [active, durationS, t]);
  return t;
}

/** Renders the "sweep" aura: a static circular clip (matching the disc/rim)
 * over the 190 box, with only the diagonal gradient band translating inside
 * it — the artifact's `inset:16px;border-radius:50%;overflow:hidden` static
 * clip + internally-sweeping `linear-gradient` band (`Medallions v2.dc.html`
 * ~line 132), rather than the old whole-layer translate that dragged the
 * clip along with it and read as a solid sliding square. */
function SweepLayer({ layer, uid, reduceMotion }: { layer: Extract<AuraLayer, { kind: "sweep" }>; uid: string; reduceMotion: boolean }) {
  const active = !reduceMotion;
  const t = useSweepDriver(layer.durationS, active);
  const clipId = `${uid}-sweepclip`;
  const gradId = `${uid}-sweepgrad`;
  // Reduce motion: band held centered (x=0) so the bright stripe crosses the
  // disc statically, matching Stage A's no-loop fallback for every other layer.
  const x = active ? t.interpolate({ inputRange: [0, 0.7, 0.86, 1], outputRange: [-190, -190, 190, 190] }) : 0;

  return (
    <View style={styles.layer} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 190 190">
        <Defs>
          <ClipPath id={clipId}>
            <Circle cx={95} cy={95} r={62} />
          </ClipPath>
          <LinearGradient id={gradId} x1="0" y1="0.15" x2="1" y2="0.85">
            <Stop offset={0.35} stopColor={layer.color} stopOpacity={0} />
            <Stop offset={0.5} stopColor={layer.color} stopOpacity={0.5} />
            <Stop offset={0.65} stopColor={layer.color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <G clipPath={url(clipId)}>
          <AnimatedRect x={x} y={0} width={190} height={190} fill={url(gradId)} />
        </G>
      </Svg>
    </View>
  );
}

const PRISM_CENTERS = [
  { cx: 158, cy: 100 },
  { cx: 129, cy: 150.2 },
  { cx: 71, cy: 150.2 },
  { cx: 42, cy: 100 },
  { cx: 71, cy: 49.8 },
  { cx: 129, cy: 49.8 },
];

function Box200Layer({ layer, i, uid }: { layer: AuraLayer; i: number; uid: string }) {
  switch (layer.kind) {
    case "orbitRing":
      return (
        <Svg width="100%" height="100%" viewBox="0 0 200 200">
          <G opacity={layer.groupOpacity ?? 1}>
            {layer.rx !== undefined && layer.ry !== undefined ? (
              <Ellipse
                cx={100}
                cy={100}
                rx={layer.rx}
                ry={layer.ry}
                fill="none"
                stroke={layer.stroke}
                strokeOpacity={layer.strokeOpacity}
                strokeWidth={layer.strokeWidth}
                transform={layer.rotateDeg ? `rotate(${layer.rotateDeg} 100 100)` : undefined}
              />
            ) : (
              <Circle cx={100} cy={100} r={layer.r} fill="none" stroke={layer.stroke} strokeOpacity={layer.strokeOpacity} strokeWidth={layer.strokeWidth} strokeDasharray={layer.dasharray} />
            )}
            {layer.moon && <Circle cx={layer.moon.cx} cy={layer.moon.cy} r={layer.moon.r} fill={layer.moon.color} />}
          </G>
        </Svg>
      );
    case "prismBlobs":
      return (
        <Svg width="100%" height="100%" viewBox="0 0 200 200">
          <Defs>
            {layer.colors.map((c, j) => (
              <RadialGradient key={j} id={`${uid}-pr${j}`} cx="50%" cy="50%" r="50%">
                <Stop offset={0} stopColor={c} stopOpacity={0.5} />
                <Stop offset={1} stopColor={c} stopOpacity={0} />
              </RadialGradient>
            ))}
          </Defs>
          {PRISM_CENTERS.map((c, j) => (
            <Circle key={j} cx={c.cx} cy={c.cy} r={30} fill={`url(#${uid}-pr${j})`} />
          ))}
        </Svg>
      );
    case "debris":
      return (
        <Svg width="100%" height="100%" viewBox="0 0 200 200">
          <G fill={layer.color} opacity={layer.opacity}>
            {layer.dots.map((d, j) => (
              <Circle key={j} cx={d.cx} cy={d.cy} r={d.r} />
            ))}
          </G>
        </Svg>
      );
    case "rayBurst":
      return (
        <Svg width="100%" height="100%" viewBox="0 0 200 200">
          <G stroke={layer.stroke} strokeOpacity={layer.strokeOpacity} strokeWidth={layer.strokeWidth} strokeLinecap="round">
            {layer.rays.map((d, j) => (
              <Path key={j} d={d} />
            ))}
          </G>
        </Svg>
      );
    default:
      return null;
  }
}

function AuraLayers({ art, uid, boxSize }: { art: MedallionArt; uid: string; boxSize: number }) {
  const reduceMotion = useReduceMotion();
  const box190 = art.aura.filter((a) => a.kind === "groundShadow" || a.kind === "glow" || a.kind === "speckleField" || a.kind === "icon");
  const sweeps = art.aura.filter((a): a is Extract<AuraLayer, { kind: "sweep" }> => a.kind === "sweep");
  const box200 = art.aura.filter((a) => a.kind === "orbitRing" || a.kind === "prismBlobs" || a.kind === "lightning" || a.kind === "debris" || a.kind === "rayBurst");

  return (
    <>
      {sweeps.map((layer, i) => (
        <SweepLayer key={`sweep-${i}`} layer={layer} uid={uid} reduceMotion={reduceMotion} />
      ))}

      {box190.map((layer, i) => {
        if (layer.kind === "groundShadow") {
          return (
            <View key={i} style={styles.layer} pointerEvents="none">
              <Box190Layer layer={layer} i={i} uid={uid} />
            </View>
          );
        }
        return (
          <AnimatedAuraLayer
            key={i}
            anim={"anim" in layer ? layer.anim : undefined}
            durationS={"durationS" in layer ? layer.durationS : undefined}
            delayS={"delayS" in layer ? layer.delayS : undefined}
            reverse={"reverse" in layer ? layer.reverse : undefined}
            boxSize={boxSize}
            coordSize={190}
            origin={originFor190(layer)}
            reduceMotion={reduceMotion}
          >
            <Box190Layer layer={layer} i={i} uid={uid} />
          </AnimatedAuraLayer>
        );
      })}

      {box200.map((layer, i) => {
        if (layer.kind === "lightning") {
          // Each bolt flashes independently on its own delay/duration —
          // matching the artifact's per-bolt `boltFlash` timing — so each
          // gets its own driver rather than sharing the layer's.
          return layer.bolts.map((bolt, j) => (
            <AnimatedAuraLayer
              key={`${i}-${j}`}
              anim="boltFlash"
              durationS={bolt.durationS}
              delayS={bolt.delayS}
              boxSize={boxSize}
              coordSize={200}
              reduceMotion={reduceMotion}
            >
              <Svg width="100%" height="100%" viewBox="0 0 200 200">
                {bolt.hasGlow && (
                  <Path d={bolt.d} stroke={layer.colorGlow} strokeOpacity={layer.glowOpacity} strokeWidth={layer.glowWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                )}
                <Path d={bolt.d} stroke={layer.colorCore} strokeWidth={bolt.coreWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </AnimatedAuraLayer>
          ));
        }
        return (
          <AnimatedAuraLayer
            key={i}
            anim={"anim" in layer ? layer.anim : undefined}
            durationS={"durationS" in layer ? layer.durationS : undefined}
            boxSize={boxSize}
            coordSize={200}
            reduceMotion={reduceMotion}
          >
            <Box200Layer layer={layer} i={i} uid={uid} />
          </AnimatedAuraLayer>
        );
      })}
    </>
  );
}

// ─── public API ─────────────────────────────────────────────────────────

const VIEW = 120;
// The artifact lays each medallion out in a 190x190 box around a 132x132
// inner <svg>; aura layers are positioned/sized relative to that 190 box.
const AURA_BOX = 190;
const MEDALLION_PX = 132;

export interface RankMedallionProps {
  art: MedallionArt;
  size?: number;
}

export default function RankMedallion({ art, size = 118 }: RankMedallionProps) {
  const uid = useId();
  const auraSize = size * (AURA_BOX / MEDALLION_PX);

  return (
    <View style={{ width: auraSize, height: auraSize, alignItems: "center", justifyContent: "center" }}>
      <AuraLayers art={art} uid={uid} boxSize={auraSize} />
      <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
        <Medallion art={art} uid={uid} />
      </Svg>
    </View>
  );
}

/** Looks up MEDALLION_ART[tierIndexOf(rankId)] and renders the matching
 * medallion, so callers (ProgressCard, RankLadderModal) don't have to wire
 * the art table by hand. */
export function medallionForRank(rankId: number, size = 118) {
  const art = MEDALLION_ART[tierIndexOf(rankId)];
  return <RankMedallion art={art} size={size} />;
}
