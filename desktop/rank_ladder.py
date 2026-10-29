# Rank ladder config — pure data, no logic. Python port of
# `app/src/rank/rankLadder.ts`, mirrored 1:1 (same values, same order). See
# RANK_SYSTEM_SPEC.md §1/§8 and the approved implementation brief. 20 named
# divisioned tiers (III/II/I, low->high) + Kratos as a single un-divisioned
# apex tier. Consumed by `./rank_engine.py`; do not hardcode tier
# names/thresholds anywhere else.
from __future__ import annotations

# Flat XP cost of one division, uniform across the whole ladder. Tunable.
XP_PER_DIVISION = 150

# Session XP gain, tunable. `session_xp = SESSION_BASE + PER_SET *
# min(working_sets, SETS_CAP)`; a cardio session earns SESSION_BASE only (no
# working-set count applies to it). Sized for a roughly 2-year perfect-run
# climb to Kratos.
XP_GAIN = {
    "SESSION_BASE": 6,
    "PER_SET": 2,
    "SETS_CAP": 8,
}

# 21 entries: 20 divisioned tiers (indices 0..19) + Kratos apex (index 20).
# Order is the climb order, low to high. Bellerophon sits at position 16
# (between Perseus and Achilles) per the approved brief -- the spec's §8
# table predates that insertion. `apex` is True only for the final,
# un-divisioned apex entry (Kratos); every other tier carries `apex: False`
# so callers never need a `.get("apex", False)` special case.
TIERS = [
    {"name": "Initiate", "copy": "You have picked up the spear.", "apex": False},
    {"name": "Ephebe", "copy": "Sworn in, not yet tested.", "apex": False},
    {"name": "Peltast", "copy": "Fast, light, expendable.", "apex": False},
    {"name": "Hoplite", "copy": "A soldier of the line.", "apex": False},
    {"name": "Phalangite", "copy": "You are not one man. You are the wall.", "apex": False},
    {"name": "Lochagos", "copy": "First command.", "apex": False},
    {"name": "Myrmidon", "copy": "Elite of the phalanx.", "apex": False},
    {"name": "Aristos", "copy": "The best of them.", "apex": False},
    {"name": "Heros", "copy": "A hero — still nameless.", "apex": False},
    {"name": "Sisyphus", "copy": "The set that never ends.", "apex": False},
    {"name": "Prometheus", "copy": "You pay for what you give.", "apex": False},
    {"name": "Atlas", "copy": "Elder, world-holding power.", "apex": False},
    {"name": "Odysseus", "copy": "Ten years. You got home.", "apex": False},
    {"name": "Theseus", "copy": "You went in and came out.", "apex": False},
    {"name": "Perseus", "copy": "You beat what could not be beaten.", "apex": False},
    {"name": "Bellerophon", "copy": "You bridled the sky.", "apex": False},
    {"name": "Achilles", "copy": "Glory over long life.", "apex": False},
    {"name": "Heracles", "copy": "The labors are finished.", "apex": False},
    {"name": "Zeus", "copy": "You dine on Olympus.", "apex": False},
    {"name": "Nike", "copy": "Victory itself.", "apex": False},
    {"name": "Kratos", "copy": "Strength itself.", "apex": True},
]
