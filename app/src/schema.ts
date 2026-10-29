// The data contract. Mirrors `pull/pull.py`'s STORED column order — keep them
// in sync by hand (see ARCHITECTURE.md "The data contract"). One document per
// set. Deliberately NO muscle field: sets stamp only the exercise name, and
// muscles are resolved via the registry (registry.ts) at read time, so
// re-tagging an exercise retroactively fixes all history.
//
// Firestore doc shape: WorkoutSet + a server `ts` timestamp added in data.ts.
//
// Cardio (Stage 2 — logging UI/registry wiring; see phase9-xp-spec.md's
// Cardio note for the engine side): `kind: "cardio"` is logged by DURATION,
// not weight×reps. A missing `kind` means `"strength"` (every doc written
// before this field existed). Modeled as a discriminated union (rather than
// one interface with everything optional) so a caller can't accidentally
// write a strength doc missing weight/reps/set, or a cardio doc carrying
// them — TypeScript enforces exactly one shape per write.
interface WorkoutSetBase {
  uid: string; // authenticated account uid — stamped by writeSet()
  date: string; // ISO 8601 "YYYY-MM-DD"
  session: string; // master workout id for one gym visit, e.g. "2026-06-30T18:05"
  exercise: string; // e.g. "bench press"
}

export interface StrengthWorkoutSet extends WorkoutSetBase {
  kind?: "strength"; // absent == "strength", back-compat with pre-Stage-1 docs
  weight: number;
  reps: number;
  set: number; // set index within this exercise this session (1-based)
}

export interface CardioWorkoutSet extends WorkoutSetBase {
  kind: "cardio";
  duration: number; // minutes
  distance?: number; // unit left to the UI
}

export type WorkoutSet = StrengthWorkoutSet | CardioWorkoutSet;

// What a caller supplies. `uid` is stamped by writeSet(); `ts` is server-side.
export type NewSet = Omit<StrengthWorkoutSet, "uid"> | Omit<CardioWorkoutSet, "uid">;
