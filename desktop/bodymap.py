# Phase 12 (desktop parity) — muscle-group body map, rendered server-side as
# an SVG string (react-native-body-highlighter, the library the phone app
# uses, is RN-only — Dash just needs a static <img>).
#
# This module mirrors two things on the phone side, values copied verbatim
# so the two apps agree pixel-for-pixel:
#   - app/src/muscleMap.ts: GROUP_TO_SLUGS, the COLORS cold->hot ramp,
#     NEGLECTED, and the colorForLevel/getMaxLevel bucketing logic.
#   - react-native-body-highlighter@3.2.0's male body-part SVG path data
#     (dist/assets/bodyFront.js + bodyBack.js). Ported, not hand-transcribed:
#     body_paths.json next to this file is a straight `JSON.stringify` dump
#     of those two modules' exported arrays (see the `node -e` one-liner in
#     the Phase 12 desktop-parity notes), trimmed to just {slug, path} —
#     the library's own per-part `color` field is dropped since we supply
#     our own fill per slug. All 19 front-figure slugs and 16 back-figure
#     slugs the library ships are included (not just our 17 tracked
#     groups), so the figure silhouette matches the phone 1:1 instead of
#     leaving gaps for hands/feet/head/etc.
#
# No Firestore/Dash imports: build_body_svg() is a pure function of
# compute_progress()'s `perGroup`, exactly like BodyScreen.tsx on the phone
# only ever reads `progress.perGroup`.
from __future__ import annotations

import json
import math
from pathlib import Path

import theme

_PATHS_FILE = Path(__file__).resolve().parent / "body_paths.json"
_BODY_PATHS = json.loads(_PATHS_FILE.read_text(encoding="utf-8"))
FRONT_PARTS: list[dict] = _BODY_PATHS["front"]
BACK_PARTS: list[dict] = _BODY_PATHS["back"]

# The library's SvgMaleWrapper viewBoxes: front is "0 0 724 1448", back is
# "724 0 724 1448" — bodyBack.js's own path coordinates are already offset
# into that right half, so front + back paths drop into one shared
# "0 0 1448 1448" canvas with no extra translation needed.
FIGURE_W = 724
FIGURE_H = 1448
CANVAS_W = FIGURE_W * 2
CANVAS_H = FIGURE_H

# ─── §1 group -> slug mapping — verbatim copy of muscleMap.ts's
# GROUP_TO_SLUGS (our 17 Phase-14 registry group names -> the library's slugs).
GROUP_TO_SLUGS: dict[str, list[str]] = {
    "Chest": ["chest"],
    "Biceps": ["biceps"],
    "Triceps": ["triceps"],
    "Shoulders": ["deltoids"],
    "Traps": ["trapezius"],
    # The Phase-14 back split. The library has no distinct lats slug, so Lats
    # deliberately collides with Upper Back on "upper-back": whichever is
    # higher wins, per _slug_levels' max-aggregation (same trick as Cardio).
    "Lats": ["upper-back"],
    "Upper Back": ["upper-back"],
    "Lower Back": ["lower-back"],
    "Core": ["abs", "obliques"],
    "Glutes": ["gluteal"],
    # Hip adductors get their own slug; there is no abductor/glute-medius
    # slug, so Abductors deliberately collides with Glutes on "gluteal" —
    # again resolved by _slug_levels' max-aggregation.
    "Adductors": ["adductors"],
    "Abductors": ["gluteal"],
    "Hamstrings": ["hamstring"],
    "Quads": ["quadriceps"],
    "Calves": ["calves"],
    "Forearms": ["forearm"],
    # Cardio counts consistency-only (no strength progression/volume — see
    # the §Cardio note in progress.py), but should still visually light up
    # the body map. It deliberately collides with the leg-strength groups
    # above (Quads/Hamstrings/Calves/Glutes all target the same 4 slugs):
    # whichever is higher wins, per build_body_svg's max-aggregation.
    "Cardio": ["quadriceps", "hamstring", "calves", "gluteal"],
}

# Reverse lookup for fill resolution below (mirrors muscleMap.ts's
# SLUG_TO_GROUP / groupForSlug).
SLUG_TO_GROUP: dict[str, str] = {
    slug: group for group, slugs in GROUP_TO_SLUGS.items() for slug in slugs
}

# ─── §2 cold -> hot palette — verbatim copy of muscleMap.ts's COLORS. The
# middle "theme go emerald" entry there is `colors.accent` (#34D399); pinned
# here as a literal since desktop's theme.py doesn't share that token.
COLORS: list[str] = [
    "#3E7CB8",  # cold — barely-trained
    "#2FAF97",  # cool-to-warm midpoint
    "#34D399",  # theme "go" emerald (app/src/theme.ts colors.accent)
    "#F2C84C",  # warming
    "#F2954A",  # hot — well-trained
]

# Untrained (level 0). Mirrors muscleMap.ts's NEGLECTED (there: colors.line2,
# "present but dormant"); theme.py's closest equivalent hairline/baseline
# tone is AXIS_LINE.
NEGLECTED = theme.AXIS_LINE

