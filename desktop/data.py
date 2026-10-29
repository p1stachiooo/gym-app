# Phase 8 + Stage 4 — Firestore -> pandas DataFrames, plus the JSON round trip
# used to stash loaded data in a dcc.Store (see app.py). Mirrors pull.py's
# defensiveness: a malformed doc is skipped with a stderr warning, never a
# crash of the whole load. Muscle resolution itself is NOT done here — this
# module only fetches the three raw collections; metrics.py resolves sets
# against the registry at read time (see its expand_muscle_credits).
#
# Cardio (see phase9-xp-spec.md's Cardio note, and app/src/workouts.ts's
# toWorkoutSet which this mirrors): a `kind: "cardio"` doc is logged by
# DURATION, not weight×reps, so it carries no weight/reps/set. load_sets must
# NOT drop such a doc for lacking them — only uid/date/session/exercise (the
# identity fields every doc carries, strength or cardio) are grounds for a
# drop. `kind`/`duration`/`distance` are carried into the returned frame so
# metrics.py and progress.py can filter/count by kind downstream.
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Optional, Tuple

import firebase_admin
import numpy as np
import pandas as pd
from firebase_admin import credentials, firestore

HERE = Path(__file__).resolve().parent
DEFAULT_KEY = (HERE / ".." / "pull" / "serviceAccountKey.json").resolve()
KEY_ENV_VAR = "HERCULES_KEY"

# A named (not default) Admin SDK app, so Refresh can tear down and
# re-initialize cleanly instead of firebase_admin raising "app already
# exists" on the second call in the same process.
_APP_NAME = "hercules-desktop"

SET_COLUMNS = ["uid", "date", "session", "exercise", "kind", "weight", "reps", "set", "duration", "distance"]
EXERCISE_COLUMNS = ["uid", "name", "muscles", "lastWeight", "pattern"]
GROUP_COLUMNS = ["uid", "name", "order"]
SET_IDENTITY_COLUMNS = ["uid", "date", "session", "exercise"]


def resolve_key_path(key_path: Optional[Path] = None) -> Path:
    if key_path is not None:
        return Path(key_path)
    env = os.environ.get(KEY_ENV_VAR)
    if env:
        return Path(env)
    return DEFAULT_KEY


def get_db(key_path: Optional[Path] = None):
    """Return a Firestore client, (re)initializing the Admin SDK app.

    Fails loudly with a clear, actionable message if the key is missing —
    this app has no other way to reach Firestore.
    """
    resolved = resolve_key_path(key_path)
    if not resolved.exists():
        raise FileNotFoundError(
            "Service-account key not found: {}\n"
            "  Set {}=/path/to/key.json to override, or place the key at "
            "../pull/serviceAccountKey.json relative to desktop/ "
            "(Firebase console -> Project settings -> Service accounts -> "
            "Generate new private key).".format(resolved, KEY_ENV_VAR)
        )
    try:
        app = firebase_admin.get_app(_APP_NAME)
        firebase_admin.delete_app(app)
    except ValueError:
        pass  # not yet initialized — nothing to tear down
    cred = credentials.Certificate(str(resolved))
    app = firebase_admin.initialize_app(cred, name=_APP_NAME)
    return firestore.client(app)


def load_sets(db) -> pd.DataFrame:
    rows = []
    skipped = 0
    for doc in db.collection("workouts").order_by("ts").stream():
        d = doc.to_dict() or {}
        # Only the identity fields are grounds to drop a doc outright — a
        # cardio doc legitimately has no weight/reps/set, and a strength doc
        # legitimately has no duration/distance. Kind-specific numeric
        # validation happens below, per-kind, after coercion.
        if any(d.get(c) is None for c in SET_IDENTITY_COLUMNS):
            missing = [c for c in SET_IDENTITY_COLUMNS if d.get(c) is None]
            print(f"warning: skipping workouts/{doc.id} — missing {missing}", file=sys.stderr)
            skipped += 1
            continue
        row = {c: d.get(c) for c in SET_COLUMNS}
        row["kind"] = "cardio" if d.get("kind") == "cardio" else "strength"
        rows.append(row)

    df = pd.DataFrame(rows, columns=SET_COLUMNS)
    if not df.empty:
        for c in ("weight", "reps", "set", "duration", "distance"):
            df[c] = pd.to_numeric(df[c], errors="coerce")

        is_cardio = df["kind"] == "cardio"
        # A strength row needs weight/reps/set to be real numbers (its NaNs
        # would otherwise silently zero out volume/PR math); a cardio row
        # needs a real duration. Neither kind is held to the other's
        # requirement, so a weight-less cardio row is kept, not dropped.
        strength_bad = (~is_cardio) & df[["weight", "reps", "set"]].isna().any(axis=1)
        cardio_bad = is_cardio & df["duration"].isna()
        bad = strength_bad | cardio_bad
        dropped = int(bad.sum())
        if dropped:
            print(f"warning: dropped {dropped} sets with non-numeric essential fields for their kind", file=sys.stderr)
        df = df[~bad]
    if skipped:
        print(f"warning: skipped {skipped} malformed set docs", file=sys.stderr)
    return df.reset_index(drop=True)


