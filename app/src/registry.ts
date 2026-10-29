// Phase 7 — the muscle-group + exercise registry. Two owner-only Firestore
// collections (`muscleGroups`, `exercises`) that sync across devices via the
// account. Exercises carry a WEIGHTED muscle mapping (primary 1.0, secondary
// 0.5, minor 0.25) so compound lifts credit multiple groups honestly. Sets
// stamp only the exercise name; muscles are resolved via this registry at read
// time ("derive, don't store" — re-tagging an exercise retroactively fixes all
// history).
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";

import { db, getUid } from "./firebase";
import { SEED_EXERCISES, SEED_GROUPS } from "./seed";

export type MuscleRole = "primary" | "secondary";

// One entry of an exercise's muscle mapping. `group` references a muscle-group
// NAME (denormalized — groups are never renamed in this app). `emphasis` keeps
// finer-than-group detail ("rear delt", "soleus") without splitting the coarse
// taxonomy; credit math only ever sees `group` and `weight`.
export interface MuscleCredit {
  group: string;
  role: MuscleRole;
  weight: number;
  emphasis?: string;
}

export interface MuscleGroup {
  id: string; // Firestore doc id
  name: string;
  order: number; // display ordering on selectors
}

// Coarse movement-pattern taxonomy — an analytics axis (push/pull balance
// etc.); it does NOT affect XP.
export type MovementPattern =
  | "Push"
  | "Pull"
  | "Squat"
  | "Hinge"
  | "Carry"
  | "Core"
  | "Isolation"
  | "Cardio";

export interface Exercise {
  id: string; // Firestore doc id
  name: string;
  muscles: MuscleCredit[];
  lastWeight?: number; // "remember last weight" memory, synced across devices
  kind?: "cardio"; // absent == strength. Seed/authoring for cardio docs is a
  // later stage — this is just the type + mapping so the UI can detect them.
  pattern?: MovementPattern; // analytics axis (push/pull balance); does NOT affect XP
}

// The primary group of an exercise — where it files on the selector.
export function primaryGroup(ex: Exercise): string | undefined {
  return ex.muscles.find((m) => m.role === "primary")?.group;
}

function requireUid(): string {
  const uid = getUid();
  if (!uid) throw new Error("registry: not signed in");
  return uid;
}

// Both watchers query by uid only and sort client-side — a where(==) plus
// orderBy on another field would demand a composite index for no gain on a
// personal-sized collection.
export function watchMuscleGroups(
  cb: (groups: MuscleGroup[]) => void
): Unsubscribe {
  const q = query(collection(db, "muscleGroups"), where("uid", "==", requireUid()));
  return onSnapshot(q, (snap) => {
    const groups = snap.docs.map((d) => ({
      id: d.id,
      name: d.data().name as string,
      order: (d.data().order as number) ?? 999,
    }));
    groups.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    cb(groups);
  });
}

export function watchExercises(cb: (exercises: Exercise[]) => void): Unsubscribe {
  const q = query(collection(db, "exercises"), where("uid", "==", requireUid()));
  return onSnapshot(q, (snap) => {
    const exercises = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name as string,
        muscles: (data.muscles as MuscleCredit[]) ?? [],
        lastWeight: data.lastWeight as number | undefined,
        kind: data.kind === "cardio" ? ("cardio" as const) : undefined,
        pattern: data.pattern as MovementPattern | undefined,
      };
    });
    exercises.sort((a, b) => a.name.localeCompare(b.name));
    cb(exercises);
  });
}

export async function addMuscleGroup(name: string, order: number): Promise<string> {
  const ref = await addDoc(collection(db, "muscleGroups"), {
    uid: requireUid(),
    name,
    order,
  });
  return ref.id;
}

export async function addExercise(
  name: string,
  muscles: MuscleCredit[]
): Promise<string> {
  const ref = await addDoc(collection(db, "exercises"), {
    uid: requireUid(),
    name,
    muscles,
  });
  return ref.id;
}

export function setLastWeight(exerciseId: string, weight: number): Promise<void> {
  return updateDoc(doc(db, "exercises", exerciseId), { lastWeight: weight });
}

// One-time seed: if this account has no muscle groups yet, write the authored
// seed (SEED_GROUPS + starting exercises) in a single atomic batch. Called after
// sign-in; a no-op for already-seeded accounts. Returns whether it seeded.
export async function seedRegistryIfEmpty(): Promise<boolean> {
  const uid = requireUid();
  const existing = await getDocs(
    query(collection(db, "muscleGroups"), where("uid", "==", uid))
  );
  if (!existing.empty) return false;

  const batch = writeBatch(db);
  SEED_GROUPS.forEach((name, i) => {
    batch.set(doc(collection(db, "muscleGroups")), { uid, name, order: i + 1 });
  });
  for (const ex of SEED_EXERCISES) {
    batch.set(doc(collection(db, "exercises")), {
      uid,
      name: ex.name,
      muscles: ex.muscles,
      ...(ex.kind ? { kind: ex.kind } : {}),
      ...(ex.pattern ? { pattern: ex.pattern } : {}),
    });
  }
  await batch.commit();
  return true;
}
