// Phase 9 wiring — reads back the signed-in user's own `workouts` docs (the
// collection data.ts's writeSet() writes to) so progress.ts's XP/leveling
// engine has a log to compute over. Mirrors registry.ts's watchers: query by
// uid only (no orderBy) so a personal-sized collection never needs a
// composite index.
import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import { db, getUid } from "./firebase";
import type { WorkoutSet } from "./progress";

function requireUid(): string {
  const uid = getUid();
  if (!uid) throw new Error("workouts: not signed in");
  return uid;
}

// Coerce one Firestore doc into progress.ts's WorkoutSet shape. Returns null
// (drop the doc) only if uid/date/session/exercise — the identity fields
// every doc must carry, strength or cardio — are missing/malformed, or if
// the kind-specific numeric fields don't coerce to finite numbers. THE SEAM:
// cardio docs (kind: "cardio") have no weight/reps and must NOT be dropped
// for lacking them — they're validated on duration instead and their
// kind/duration/distance are propagated so they reach computeProgress (where
// they count toward Consistency and are filtered out of Progression/Volume
// by the engine itself, per progress.ts's isStrengthSet). The engine must
// never see NaN, and this is the one seam where untrusted data enters it.
function toWorkoutSet(data: Record<string, unknown>): WorkoutSet | null {
  if (
    typeof data.uid !== "string" ||
    typeof data.date !== "string" ||
    typeof data.session !== "string" ||
    typeof data.exercise !== "string"
  ) {
    return null;
  }

  if (data.kind === "cardio") {
    const duration = Number(data.duration);
    if (!Number.isFinite(duration)) return null;

    let distance: number | undefined;
    if (data.distance !== undefined) {
      const n = Number(data.distance);
      if (Number.isFinite(n)) distance = n;
    }

    return {
      uid: data.uid,
      date: data.date,
      session: data.session,
      exercise: data.exercise,
      kind: "cardio",
      duration,
      distance,
    };
  }

  // Strength (kind absent or "strength" — absent means every doc written
  // before Stage 1 added the field, back-compat per schema.ts).
  const weight = Number(data.weight);
  const reps = Number(data.reps);
  if (!Number.isFinite(weight) || !Number.isFinite(reps)) return null;

  let set: number | undefined;
  if (data.set !== undefined) {
    const n = Number(data.set);
    if (!Number.isFinite(n)) return null;
    set = n;
  }

  return {
    uid: data.uid,
    date: data.date,
    session: data.session,
    exercise: data.exercise,
    kind: "strength",
    weight,
    reps,
    set,
  };
}

export function watchWorkouts(cb: (workouts: WorkoutSet[]) => void): Unsubscribe {
  const q = query(collection(db, "workouts"), where("uid", "==", requireUid()));
  return onSnapshot(q, (snap) => {
    const workouts: WorkoutSet[] = [];
    for (const d of snap.docs) {
      const mapped = toWorkoutSet(d.data());
      if (mapped) workouts.push(mapped);
    }
    cb(workouts);
  });
}
