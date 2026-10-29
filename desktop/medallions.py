# Phase (desktop parity) — rank medallions, rendered server-side as a STATIC
# SVG string for the Dash dashboard. Mirrors bodymap.py's approach exactly
# (build_*_svg() is a pure function of data, no Firestore/Dash imports; the
# result is base64'd into a data: URI for an html.Img — see medallion_data_uri
# below and app.py's body_svg_data_uri for the identical pattern).
#
# Source of truth: `Medallions v2.dc.html` (the approved v2 artifact, 1096
# lines) via `app/src/rank/medallionArt.ts` — the already-parsed, already-
# verbatim-checked TS port of that HTML (its own header explains the draw
# order and documents two deliberate Stage-A approximations; both are
# inherited here unchanged). Rather than hand-transcribing medallionArt.ts's
# ~1000 lines of builder-function calls (S/linear/rimPolygon/faceGrad/spec1/
# spec2/vig/...) into a second, parallel Python builder, `medallion_art.json`
# next to this file is a straight `JSON.stringify(MEDALLION_ART)` dump of the
# already-*resolved* plain objects — produced once via
# `npx tsx app/scripts/dump_medallion_art.ts` (that script stays in the repo
# for provenance/re-generation if the artifact ever changes) — exactly the
# same "ported via node one-liner, not hand-transcribed" trick bodymap.py
# documents for body_paths.json. This guarantees every rim path / gradient
# stop / glyph `d` is byte-identical to the TS (and therefore the HTML)
# source, with no risk of a hand-copy typo.
#
# Renderer below is a line-for-line Python port of app/src/rank/
# RankMedallion.tsx's draw order and its "reduce motion" static fallback
# (AnimatedAuraLayer/SweepLayer's `!active` branch): rim -> "rim"-layer
# decorations -> face fill -> pre-vignette speculars -> "preVignette"-layer
# decorations (Kratos's clipped blood streak only) -> vignette -> post-
# vignette speculars -> "postVignette"-layer decorations -> glyph highlight
# pass -> glyph main pass -> glyph main-only extras, with the aura layers
# (ground shadow / glow / speckle field / sweep / orbit ring / icon / prism
# blobs / lightning / debris / ray burst) drawn behind it at their CSS
# `@keyframes` REST pose — no `<animate>`/CSS animation emitted anywhere, per
# the desktop brief (a Dash `<img>` can't run it, and RankMedallion.tsx's own
# `reduceMotion` branch already defines exactly this rest pose for every
# layer type, so "static" here means "what the app itself falls back to").
from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Optional

_ART_FILE = Path(__file__).resolve().parent / "medallion_art.json"
MEDALLION_ART: list[dict] = json.loads(_ART_FILE.read_text(encoding="utf-8"))

# ─── shared layout constants — verbatim from RankMedallion.tsx ────────────
CX = 60
CY = 60
VIEW = 120  # the medallion disc's own viewBox is "0 0 120 120"
AURA_BOX = 190  # the artifact's outer layout box aura layers are positioned in
MEDALLION_PX = 132  # the artifact's inner <svg> size the AURA_BOX was tuned around

# react-native-svg's Box200Layer inner coordinate space (orbitRing/prismBlobs/
# debris/rayBurst/lightning all come from the artifact's nested
# `<svg viewBox="0 0 200 200">` overlays).
BOX200 = 200

_PRISM_CENTERS = [
    (158, 100),
    (129, 150.2),
    (71, 150.2),
    (42, 100),
    (71, 49.8),
    (129, 49.8),
]


def _pct(v: float) -> str:
    return f"{v * 100}%"


def _num(v: float) -> str:
    # Trim ".0" off whole numbers so output stays close to the artifact's own
    # terse formatting; harmless either way since SVG accepts both.
    return f"{v:g}"


def _attr(name: str, value) -> str:
    """One `name="value"` XML attribute, or "" if value is None/absent —
    lets every renderer below build attribute strings by simple concatenation
    without a maze of if/else, mirroring how sparse each RN prop list is."""
    if value is None:
        return ""
    return f' {name}="{value}"'


# ─── gradients ──────────────────────────────────────────────────────────

