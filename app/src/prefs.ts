// "Remember me" preferences — thin async wrapper over AsyncStorage.
//
// Two independent-but-usually-linked bits of local state:
//   - savedEmail: prefills the email field on the next visit to AuthScreen.
//   - staySignedIn: whether the Firebase-persisted session (native auto-persists
//     via AsyncStorage — see firebase.ts) should be honored on the next cold
//     start. Defaults to true when unset so existing installs (pre-dating this
//     feature) keep behaving exactly as before. App.tsx reads this once on
//     launch and signs the user out if it's false, before revealing any UI.
import AsyncStorage from "@react-native-async-storage/async-storage";

const SAVED_EMAIL_KEY = "hercules.savedEmail";
const STAY_SIGNED_IN_KEY = "hercules.staySignedIn";
const ACK_LEVEL_KEY = "hercules.ackLevel";
const ACK_RANK_ID_KEY = "hercules.ackRankId";

export async function getSavedEmail(): Promise<string | null> {
  return AsyncStorage.getItem(SAVED_EMAIL_KEY);
}

export async function setSavedEmail(email: string): Promise<void> {
  await AsyncStorage.setItem(SAVED_EMAIL_KEY, email);
}

export async function clearSavedEmail(): Promise<void> {
  await AsyncStorage.removeItem(SAVED_EMAIL_KEY);
}

export async function getStaySignedIn(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(STAY_SIGNED_IN_KEY);
  if (raw === null) return true; // default: stay signed in, matching pre-feature behavior
  return raw === "true";
}

export async function setStaySignedIn(stay: boolean): Promise<void> {
  await AsyncStorage.setItem(STAY_SIGNED_IN_KEY, stay ? "true" : "false");
}

// Phase 13 — the highest overall level the level-up overlay has already
// celebrated, so a re-render (or a later dip from decay) never re-fires it for
// a level already acknowledged. Returns null when UNSET (first run), which is
// distinct from a stored 0: LogScreen baselines the ack to the current level
// silently on first run so an existing player doesn't get a phantom level-up.
export async function getAckLevel(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(ACK_LEVEL_KEY);
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export async function setAckLevel(n: number): Promise<void> {
  await AsyncStorage.setItem(ACK_LEVEL_KEY, String(n));
}

// Rank-moment overlays — the highest rankId already acknowledged (celebrated
// as a rank-up, or shown as a rank-slip), mirroring getAckLevel/setAckLevel
// above exactly: null means UNSET (first run), distinct from a stored 0, so
// LogScreen can baseline silently to the current rank instead of firing a
// phantom rank-up/slip for an existing player.
export async function getAckRankId(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(ACK_RANK_ID_KEY);
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export async function setAckRankId(n: number): Promise<void> {
  await AsyncStorage.setItem(ACK_RANK_ID_KEY, String(n));
}
