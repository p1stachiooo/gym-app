// Cross-platform alert/confirm. react-native-web does NOT implement Alert —
// Alert.alert is a silent no-op on web — so web falls back to the browser's
// native dialogs. Native keeps the real Alert UI.
import { Alert, Platform } from "react-native";

export function notify(title: string, message: string): void {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

// Two-button confirm for a destructive action; runs onConfirm only on accept.
// window.confirm's button labels are fixed by the browser, so confirmLabel
// only shows on native.
export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void
): void {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: "Keep going", style: "cancel" },
      { text: confirmLabel, style: "destructive", onPress: onConfirm },
    ]);
  }
}