def _stops_svg(stops: list[dict]) -> str:
    parts = []
    for s in stops:
        opacity = s.get("opacity", 1)
        parts.append(f'<stop offset="{s["offset"]}" stop-color="{s["color"]}" stop-opacity="{opacity}"/>')
    return "".join(parts)


def _linear_gradient_svg(gid: str, spec: dict) -> str:
    return (
        f'<linearGradient id="{gid}" x1="{_pct(spec["x1"])}" y1="{_pct(spec["y1"])}" '
        f'x2="{_pct(spec["x2"])}" y2="{_pct(spec["y2"])}">{_stops_svg(spec["stops"])}</linearGradient>'
    )


def _radial_gradient_svg(gid: str, spec: dict) -> str:
    return (
        f'<radialGradient id="{gid}" cx="{_pct(spec["cx"])}" cy="{_pct(spec["cy"])}" '
        f'r="{_pct(spec["r"])}">{_stops_svg(spec["stops"])}</radialGradient>'
    )


def _grad_stops_with_mid(color_start: str, color_end: str, mid_stop: Optional[dict]) -> list[dict]:
    """Mirrors RankMedallion.tsx's gradStops(): start/end, or start/mid/end
    when a midStop percent+color is present (Lochagos/Prometheus/Heros/
    Zeus/Kratos's ring-out and collapse glows)."""
    if not mid_stop:
        return [{"offset": 0, "color": color_start}, {"offset": 1, "color": color_end}]
    return [
        {"offset": 0, "color": color_start},
        {"offset": mid_stop["pct"] / 100, "color": mid_stop["color"]},
        {"offset": 1, "color": color_end},
    ]


# ─── glyph ──────────────────────────────────────────────────────────────

def _glyph_shape_svg(shape: dict, pass_color: str) -> str:
    if shape["kind"] == "group":
        inner = "".join(_glyph_shape_svg(p, pass_color) for p in shape["parts"])
        return f'<g transform="{shape["transform"]}">{inner}</g>'

    color = shape.get("color", pass_color)
    fill = color if shape.get("fill") else "none"
    stroke_width = shape.get("strokeWidth")
    stroke = color if stroke_width is not None else "none"
    linecap = shape.get("strokeLinecap", "round")
    linejoin = shape.get("strokeLinejoin", "round")
    common = (
        f'fill="{fill}" stroke="{stroke}"'
        + _attr("stroke-width", stroke_width)
        + f' stroke-linecap="{linecap}" stroke-linejoin="{linejoin}"'
        + _attr("stroke-dasharray", shape.get("strokeDasharray"))
        + _attr("transform", shape.get("transform"))
    )
    if shape["kind"] == "path":
        return f'<path d="{shape["d"]}" {common}/>'
    if shape["kind"] == "circle":
        return f'<circle cx="{shape["cx"]}" cy="{shape["cy"]}" r="{shape["r"]}" {common}/>'
    if shape["kind"] == "rect":
        return (
            f'<rect x="{shape["x"]}" y="{shape["y"]}" width="{shape["width"]}" '
            f'height="{shape["height"]}"{_attr("rx", shape.get("rx"))} {common}/>'
        )
    if shape["kind"] == "ellipse":
        return f'<ellipse cx="{shape["cx"]}" cy="{shape["cy"]}" rx="{shape["rx"]}" ry="{shape["ry"]}" {common}/>'
    return ""


def _glyph_svg(glyph: dict) -> str:
    """The two-layer glyph, wrapped in the artifact's own centering
    transform (translate(60 60) scale(1.02) translate(-50 -50)) — see
    GlyphLayers in RankMedallion.tsx for why: the artifact draws every glyph
    in a 0-100 space and this maps it onto the 120x120 disc center."""
    highlight = "".join(_glyph_shape_svg(p, glyph["highlightColor"]) for p in glyph["parts"])
    main = "".join(_glyph_shape_svg(p, glyph["mainColor"]) for p in glyph["parts"])
    extras = "".join(_glyph_shape_svg(p, glyph["mainColor"]) for p in glyph.get("extras", []))
    return (
        '<g transform="translate(60 60) scale(1.02) translate(-50 -50)">'
        f'<g transform="translate(0 1.6)" opacity="{glyph["highlightOpacity"]}">{highlight}</g>'
        f"<g>{main}{extras}</g>"
        "</g>"
    )


