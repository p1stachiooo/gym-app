// Phase 9 — compact, always-visible read-out of the pure XP/leveling engine
// (progress.ts). Deliberately dumb: takes an already-computed `Progress` and
// renders it. Phase 10 — restyled into the "progress strip" from the
// approved mockup: a big level number, an XP-to-next bar, three C/P/V mini
// bars, and the streak in amber, all in one card up top so the reward loop
// is always in view. Same props, same inputs — presentation only.
//
// Phase 13 — the flame "comes alive": a gentle Animated pulse while
// streak > 0 (skipped under Reduce Motion — a still flame at the right size
// still communicates the streak), and grows across three tiers by streak
// length so a long streak visibly reads as a bigger deal than a 1-week one.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { DEFAULT_PARAMS, type Progress } from "../progress";
import { labelForRankId } from "../rank/rankArt";
import { medallionForRank } from "../rank/RankMedallion";
import type { RankView } from "../rank/rankEngine";
import { colors, radius, space, tabularNums, type } from "../theme";

// Flame font size by streak-length tier: 1-2 / 3-5 / 6+ weeks.
function flameTierSize(streak: number): number {
  if (streak >= 6) return 26;
  if (streak >= 3) return 22;
  return 18;
}

// The flame glyph: grows across streak-length tiers and gently pulses
// (scale + opacity) while the streak is alive. Stops and resets to a flat
// resting state the moment streak hits 0, and never animates at all under
// Reduce Motion.
function StreakFlame({ streak }: { streak: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const active = streak > 0;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduceMotion(v);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!active || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const size = flameTierSize(streak);

  return (
    <Animated.Text
      style={[
        styles.streakFlame,
        { fontSize: size, lineHeight: size + 4 },
        active && { transform: [{ scale }], opacity },
      ]}
    >
      🔥
    </Animated.Text>
  );
}

// Derived purely for display: xp needed to reach the next level, and how far
// into the current level's band the current xp sits (for the bar fill).
// Mirrors scoreToXpLevel's inverse (level = floor(sqrt(xp / LEVEL_K))) using
// the same exported constant progress.ts already uses — no engine change.
function xpBand(xp: number, level: number) {
  const k = DEFAULT_PARAMS.LEVEL_K;
  const floor = k * level * level;
  const nextLevelXp = k * (level + 1) * (level + 1);
  const span = Math.max(1, nextLevelXp - floor);
  const pct = Math.round(clip01((xp - floor) / span) * 100);
  return { nextLevelXp, toGo: Math.max(0, nextLevelXp - xp), pct };
}

function clip01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export default function ProgressCard({
  progress,
  hasWorkouts,
  rank,
  peakRankId,
  onPressMedallion,
}: {
  progress: Progress;
  hasWorkouts: boolean;
  rank?: RankView;
  peakRankId?: number;
  onPressMedallion?: () => void;
}) {
  if (!hasWorkouts) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyLabel}>PROGRESS</Text>
        <Text style={styles.hint}>Log a session to start leveling.</Text>
      </View>
    );
  }

  const topGroups = Object.entries(progress.perGroup)
    .filter(([, g]) => g.level > 0)
    .sort((a, b) => b[1].level - a[1].level || b[1].xp - a[1].xp)
    .slice(0, 3);

  const band = xpBand(progress.xp, progress.level);

  return (
    <View style={styles.card}>
      {rank && (
        <RankSection rank={rank} peakRankId={peakRankId} onPress={onPressMedallion} />
      )}

      <View style={styles.prow}>
        <View style={styles.level}>
          <Text style={[styles.lvNum, tabularNums]}>{progress.level}</Text>
          <Text style={styles.lvCap}>LEVEL</Text>
        </View>

        <View style={styles.pmid}>
          <View style={styles.xpTop}>
            <Text style={[styles.xpValue, tabularNums]}>{progress.xp} XP</Text>
            <Text style={[styles.xpNext, tabularNums]}>
              Lv {progress.level + 1} · {band.toGo} to go
            </Text>
          </View>
          <View style={styles.xpBarTrack}>
            <View style={[styles.xpBarFill, { width: `${band.pct}%` }]} />
          </View>

          <View style={styles.comps}>
            <MiniBar label="Consistency" value={progress.components.consistency} accent />
            <MiniBar label="Progression" value={progress.components.progression} />
            <MiniBar label="Volume" value={progress.components.volume} />
          </View>
        </View>

        <View style={styles.streak}>
          <StreakFlame streak={progress.streak} />
          <Text style={[styles.streakNum, tabularNums]}>{progress.streak}</Text>
          <Text style={styles.streakCap}>WK</Text>
        </View>
      </View>

      {topGroups.length > 0 && (
        <View style={styles.groupsRow}>
          {topGroups.map(([name, g]) => (
            <View key={name} style={styles.groupChip}>
              <Text style={styles.groupText}>
                {name} · <Text style={tabularNums}>Lv{g.level}</Text>
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// One of the three Consistency/Progression/Volume mini bars in the middle
// column. Full words (not "C"/"P"/"V") per the user-facing relabel — they
// read as an unlabeled traffic-light otherwise.
function MiniBar({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  const pct = Math.round(clip01(value) * 100);
  return (
    <View style={styles.comp}>
      <Text style={styles.compLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.compTrack}>
        <View
          style={[
            styles.compFill,
            { width: `${pct}%` },
            accent && styles.compFillAccent,
          ]}
        />
      </View>
    </View>
  );
}

// The rank section at the top of the card: the current medallion (tappable
// to open the full ladder), tier + division name, a progress bar toward the
// next division (or, at the apex, XP banked past Kratos), and a small muted
// "Peak: …" readout of the highest rank ever reached (peakRankId only ever
// rises — see rankEngine's RankResult — so this can dip below it after a
// slip without ever re-writing it).
function RankSection({
  rank,
  peakRankId,
  onPress,
}: {
  rank: RankView;
  peakRankId?: number;
  onPress?: () => void;
}) {
  const pct = rank.isApex
    ? 100
    : Math.round(clip01(rank.xpIntoDivision / rank.xpForDivision) * 100);
  const nextLabel = rank.isApex ? null : labelForRankId(rank.rankId + 1);

  return (
    <Pressable
      style={({ pressed }) => [styles.rankSection, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.medallionWrap}>{medallionForRank(rank.rankId, 72)}</View>
      <View style={styles.rankInfo}>
        <Text style={styles.rankName}>
          {rank.tierName}
          {rank.divisionLabel ? ` ${rank.divisionLabel}` : ""}
        </Text>
        <View style={styles.rankBarTrack}>
          <View style={[styles.rankBarFill, { width: `${pct}%` }]} />
        </View>
        <Text style={[styles.rankBarLabel, tabularNums]}>
          {rank.isApex
            ? `${rank.xpIntoDivision} XP past Kratos`
            : `${rank.xpIntoDivision} / ${rank.xpForDivision} to ${nextLabel}`}
        </Text>
        {peakRankId !== undefined && (
          <Text style={styles.peakLabel}>Peak: {labelForRankId(peakRankId)}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rankSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.x3,
    paddingBottom: space.x4,
    marginBottom: space.x4,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  // RankMedallion's own box is bigger than the 72px disc it draws (it
  // reserves room for the aura layers around the medallion, at the same
  // 190/132 ratio as the artifact's card layout) — size the wrapper to
  // that box so the aura isn't clipped or overlapping rankInfo's text.
  medallionWrap: { width: 104, height: 104, alignItems: "center", justifyContent: "center" },
  rankInfo: { flex: 1, minWidth: 0 },
  rankName: { ...type.title, fontSize: 17, color: colors.ink, marginBottom: 6 },
  rankBarTrack: {
    height: 6,
    borderRadius: 5,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  rankBarFill: {
    height: "100%",
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  rankBarLabel: { fontSize: 11.5, color: colors.ink3, marginTop: 5 },
  peakLabel: { fontSize: 11, color: colors.ink3, marginTop: 4 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: space.x4,
    marginBottom: space.x4,
  },
  emptyLabel: { ...type.label, color: colors.ink3 },
  hint: { ...type.body, color: colors.ink2, marginTop: space.x2 },

  prow: { flexDirection: "row", alignItems: "center", gap: space.x4 },

  level: {
    alignItems: "center",
    paddingRight: space.x4,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  lvNum: { ...type.display, color: colors.ink, lineHeight: 38 },
  lvCap: {
    ...type.label,
    fontSize: 9.5,
    color: colors.accent,
    marginTop: space.x1 + 1,
  },

  pmid: { flex: 1, minWidth: 0 },
  xpTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: space.x2 - 2,
  },
  xpValue: { fontSize: 14, fontWeight: "700", color: colors.ink },
  xpNext: { fontSize: 11.5, color: colors.ink3 },
  xpBarTrack: {
    height: 7,
    borderRadius: 6,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  xpBarFill: {
    height: "100%",
    borderRadius: 6,
    backgroundColor: colors.accent, // solid — see LogScreen note on gradients
  },

  // Stacked (label above bar) rather than side-by-side: "Progression" /
  // "Consistency" are too wide to sit next to their own track in a
  // three-across row without squeezing it to nothing.
  comps: { flexDirection: "row", gap: space.x3, marginTop: 11 },
  comp: { flex: 1, gap: 4 },
  compLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: colors.ink3,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  compTrack: {
    height: 5,
    borderRadius: 4,
    backgroundColor: colors.bg,
    overflow: "hidden",
  },
  compFill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: colors.ink2,
  },
  compFillAccent: { backgroundColor: colors.accent },

  streak: { alignItems: "center", paddingLeft: space.x1 },
  streakFlame: { textAlign: "center" },
  streakNum: {
    fontSize: 19,
    fontWeight: "800",
    color: colors.amber,
    marginTop: 2,
  },
  streakCap: { fontSize: 10, color: colors.ink3, letterSpacing: 0.6 },

  groupsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.x2 - 2,
    marginTop: space.x3,
    paddingTop: space.x3,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  groupChip: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.chip - 2,
  },
  groupText: { fontSize: 12, fontWeight: "600", color: colors.ink2 },

  pressed: { opacity: 0.7 },
});
