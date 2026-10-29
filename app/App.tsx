import { StatusBar } from "expo-status-bar";
import type { User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { signOutUser, watchAuth } from "./src/firebase";
import { getStaySignedIn } from "./src/prefs";
import { seedRegistryIfEmpty } from "./src/registry";
import AuthScreen from "./src/screens/AuthScreen";
import BodyScreen from "./src/screens/BodyScreen";
import LogScreen from "./src/screens/LogScreen";
import { colors, radius, space } from "./src/theme";

type Tab = "log" | "body";

// Phase 6 — auth gate. Watch the account state: show a splash until we know,
// then the login screen if signed out, or the logger if signed in.
// Phase 11 — a lightweight bottom tab bar switches the signed-in view between
// LogScreen (unchanged) and the new read-only BodyScreen. A bottom bar (vs. a
// top segmented control) was chosen specifically so it can wrap either screen
// without touching either one's own top status-bar padding.
// "Remember me" — if the user unchecked it at sign-in, staySignedIn is false
// and any restored session should not stick past a cold start. We resolve
// that *before* flipping `ready`, so the splash holds through the sign-out
// and the logged-in tabs never mount even for a frame.
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("log");
  // "Remember me" governs only a RESTORED session on cold start. Only the first
  // auth resolution this launch is a restore; every later fire is an interactive
  // sign-in/out and must be shown as-is — otherwise an unchecked sign-in would
  // immediately bounce itself back to the login screen.
  const restoreChecked = useRef(false);

  useEffect(() => {
    const unsub = watchAuth((u) => {
      const isRestore = !restoreChecked.current;
      restoreChecked.current = true;
      if (u) {
        if (isRestore) {
          // Cold-start restore: honor "remember me". If the user opted out, sign
          // the restored session out; the follow-up null fire reveals Auth.
          getStaySignedIn().then((stay) => {
            if (stay) {
              setUser(u);
              setReady(true);
            } else {
              signOutUser().catch((err) => {
                console.warn("forced sign-out failed:", err);
                // Don't wedge on the splash — reveal the still-authed app.
                setUser(u);
                setReady(true);
              });
            }
          });
        } else {
          // Interactive sign-in — always show it.
          setUser(u);
          setReady(true);
        }
      } else {
        setUser(null);
        setReady(true);
      }
    });
    return unsub;
  }, []);

  // Phase 7 — first sign-in on a fresh account seeds the exercise registry.
  // Idempotent (no-op once groups exist); failure is non-fatal since the
  // LogScreen listeners will simply show an empty registry to add to.
  useEffect(() => {
    if (!user) return;
    seedRegistryIfEmpty().catch((err) =>
      console.warn("registry seed failed:", err)
    );
  }, [user]);

  return (
    <>
      {!ready ? (
        <View style={styles.splash}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : user ? (
        <View style={styles.app}>
          <View style={styles.screenArea}>
            {tab === "log" ? (
              <LogScreen email={user.email} onSignOut={() => void signOutUser()} />
            ) : (
              <BodyScreen />
            )}
          </View>
          <View style={styles.tabBar}>
            <TabButton label="Log" active={tab === "log"} onPress={() => setTab("log")} />
            <TabButton label="Body" active={tab === "body"} onPress={() => setTab("body")} />
          </View>
        </View>
      ) : (
        <AuthScreen />
      )}
      <StatusBar style="light" />
    </>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.tabButton,
        active && styles.tabButtonActive,
        pressed && styles.tabPressed,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  app: { flex: 1, backgroundColor: colors.bg },
  screenArea: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space.x2,
    paddingBottom: Platform.OS === "ios" ? space.x7 : space.x3,
    paddingHorizontal: space.x4,
    gap: space.x3,
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: space.x2 + 2,
    borderRadius: radius.chip,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tabButtonActive: {
    backgroundColor: colors.accentTint,
    borderColor: colors.accentLine,
  },
  tabLabel: { color: colors.ink2, fontSize: 13.5, fontWeight: "700" },
  tabLabelActive: { color: colors.accent },
  tabPressed: { opacity: 0.7 },
});