def load_exercises(db) -> pd.DataFrame:
    rows = []
    for doc in db.collection("exercises").stream():
        d = doc.to_dict() or {}
        uid, name = d.get("uid"), d.get("name")
        if not uid or not name:
            print(f"warning: skipping exercises/{doc.id} — missing uid/name", file=sys.stderr)
            continue
        clean_muscles = []
        for m in d.get("muscles") or []:
            if not isinstance(m, dict):
                continue
            group, weight = m.get("group"), m.get("weight")
            if group is None or weight is None:
                continue
            clean_muscles.append({
                "group": group,
                "role": m.get("role", "secondary"),
                "weight": float(weight),
                "emphasis": m.get("emphasis"),
            })
        rows.append({"uid": uid, "name": name, "muscles": clean_muscles, "lastWeight": d.get("lastWeight"),
                     "pattern": d.get("pattern")})
    return pd.DataFrame(rows, columns=EXERCISE_COLUMNS)


def load_groups(db) -> pd.DataFrame:
    rows = []
    for doc in db.collection("muscleGroups").stream():
        d = doc.to_dict() or {}
        uid, name = d.get("uid"), d.get("name")
        if not uid or not name:
            print(f"warning: skipping muscleGroups/{doc.id} — missing uid/name", file=sys.stderr)
            continue
        rows.append({"uid": uid, "name": name, "order": d.get("order", 0)})
    df = pd.DataFrame(rows, columns=GROUP_COLUMNS)
    if not df.empty:
        df = df.sort_values("order").reset_index(drop=True)
    return df


def load_vetoes(db) -> list:
    """Read the `vetoes` collection -> sorted, de-duplicated list of "date"
    strings. Docs missing `date` are skipped (defensive, like the other
    loaders). Single-account desktop, like the other loaders — no uid
    filtering here; that happens (for sets/exercises/groups) downstream via
    the uid-select dropdown, and vetoes carry no such per-uid split today."""
    dates = set()
    for doc in db.collection("vetoes").stream():
        d = doc.to_dict() or {}
        ds = d.get("date")
        if not ds:
            print(f"warning: skipping vetoes/{doc.id} — missing date", file=sys.stderr)
            continue
        dates.add(ds)
    return sorted(dates)


def load_all(key_path: Optional[Path] = None) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, list]:
    """Fetch (sets, exercises, groups, vetoes) fresh from Firestore. No
    caching — every call re-queries, so the Dash Refresh button just calls
    this again."""
    db = get_db(key_path)
    return load_sets(db), load_exercises(db), load_groups(db), load_vetoes(db)


# ─── JSON round trip for dcc.Store ────────────────────────────────────────
# Deliberately NOT pd.DataFrame.to_json/read_json: read_json's convert_dates
# auto-detection would silently coerce our "date" string column (YYYY-MM-DD)
# to Timestamps, which breaks metrics.py's plain string comparisons. Plain
# json.dumps/loads over records keeps every value's type exactly as-is.

def _json_default(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return None if np.isnan(o) else float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    raise TypeError(f"not JSON serializable: {type(o)!r}")


def df_to_json(df: pd.DataFrame) -> str:
    return json.dumps(df.to_dict(orient="records"), default=_json_default)


def df_from_json(payload: Optional[str], columns) -> pd.DataFrame:
    records = json.loads(payload) if payload else []
    return pd.DataFrame(records, columns=columns)


def store_payload(sets_df: pd.DataFrame, exercises_df: pd.DataFrame, groups_df: pd.DataFrame,
                   vetoes: Optional[list] = None) -> dict:
    return {
        "sets": df_to_json(sets_df),
        "exercises": df_to_json(exercises_df),
        "groups": df_to_json(groups_df),
        # Plain JSON list, not df_to_json — vetoes is just date strings, no
        # DataFrame/numpy dtypes in play, so the df round-trip machinery
        # above (built for numpy-typed columns) would be pure overhead here.
        "vetoes": list(vetoes) if vetoes else [],
    }


def frames_from_store(payload: Optional[dict]) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, list]:
    if not payload:
        return (
            pd.DataFrame(columns=SET_COLUMNS),
            pd.DataFrame(columns=EXERCISE_COLUMNS),
            pd.DataFrame(columns=GROUP_COLUMNS),
            [],
        )
    return (
        df_from_json(payload.get("sets"), SET_COLUMNS),
        df_from_json(payload.get("exercises"), EXERCISE_COLUMNS),
        df_from_json(payload.get("groups"), GROUP_COLUMNS),
        payload.get("vetoes") or [],
    )