# ─── decorations ────────────────────────────────────────────────────────

def _decoration_svg(dec: dict, clip_id: str) -> str:
    kind = dec["kind"]
    if kind == "circleGroup":
        circles = "".join(f'<circle cx="{c["cx"]}" cy="{c["cy"]}" r="{c["r"]}"/>' for c in dec["circles"])
        return f'<g fill="{dec["fill"]}"{_attr("opacity", dec.get("opacity"))}>{circles}</g>'
    if kind == "ring":
        return (
            f'<circle cx="{CX}" cy="{CY}" r="{dec["r"]}" fill="none" stroke="{dec["stroke"]}" '
            f'stroke-width="{dec["strokeWidth"]}"'
            + _attr("stroke-opacity", dec.get("strokeOpacity"))
            + _attr("stroke-dasharray", dec.get("strokeDasharray"))
            + _attr("stroke-dashoffset", dec.get("strokeDashoffset"))
            + "/>"
        )
    if kind == "path":
        attrs = (
            f'd="{dec["d"]}" fill="{dec.get("fill", "none")}"'
            + _attr("stroke", dec.get("stroke"))
            + _attr("stroke-width", dec.get("strokeWidth"))
            + _attr("stroke-opacity", dec.get("strokeOpacity"))
            + _attr("stroke-linecap", dec.get("strokeLinecap"))
            + _attr("stroke-linejoin", dec.get("strokeLinejoin"))
            + _attr("stroke-dasharray", dec.get("strokeDasharray"))
            + _attr("stroke-dashoffset", dec.get("strokeDashoffset"))
            + _attr("opacity", dec.get("opacity"))
        )
        clip = f' clip-path="url(#{clip_id})"' if dec.get("clipToFace") else ""
        return f"<path {attrs}{clip}/>"
    return ""


# ─── medallion disc (rim + face + decorations + glyph) ─────────────────

def _disc_svg(art: dict, uid: str) -> str:
    rim_id = f"{uid}-rim"
    face_id = f"{uid}-face"
    vig_id = f"{uid}-vig"
    clip_id = f"{uid}-clip"
    spec_ids = [f"{uid}-spec{i}" for i in range(len(art["face"]["speculars"]))]
    needs_clip = any(d["kind"] == "path" and d.get("clipToFace") for d in art["decorations"])

    rim_decos = [d for d in art["decorations"] if d["layer"] == "rim"]
    pre_vig_decos = [d for d in art["decorations"] if d["layer"] == "preVignette"]
    post_vig_decos = [d for d in art["decorations"] if d["layer"] == "postVignette"]

    speculars = art["face"]["speculars"]
    spec_before = [i for i, s in enumerate(speculars) if not s.get("afterVignette")]
    spec_after = [i for i, s in enumerate(speculars) if s.get("afterVignette")]

    defs = [
        _linear_gradient_svg(rim_id, art["rim"]["gradient"]),
        _radial_gradient_svg(face_id, art["face"]["gradient"]),
    ]
    for i, spec in enumerate(speculars):
        defs.append(_radial_gradient_svg(spec_ids[i], spec))
    defs.append(_radial_gradient_svg(vig_id, art["face"]["vignette"]))
    if needs_clip:
        defs.append(f'<clipPath id="{clip_id}"><circle cx="{CX}" cy="{CY}" r="{art["face"]["r"]}"/></clipPath>')

    rim = art["rim"]
    if rim["kind"] == "polygon":
        rim_svg = (
            f'<path d="{rim["d"]}" fill="url(#{rim_id})" stroke="{rim["stroke"]}" '
            f'stroke-opacity="{rim["strokeOpacity"]}" stroke-width="{rim["strokeWidth"]}" stroke-linejoin="round"/>'
        )
    else:
        rim_svg = (
            f'<circle cx="{CX}" cy="{CY}" r="{rim["r"]}" fill="url(#{rim_id})" stroke="{rim["stroke"]}" '
            f'stroke-opacity="{rim["strokeOpacity"]}" stroke-width="{rim["strokeWidth"]}"/>'
        )

    def spec_circle(i: int) -> str:
        paint_r = speculars[i].get("paintR", art["face"]["r"])
        return f'<circle cx="{CX}" cy="{CY}" r="{paint_r}" fill="url(#{spec_ids[i]})"/>'

    pieces = [
        f'<defs>{"".join(defs)}</defs>',
        rim_svg,
        *[_decoration_svg(d, clip_id) for d in rim_decos],
        f'<circle cx="{CX}" cy="{CY}" r="{art["face"]["r"]}" fill="url(#{face_id})"/>',
        *[spec_circle(i) for i in spec_before],
        *[_decoration_svg(d, clip_id) for d in pre_vig_decos],
        f'<circle cx="{CX}" cy="{CY}" r="{art["face"]["r"]}" fill="url(#{vig_id})"/>',
        *[spec_circle(i) for i in spec_after],
        *[_decoration_svg(d, clip_id) for d in post_vig_decos],
        _glyph_svg(art["glyph"]),
    ]
    return "".join(pieces)


