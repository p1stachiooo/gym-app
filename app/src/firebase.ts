// Firebase JS SDK init + email/password auth. The only place the SDK is configured.
//
// Config comes from app/.env.local as EXPO_PUBLIC_* vars (inlined by Metro at
// build time, on web and native). These are not secrets — the Firestore
// security rules are what protect the data. On EAS cloud builds the same values
// come from EAS environment variables (see project memory), since .env.local is
// gitignored and never uploaded.
//
// Persistence note (Firebase JS SDK v12): getReactNativePersistence was REMOVED.
// In v12, auth persistence is auto-detected — getAuth(app) uses
// @react-native-async-storage/async-storage on native and browserLocal on web,
// so a signed-in session survives app restarts. Do not reintroduce
// getReactNativePersistence.
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Guard against re-init on Fast Refresh.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Subscribe to auth state; fires once with the current user (or null) on mount
// and again on every sign-in/out. Returns the unsubscribe function.
export function watchAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export function signUp(email: string, password: string): Promise<unknown> {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signIn(email: string, password: string): Promise<unknown> {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signOutUser(): Promise<void> {
  return signOut(auth);
}

export function getUid(): string | null {
  return auth.currentUser?.uid ?? null;
}
