// Phase 10 — design tokens for the restyle pass. Single source of truth for
// color/spacing/radius/type so screens stop hand-rolling hex values. Mirrors
// the approved mockup 1:1 (see phase10 mockup HTML): a blue-slate dark ground
// with one emerald accent ("go / logged") and amber reserved for streak +
// saving state. Pure constants — no React Native imports beyond types, so
// this file has no effect on behavior, only presentation.

export const colors = {
  bg: "#0A0F1A", // ground
  surface: "#131C2B", // card background
  raised: "#1C283A", // inputs, secondary buttons, "raised" surfaces
  line: "#26344A", // default hairline border
  line2: "#324159", // stronger hairline (steppers, inputs)
  ink: "#F2F6FC", // primary text
  ink2: "#AEBCD0", // secondary text
  ink3: "#6E7E96", // tertiary text / labels
  accent: "#34D399", // emerald — "go / logged"
  accentPress: "#10B981", // pressed/darker emerald
  accentInk: "#03150E", // text/icon color drawn on top of accent fills
  accentTint: "#12271F", // tinted accent background (active chips)
  accentLine: "#1F5D46", // accent-tinted border
  amber: "#FBBF24", // streak + saving status
  amberTint: "#2A2412", // tinted amber background
  // Not in the mockup swatches — kept distinct from accent/amber so the
  // retry/error affordance in the session log still reads unambiguously.
  danger: "#F87171",
} as const;

// 4-based spacing scale: space.x{n} === n * 4.
export const space = {
  x1: 4,
  x2: 8,
  x3: 12,
  x4: 16,
  x5: 20,
  x6: 24,
  x7: 28,
  x8: 32,
  x9: 36,
  x10: 40,
} as const;

export const radius = {
  card: 16,
  chip: 11,
  button: 13, // secondary/pill buttons (sign out, end, add)
  buttonLg: 14, // the primary CTA (Log set / start / submit)
} as const;

// Type scale — sizes + weights only; components own their own color unless
// noted. `label` is the recurring all-caps eyebrow used throughout.
export const type = {
  display: { fontSize: 42, fontWeight: "800" as const, letterSpacing: -1.2 },
  title: { fontSize: 20, fontWeight: "800" as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: "400" as const },
  value: { fontSize: 25, fontWeight: "800" as const },
  label: {
    fontSize: 11,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    textTransform: "uppercase" as const,
  },
} as const;

// Every numeric display (level, xp, weight, reps, set counts, "Last: W × R")
// should carry this so digits don't jitter as steppers change. Deliberately
// not `as const`-frozen: RN's TextStyle.fontVariant is typed as a mutable
// array, and a readonly tuple here doesn't structurally match it.
export const tabularNums: { fontVariant: "tabular-nums"[] } = {
  fontVariant: ["tabular-nums"],
};

// Shared shadow for the one lifted, focal element (the Log card). RN has no
// gradient primitive without a new dependency, so the mockup's card gradient
// is approximated with a solid `raised` background — see LogScreen for the
// note on that deviation.
export const lift = {
  elevation: 8,
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.35,
  shadowRadius: 20,
} as const;