# ─── aura (static rest pose — mirrors RankMedallion.tsx's reduceMotion
# fallback for every layer kind) ────────────────────────────────────────

def _aura_ground_shadow_svg(layer: dict, uid: str) -> str:
    gid = f"{uid}-ground"
    opacity = layer.get("opacity", 0.55) / 0.55
    return (
        f'<defs><radialGradient id="{gid}" cx="50%" cy="50%" r="50%">'
        '<stop offset="0" stop-color="rgba(0,0,0,0.55)"/>'
        '<stop offset="0.7" stop-color="rgba(0,0,0,0)"/>'
        "</radialGradient></defs>"
        f'<ellipse cx="95" cy="169" rx="56" ry="9" fill="url(#{gid})" opacity="{opacity}"/>'
    )


def _aura_glow_svg(layer: dict, uid: str, idx: int) -> str:
    gid = f"{uid}-a{idx}"
    stops = _grad_stops_with_mid(layer["colorStart"], layer["colorEnd"], layer.get("midStop"))
    stops_svg = "".join(f'<stop offset="{s["offset"]}" stop-color="{s["color"]}"/>' for s in stops)
    cx = (layer["cxPct"] / 100) * 190
    cy = (layer["cyPct"] / 100) * 190
    rx = (layer["rxPct"] / 100) * 190
    ry = (layer["ryPct"] / 100) * 190
    return (
        f'<defs><radialGradient id="{gid}" cx="50%" cy="50%" r="50%">{stops_svg}</radialGradient></defs>'
        f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#{gid})"/>'
    )


def _aura_speckle_svg(layer: dict) -> str:
    opacity = min(0.25, layer["dotOpacity"] * 0.4)
    return f'<circle cx="95" cy="95" r="80" fill="{layer["dotColor"]}" opacity="{opacity}"/>'


def _aura_icon_svg(layer: dict) -> str:
    x = (layer["leftPct"] / 100) * 190
    y = (layer["topPct"] / 100) * 190
    scale = layer["sizePx"] / layer["viewBox"]
    return (
        f'<g transform="translate({x} {y}) scale({scale})">'
        f'<path d="{layer["d"]}" fill="{layer.get("fill", "none")}"'
        + _attr("stroke", layer.get("stroke"))
        + _attr("stroke-width", layer.get("strokeWidth"))
        + ' stroke-linecap="round"/></g>'
    )


def _aura_sweep_svg(layer: dict, uid: str) -> str:
    """Static rest pose: RankMedallion.tsx's SweepLayer holds the band
    centered (x=0) when reduce-motion is active — the bright diagonal stripe
    crosses the disc statically rather than sweeping."""
    clip_id = f"{uid}-sweepclip"
    grad_id = f"{uid}-sweepgrad"
    return (
        f'<defs><clipPath id="{clip_id}"><circle cx="95" cy="95" r="62"/></clipPath>'
        f'<linearGradient id="{grad_id}" x1="0" y1="0.15" x2="1" y2="0.85">'
        f'<stop offset="0.35" stop-color="{layer["color"]}" stop-opacity="0"/>'
        f'<stop offset="0.5" stop-color="{layer["color"]}" stop-opacity="0.5"/>'
        f'<stop offset="0.65" stop-color="{layer["color"]}" stop-opacity="0"/>'
        "</linearGradient></defs>"
        f'<g clip-path="url(#{clip_id})"><rect x="0" y="0" width="190" height="190" fill="url(#{grad_id})"/></g>'
    )


