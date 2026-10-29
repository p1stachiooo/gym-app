#!/usr/bin/env python3
"""Phase 4 + 7 + Stage 4 — export the `workouts` collection to CSV for the
chart tool.

Reads every set from Cloud Firestore (via the Admin SDK, which bypasses the
security rules) and writes them in the LOCKED data-contract column order
(muscle column locked 2026-07-02; kind/duration added Stage 4; pattern
appended Phase 14):

    date,session,exercise,primary_muscle,kind,weight,reps,set,duration,pattern

`primary_muscle` is NOT stored on set docs — sets stamp only the exercise name,
and the muscle is resolved here at read time via the Phase 7 `exercises`
registry (the entry whose role is "primary"). Re-tagging an exercise in the app
therefore retroactively fixes every exported row. Sets whose exercise isn't in
the registry get an empty muscle cell plus a stderr warning (the row itself is
kept — the set data is still valid). `pattern` (Phase 14) is resolved the same
way: it lives on the exercise's registry doc (Push/Pull/Squat/Hinge/Carry/
Core/Isolation/Cardio), never on the set doc, so re-tagging retroactively
fixes exports; an unregistered or untagged exercise gets an empty pattern
cell (no warning — pattern is an optional analytics axis, unlike muscle).

Cardio (see phase9-xp-spec.md's Cardio note): a doc with `kind: "cardio"` is
logged by DURATION, not weight×reps, so it carries no weight/reps/set. Such
rows are exported (never dropped) with `kind=cardio`, `duration=<minutes>`,
and blank weight/reps/set cells; strength rows get `kind=strength` (a missing
`kind` on the doc means "strength", for back-compat with pre-Stage-1 docs) and
a blank duration cell. Cardio rows resolve `pattern` through the registry
exactly like strength rows (a tagged cardio exercise exports "Cardio" — no
special-casing). The chart tool is expected to filter on `kind` for any
strength-only computation (volume, PRs, progression) the same way the XP
engine does — a cardio row's blank weight/reps must never be coerced into 0
and silently counted as a lift.

Column order and the `YYYY-MM-DD` date format mirror `app/src/schema.ts` — keep
the two in sync by hand (see ARCHITECTURE.md, "The data contract"). This script
is the only place that reads the schema on the pull side.

Usage (from anywhere; paths resolve relative to this file):
    python pull.py                          # all sets -> workouts.csv
    python pull.py --out lifts.csv          # custom output path
    python pull.py --from 2026-01-01        # only sets on/after this date
    python pull.py --from 2026-01-01 --to 2026-06-30
    python pull.py --key /path/to/key.json  # override service-account key

Design notes:
- Sets are fetched ordered by the server timestamp `ts` (chronological). A
  single-field index is automatic, so no composite index is needed.
- The optional --from/--to date bounds (inclusive) are applied client-side on
  the `date` field. That deliberately avoids a Firestore composite-index
  requirement; a personal dataset is tiny, so filtering in Python is free.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Optional

import firebase_admin
from firebase_admin import credentials, firestore

HERE = Path(__file__).resolve().parent
DEFAULT_KEY = HERE / "serviceAccountKey.json"
DEFAULT_OUT = HERE / "workouts.csv"

# The locked contract. Order matters — it is what the chart tool eats.
# `primary_muscle` is derived via the registry, not read off the set doc.
# `kind`/`duration` (Stage 4): every row carries a `kind`; strength rows leave
# `duration` blank and cardio rows leave weight/reps/set blank — never 0,
# which would be indistinguishable from a real zero-weight/zero-rep set.
# `pattern` (Phase 14): registry-derived like primary_muscle, blank for
# unregistered/untagged exercises. APPENDED as the last column so existing
# positional consumers of the earlier columns keep working unchanged.
IDENTITY_COLUMNS = ["date", "session", "exercise"]
STRENGTH_COLUMNS = ["weight", "reps", "set"]
CSV_COLUMNS = ["date", "session", "exercise", "primary_muscle", "kind", "weight", "reps", "set", "duration", "pattern"]


def _row_kind(d: dict) -> str:
    """A missing/non-"cardio" `kind` on the doc means "strength" — back-compat
    with every doc written before Stage 1 added the field."""
    return "cardio" if d.get("kind") == "cardio" else "strength"


def _is_finite_number(v: object) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def missing_fields(d: dict) -> list[str]:
    """Kind-aware validation: identity fields are required regardless of
    kind; a cardio doc additionally needs a finite `duration`, a strength doc
    additionally needs weight/reps/set. Returns the list of missing/invalid
    field names (empty == valid)."""
    missing = [c for c in IDENTITY_COLUMNS if d.get(c) is None]
    if missing:
        return missing
    if _row_kind(d) == "cardio":
        if not _is_finite_number(d.get("duration")):
            return ["duration"]
        return []
    return [c for c in STRENGTH_COLUMNS if d.get(c) is None]


def build_row(d: dict, muscles: dict[tuple[str, str], str], patterns: dict[tuple[str, str], str]) -> Optional[dict]:
    """One Firestore `workouts` doc dict -> a CSV row dict, or None if the
    doc fails `missing_fields`. `muscles` is `load_muscle_lookup`'s output;
    `patterns` is `load_pattern_lookup`'s (unknown/untagged -> "")."""
    if missing_fields(d):
        return None
    kind = _row_kind(d)
    primary = muscles.get((d.get("uid", ""), str(d["exercise"]).lower()), "")
    return {
        "date": d["date"],
        "session": d["session"],
        "exercise": d["exercise"],
        "primary_muscle": primary,
        "kind": kind,
        "weight": "" if kind == "cardio" else d["weight"],
        "reps": "" if kind == "cardio" else d["reps"],
        "set": "" if kind == "cardio" else d["set"],
        "duration": d["duration"] if kind == "cardio" else "",
        "pattern": patterns.get((d.get("uid", ""), str(d["exercise"]).lower()), ""),
    }


