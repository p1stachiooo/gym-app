// The ONLY function that touches the Firestore schema. Everything that writes a
// set goes through here, so the document shape lives in exactly one place.
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { db, getUid } from "./firebase";
import type { NewSet } from "./schema";

// Writes one set to the `workouts` collection. Stamps the caller's UID (the
// security rules require request.auth.uid == data.uid on create) and a server
// timestamp for ordering. Returns the new document id.
//
// Accepts either a strength set (weight/reps/set) or a cardio set
// (kind: "cardio", duration, optional distance) per schema.ts's NewSet
// union. Guarded here — the sole schema touchpoint — so a caller passing a
// non-finite number (a stray NaN from an unparsed input) never reaches
// Firestore for either shape.
export async function writeSet(set: NewSet): Promise<string> {
  const uid = getUid();
  if (!uid) {
    throw new Error("writeSet: not signed in");
  }

  if (set.kind === "cardio") {
    if (!Number.isFinite(set.duration)) {
      throw new Error("writeSet: invalid duration");
    }
    if (set.distance !== undefined && !Number.isFinite(set.distance)) {
      throw new Error("writeSet: invalid distance");
    }
  } else if (
    !Number.isFinite(set.weight) ||
    !Number.isFinite(set.reps) ||
    !Number.isFinite(set.set)
  ) {
    throw new Error("writeSet: invalid weight/reps/set");
  }

  const ref = await addDoc(collection(db, "workouts"), {
    ...set,
    uid,
    ts: serverTimestamp(),
  });
  return ref.id;
}