def _aura_orbit_ring_svg(layer: dict) -> str:
    if "rx" in layer and "ry" in layer:
        rotate = f' transform="rotate({layer["rotateDeg"]} 100 100)"' if layer.get("rotateDeg") else ""
        shape = (
            f'<ellipse cx="100" cy="100" rx="{layer["rx"]}" ry="{layer["ry"]}" fill="none" '
            f'stroke="{layer["stroke"]}" stroke-opacity="{layer["strokeOpacity"]}" '
            f'stroke-width="{layer["strokeWidth"]}"{rotate}/>'
        )
    else:
        shape = (
            f'<circle cx="100" cy="100" r="{layer["r"]}" fill="none" stroke="{layer["stroke"]}" '
            f'stroke-opacity="{layer["strokeOpacity"]}" stroke-width="{layer["strokeWidth"]}"'
            + _attr("stroke-dasharray", layer.get("dasharray"))
            + "/>"
        )
    moon = ""
    if layer.get("moon"):
        m = layer["moon"]
        moon = f'<circle cx="{m["cx"]}" cy="{m["cy"]}" r="{m["r"]}" fill="{m["color"]}"/>'
    return f'<g opacity="{layer.get("groupOpacity", 1)}">{shape}{moon}</g>'


def _aura_prism_blobs_svg(layer: dict, uid: str) -> str:
    defs = []
    circles = []
    for j, color in enumerate(layer["colors"]):
        gid = f"{uid}-pr{j}"
        defs.append(
            f'<radialGradient id="{gid}" cx="50%" cy="50%" r="50%">'
            f'<stop offset="0" stop-color="{color}" stop-opacity="0.5"/>'
            f'<stop offset="1" stop-color="{color}" stop-opacity="0"/>'
            "</radialGradient>"
        )
        cx, cy = _PRISM_CENTERS[j % len(_PRISM_CENTERS)]
        circles.append(f'<circle cx="{cx}" cy="{cy}" r="30" fill="url(#{gid})"/>')
    return f'<defs>{"".join(defs)}</defs>{"".join(circles)}'


def _aura_debris_svg(layer: dict) -> str:
    dots = "".join(f'<circle cx="{d["cx"]}" cy="{d["cy"]}" r="{d["r"]}"/>' for d in layer["dots"])
    return f'<g fill="{layer["color"]}" opacity="{layer["opacity"]}">{dots}</g>'


def _aura_ray_burst_svg(layer: dict) -> str:
    rays = "".join(f'<path d="{d}"/>' for d in layer["rays"])
    return (
        f'<g stroke="{layer["stroke"]}" stroke-opacity="{layer["strokeOpacity"]}" '
        f'stroke-width="{layer["strokeWidth"]}" stroke-linecap="round">{rays}</g>'
    )


def _aura_lightning_svg(layer: dict) -> str:
    """Every bolt drawn at full strength — RankMedallion.tsx gives each bolt
    its own independent boltFlash driver; the reduce-motion fallback (this
    module's only mode) renders each bolt's static children unmodified, i.e.
    ALL bolts visible at once, which is the faithful "resting"/still capture
    of a field that's normally flickering one-at-a-time."""
    pieces = []
    for bolt in layer["bolts"]:
        if bolt.get("hasGlow"):
            pieces.append(
                f'<path d="{bolt["d"]}" stroke="{layer["colorGlow"]}" stroke-opacity="{layer["glowOpacity"]}" '
                f'stroke-width="{layer["glowWidth"]}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
            )
        pieces.append(
            f'<path d="{bolt["d"]}" stroke="{layer["colorCore"]}" stroke-width="{bolt["coreWidth"]}" '
            'fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
        )
    return "".join(pieces)