def load_muscle_lookup(db) -> dict[tuple[str, str], str]:
    """Map (uid, lowercased exercise name) -> primary muscle-group name.

    Keyed per-uid because the registry is per-account; lowercased so pulls are
    tolerant of casing drift between logged sets and registry entries.
    """
    lookup: dict[tuple[str, str], str] = {}
    for doc in db.collection("exercises").stream():
        d = doc.to_dict() or {}
        uid, name = d.get("uid"), d.get("name")
        if not uid or not name:
            continue
        primary = next(
            (m.get("group") for m in d.get("muscles", []) if m.get("role") == "primary"),
            None,
        )
        if primary:
            lookup[(uid, name.lower())] = primary
    return lookup


def load_pattern_lookup(db) -> dict[tuple[str, str], str]:
    """Map (uid, lowercased exercise name) -> movement pattern (Phase 14).

    Keyed per-uid because the registry is per-account; lowercased so pulls are
    tolerant of casing drift between logged sets and registry entries.
    """
    lookup: dict[tuple[str, str], str] = {}
    for doc in db.collection("exercises").stream():
        d = doc.to_dict() or {}
        uid, name = d.get("uid"), d.get("name")
        if not uid or not name:
            continue
        pattern = d.get("pattern")
        if pattern:
            lookup[(uid, name.lower())] = pattern
    return lookup


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export Firestore workouts to CSV.")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT,
                   help=f"output CSV path (default: {DEFAULT_OUT.name} beside this script)")
    p.add_argument("--key", type=Path, default=DEFAULT_KEY,
                   help="service-account key JSON (default: serviceAccountKey.json here)")
    p.add_argument("--from", dest="date_from", metavar="YYYY-MM-DD",
                   help="only include sets with date >= this (inclusive)")
    p.add_argument("--to", dest="date_to", metavar="YYYY-MM-DD",
                   help="only include sets with date <= this (inclusive)")
    return p.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    if not args.key.exists():
        print(f"error: service-account key not found: {args.key}\n"
              "       (Firebase console -> Project settings -> Service accounts "
              "-> Generate new private key, save it there)", file=sys.stderr)
        return 2

    cred = credentials.Certificate(str(args.key))
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    muscles = load_muscle_lookup(db)
    patterns = load_pattern_lookup(db)
    docs = db.collection("workouts").order_by("ts").stream()

    rows: list[list[object]] = []
    skipped = 0
    unresolved: set[str] = set()
    for doc in docs:
        d = doc.to_dict() or {}
        # Client-side date bounds (see module docstring).
        date = d.get("date")
        if args.date_from and (date is None or date < args.date_from):
            continue
        if args.date_to and (date is None or date > args.date_to):
            continue
        # Defensive: a malformed doc missing a contract field is reported, not
        # silently written as blanks that would corrupt the chart input.
        # Kind-aware (Stage 4, see missing_fields): a cardio doc is never
        # skipped for lacking weight/reps/set, nor a strength doc for lacking
        # duration.
        bad = missing_fields(d)
        if bad:
            print(f"warning: skipping {doc.id} — missing {bad}", file=sys.stderr)
            skipped += 1
            continue
        if not muscles.get((d.get("uid", ""), str(d["exercise"]).lower())):
            unresolved.add(str(d["exercise"]))
        row = build_row(d, muscles, patterns)
        rows.append([row[c] for c in CSV_COLUMNS])

    for name in sorted(unresolved):
        print(f"warning: exercise not in registry (blank muscle): {name!r}",
              file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_COLUMNS)
        writer.writerows(rows)

    note = f" ({skipped} skipped)" if skipped else ""
    print(f"wrote {len(rows)} sets -> {args.out}{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