# Fallback fill for slugs the library renders that aren't one of our 17
# groups (hands, feet, head, neck, hair, knees, tibialis, ankles) — kept
# muted so they recede behind the trained/neglected groups, same intent as
# muscleMap.ts's UNMAPPED_FILL (there: colors.raised).
UNMAPPED_FILL = theme.GRID

# Stroke between adjacent body-part fills — matches the phone's
# defaultStroke={colors.line}/defaultStrokeWidth={1} (BodyScreen.tsx).
STROKE = theme.BORDER
STROKE_WIDTH = "1"


def get_max_level(per_group: dict) -> int:
    """Highest level among the groups actually present in perGroup (>=1 so a
    single trained group always buckets into the hottest color). Mirrors
    muscleMap.ts's getMaxLevel."""
    max_level = 1
    for g in per_group.values():
        level = g.get("level", 0)
        if level > max_level:
            max_level = level
    return max_level


def color_for_level(level: int, max_level: int) -> str:
    """Bucket a group's level onto the COLORS ramp, scaled relative to this
    trainee's own highest-level group. Mirrors muscleMap.ts's
    colorForLevel exactly (same clip/ceil/index math)."""
    if level <= 0:
        return NEGLECTED
    denom = max(1, max_level)
    ratio = max(0.0, min(1.0, level / denom))
    idx = max(0, min(len(COLORS) - 1, math.ceil(ratio * len(COLORS)) - 1))
    return COLORS[idx]


def _slug_levels(per_group: dict) -> dict[str, int]:
    """Aggregate perGroup down to slug -> MAX level among all groups that
    map to that slug. Several groups can map to the same slug (Cardio
    deliberately collides with the leg-strength groups — see
    GROUP_TO_SLUGS), so this takes the max per slug rather than letting
    whichever group is processed last silently win. Slugs with a single
    contributing group resolve to exactly that group's level, as before.
    Mirrors muscleMap.ts's buildBodyData aggregation."""
    # Must record every slug even when its level is 0 (all-zero contributors
    # still resolve to NEGLECTED via _slug_fill's default) — `slug not in
    # levels` is the "first time we've seen this slug" case, distinct from
    # "we've seen it and its running max is 0". (_slug_fill's own
    # `.get(slug, 0)` happens to mask this either way since every slug it
    # queries comes from body_paths.json rather than this dict's keys, but
    # keeping the two languages' aggregation logic identical is the point.)
    levels: dict[str, int] = {}
    for group, slugs in GROUP_TO_SLUGS.items():
        level = per_group.get(group, {}).get("level", 0)
        for slug in slugs:
            if slug not in levels or level > levels[slug]:
                levels[slug] = level
    return levels


def _slug_fill(slug: str, slug_levels: dict[str, int], max_level: int) -> str:
    if slug not in SLUG_TO_GROUP:
        return UNMAPPED_FILL
    level = slug_levels.get(slug, 0)
    return color_for_level(level, max_level)


def _render_parts(parts: list[dict], slug_levels: dict[str, int], max_level: int) -> str:
    pieces = []
    for part in parts:
        fill = _slug_fill(part["slug"], slug_levels, max_level)
        path = part.get("path", {})
        ds = [*path.get("common", []), *path.get("left", []), *path.get("right", [])]
        for d in ds:
            pieces.append(
                f'<path d="{d}" fill="{fill}" stroke="{STROKE}" stroke-width="{STROKE_WIDTH}"/>'
            )
    return "".join(pieces)


def build_body_svg(per_group: dict) -> str:
    """perGroup (Phase 9's compute_progress()["perGroup"]) -> a standalone
    SVG string with front + back male figures side by side, each body part
    tinted by its group's LEVEL (neglected/muted for untracked/untrained
    parts). Pure function, no I/O — safe to call every callback tick."""
    max_level = get_max_level(per_group)
    slug_levels = _slug_levels(per_group)
    front_svg = _render_parts(FRONT_PARTS, slug_levels, max_level)
    back_svg = _render_parts(BACK_PARTS, slug_levels, max_level)

    # theme.FONT_FAMILY has embedded double quotes (e.g. "Segoe UI") — swap
    # for single quotes so it's safe inside this double-quoted XML attribute
    # (SVG/CSS both accept either quote style for a font-family name).
    font_family_attr = theme.FONT_FAMILY.replace('"', "'")
    label_y = -22
    label_attrs = (
        f'font-family="{font_family_attr}" font-size="30" font-weight="600" '
        f'letter-spacing="3" fill="{theme.INK_MUTED}" text-anchor="middle"'
    )

    view_y_pad = 70
    view_box = f"0 -{view_y_pad} {CANVAS_W} {CANVAS_H + view_y_pad}"

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{view_box}" width="820" height="{860}">'
        f'<rect x="0" y="-{view_y_pad}" width="{CANVAS_W}" height="{CANVAS_H + view_y_pad}" '
        f'fill="{theme.BG_PAGE}"/>'
        f'<text x="{FIGURE_W // 2}" y="{label_y}" {label_attrs}>FRONT</text>'
        f'<text x="{FIGURE_W + FIGURE_W // 2}" y="{label_y}" {label_attrs}>BACK</text>'
        f"<g>{front_svg}</g>"
        f"<g>{back_svg}</g>"
        "</svg>"
    )
