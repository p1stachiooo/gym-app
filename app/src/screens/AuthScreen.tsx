// Phase 6 — the auth gate. Email/password sign-in and sign-up on one screen.
// On success, App's auth listener swaps this screen for the logger, so there's
// no navigation here — just call signIn/signUp and let the state change flow.
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { signIn, signUp } from "../firebase";
import { getSavedEmail, setSavedEmail, clearSavedEmail, setStaySignedIn } from "../prefs";
import { colors, radius, space, type } from "../theme";

type Mode = "signin" | "signup";

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);

  // Prefill the email field from a prior "remember me" sign-in. A saved
  // email implies the checkbox should read as checked (it already defaults
  // to true, but this keeps the two in sync if that default ever changes).
  useEffect(() => {
    let cancelled = false;
    getSavedEmail().then((saved) => {
      if (cancelled || !saved) return;
      setEmail(saved);
      setRememberMe(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = email.trim().length > 3 && password.length >= 6 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const trimmedEmail = email.trim();
      if (mode === "signin") await signIn(trimmedEmail, password);
      else await signUp(trimmedEmail, password);
      // Success: the component unmounts as App switches to the logger, so we
      // deliberately leave `busy` true rather than set state on an unmounted view.
      if (rememberMe) {
        await setSavedEmail(trimmedEmail);
        await setStaySignedIn(true);
      } else {
        await clearSavedEmail();
        await setStaySignedIn(false);
      }
    } catch (err: unknown) {
      setError(friendly(err));
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Project Hercules</Text>
        <Text style={styles.subtitle}>
          {isSignup ? "Create your account" : "Sign in"}
        </Text>

        <Text style={styles.label}>EMAIL</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.ink3}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
        />

        <Text style={styles.label}>PASSWORD</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="at least 6 characters"
          placeholderTextColor={colors.ink3}
          secureTextEntry
          autoCapitalize="none"
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        <Pressable
          style={styles.rememberRow}
          onPress={() => setRememberMe((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rememberMe }}
        >
          <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
            {rememberMe && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.rememberLabel}>Remember me</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            !canSubmit && styles.buttonDisabled,
            canSubmit && pressed && styles.pressed,
          ]}
          disabled={!canSubmit}
          onPress={submit}
        >
          {busy ? (
            <ActivityIndicator color={colors.accentInk} />
          ) : (
            <Text style={styles.buttonText}>
              {isSignup ? "Create account" : "Sign in"}
            </Text>
          )}
        </Pressable>

        <Pressable
          style={styles.toggle}
          onPress={() => {
            setMode(isSignup ? "signin" : "signup");
            setError(null);
          }}
        >
          <Text style={styles.toggleText}>
            {isSignup
              ? "Have an account? Sign in"
              : "Need an account? Create one"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// Turn Firebase auth error codes into plain, gym-legible messages.
function friendly(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  switch (code) {
    case "auth/invalid-email":
      return "That email doesn't look right.";
    case "auth/missing-password":
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/email-already-in-use":
      return "That email already has an account — sign in instead.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Wrong email or password.";
    case "auth/too-many-requests":
      return "Too many attempts — wait a bit and try again.";
    case "auth/network-request-failed":
      return "Network error — check your connection.";
    default:
      return err instanceof Error ? err.message : "Something went wrong.";
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: {
    flex: 1,
    justifyContent: "center",
    padding: space.x6,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  title: { color: colors.ink, fontSize: 28, fontWeight: "800", letterSpacing: -0.2 },
  subtitle: {
    color: colors.ink2,
    fontSize: 15,
    marginTop: space.x1,
    marginBottom: space.x7,
  },
  label: {
    ...type.label,
    color: colors.ink3,
    marginBottom: space.x2 - 2,
    marginTop: space.x3 + 2,
  },
  input: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.ink,
    fontSize: 16,
  },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: space.x5,
    gap: space.x2 + 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.line2,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkmark: { color: colors.accentInk, fontSize: 13, fontWeight: "800" },
  rememberLabel: { color: colors.ink2, fontSize: 14, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 14, marginTop: space.x4 },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 18,
    borderRadius: radius.buttonLg,
    alignItems: "center",
    marginTop: space.x6,
  },
  buttonDisabled: { backgroundColor: colors.raised },
  buttonText: { color: colors.accentInk, fontSize: 18, fontWeight: "800" },
  toggle: { marginTop: space.x5, alignItems: "center" },
  toggleText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.7 },
});
