# Smoke tests for medallions.py — mirrors the plain-assert-per-behavior style
# of the other desktop test files, kept tiny since the real fidelity check is
# visual (every value is a verbatim JSON dump of medallionArt.ts, itself
# checked against the HTML artifact — see medallions.py's own header).
from __future__ import annotations

import base64

import medallions


def test_all_21_tiers_render():
    assert len(medallions.MEDALLION_ART) == 21
    for i in range(21):
        svg = medallions.medallion_svg(i)
        assert svg.startswith("<svg")
        assert svg.strip().endswith("</svg>")
        assert "<defs>" in svg  # every tier has at least the rim/face gradients


def test_ids_are_namespaced_per_tier():
    # Two different tiers' gradient ids must never collide if both are
    # embedded on the same page (the whole point of the m{tier_index}-...
    # prefix — see medallion_svg's docstring).
    svg0 = medallions.medallion_svg(0)
    svg1 = medallions.medallion_svg(1)
    assert 'id="m0-rim"' in svg0
    assert 'id="m1-rim"' in svg1
    assert 'id="m1-rim"' not in svg0


def test_custom_size_scales_disc_and_aura_box():
    small = medallions.medallion_svg(5, size=66)
    large = medallions.medallion_svg(5, size=132)
    assert 'width="66"' in small
    assert 'width="132"' in large


def test_data_uri_round_trips_to_the_same_svg():
    svg = medallions.medallion_svg(14)
    uri = medallions.medallion_data_uri(14)
    assert uri.startswith("data:image/svg+xml;base64,")
    encoded = uri.split(",", 1)[1]
    assert base64.b64decode(encoded).decode("utf-8") == svg


def test_kratos_polygon_rim_and_clip_present():
    # Tier 20 (Kratos) is the one tier with both a faceted polygon rim (not
    # the plain r=56 circle every metal/precious tier uses) and a clipToFace
    # decoration (the blood streak), so it exercises both branches other
    # tiers don't.
    svg = medallions.medallion_svg(20)
    assert "<clipPath" in svg
    assert "M110.7 60.0" in svg  # first rim coordinate, verbatim from the artifact
