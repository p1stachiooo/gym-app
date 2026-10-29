// Rest-day / excuse control. Mirrors registry.ts's and workouts.ts's
// Firestore CRUD pattern exactly (requireUid, collection(db, ...), query by
// uid only — no orderBy, so a personal-sized collection never needs a
// composite index). Docs: `{ uid, date: "YYYY-MM-DD" }` in the `vetoes`
// collection. Feeds progress.ts's `computeProgress`/rankEngine.ts's
// `evaluateRank` `vetoes: string[]` param, which itself enforces the
// VETO_DAYS_PER_MONTH cap (see progress.ts's `enforceVetoCap`) — this module
// does no capping of its own; it's a plain synced set of excused dates.
import {
  addDoc,
  collection,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";

import { db, getUid } from "./firebase";

function requireUid(): string {
  const uid = getUid();
  if (!uid) throw new Error("vetoes: not signed in");
  return uid;
}

// Query by uid only and sort/de-dupe client-side, matching registry.ts's
// watchers.
export function watchVetoes(cb: (dates: string[]) => void): Unsubscribe {
  const q = query(collection(db, "vetoes"), where("uid", "==", requireUid()));
  return onSnapshot(q, (snap) => {
    const dates = Array.from(
      new Set(snap.docs.map((d) => d.data().date as string))
    );
    dates.sort();
    cb(dates);
  });
}

// Adds a rest-day doc for `date`, unless the signed-in uid already has one
// (checked via getDocs first) — de-duped so double-tapping "mark today" (or
// a re-render racing a snapshot) never creates a duplicate doc for the same
// date.
export async function addVeto(date: string): Promise<void> {
  const uid = requireUid();
  const existing = await getDocs(
    query(
      collection(db, "vetoes"),
      where("uid", "==", uid),
      where("date", "==", date)
    )
  );
  if (!existing.empty) return;
  await addDoc(collection(db, "vetoes"), { uid, date });
}

// Removes every doc (should only ever be one, given addVeto's de-dupe) for
// the signed-in uid + date.
export async function removeVeto(date: string): Promise<void> {
  const uid = requireUid();
  const existing = await getDocs(
    query(
      collection(db, "vetoes"),
      where("uid", "==", uid),
      where("date", "==", date)
    )
  );
  await Promise.all(existing.docs.map((d) => deleteDoc(d.ref)));
}