def _aura_svg(art: dict, uid: str, aura_size: float) -> str:
    """Assembles the aura stack behind the disc, in the artifact's own draw
    order: sweep(s) first, then the 190-space layers (groundShadow/glow/
    speckleField/icon) in their original array order, then the 200-space
    layers (orbitRing/prismBlobs/lightning/debris/rayBurst) in original array
    order — exactly AuraLayers' three passes in RankMedallion.tsx, just
    without the Animated.View wrappers."""
    aura = art["aura"]
    box190_kinds = {"groundShadow", "glow", "speckleField", "icon"}
    box200_kinds = {"orbitRing", "prismBlobs", "lightning", "debris", "rayBurst"}

    sweeps = [a for a in aura if a["kind"] == "sweep"]
    box190 = [a for a in aura if a["kind"] in box190_kinds]
    box200 = [a for a in aura if a["kind"] in box200_kinds]

    def nested(viewbox: int, inner: str) -> str:
        return (
            f'<svg x="0" y="0" width="{aura_size}" height="{aura_size}" '
            f'viewBox="0 0 {viewbox} {viewbox}">{inner}</svg>'
        )

    out = []
    for layer in sweeps:
        out.append(nested(190, _aura_sweep_svg(layer, uid)))

    inner190 = []
    for i, layer in enumerate(aura):
        if layer["kind"] == "groundShadow":
            inner190.append(_aura_ground_shadow_svg(layer, uid))
        elif layer["kind"] == "glow":
            inner190.append(_aura_glow_svg(layer, uid, i))
        elif layer["kind"] == "speckleField":
            inner190.append(_aura_speckle_svg(layer))
        elif layer["kind"] == "icon":
            inner190.append(_aura_icon_svg(layer))
    if inner190:
        out.append(nested(190, "".join(inner190)))

    inner200 = []
    for layer in box200:
        if layer["kind"] == "orbitRing":
            inner200.append(_aura_orbit_ring_svg(layer))
        elif layer["kind"] == "prismBlobs":
            inner200.append(_aura_prism_blobs_svg(layer, uid))
        elif layer["kind"] == "debris":
            inner200.append(_aura_debris_svg(layer))
        elif layer["kind"] == "rayBurst":
            inner200.append(_aura_ray_burst_svg(layer))
        elif layer["kind"] == "lightning":
            inner200.append(_aura_lightning_svg(layer))
    if inner200:
        out.append(nested(200, "".join(inner200)))

    return "".join(out)


# ─── public API ─────────────────────────────────────────────────────────

def medallion_svg(tier_index: int, size: int = 132) -> str:
    """MEDALLION_ART[tier_index] (0=Initiate .. 20=Kratos) -> a standalone
    <svg> string: static aura behind a faithful disc+glyph render. Pure
    function, no I/O — safe to call for all 21 tiers on every page load.

    Gradient/clip ids are namespaced `m{tier_index}-...` so 21 calls' <defs>
    never collide when embedded on the same page (mirrors RankMedallion.tsx's
    per-instance useId(), just keyed on tier index instead of a React id
    since callers render one medallion per tier here, never the same tier
    twice on one page).
    """
    art = MEDALLION_ART[tier_index]
    uid = f"m{tier_index}"
    aura_size = size * (AURA_BOX / MEDALLION_PX)
    disc_offset = (aura_size - size) / 2

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{aura_size}" height="{aura_size}" viewBox="0 0 {aura_size} {aura_size}">'
        f'<title>{art["material"]}</title>'
        f"{_aura_svg(art, uid, aura_size)}"
        f'<svg x="{disc_offset}" y="{disc_offset}" width="{size}" height="{size}" viewBox="0 0 {VIEW} {VIEW}">'
        f"{_disc_svg(art, uid)}"
        "</svg>"
        "</svg>"
    )


def medallion_data_uri(tier_index: int, size: int = 132) -> str:
    """tier_index -> a data: URI Dash's html.Img can render directly.
    Same base64-SVG-in-<img> pattern app.py's body_svg_data_uri uses for
    bodymap.build_body_svg (plotly has no native SVG output type of its own)."""
    svg = medallion_svg(tier_index, size)
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"
